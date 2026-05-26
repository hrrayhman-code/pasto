-- ============================================================
-- PASTO REVIEWS — Supabase schema
-- ============================================================
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query.
-- It is safe to re-run; everything is idempotent.
-- ============================================================

-- ----- Table -----
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  location    text,
  rating      smallint    not null check (rating between 1 and 5),
  quote       text        not null,
  status      text        not null default 'pending'
                check (status in ('pending','approved','rejected')),
  pinned      boolean     not null default false,
  likes       int         not null default 0,
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists reviews_status_idx
  on public.reviews(status);
create index if not exists reviews_display_idx
  on public.reviews(status, pinned desc, created_at desc);

-- ----- Row-Level Security -----
alter table public.reviews enable row level security;

-- Drop & recreate policies so re-running the script stays clean.
drop policy if exists "public_read_approved"  on public.reviews;
drop policy if exists "public_insert_pending" on public.reviews;
drop policy if exists "auth_all"              on public.reviews;

-- Anyone (anon) can read APPROVED reviews only.
create policy "public_read_approved"
  on public.reviews for select
  to anon, authenticated
  using (status = 'approved');

-- Anyone can submit a review, but only as 'pending' with no pinning/likes.
create policy "public_insert_pending"
  on public.reviews for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and pinned = false
    and likes = 0
  );

-- Authenticated users (i.e. the admin) can do anything.
create policy "auth_all"
  on public.reviews for all
  to authenticated
  using (true)
  with check (true);

-- ----- Atomic like increment (callable by anon) -----
create or replace function public.increment_review_likes(review_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_likes int;
begin
  update public.reviews
    set likes = likes + 1
    where id = review_id and status = 'approved'
    returning likes into new_likes;
  return new_likes;
end;
$$;

grant execute on function public.increment_review_likes(uuid)
  to anon, authenticated;

-- ============================================================
-- ORDERS — live order status tracking
-- ============================================================

create table if not exists public.orders (
  id                uuid        primary key default gen_random_uuid(),
  short_code        text        not null unique
                      default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  customer_name     text        not null,
  customer_phone    text        not null,
  customer_address  text        not null,
  notes             text,
  items             jsonb       not null,    -- [{ id, name, qty, price }]
  total             int         not null,
  status            text        not null default 'received'
                      check (status in ('received','preparing','baking','out_for_delivery','delivered','cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

-- updated_at trigger
create or replace function public.touch_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch
  before update on public.orders
  for each row execute function public.touch_orders_updated_at();

-- RLS
alter table public.orders enable row level security;

drop policy if exists "auth_orders_all" on public.orders;

-- Only authenticated (admin) can read / update / delete the full table.
-- Anonymous customers go through SECURITY DEFINER RPCs below — that
-- means we never expose phone / address / notes to the public.
create policy "auth_orders_all"
  on public.orders for all
  to authenticated
  using (true) with check (true);

-- ----- place_order RPC (callable by anon) -----
create or replace function public.place_order(
  p_name    text,
  p_phone   text,
  p_address text,
  p_notes   text,
  p_items   jsonb,
  p_total   int
)
returns table (id uuid, short_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  new_code text;
begin
  if char_length(coalesce(p_name, '')) < 2
     or char_length(coalesce(p_phone, '')) < 6
     or char_length(coalesce(p_address, '')) < 5
     or jsonb_array_length(p_items) = 0
     or p_total <= 0 then
    raise exception 'Invalid order payload';
  end if;

  insert into public.orders (customer_name, customer_phone, customer_address, notes, items, total)
    values (p_name, p_phone, p_address, p_notes, p_items, p_total)
    returning orders.id, orders.short_code into new_id, new_code;

  return query select new_id, new_code;
end;
$$;

grant execute on function public.place_order(text, text, text, text, jsonb, int)
  to anon, authenticated;

-- ----- track_order RPC (callable by anon, returns only public-safe fields) -----
create or replace function public.track_order(order_id uuid)
returns table (
  status text,
  customer_name text,
  short_code text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.status,
    split_part(o.customer_name, ' ', 1) as customer_name, -- first name only
    o.short_code,
    o.created_at,
    o.updated_at
  from public.orders o
  where o.id = order_id;
$$;

grant execute on function public.track_order(uuid) to anon, authenticated;

-- ============================================================
-- LOYALTY + COUPONS + REFERRALS
-- ============================================================

-- ----- Loyalty card per phone number -----
create table if not exists public.loyalty (
  phone           text primary key,
  name            text,
  order_count     int  not null default 0,
  free_credits    int  not null default 0,
  referral_code   text not null unique default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.loyalty enable row level security;
drop policy if exists "auth_loyalty_all" on public.loyalty;
create policy "auth_loyalty_all" on public.loyalty for all to authenticated
  using (true) with check (true);

-- ----- Coupons (manual promos + auto referral codes share this table) -----
create table if not exists public.coupons (
  code            text primary key,
  kind            text not null default 'promo'
                    check (kind in ('promo','referral')),
  description     text,
  discount_type   text not null check (discount_type in ('percent','flat')),
  discount_value  int  not null check (discount_value > 0),
  max_uses        int,                                  -- null = unlimited
  used_count      int  not null default 0,
  min_order_total int  not null default 0,
  expires_at      timestamptz,
  active          boolean not null default true,
  owner_phone     text,                                 -- non-null for referral codes
  created_at      timestamptz not null default now()
);

alter table public.coupons enable row level security;
drop policy if exists "auth_coupons_all" on public.coupons;
create policy "auth_coupons_all" on public.coupons for all to authenticated
  using (true) with check (true);

-- Optional: add coupon + discount columns to orders if missing
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='coupon_code') then
    alter table public.orders add column coupon_code text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='discount') then
    alter table public.orders add column discount int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='used_free_credit') then
    alter table public.orders add column used_free_credit boolean not null default false;
  end if;
end $$;


-- ----- Validate coupon (callable by anon for live checkout preview) -----
create or replace function public.validate_coupon(p_code text, p_total int)
returns table (
  code text, description text, discount_type text, discount_value int,
  computed_discount int, ok boolean, reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coupons%rowtype;
  d int;
begin
  select * into c from public.coupons where upper(coupons.code) = upper(p_code);
  if not found then
    return query select p_code, null::text, null::text, null::int, 0, false, 'Code not found';
    return;
  end if;
  if not c.active then
    return query select c.code, c.description, c.discount_type, c.discount_value, 0, false, 'Code inactive';
    return;
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return query select c.code, c.description, c.discount_type, c.discount_value, 0, false, 'Code expired';
    return;
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return query select c.code, c.description, c.discount_type, c.discount_value, 0, false, 'Code fully redeemed';
    return;
  end if;
  if p_total < c.min_order_total then
    return query select c.code, c.description, c.discount_type, c.discount_value, 0, false,
      'Minimum order Rs. ' || c.min_order_total;
    return;
  end if;

  if c.discount_type = 'percent' then
    d := round(p_total * c.discount_value / 100.0);
  else
    d := c.discount_value;
  end if;
  d := least(d, p_total); -- never discount more than the total

  return query select c.code, c.description, c.discount_type, c.discount_value, d, true, null::text;
end;
$$;

grant execute on function public.validate_coupon(text, int) to anon, authenticated;


-- ----- Get loyalty status (callable by anon for customer lookup) -----
create or replace function public.get_loyalty(p_phone text)
returns table (
  phone text, name text, order_count int, free_credits int,
  next_milestone int, progress int, referral_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.loyalty%rowtype;
begin
  select * into l from public.loyalty where loyalty.phone = p_phone;
  if not found then
    return query select p_phone, null::text, 0, 0, 5, 0, null::text;
    return;
  end if;
  return query select l.phone, l.name, l.order_count, l.free_credits,
    5 - (l.order_count % 5),                           -- orders until next free
    (l.order_count % 5),                               -- progress 0..4
    l.referral_code;
end;
$$;

grant execute on function public.get_loyalty(text) to anon, authenticated;


-- ----- Replace place_order to handle coupons, loyalty, referrals -----
drop function if exists public.place_order(text, text, text, text, jsonb, int);

create or replace function public.place_order(
  p_name        text,
  p_phone       text,
  p_address     text,
  p_notes       text,
  p_items       jsonb,
  p_total       int,
  p_coupon_code text default null,
  p_use_credit  boolean default false
)
returns table (id uuid, short_code text, referral_code text, discount int, free_used boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id          uuid;
  new_code        text;
  v_discount      int := 0;
  v_coupon        text := null;
  v_loyalty       public.loyalty%rowtype;
  v_free_used     boolean := false;
  v_referral_code text;
begin
  if char_length(coalesce(p_name, '')) < 2
     or char_length(coalesce(p_phone, '')) < 6
     or char_length(coalesce(p_address, '')) < 5
     or jsonb_array_length(p_items) = 0
     or p_total <= 0 then
    raise exception 'Invalid order payload';
  end if;

  -- Validate coupon
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select computed_discount, code into v_discount, v_coupon
      from public.validate_coupon(p_coupon_code, p_total)
      where ok = true;
    if v_coupon is null then
      raise exception 'Invalid or expired coupon';
    end if;
  end if;

  -- Upsert loyalty row first to ensure we have a referral_code
  insert into public.loyalty (phone, name)
    values (p_phone, p_name)
    on conflict (phone) do update set name = excluded.name, updated_at = now()
    returning * into v_loyalty;

  -- Optionally consume a free credit (skip if discount already large)
  if p_use_credit and v_loyalty.free_credits > 0 then
    -- Free credit: discount the cheapest item price (we approximate via min item price in payload)
    declare cheapest int;
    begin
      select min((it->>'price')::int) into cheapest from jsonb_array_elements(p_items) it;
      v_discount := least(p_total, v_discount + coalesce(cheapest, 0));
      v_free_used := true;
      update public.loyalty
        set free_credits = free_credits - 1, updated_at = now()
        where phone = p_phone;
    end;
  end if;

  -- Insert the order
  insert into public.orders (
    customer_name, customer_phone, customer_address, notes, items, total,
    coupon_code, discount, used_free_credit
  ) values (
    p_name, p_phone, p_address, p_notes, p_items, p_total,
    v_coupon, v_discount, v_free_used
  )
  returning orders.id, orders.short_code into new_id, new_code;

  -- Bump coupon usage
  if v_coupon is not null then
    update public.coupons set used_count = used_count + 1 where code = v_coupon;
  end if;

  -- Bump loyalty order_count; award a free credit on every 5th order
  update public.loyalty
    set order_count = order_count + 1,
        free_credits = free_credits + case when (order_count + 1) % 5 = 0 then 1 else 0 end,
        updated_at = now()
    where phone = p_phone
    returning * into v_loyalty;

  v_referral_code := v_loyalty.referral_code;

  return query select new_id, new_code, v_referral_code, v_discount, v_free_used;
end;
$$;

grant execute on function public.place_order(text, text, text, text, jsonb, int, text, boolean)
  to anon, authenticated;


-- ============================================================
-- Done. Next steps:
--   1. Authentication → Users → "Add user" → create your admin
--      account (email + password). This is who logs into admin.html.
--   2. Settings → API → copy your Project URL and anon public key
--      into js/config.js (SUPABASE block).
-- ============================================================
