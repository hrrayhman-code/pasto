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

-- NOTE: place_order + track_order are defined further down at the end of
-- the file, after all the columns they reference (payment_method, etc.)
-- have been added. Keeping their definitions in one place avoids the
-- "cannot change return type of existing function" error when re-running
-- this script.

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
-- p_phone is optional: when provided, prevents customers from redeeming
-- their own referral code on their own order.
drop function if exists public.validate_coupon(text, int);
drop function if exists public.validate_coupon(text, int, text);

create or replace function public.validate_coupon(p_code text, p_total int, p_phone text default null)
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
  -- Prevent self-use of your own referral code
  if c.kind = 'referral' and c.owner_phone is not null and p_phone is not null
     and c.owner_phone = p_phone then
    return query select c.code, c.description, c.discount_type, c.discount_value, 0, false,
      'You cannot use your own referral code';
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

grant execute on function public.validate_coupon(text, int, text) to anon, authenticated;


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


-- (Intermediate place_order definition removed — the canonical
--  version with payment_method support lives at the end of this file.)


-- ============================================================
-- REFERRAL CODE ACTIVATION
-- ============================================================
-- When an order is marked 'delivered', this trigger upserts a coupon
-- row keyed on the customer's referral_code, granting 10% off to anyone
-- (other than the owner) who redeems it. This guarantees the referrer
-- must have actually completed an order before their code is live.
-- ============================================================
create or replace function public.activate_referral_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral_code text;
  v_customer_name text;
begin
  if NEW.status = 'delivered'
     and (OLD.status is null or OLD.status <> 'delivered')
  then
    select referral_code, name
      into v_referral_code, v_customer_name
      from public.loyalty
      where phone = NEW.customer_phone;

    if v_referral_code is not null then
      insert into public.coupons (
        code, kind, description,
        discount_type, discount_value,
        owner_phone, active, min_order_total
      ) values (
        v_referral_code, 'referral',
        '10% off — referred by ' || coalesce(v_customer_name, NEW.customer_name),
        'percent', 10,
        NEW.customer_phone, true, 0
      )
      on conflict (code) do update
        set active = true,
            description = excluded.description;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_activate_referral on public.orders;
create trigger trg_activate_referral
  after update of status on public.orders
  for each row execute function public.activate_referral_on_delivery();


-- ============================================================
-- MENU ITEMS  (admin-managed via admin.html → Menu tab)
-- ============================================================
create table if not exists public.menu_items (
  id           text primary key,                 -- short slug, used as cart key
  name         text not null,
  description  text not null default '',
  price        int  not null check (price > 0),
  tag          text not null default 'signature',
  tag_label    text not null default 'Signature',
  image_url    text,                             -- Supabase Storage URL
  icon_color   text not null default '#FFF8F0',
  accent_color text not null default '#E63946',
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.touch_menu_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_menu_touch on public.menu_items;
create trigger trg_menu_touch
  before update on public.menu_items
  for each row execute function public.touch_menu_updated_at();

alter table public.menu_items enable row level security;
drop policy if exists "public_read_active_menu" on public.menu_items;
drop policy if exists "auth_menu_all"           on public.menu_items;

create policy "public_read_active_menu"
  on public.menu_items for select
  to anon, authenticated
  using (active = true);

create policy "auth_menu_all"
  on public.menu_items for all
  to authenticated using (true) with check (true);

-- Seed the five existing items so existing carts / orders keep working.
-- Re-running this won't clobber edits because of ON CONFLICT DO NOTHING.
insert into public.menu_items (id, name, description, price, tag, tag_label, icon_color, accent_color, sort_order) values
  ('alfredo','Pasta Alfredo','Creamy parmigiano-laced sauce over hand-rolled fettuccine, with cracked black pepper and a hint of nutmeg.',650,'signature','Signature','#FFF8F0','#E63946',1),
  ('pink','Pink Sauce Pasta','Slow-simmered tomato cream sauce with garlic, herbs, and a touch of chili. Comforting, balanced, addictive.',700,'signature','Signature','#FFE0E0','#E63946',2),
  ('green','Lean Green Pasta','Fresh basil pesto with spinach, olive oil, garlic, and parmigiano. Bright, herby, satisfying.',750,'spicy','Spicy','#E8F0E2','#2d6a3f',3),
  ('garlic','Classic Garlic Bread','Buttery, garlicky, herbed bread toasted till the edges crisp. Made fresh, never reheated.',250,'veg','Side','#F5E8C8','#C9A876',4),
  ('sausage','Smoky Sausage Bruschetta','Toasted bread topped with smoky sausage, tomato, herbs, and olive oil. Hearty bite-sized starter.',350,'spicy','Side','#FFE0CC','#d97706',5)
on conflict (id) do nothing;


-- ============================================================
-- SITE SETTINGS  (key/value bag for things like hero image URL)
-- ============================================================
create table if not exists public.site_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;
drop policy if exists "public_read_settings" on public.site_settings;
drop policy if exists "auth_settings_all"    on public.site_settings;

create policy "public_read_settings"
  on public.site_settings for select
  to anon, authenticated using (true);

create policy "auth_settings_all"
  on public.site_settings for all
  to authenticated using (true) with check (true);


-- ============================================================
-- STORAGE — buckets for menu item photos and the hero image
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('menu-images', 'menu-images', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('site-images', 'site-images', true) on conflict (id) do nothing;

-- Storage RLS: public read, authenticated write.
drop policy if exists "public_read_menu_images" on storage.objects;
drop policy if exists "auth_write_menu_images"  on storage.objects;
drop policy if exists "public_read_site_images" on storage.objects;
drop policy if exists "auth_write_site_images"  on storage.objects;

create policy "public_read_menu_images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'menu-images');

create policy "auth_write_menu_images"
  on storage.objects for all to authenticated
  using (bucket_id = 'menu-images')
  with check (bucket_id = 'menu-images');

create policy "public_read_site_images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'site-images');

create policy "auth_write_site_images"
  on storage.objects for all to authenticated
  using (bucket_id = 'site-images')
  with check (bucket_id = 'site-images');


-- ============================================================
-- PAYMENTS — add method/status/proof columns to orders
-- ============================================================
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='payment_method') then
    alter table public.orders add column payment_method text not null default 'cod';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='payment_status') then
    alter table public.orders add column payment_status text not null default 'pending';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='payment_proof_url') then
    alter table public.orders add column payment_proof_url text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='orders' and column_name='payment_reference') then
    alter table public.orders add column payment_reference text;
  end if;
end $$;

-- Constraints (drop + add so we can change valid values without errors on re-run)
alter table public.orders
  drop constraint if exists orders_payment_method_check,
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method in ('cod','bank_transfer','card')),
  add constraint orders_payment_status_check
    check (payment_status in ('pending','awaiting_verification','verified','failed'));

-- Storage bucket for payment proof uploads
-- (public bucket so admin can view; paths include UUID so URLs are unguessable)
insert into storage.buckets (id, name, public)
  values ('payment-proofs', 'payment-proofs', true) on conflict (id) do nothing;

drop policy if exists "anon_write_payment_proofs" on storage.objects;
drop policy if exists "public_read_payment_proofs" on storage.objects;
drop policy if exists "auth_all_payment_proofs"    on storage.objects;

create policy "anon_write_payment_proofs"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'payment-proofs');

create policy "public_read_payment_proofs"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'payment-proofs');

create policy "auth_all_payment_proofs"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'payment-proofs')
  with check (bucket_id = 'payment-proofs');


-- Update place_order to accept payment_method + proof URL
drop function if exists public.place_order(text, text, text, text, jsonb, int, text, boolean);
drop function if exists public.place_order(text, text, text, text, jsonb, int, text, boolean, text, text);

create or replace function public.place_order(
  p_name              text,
  p_phone             text,
  p_address           text,
  p_notes             text,
  p_items             jsonb,
  p_total             int,
  p_coupon_code       text default null,
  p_use_credit        boolean default false,
  p_payment_method    text default 'cod',
  p_payment_proof_url text default null
)
returns table (
  id uuid, short_code text, referral_code text,
  discount int, free_used boolean, bulk_free_amount int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id          uuid;
  new_code        text;
  v_discount      int := 0;
  v_coupon        text := null;
  v_coupon_disc   int := 0;
  v_loyalty       public.loyalty%rowtype;
  v_total_qty     int := 0;
  v_cheapest      int := 0;
  v_bulk_free     int := 0;
  v_free_used     boolean := false;
  v_referral_code text;
  v_pay_method    text;
  v_pay_status    text;
begin
  if char_length(coalesce(p_name, '')) < 2
     or char_length(coalesce(p_phone, '')) < 6
     or char_length(coalesce(p_address, '')) < 5
     or jsonb_array_length(p_items) = 0
     or p_total <= 0 then
    raise exception 'Invalid order payload';
  end if;

  v_pay_method := coalesce(p_payment_method, 'cod');
  if v_pay_method not in ('cod', 'bank_transfer', 'card') then
    raise exception 'Invalid payment method';
  end if;

  -- Initial payment status by method
  v_pay_status := case v_pay_method
    when 'bank_transfer' then 'awaiting_verification'
    when 'card' then 'pending'           -- admin sends payment link
    else 'pending'                       -- COD: pay on delivery
  end;

  -- Buy 5 get 1 free
  select coalesce(sum((it->>'qty')::int), 0) into v_total_qty
    from jsonb_array_elements(p_items) it;
  if v_total_qty >= 5 then
    select min((it->>'price')::int) into v_cheapest
      from jsonb_array_elements(p_items) it
      where (it->>'price')::int > 0;
    v_bulk_free := coalesce(v_cheapest, 0);
    v_discount := v_discount + v_bulk_free;
    v_free_used := v_bulk_free > 0;
  end if;

  -- Coupon
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    select computed_discount, code into v_coupon_disc, v_coupon
      from public.validate_coupon(p_coupon_code, p_total, p_phone)
      where ok = true;
    if v_coupon is null then
      raise exception 'Invalid or expired coupon';
    end if;
    v_discount := v_discount + v_coupon_disc;
  end if;

  -- Bank transfer: 5% off the subtotal, applied automatically
  if v_pay_method = 'bank_transfer' then
    v_discount := v_discount + round(p_total * 5 / 100.0);
  end if;

  v_discount := least(v_discount, p_total);

  -- Upsert loyalty
  insert into public.loyalty (phone, name)
    values (p_phone, p_name)
    on conflict (phone) do update set name = excluded.name, updated_at = now()
    returning * into v_loyalty;

  -- Insert order
  insert into public.orders (
    customer_name, customer_phone, customer_address, notes, items, total,
    coupon_code, discount, used_free_credit,
    payment_method, payment_status, payment_proof_url
  ) values (
    p_name, p_phone, p_address, p_notes, p_items, p_total,
    v_coupon, v_discount, v_free_used,
    v_pay_method, v_pay_status, p_payment_proof_url
  )
  returning orders.id, orders.short_code into new_id, new_code;

  if v_coupon is not null then
    update public.coupons set used_count = used_count + 1 where code = v_coupon;
  end if;

  update public.loyalty
    set order_count = order_count + 1, updated_at = now()
    where phone = p_phone
    returning * into v_loyalty;

  v_referral_code := v_loyalty.referral_code;

  return query select new_id, new_code, v_referral_code, v_discount, v_free_used, v_bulk_free;
end;
$$;

grant execute on function public.place_order(
  text, text, text, text, jsonb, int, text, boolean, text, text
) to anon, authenticated;


-- Update track_order to also return payment info
drop function if exists public.track_order(uuid);

create or replace function public.track_order(order_id uuid)
returns table (
  status text,
  customer_name text,
  short_code text,
  payment_status text,
  payment_method text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.status,
    split_part(o.customer_name, ' ', 1),
    o.short_code,
    o.payment_status,
    o.payment_method,
    o.created_at,
    o.updated_at
  from public.orders o
  where o.id = order_id;
$$;

grant execute on function public.track_order(uuid) to anon, authenticated;


-- Seed default site settings for bank account if missing
insert into public.site_settings (key, value) values
  ('bank_name',         ''),
  ('bank_account_title','Pasto by Aiman'),
  ('bank_account_number',''),
  ('bank_iban',         ''),
  ('bank_branch_code',  ''),
  ('payment_card_note', 'After you submit, we will WhatsApp you a secure payment link. Pay there and your order goes into the kitchen.')
on conflict (key) do nothing;


-- ============================================================
-- LAUNCH SIGNUPS — pre-launch notify list
-- ============================================================
create table if not exists public.launch_signups (
  id          uuid        primary key default gen_random_uuid(),
  name        text,
  phone       text        not null,
  source      text                  default 'website',
  notified    boolean     not null default false,
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists launch_signups_phone_idx on public.launch_signups(phone);
create index if not exists launch_signups_notified_idx on public.launch_signups(notified);

alter table public.launch_signups enable row level security;

drop policy if exists "public_insert_signup"  on public.launch_signups;
drop policy if exists "auth_signups_all"      on public.launch_signups;

-- Anyone can submit a signup. They cannot read others' signups.
create policy "public_insert_signup"
  on public.launch_signups for insert
  to anon, authenticated
  with check (length(phone) >= 6);

-- Admin (authenticated) can read, update, delete.
create policy "auth_signups_all"
  on public.launch_signups for all
  to authenticated
  using (true) with check (true);


-- ============================================================
-- Done. Next steps:
--   1. Authentication → Users → "Add user" → create your admin
--      account (email + password). This is who logs into admin.html.
--   2. Settings → API → copy your Project URL and anon public key
--      into js/config.js (SUPABASE block).
-- ============================================================
