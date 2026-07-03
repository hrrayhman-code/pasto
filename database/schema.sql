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
        '10% off — referral reward',   -- no customer name (leaked via validate_coupon; Finding 7)
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

-- Whitelist non-secret keys only. Secrets and the prepay wallet number
-- (prepay_number/prepay_title) are deliberately excluded so anon cannot read
-- them; the wallet is returned only via place_order/track_order to an
-- order-placer. Admin sees everything via auth_settings_all below.
create policy "public_read_settings"
  on public.site_settings for select
  to anon, authenticated
  using (key in (
    'delivery_fee','free_delivery_over','hero_image_url',
    'business_hours_start','business_hours_end'
  ));

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

-- Spec #2 order columns
alter table public.orders add column if not exists alt_phone    text;
alter table public.orders add column if not exists email        text;
alter table public.orders add column if not exists subtotal     int;
alter table public.orders add column if not exists delivery_fee int not null default 0;

-- Migrate legacy payment methods to the cod/prepay model, then re-constrain.
update public.orders set payment_method = 'prepay' where payment_method = 'bank_transfer';
update public.orders set payment_method = 'cod'    where payment_method = 'card';

-- Constraints (drop + add so we can change valid values without errors on re-run)
alter table public.orders
  drop constraint if exists orders_payment_method_check,
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_method_check
    check (payment_method in ('cod','prepay')),
  add constraint orders_payment_status_check
    check (payment_status in ('pending','awaiting_verification','verified','failed'));

-- Storage bucket for payment proof uploads
-- (public bucket so admin can view; paths include UUID so URLs are unguessable)
insert into storage.buckets (id, name, public)
  values ('payment-proofs', 'payment-proofs', true) on conflict (id) do nothing;

-- Constrain uploads: images only, 5 MB cap (Finding 9).
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'payment-proofs';

drop policy if exists "anon_write_payment_proofs" on storage.objects;
drop policy if exists "public_read_payment_proofs" on storage.objects;
drop policy if exists "auth_all_payment_proofs"    on storage.objects;

create policy "anon_write_payment_proofs"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'payment-proofs');

-- NOTE: no anon SELECT policy on payment-proofs (Finding 2). Anon can upload
-- but cannot list/enumerate others' screenshots. Admin reads them via
-- auth_all_payment_proofs. (Full hardening — private bucket + signed URLs —
-- is Task 9 in the remediation plan.)

create policy "auth_all_payment_proofs"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'payment-proofs')
  with check (bucket_id = 'payment-proofs');


-- place_order — Spec #2 rewrite: server-authoritative totals (no client price/total trust),
-- server-side business-hours + delivery fee + prepay discount; cod/prepay only.
drop function if exists public.place_order(text, text, text, text, jsonb, int, text, boolean);
drop function if exists public.place_order(text, text, text, text, jsonb, int, text, boolean, text, text);

create or replace function public.place_order(
  p_name           text,
  p_phone          text,
  p_alt_phone      text,
  p_email          text,
  p_address        text,
  p_notes          text,
  p_items          jsonb,             -- [{ id, qty }] ; client price/name IGNORED
  p_coupon_code    text default null,
  p_payment_method text default 'cod'
)
returns table (
  id uuid, short_code text, referral_code text,
  subtotal int, delivery_fee int, discount int, total int,
  free_used boolean, bulk_free_amount int,
  prepay_title text, prepay_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid; new_code text;
  v_it jsonb; v_qty int; v_menu public.menu_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_subtotal int := 0; v_total_qty int := 0; v_cheapest int := 0;
  v_delivery int := 0; v_fee int := 0; v_free_over int := 0;
  v_discount int := 0; v_bulk_free int := 0; v_free_used boolean := false;
  v_coupon text := null; v_coupon_disc int := 0; v_prepay_pct int := 0;
  v_hstart text; v_hend text; v_now time;
  v_loyalty public.loyalty%rowtype; v_referral_code text;
  v_pay_status text; v_ptitle text := null; v_pnumber text := null;
begin
  if char_length(coalesce(p_name,'')) < 2 or char_length(coalesce(p_phone,'')) < 6
     or char_length(coalesce(p_address,'')) < 5
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'Invalid order payload';
  end if;
  if coalesce(p_payment_method,'cod') not in ('cod','prepay') then
    raise exception 'Invalid payment method';
  end if;
  if p_email is not null and length(trim(p_email)) > 0
     and p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid email';
  end if;

  -- Business hours (Karachi, admin-set)
  select value into v_hstart from public.site_settings where key='business_hours_start';
  select value into v_hend   from public.site_settings where key='business_hours_end';
  v_hstart := coalesce(v_hstart,'18:00'); v_hend := coalesce(v_hend,'23:00');
  v_now := (now() at time zone 'Asia/Karachi')::time;
  if v_now < v_hstart::time or v_now >= v_hend::time then
    raise exception 'We are closed right now';
  end if;

  -- Subtotal from real menu prices; snapshot items with server-side name+price
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_it->>'qty')::int, 0);
    if v_qty <= 0 then raise exception 'Invalid item quantity'; end if;
    select * into v_menu from public.menu_items where id = (v_it->>'id') and active = true;
    if not found then raise exception 'Item not available'; end if;
    v_subtotal  := v_subtotal + v_menu.price * v_qty;
    v_total_qty := v_total_qty + v_qty;
    v_items := v_items || jsonb_build_object('id',v_menu.id,'name',v_menu.name,'price',v_menu.price,'qty',v_qty);
  end loop;
  if v_subtotal <= 0 then raise exception 'Invalid order total'; end if;

  -- Delivery fee (admin-set; optional free-over threshold)
  select coalesce(value::int,0) into v_fee       from public.site_settings where key='delivery_fee';
  select coalesce(value::int,0) into v_free_over  from public.site_settings where key='free_delivery_over';
  v_fee := coalesce(v_fee,0); v_free_over := coalesce(v_free_over,0);
  v_delivery := case when v_free_over > 0 and v_subtotal >= v_free_over then 0 else v_fee end;

  -- Buy 5 get 1 free (cheapest item), server prices
  if v_total_qty >= 5 then
    select min((it->>'price')::int) into v_cheapest
      from jsonb_array_elements(v_items) it where (it->>'price')::int > 0;
    v_bulk_free := coalesce(v_cheapest,0);
    v_discount := v_discount + v_bulk_free; v_free_used := v_bulk_free > 0;
  end if;

  -- Coupon (row-locked; validated against the SERVER subtotal)
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    perform 1 from public.coupons
      where upper(code)=upper(p_coupon_code) and (max_uses is null or used_count<max_uses) for update;
    select computed_discount, code into v_coupon_disc, v_coupon
      from public.validate_coupon(p_coupon_code, v_subtotal, p_phone) where ok=true;
    if v_coupon is null then raise exception 'Invalid or expired coupon'; end if;
    v_discount := v_discount + v_coupon_disc;
  end if;

  -- Prepay discount (admin-controlled %)
  if p_payment_method='prepay' then
    select coalesce(value::int,0) into v_prepay_pct from public.site_settings where key='prepay_discount_percent';
    v_discount := v_discount + round(v_subtotal * coalesce(v_prepay_pct,0) / 100.0);
  end if;

  v_discount := least(v_discount, v_subtotal);
  v_pay_status := case when p_payment_method='prepay' then 'awaiting_verification' else 'pending' end;

  insert into public.loyalty (phone, name) values (p_phone, p_name)
    on conflict (phone) do update set name=excluded.name, updated_at=now()
    returning * into v_loyalty;

  insert into public.orders (
    customer_name, customer_phone, alt_phone, email, customer_address, notes,
    items, subtotal, delivery_fee, discount, total, coupon_code, used_free_credit,
    payment_method, payment_status
  ) values (
    p_name, p_phone, p_alt_phone, p_email, p_address, p_notes,
    v_items, v_subtotal, v_delivery, v_discount, v_subtotal + v_delivery - v_discount,
    v_coupon, v_free_used, p_payment_method, v_pay_status
  ) returning orders.id, orders.short_code into new_id, new_code;

  if v_coupon is not null then update public.coupons set used_count=used_count+1 where code=v_coupon; end if;
  update public.loyalty set order_count=order_count+1, updated_at=now()
    where phone=p_phone returning * into v_loyalty;
  v_referral_code := v_loyalty.referral_code;

  if p_payment_method='prepay' then
    select value into v_ptitle  from public.site_settings where key='prepay_title';
    select value into v_pnumber from public.site_settings where key='prepay_number';
  end if;

  return query select new_id, new_code, v_referral_code,
    v_subtotal, v_delivery, v_discount, v_subtotal + v_delivery - v_discount,
    v_free_used, v_bulk_free, v_ptitle, v_pnumber;
end;
$$;

grant execute on function public.place_order(
  text, text, text, text, text, text, jsonb, text, text
) to anon, authenticated;


-- track_order — Spec #2: also returns prepay wallet details for an unverified
-- prepay order (so the confirmation/tracker can show "pay here" across reloads).
drop function if exists public.track_order(uuid);

create or replace function public.track_order(order_id uuid)
returns table (
  status text,
  customer_name text,
  short_code text,
  payment_status text,
  payment_method text,
  created_at timestamptz,
  updated_at timestamptz,
  prepay_title text,
  prepay_number text
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
    o.updated_at,
    case when o.payment_method = 'prepay' and o.payment_status <> 'verified'
      then (select value from public.site_settings where key = 'prepay_title') end,
    case when o.payment_method = 'prepay' and o.payment_status <> 'verified'
      then (select value from public.site_settings where key = 'prepay_number') end
  from public.orders o
  where o.id = order_id;
$$;

grant execute on function public.track_order(uuid) to anon, authenticated;


-- attach_payment_proof — Spec #2: lets an anon order-placer attach their payment
-- screenshot AFTER placing a prepay order (the wallet number is only revealed
-- post-order). SECURITY DEFINER so anon can update just this one order row.
create or replace function public.attach_payment_proof(p_order_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set payment_proof_url = p_url, payment_status = 'awaiting_verification'
   where id = p_order_id and payment_method = 'prepay'
     and payment_status in ('pending','awaiting_verification');
end;
$$;
grant execute on function public.attach_payment_proof(uuid, text) to anon, authenticated;


-- ============================================================
-- WEB PUSH — owner PWA order alerts (replaces Telegram; Spec #1)
-- ============================================================
-- pg_net stays (used by the pg_cron re-alert sweep in
-- database/cron-push-alerts.sql).
create extension if not exists pg_net with schema extensions;

-- One row per installed admin device.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_id    uuid not null default auth.uid(),
  label      text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own_push_subs" on public.push_subscriptions;
-- Only the logged-in admin manages their own device subscriptions; anon has none.
create policy "own_push_subs" on public.push_subscriptions for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Acknowledgement state on orders (drives the re-alert loop).
alter table public.orders add column if not exists alert_acked boolean not null default false;
alter table public.orders add column if not exists acked_at   timestamptz;

-- Auto-acknowledge when the owner advances an order off 'received'.
create or replace function public.ack_alert_on_status_change()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'received' and NEW.status is distinct from 'received'
     and NEW.alert_acked = false then
    NEW.alert_acked := true;
    NEW.acked_at := now();
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_ack_on_status on public.orders;
create trigger trg_ack_on_status before update of status on public.orders
  for each row execute function public.ack_alert_on_status_change();

-- Remove the old Telegram path entirely (Critical #1 surface deleted, not patched).
drop trigger if exists trg_notify_telegram_on_order on public.orders;
drop function if exists public.notify_telegram_on_new_order();
delete from public.site_settings where key in ('telegram_bot_token','telegram_chat_id');


-- ============================================================
-- REALTIME — push new orders to admin dashboard instantly
-- ============================================================
-- Adds public.orders + public.launch_signups to the realtime
-- publication so admin.html can subscribe to inserts and play
-- a sound / show a notification the moment they land.
do $$ begin
  begin
    execute 'alter publication supabase_realtime add table public.orders';
  exception when duplicate_object then null; when others then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.launch_signups';
  exception when duplicate_object then null; when others then null;
  end;
end $$;


-- Seed default site settings (Spec #2: prepay wallet + delivery + business hours).
insert into public.site_settings (key, value) values
  ('delivery_fee',            '250'),
  ('free_delivery_over',      '0'),
  ('prepay_discount_percent', '5'),
  ('business_hours_start',    '18:00'),
  ('business_hours_end',      '23:00'),
  ('prepay_title',            'Pasto by Aiman'),
  ('prepay_number',           '')
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
