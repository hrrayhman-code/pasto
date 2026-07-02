# Pasto Security Remediation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. This is a static site with **no test runner**, so "verify" steps are concrete browser-DevTools / SQL checks, not unit tests. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the 18 findings from the 2026-07-02 security audit and fix the one broken feature (loyalty free-credit redemption), without breaking existing flows.

**Architecture:** Static HTML/CSS/JS → Supabase (Postgres + Auth + Storage). Security boundary is **RLS + `SECURITY DEFINER` RPCs**, not the client. Backend fixes are edits to the single idempotent `database/schema.sql` (re-run in the Supabase SQL Editor to deploy). Client fixes are edits to `js/*.js` / `*.html` (redeploy static files to Vercel).

**Tech Stack:** Supabase JS v2 (CDN UMD), plain ES / DOM, PL/pgSQL.

## Global Constraints
- **No repo edit is live until deployed.** Backend = re-run `database/schema.sql`; client = redeploy static site. Nothing here touches production until you do those two things.
- Keep `database/schema.sql` **idempotent and re-runnable** (drop-then-create policies/functions; `if not exists`; `on conflict do nothing`). Follow the file's existing `drop function if exists ...` pattern before any `create or replace` that changes a return type.
- `escapeHTML()` is safe for HTML-text and **double-quoted attribute** contexts only. It is NOT safe inside a JS-string / inline `onclick`. Do not put data into inline event handlers.
- Supabase anon key in `js/config.js` is public **by design** — do not treat it as a secret; RLS is the control.

## Deploy-only actions (owner must do; cannot be done from the repo)
1. **Rotate the Telegram bot token** via @BotFather (`/revoke` → new token), then set it in Supabase (`update public.site_settings set value='<new>' where key='telegram_bot_token';`). Required because the old token must be assumed leaked (Finding 1).
2. Re-run `database/schema.sql` in Supabase SQL Editor after each backend task.
3. Redeploy the static site to Vercel after client tasks.

---

## Status legend
- ✅ **NOW** — unambiguous, no product/infra decision, implemented on `dev` this pass.
- ⏸ **DEFER** — needs your input, external keys/infra, or a live verification pass; documented here, not yet coded.

---

## Task 1 — ✅ Finding 1 (Critical): stop exposing the Telegram token to `anon`

**Files:** Modify `database/schema.sql` (policy `public_read_settings`, ~line 407-409).

**Change:** Replace the blanket `using (true)` SELECT policy with a **whitelist of non-secret keys** so the homepage still reads bank/kitchen/copy settings, but `telegram_bot_token` / `telegram_chat_id` become unreadable by `anon`.

```sql
drop policy if exists "public_read_settings" on public.site_settings;
create policy "public_read_settings"
  on public.site_settings for select
  to anon, authenticated
  using (key in (
    'bank_name','bank_account_title','bank_account_number','bank_iban',
    'bank_branch_code','payment_card_note',
    'kitchen_lat','kitchen_lng','delivery_radius_km','delivery_fee',
    'hero_image_url'
  ));
```
> `authenticated` (admin) keeps full access via the separate `auth_settings_all` policy, so the admin Site tab still reads/writes everything including the token.

- [ ] Apply edit. Re-run `schema.sql` in Supabase.
- [ ] **Verify:** in a logged-out browser console on the live site run `await sb.from('site_settings').select('*')` → result contains bank/kitchen keys but **NOT** `telegram_bot_token`. Then confirm the homepage bank-transfer details + hero image still render.
- [ ] Rotate the token (deploy-only action #1).

## Task 2 — ✅ Finding 2 + 9 (Critical/Medium): kill anonymous enumeration of payment proofs + constrain uploads

**Files:** Modify `database/schema.sql` (bucket + policies ~484-505); Modify `js/supabase-client.js` (`uploadPaymentProof`, ~153-164).

**Change A — remove anon `list`/`select` on the bucket (stops bulk enumeration — the Critical part) and add size/MIME limits.** The bucket stays public-URL-readable for now so the admin's existing `View screenshot` link keeps working; the full private-bucket + signed-URL migration is Task 9 (⏸).

```sql
-- Drop anon read/list; keep anon INSERT only.
drop policy if exists "public_read_payment_proofs" on storage.objects;
-- (auth_all_payment_proofs stays: admin can read/list)

-- Constrain uploads: images only, 5 MB cap.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'payment-proofs';
```

**Change B — unguessable object names** (defense-in-depth while the bucket is still public-URL):
```js
// js/supabase-client.js — uploadPaymentProof
const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');
const path = `${crypto.randomUUID()}.${ext}`;
```

- [ ] Apply edits. Re-run `schema.sql`; redeploy static.
- [ ] **Verify:** logged-out console `await sb.storage.from('payment-proofs').list()` → returns an **error / empty** (no enumeration). Place a test bank-transfer order with a screenshot → upload still succeeds; admin `View screenshot` link still opens it.

## Task 3 — ✅ Finding 6 (High): eliminate the launch-signup `onclick` XSS

**Files:** Modify `js/admin.js` (`renderLaunchList` ~1071-1095; add a delegated listener near ~1098).

**Change:** Stop building inline `onclick="fn('...')"` from data. Move values into **double-quoted `data-*` attributes** (where `escapeHTML` IS safe) and dispatch via one delegated click listener.

Row action block becomes:
```js
<div class="admin-row-actions">
  <button class="admin-action approve" data-signup-action="whatsapp"
    data-id="${escapeHTML(s.id)}" data-phone="${escapeHTML(s.phone)}" data-name="${escapeHTML(s.name || '')}">
    📱 WhatsApp &amp; mark notified
  </button>
  ${s.notified ? `<button class="admin-action secondary" data-signup-action="pending" data-id="${escapeHTML(s.id)}">Mark pending</button>` : ''}
  <button class="admin-action danger" data-signup-action="delete" data-id="${escapeHTML(s.id)}">Delete</button>
</div>
```
Add once (next to the existing `input` listener at ~1098):
```js
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-signup-action]');
  if (!btn) return;
  const { signupAction, id, phone, name } = btn.dataset;
  if (signupAction === 'whatsapp') whatsappOneSignup(phone || '', name || '', id);
  else if (signupAction === 'pending') toggleSignupNotified(id, false);
  else if (signupAction === 'delete') deleteSignup(id);
});
```
`whatsappOneSignup` already digit-sanitizes the phone, so no further change needed there.

- [ ] Apply edits. Redeploy static.
- [ ] **Verify:** as admin, submit a launch signup with phone `');alert(1);//` from the public form, open the admin Launch tab → **no alert fires**; clicking "WhatsApp & mark notified" opens WhatsApp with the (digit-stripped) number and marks notified.

## Task 4 — ✅ Findings 12, 13, 14 (Low, defense-in-depth): close the remaining unescaped output sinks

**Files:** Modify `js/admin.js` (order `qty`, ~469 and ~1312); Modify `js/app.js` (`avatarHTML` ~292-303, `dishVisual` ~27-90, `renderMenu` ~132-145, `renderCart` ~1114).

- **admin.js order qty** — coerce to a number (also hardens the `price*qty` math):
  - `~469`: `` `<li>${Number(it.qty)||0}× ${escapeHTML(it.name)} <span class="ord-item-price">Rs. ${(Number(it.price)||0)*(Number(it.qty)||0)}</span></li>` ``
  - `~1312`: `` `<span>${Number(it.qty)||0}× ${escapeHTML(it.name)}</span>` `` and `~1313` `` `<span>Rs. ${(Number(it.price)||0)*(Number(it.qty)||0)}</span>` ``
- **app.js `avatarHTML`** — escape the three fields:
  - `~294`: `` `<img class="review-avatar-img" src="${escapeHTML(review.imageUrl)}" alt="${escapeHTML(review.name)}" loading="lazy">` ``
  - `~301-302`: `const bg = /^#[0-9a-fA-F]{3,8}$/.test(review.accentColor || '') ? review.accentColor : palette[idx];` then use `${bg}` (validated hex).
- **app.js menu fields** — wrap in `escapeHTML(...)` on output (source is `menu_items`, admin-managed; matches what `admin.js` already does):
  - `dishVisual ~30`: escape `item.imageUrl`, `item.name`.
  - `dishVisual ~34/38/…`: `iconColor`/`accentColor` feed SVG attributes — validate to a hex/allowed pattern (`hexOr(item.accentColor, '#E63946')`).
  - `renderMenu ~135/138/139/141`: `escapeHTML(item.tagLabel)`, `escapeHTML(item.name)`, `escapeHTML(item.desc)`; `item.tag` in the class → restrict to `[a-z]+`.
  - `renderCart ~1114`: `escapeHTML(item.name)`.
  - Add a small helper in app.js: `function hexOr(v, fb){ return /^#[0-9a-fA-F]{3,8}$/.test(v||'') ? v : fb; }`

- [ ] Apply edits. Redeploy static.
- [ ] **Verify:** homepage + cart still render menu/reviews normally; as admin add a menu item named `<b>x</b>` → it shows as literal text on the homepage, not bold.

## Task 5 — ✅ Findings 10 + 18 (Medium/Low): stop shipping the schema and advertising internal paths

**Files:** Create `.vercelignore`; Modify `robots.txt`.

```
# .vercelignore
database/
docs/
SUPABASE_SETUP.md
README.md
CLAUDE.md
```
```
# robots.txt — remove the lines that name /admin.html and /database/.
# (They don't protect anything; they advertise the surface.)
```

- [ ] Apply edits. Redeploy static.
- [ ] **Verify:** `https://<site>/database/schema.sql` → 404. `robots.txt` no longer lists admin/database.

## Task 6 — ✅ Finding 7 (Medium, partial): stop leaking the referrer's real name via coupons

**Files:** Modify `database/schema.sql` (`activate_referral_on_delivery`, description string ~324).

**Change:** Drop the customer name from the coupon `description` (it is returned by the anon-callable `validate_coupon`).
```sql
'10% off — referral reward',    -- was: '... referred by ' || name
```
- [ ] Apply edit. Re-run `schema.sql`.
- [ ] **Verify:** `await sb.rpc('validate_coupon',{p_code:'<a referral code>',p_total:1000})` → `description` no longer contains a person's name.

## Task 7 — ✅ Finding 16 (Low): make coupon redemption race-safe

**Files:** Modify `database/schema.sql` (`place_order`, coupon block ~580-588 / increment ~615-617).

**Change:** Lock the coupon row and re-check `max_uses` atomically inside `place_order` before incrementing.
```sql
-- inside place_order, replace the coupon validation/increment with a locked re-check:
if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
  perform 1 from public.coupons
    where upper(code) = upper(p_coupon_code)
      and (max_uses is null or used_count < max_uses)
    for update;              -- row lock
  select computed_discount, code into v_coupon_disc, v_coupon
    from public.validate_coupon(p_coupon_code, p_total, p_phone) where ok = true;
  if v_coupon is null then raise exception 'Invalid or expired coupon'; end if;
  v_discount := v_discount + v_coupon_disc;
end if;
```
- [ ] Apply edit. Re-run `schema.sql`.
- [ ] **Verify:** create a `max_uses = 1` coupon; fire two orders with it near-simultaneously → only one succeeds with the discount.

---

# ⏸ DEFERRED — need your input, keys, or a live verification pass

## Task 8 — ⏸ Finding 3 (High): server-side price/total enforcement in `place_order`
**Why deferred:** the client sends a single `p_total` that already folds in a **client-computed delivery fee** (geolocation-gated), and the delivery-zone decision is never sent to the server — so a naive "recompute from `menu_items`" would reject legitimate orders that include delivery. Needs a decision + a live order-flow test.
**Recommended approach:** inside `place_order`, recompute `v_items_subtotal = Σ(menu_items.price × qty)` by looking up each `p_items[].id`; ignore client `price`. Read `delivery_fee` from `site_settings`. Accept the order only if `p_total` equals `v_items_subtotal + {0 or delivery_fee} − v_discount`; otherwise `raise exception`. Store the **server-computed** total. Requires deciding how the server learns whether delivery applies (e.g. pass an explicit `p_delivery:boolean` and validate the address/zone server-side, or make delivery fee unconditional).
**Decision needed:** how delivery fee is determined server-side.

## Task 9 — ⏸ Finding 2 (complete fix): private bucket + signed URLs
**Why deferred:** making `payment-proofs` `public=false` breaks the admin's current public-URL `<a href>` link; the admin list render (`admin.js:919`) is synchronous and would need async `createSignedUrl`. Task 2 already removed the bulk-enumeration risk; this is the hardening completion.
**Recommended approach:** `update storage.buckets set public=false where id='payment-proofs';` store the **object path** (not a public URL) in `orders.payment_proof_url`; in admin, replace the static link with a button that calls `sb.storage.from('payment-proofs').createSignedUrl(path, 300)` on click and opens the signed URL. Needs a live admin test.

## Task 10 — ⏸ Finding 4 (High): gate `get_loyalty` PII behind possession proof
**Why deferred:** proper fix needs an OTP/verification channel (SMS/WhatsApp) you don't have wired.
**Interim (safe) option we CAN do if you approve:** stop returning `name` from `get_loyalty` (keep progress + referral code), which removes the name-harvest while keeping the rewards lookup working.

## Task 11 — ⏸ Finding 8 (Medium): abuse/rate-limiting on `place_order` (and signups/likes)
**Why deferred:** needs a bot-protection choice (Cloudflare Turnstile / hCaptcha) with site+secret keys, verified server-side (Edge Function), or a throttle table keyed by IP (IP isn't available inside the RPC without passing it). **Decision needed:** which captcha provider, or accept a coarser per-phone throttle table.

## Task 12 — ⏸ Finding 5 (High): pin + integrity-check (or vendor) supabase-js
**Why partially deferred:** SRI requires the exact file hash. **Do now (safe):** pin the version in both pages, e.g. `@supabase/supabase-js@2.45.4` instead of `@2`. **Deploy-time:** add `integrity="sha384-…" crossorigin="anonymous"` (compute the hash from the pinned file) or vendor the file into `js/vendor/` and serve same-origin, plus a `Content-Security-Policy` header (via `vercel.json` `headers`) restricting `script-src`.

## Task 13 — ⏸ Finding 11 (Medium): CSP + move admin session off `localStorage`
**Why deferred:** adding a strict CSP needs testing against inline handlers/styles still present; changing session storage affects the persist/refresh behavior. Pairs naturally with Task 12's CSP header.

## Task 14 — ⏸ Findings 15 + 17 (Low): like-dedup + signup dedup
- Finding 15: dedupe `increment_review_likes` per session/IP (or accept as cosmetic).
- Finding 17: add `unique(phone)` / upsert on `launch_signups`. **Caution:** a unique constraint will fail if the live table already has duplicate phones — needs a dedup migration first.

## Task 15 — ⏸ Broken feature: loyalty free-credit redemption
**Why deferred (product):** `place_order` accepts `p_use_credit` but never applies it, and `free_credits` is never incremented — the "every 5th order = 1 free" reward is unimplemented. Needs the reward rule pinned down (what exactly is free, when a credit is earned vs spent) before coding. Belongs with the "fully functional" goal, not the security pass.

---

## Self-review notes
- Spec coverage: all 18 audit findings + the broken feature are represented (Tasks 1–15). Criticals 1 & 2 → Tasks 1, 2 (with 9 as completion). Highs → Tasks 3(#6), 8(#3), 10(#4), 12(#5). Mediums → 2/9(#9), 5(#10), 6(#7), 11(#8), 13(#11). Lows → 4, 7, 14, 5(#18).
- The ✅ NOW tasks (1–7) only tighten access or add escaping/limits — none removes legitimate capability, so they are safe to land unattended on `dev`.
