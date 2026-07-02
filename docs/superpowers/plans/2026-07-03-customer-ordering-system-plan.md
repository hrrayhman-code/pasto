# Customer Ordering System — Implementation Plan (Spec #2)

> **For agentic workers:** Use superpowers:executing-plans. No test runner (static site) — "verify" steps are DevTools/SQL checks. Steps use `- [ ]`.

**Goal:** Fully in-app ordering (no WhatsApp hand-off), COD + Easypaisa/JazzCash prepay (wallet revealed only post-order), flat admin-set delivery fee, and a server-authoritative `place_order` that recomputes totals from real menu prices and rejects after-hours orders. Owner confirms via a WhatsApp button on each admin order.

**Spec:** `docs/superpowers/specs/2026-07-03-customer-ordering-system-design.md`

## Global Constraints
- **Free only** — no card gateway. Prepay = wallet number + screenshot, owner verifies.
- Nothing is live until deployed: backend = re-run `schema.sql`; client = merge to `main` (Vercel auto-deploys).
- `payment_method` ∈ `('cod','prepay')`. Prepay wallet number (`prepay_number`/`prepay_title`) is **never** in the public `site_settings` read-whitelist — reachable only via `place_order`/`track_order` RPCs by an order-placer.
- Server total = `subtotal(from menu_items) + delivery_fee − discount`. Client numbers are display-only.
- Business hours admin-set in `site_settings` (`business_hours_start`/`end`, Karachi time), enforced in `place_order`.
- No inline `onclick` built from data (use `data-*` + delegated listeners, per the Finding 6 pattern).

## Sequencing note (Option B → post-order upload)
The wallet number is shown only **after** the order is placed, so the customer cannot upload the proof before placing. Therefore: `place_order` no longer takes a proof URL; a prepay order starts `payment_status='awaiting_verification'` with no proof; the confirmation screen reveals the wallet number + an upload control; uploading calls a new anon RPC `attach_payment_proof(order_id, url)`.

## File structure
- Modify `database/schema.sql` — orders columns, `payment_method` migration, `site_settings` seeds + whitelist, **rewrite `place_order`**, extend `track_order`, add `attach_payment_proof`, drop the dead free-credit path.
- Modify `js/supabase-client.js` — `OrdersAPI.place` (new signature), `OrdersAPI.attachPaymentProof`.
- Modify `index.html` — checkout modal fields + payment picker; confirmation modal prepay block.
- Modify `js/app.js` — `submitOrder` rewrite (no WhatsApp), payment UI, confirmation reveal + upload, remove bank-at-checkout + free-credit UI.
- Modify `admin.html` + `js/admin.js` — Site tab settings (prepay/delivery/discount/hours), order-row WhatsApp button.

---

## Task 1: Schema — orders columns, payment migration, settings, `place_order` rewrite

**Files:** Modify `database/schema.sql`.

**Interfaces produced:** `place_order(p_name,p_phone,p_alt_phone,p_email,p_address,p_notes,p_items,p_coupon_code,p_payment_method)` returning `(id, short_code, referral_code, subtotal, delivery_fee, discount, total, free_used, bulk_free_amount, prepay_title, prepay_number)`; `attach_payment_proof(order_id uuid, url text)`; `track_order` extended with `prepay_title, prepay_number`.

- [ ] **Step 1: orders columns** (add near the other `alter table public.orders add column if not exists` blocks):
```sql
alter table public.orders add column if not exists alt_phone    text;
alter table public.orders add column if not exists email        text;
alter table public.orders add column if not exists subtotal     int;
alter table public.orders add column if not exists delivery_fee int not null default 0;
```

- [ ] **Step 2: payment_method → cod/prepay** (replace the existing method constraint block):
```sql
-- migrate legacy values then re-constrain
update public.orders set payment_method = 'prepay' where payment_method = 'bank_transfer';
update public.orders set payment_method = 'cod'    where payment_method = 'card';
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add  constraint orders_payment_method_check
  check (payment_method in ('cod','prepay'));
```

- [ ] **Step 3: settings seeds + whitelist.** Add seeds (near the other `insert into public.site_settings ... on conflict do nothing`):
```sql
insert into public.site_settings (key, value) values
  ('prepay_discount_percent','5'),
  ('free_delivery_over','0'),
  ('business_hours_start','18:00'),
  ('business_hours_end','23:00'),
  ('prepay_title','Pasto by Aiman'),
  ('prepay_number','')
on conflict (key) do nothing;
```
Update the `public_read_settings` whitelist policy: **remove** `bank_*`, **add** `business_hours_start`,`business_hours_end`,`free_delivery_over` (keep `delivery_fee`,`hero_image_url`; keep `payment_card_note` optional; **do NOT** add `prepay_number`/`prepay_title`):
```sql
drop policy if exists "public_read_settings" on public.site_settings;
create policy "public_read_settings" on public.site_settings for select
  to anon, authenticated
  using (key in (
    'delivery_fee','free_delivery_over','hero_image_url',
    'business_hours_start','business_hours_end'
  ));
```

- [ ] **Step 4: rewrite `place_order`** — drop old signatures, create new. Place it where the current `place_order` lives (the canonical one near the end):
```sql
drop function if exists public.place_order(text,text,text,text,jsonb,int,text,boolean,text,text);
drop function if exists public.place_order(text,text,text,text,jsonb,int,text,boolean);

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
language plpgsql security definer set search_path = public
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

  -- Subtotal from real menu prices; snapshot items
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

  -- Delivery fee
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

  -- Coupon (row-locked; validated against server subtotal)
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    perform 1 from public.coupons
      where upper(code)=upper(p_coupon_code) and (max_uses is null or used_count<max_uses) for update;
    select computed_discount, code into v_coupon_disc, v_coupon
      from public.validate_coupon(p_coupon_code, v_subtotal, p_phone) where ok=true;
    if v_coupon is null then raise exception 'Invalid or expired coupon'; end if;
    v_discount := v_discount + v_coupon_disc;
  end if;

  -- Prepay discount (admin %)
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
end; $$;

grant execute on function public.place_order(text,text,text,text,text,text,jsonb,text,text)
  to anon, authenticated;
```

- [ ] **Step 5: `attach_payment_proof` RPC:**
```sql
create or replace function public.attach_payment_proof(p_order_id uuid, p_url text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.orders
     set payment_proof_url = p_url, payment_status = 'awaiting_verification'
   where id = p_order_id and payment_method = 'prepay'
     and payment_status in ('pending','awaiting_verification');
end; $$;
grant execute on function public.attach_payment_proof(uuid, text) to anon, authenticated;
```

- [ ] **Step 6: extend `track_order`** to return prepay details for unverified prepay orders (drop + recreate):
```sql
drop function if exists public.track_order(uuid);
create or replace function public.track_order(order_id uuid)
returns table (status text, customer_name text, short_code text,
  payment_status text, payment_method text, created_at timestamptz, updated_at timestamptz,
  prepay_title text, prepay_number text)
language sql security definer set search_path = public as $$
  select o.status, split_part(o.customer_name,' ',1), o.short_code,
    o.payment_status, o.payment_method, o.created_at, o.updated_at,
    case when o.payment_method='prepay' and o.payment_status<>'verified'
      then (select value from public.site_settings where key='prepay_title') end,
    case when o.payment_method='prepay' and o.payment_status<>'verified'
      then (select value from public.site_settings where key='prepay_number') end
  from public.orders o where o.id = order_id;
$$;
grant execute on function public.track_order(uuid) to anon, authenticated;
```

- [ ] **Step 7: Deploy + verify.** Re-run `schema.sql`. Then in SQL Editor (during business hours, or temporarily set `business_hours_start='00:00'`, `business_hours_end='23:59'` to test):
```sql
select * from public.place_order('Test','03001234567',null,null,'Test address',null,
  '[{"id":"alfredo","qty":1}]'::jsonb, null, 'cod');   -- returns total=650(+fee), etc.
```
Confirm the returned `subtotal` matches the real menu price (ignores any client value), and `total = subtotal + delivery_fee`. Then `delete from orders where customer_name='Test';`. Verify anon cannot read the wallet number: logged-out `await sb.from('site_settings').select('*')` must NOT include `prepay_number`.
- [ ] **Step 8: Commit** `database/schema.sql`.

## Task 2: Client API — `OrdersAPI.place` new signature + `attachPaymentProof`

**Files:** Modify `js/supabase-client.js`.

- [ ] **Step 1: Replace `OrdersAPI.place`** to the new params (drop `total`/`useCredit`; add `altPhone`/`email`; items are `[{id,qty}]`; no proof at placement):
```js
  async place({ name, phone, altPhone, email, address, notes, items, couponCode, paymentMethod }) {
    const { data, error } = await sb.rpc('place_order', {
      p_name: name, p_phone: phone, p_alt_phone: altPhone || null, p_email: email || null,
      p_address: address, p_notes: notes || null,
      p_items: items, p_coupon_code: couponCode || null,
      p_payment_method: paymentMethod || 'cod'
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No order returned from server');
    return row;
  },
```
- [ ] **Step 2: Add `attachPaymentProof`** (upload then attach via RPC):
```js
  async attachPaymentProof(orderId, file) {
    const url = await this.uploadPaymentProof(file);     // existing uploader (UUID filename)
    const { error } = await sb.rpc('attach_payment_proof', { p_order_id: orderId, p_url: url });
    if (error) throw error;
    return url;
  },
```
- [ ] **Step 3:** `node --check js/supabase-client.js`. **Commit.**

## Task 3: Checkout modal markup (index.html)

**Files:** Modify `index.html` (checkout modal `572`–`649`; confirmation modal).

- [ ] **Step 1: Add alt-phone + email fields** after the phone field (`582`):
```html
    <div class="field">
      <label for="custAltPhone">Alternate phone (optional)</label>
      <input type="tel" id="custAltPhone" placeholder="Another number we can reach you on">
    </div>
    <div class="field">
      <label for="custEmail">Email (optional)</label>
      <input type="email" id="custEmail" placeholder="For an order confirmation">
    </div>
```
- [ ] **Step 2: Replace the payment picker** (`601`–`642`): keep COD; replace the `bank_transfer` option with `prepay` (Easypaisa/JazzCash); delete the `card` panel; replace the bank-details panel with a prepay note (number is revealed post-order, not here):
```html
    <div class="field">
      <label>Payment method</label>
      <div class="pay-picker" id="payPicker">
        <label class="pay-option active">
          <input type="radio" name="payMethod" value="cod" checked onchange="onPayMethodChange()">
          <span class="pay-option-body"><span class="pay-option-title">Cash on delivery</span>
          <span class="pay-option-desc">Pay the rider when your order arrives.</span></span>
        </label>
        <label class="pay-option pay-option-promo">
          <input type="radio" name="payMethod" value="prepay" onchange="onPayMethodChange()">
          <span class="pay-option-body"><span class="pay-option-title">Prepay (Easypaisa / JazzCash) <span class="pay-option-badge" id="prepayBadge"></span></span>
          <span class="pay-option-desc">Pay in advance and save. We'll show the number after you place the order.</span></span>
        </label>
      </div>
    </div>
    <div class="pay-panel" id="prepayPanel" hidden>
      <p class="pay-card-note">After you place the order, you'll see our Easypaisa/JazzCash number and can upload your payment screenshot on the confirmation screen.</p>
    </div>
```
- [ ] **Step 3: Add a prepay block to the confirmation modal** (wherever the post-order confirmation/tracker renders — see Task 4). Add a container:
```html
    <div class="prepay-reveal" id="prepayReveal" hidden></div>
```
- [ ] **Step 4:** Update the modal subtitle (`574`) to drop the WhatsApp promise: `Fill in your details — we'll start on your order right away.` **Commit** `index.html`.

## Task 4: Checkout JS rewrite (app.js) — no WhatsApp, server totals, prepay reveal

**Files:** Modify `js/app.js`.

- [ ] **Step 1: Repurpose payment UI.** Replace `loadBankDetails`/`bankTransferDiscount` usage: delete `loadBankDetails` call in `openCheckoutModal` (`1209`); in `onPayMethodChange` (`1271`) toggle `prepayPanel` on `method==='prepay'` (remove `bankPanel`/`cardPanel` refs). Set `#prepayBadge` text to the admin prepay % (read from `SettingsAPI` isn't whitelisted for prepay %, so read it from a value the server returns or just show "SAVE %"). Simplest: show a static "SAVE" badge; the exact % appears on the confirmation total.
- [ ] **Step 2: Rewrite `submitOrder`** (`1445`–~`1600`):
  - Keep the client business-hours guard (UX), but the server also enforces it.
  - Read `custName, custPhone, custAltPhone, custEmail, custAddress, custNotes, custCoupon`.
  - `items = Object.entries(cart).map(([id, qty]) => ({ id, qty }))` — **no price/name**.
  - `const payMethod = selectedPayMethod();` (`cod`|`prepay`).
  - **Remove** the pre-submit proof upload entirely (it moves post-order).
  - Call `OrdersAPI.place({ name, phone, altPhone, email, address, notes, items, couponCode: coupon, paymentMethod: payMethod })`.
  - **Delete** all WhatsApp message building + `window.open`. On success, store the active order in `localStorage` (as today) and **open the confirmation modal** (Task's Step 3) instead of WhatsApp.
  - Map friendly errors: add a case for `We are closed right now` → show the closed modal; `Item not available` → "An item is no longer available — please refresh your cart."
- [ ] **Step 3: Confirmation reveal for prepay.** After a successful prepay order, render into `#prepayReveal`:
```js
if (placed.prepay_number) {
  const el = document.getElementById('prepayReveal');
  el.hidden = false;
  el.innerHTML = `
    <div class="prepay-head">Send <strong>${CONFIG.currency} ${placed.total}</strong> to:</div>
    <div class="prepay-acct"><span>${escapeHTML(placed.prepay_title||'')}</span>
      <span class="prepay-num">${escapeHTML(placed.prepay_number)}</span>
      <button type="button" class="bank-copy" onclick="copyBank('${escapeHTML(placed.prepay_number)}')">Copy</button></div>
    <label class="prepay-upload">Upload your payment screenshot
      <input type="file" id="prepayProof" accept="image/*"></label>
    <div class="pay-proof-preview" id="prepayProofPreview" hidden></div>`;
  document.getElementById('prepayProof').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { await OrdersAPI.attachPaymentProof(placed.id, f); showToast('Screenshot received — we\'ll verify shortly'); }
    catch (err) { showToast('Upload failed — try a smaller image'); }
  });
}
```
- [ ] **Step 4: Remove loyalty free-credit UI.** Delete `_useFreeCredit`, the free-credit checkbox/stamp handling in the checkout, and any "use free credit" rendering. Keep the referral-code display in the tracker/confirmation and the Rewards phone lookup (referral only).
- [ ] **Step 5:** `node --check js/app.js`. **Commit** `js/app.js`.

## Task 5: Admin order-row "Message on WhatsApp" button (admin.js)

**Files:** Modify `js/admin.js` (`renderOrderRow` ~`500`; add a delegated handler).

- [ ] **Step 1:** In the order row actions, add (data-* wired, no inline onclick):
```html
<button class="admin-action" data-order-action="whatsapp" data-phone="${escapeHTML(o.customer_phone)}" data-name="${escapeHTML(o.customer_name)}" data-code="${escapeHTML(o.short_code)}">💬 WhatsApp</button>
```
- [ ] **Step 2:** Add one delegated listener (near the launch-signup one):
```js
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-order-action="whatsapp"]'); if (!b) return;
  let n = (b.dataset.phone||'').replace(/\D/g,''); if (n.startsWith('0')) n='92'+n.slice(1); else if(!n.startsWith('92')) n='92'+n;
  const msg = `Hi ${b.dataset.name||''}! Thanks for your Pasto order #${b.dataset.code}. We're confirming it now and will start cooking shortly. 🍝`;
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, '_blank');
});
```
- [ ] **Step 3:** `node --check js/admin.js`. **Commit.**

## Task 6: Admin Site settings — prepay / delivery / discount / hours

**Files:** Modify `admin.html` (Site section `332`+), `js/admin.js` (`loadBankSettings`/`saveBankSettings` ~`968`/`1016`).

- [ ] **Step 1:** In the Site section, replace the bank inputs (`bsTitle`/`bsNumber`/etc.) with: `prepay_title`, `prepay_number`, `delivery_fee`, `free_delivery_over`, `prepay_discount_percent`, `business_hours_start`, `business_hours_end` inputs (give ids `stPrepayTitle`, `stPrepayNumber`, `stDeliveryFee`, `stFreeOver`, `stPrepayPct`, `stHoursStart`, `stHoursEnd`).
- [ ] **Step 2:** Rewrite `loadBankSettings`→`loadStoreSettings` to populate those from `SettingsAPI.getAll()` (admin is authenticated → reads all keys incl. prepay/hours) and `saveBankSettings`→`saveStoreSettings` to `SettingsAPI.set(...)` each. Update the calls in `showDashboard` and the form's submit handler.
- [ ] **Step 3:** `node --check js/admin.js`. **Commit** `admin.html`, `js/admin.js`.

## Task 7: Deploy + end-to-end verify
- [ ] **Step 1:** Re-run `database/schema.sql` in Supabase.
- [ ] **Step 2:** In admin → Site, set your real **Easypaisa/JazzCash number**, delivery fee, prepay %, hours.
- [ ] **Step 3:** Merge `dev`→`main`, push (Vercel deploys).
- [ ] **Step 4:** During business hours, place a **COD** order end-to-end: confirmation shows code + tracker, **no WhatsApp opens**, owner gets the push (Spec #1). Place a **Prepay** order: confirmation reveals the wallet number + upload; upload a screenshot; admin sees `awaiting_verification` + the proof.
- [ ] **Step 5:** Tamper test: in DevTools, try `sb.rpc('place_order', {... p_items:[{id:'alfredo',qty:1}] ...})` — total comes back as the real menu price; confirm you cannot force a lower total. Try an order outside hours → `We are closed right now`.
- [ ] **Step 6:** Admin order row → **WhatsApp** button opens a pre-filled confirm chat.

## Self-review
- Spec coverage: fully-in-app + no WhatsApp (T3/T4), fields incl. alt_phone/email (T1/T3/T4), COD+prepay Easypaisa/JazzCash (T1/T3/T4), wallet revealed post-order only (T1 track/place return + T4 reveal; whitelist excludes it — T1/S3), admin-controlled prepay %/delivery/hours (T1/T6), server-authoritative totals + hours (T1), card removed (T1/T3), loyalty free-credit removed (T4), public bank details removed (T1 whitelist + T3/T4), admin WhatsApp confirm (T5). All mapped.
- Placeholders: none — only owner-entered settings values (wallet number etc.) are intentionally blank, entered in admin.
- Consistency: `place_order` return fields (`subtotal,delivery_fee,discount,total,prepay_title,prepay_number`) produced in T1 and consumed in T4; `attach_payment_proof(uuid,text)` produced T1, consumed T2/T4; `OrdersAPI.place`/`attachPaymentProof` produced T2, consumed T4.
- Deferred to the final hardening pass (NOT this plan): Findings 4 (`get_loyalty` PII), 5 (CDN pin/SRI), 11 (CSP), 15/17. Payment-proofs private+signed-URL (Task 9 of the alerts... actually of the security plan) also remains.
