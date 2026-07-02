# Customer Ordering System — Design

**Status:** Approved (brainstorming) · 2026-07-03
**Sub-project:** 2 of 2 (the other is "Owner PWA Order Alerts")

## Goal
Make ordering **fully in-app**: submitting the checkout form *is* placing the
order (saved to Supabase, owner alerted via Spec #1), with no WhatsApp hand-off.
Move all money/eligibility math **server-side** so totals can't be tampered and
after-hours orders are rejected. Keep everything **free** (no card gateway).
The owner confirms each order by messaging the customer on WhatsApp from the
admin dashboard.

## Current state
- Checkout (`app.js` `submitOrder`) collects name/phone/address/notes + payment method + promo code + optional proof upload, calls `place_order`, **and also opens a pre-filled WhatsApp message** to the business number. A live tracker card then polls `track_order`.
- `place_order` (`schema.sql`) trusts the client `p_total` and per-item `price` (audit Finding 3); business-hours + delivery-zone are enforced **client-side only** (Findings 4/8). Payment methods: `cod`, `bank_transfer` (5% off, hardcoded), `card` (non-functional "we'll send a link").
- Loyalty free-credit is dead code: `place_order` accepts `p_use_credit` but ignores it; `free_credits` is never incremented.

## Constraints
- **Free only** — no online card processing; prepay is manual (wallet number + screenshot, owner verifies).
- Owner confirms every order over WhatsApp, so hard automated zone/eligibility gates aren't required — the owner is the final check.
- Reuse existing patterns: `site_settings` key/value bag for admin-controlled values; `SECURITY DEFINER` RPCs for anon-safe access.

## Customer flow
1. Browse menu → cart (localStorage) — unchanged.
2. **Checkout fields:** `name*`, `phone*`, `alt_phone`, `email`, `address*`, `notes` (`*` required). Email validated for format only if provided.
3. **Payment choice:** `COD` or `Prepay (Easypaisa/JazzCash)`.
4. **Submit = order placed.** `place_order` saves it; the owner gets the Spec #1 push. **No WhatsApp opens.**
5. **Confirmation screen:** order code `#XXXXXX` + live tracker. For a **Prepay** order it also shows *"Send Rs. \<total\> to \<wallet title\> \<wallet number\> and upload your screenshot,"* with the upload control. The wallet number is returned by the RPC (see below) — it is **never** on the public site.
6. Tracker persists across reloads (`track_order`), and for an unverified prepay order the reload still shows the pay-here details.

## Payments
- **COD** — pay on delivery. `payment_status='pending'`.
- **Prepay** — customer sends money to the owner's Easypaisa/JazzCash wallet and uploads a screenshot → `payment_status='awaiting_verification'` → owner verifies in admin (existing flow). No bank account/IBAN anywhere.
- **Prepay discount** — admin-controlled `site_settings.prepay_discount_percent` (default `5`, `0` disables). `place_order` reads it at order time. Never hardcoded.
- **Removed:** the `card` / payment-link method.
- **`payment_method` values become `('cod','prepay')`** (was `cod/bank_transfer/card`). Migration maps any existing `bank_transfer`→`prepay`, `card`→`cod`; the check constraint is updated.

## Delivery
- **Flat fee** from `site_settings.delivery_fee` (already exists), added server-side to every order.
- Optional **`site_settings.free_delivery_over`** (default `0` = off): when `> 0` and subtotal ≥ it, delivery is free.
- The GPS zone gate is **removed as a price factor**. `kitchen_lat/lng` + `delivery_radius_km` are no longer used for pricing; delivery area becomes advisory copy. Owner declines genuinely out-of-range orders at WhatsApp-confirm time.

## Server-side enforcement (closes Findings 3 & 8)
`place_order` becomes authoritative. New signature:
```
place_order(p_name, p_phone, p_alt_phone, p_email, p_address, p_notes,
            p_items,           -- [{ id, qty }] — client price/name IGNORED
            p_coupon_code, p_payment_method, p_payment_proof_url)
-- p_total and p_use_credit REMOVED
```
Logic, all inside the RPC:
1. **Validate** name/phone/address lengths, `p_items` non-empty, `p_payment_method in ('cod','prepay')`, `p_email` format if present.
2. **Business hours:** read `business_hours_start`/`business_hours_end` from `site_settings` (admin-controlled; Karachi time via `now() at time zone 'Asia/Karachi'`). If outside the window, `raise exception 'We are closed right now'`.
3. **Subtotal:** for each `p_items[].id`, look up `menu_items` (must exist and be `active`); `subtotal = Σ(menu_items.price × qty)`. Reject unknown/inactive items or `qty ≤ 0`. Snapshot `{id,name,price,qty}` from the DB into the stored `items` jsonb (so the record/receipt uses real names + prices).
4. **Delivery fee:** `fee = (free_delivery_over > 0 AND subtotal ≥ free_delivery_over) ? 0 : delivery_fee`.
5. **Discounts** (applied to `subtotal`, not to `fee`): buy-5-get-1 (cheapest of the DB-priced items), coupon (`validate_coupon` on `subtotal`, row-locked per Finding 16), prepay (`round(subtotal × prepay_discount_percent / 100)` when `p_payment_method='prepay'`). `discount = least(sum, subtotal)`.
6. **Total:** `total = subtotal + fee − discount`. Store the server-computed `total`, `subtotal`, `delivery_fee`, `discount`.
7. Upsert loyalty (keep `order_count` increment + `referral_code`), insert order, bump coupon `used_count`.
8. **Return:** `id, short_code, referral_code, subtotal, delivery_fee, discount, total`, plus — **only when `p_payment_method='prepay'`** — `prepay_title, prepay_number` read from `site_settings`. `track_order` likewise returns the prepay details for an unverified prepay order (for reload persistence). The wallet keys are **excluded from the public `site_settings` read whitelist**, so they are reachable *only* through these SECURITY DEFINER RPCs by someone who placed a prepay order.

## Admin side
- New **"Message customer on WhatsApp"** action on each order row: opens `wa.me/<normalized order phone>` with a pre-filled confirm message. Built with `data-*` attributes + delegated listener (no inline-onclick; consistent with the Finding 6 fix).
- Prepay verification (verify / mark paid) — existing flow, retained.
- Dashboard settings for `delivery_fee`, `free_delivery_over`, `prepay_discount_percent`, `business_hours_start/end`, and the Easypaisa/JazzCash `prepay_title` + `prepay_number` (Site tab).

## Removals
- WhatsApp auto-open from the customer checkout flow.
- Loyalty free-credit: drop `p_use_credit`, the `free_credits` usage, and the "5-stamp / free item" UI framing in the Rewards section (keep the referral-code lookup). `free_credits` column may remain unused (no destructive migration).
- Public bank details (`bank_*` keys) removed from display and from the public read whitelist; replaced by the post-order-only wallet reveal.
- GPS delivery gate.

## Data-model changes
- `orders`: add `alt_phone text`, `email text`, `subtotal int`, `delivery_fee int not null default 0`, `discount int` (already exists). Keep `payment_method`/`payment_status`/`payment_proof_url`.
- `site_settings`: add `prepay_discount_percent` (default `5`), `free_delivery_over` (default `0`), `business_hours_start` (`18:00`), `business_hours_end` (`23:00`), `prepay_title`, `prepay_number`. Add `business_hours_*` + `delivery_fee` + `free_delivery_over` to the **public read whitelist**; keep `prepay_number`/`prepay_title` **out** of it. Remove `bank_*` from display.
- `place_order`: signature + logic per above. `track_order`: add prepay detail return for unverified prepay orders.

## Security considerations
- Totals, discounts, delivery fee, and business-hours are all server-authoritative — the browser cannot tamper them (Findings 3 & 8 closed).
- Prepay wallet number is never public; only order-placers receive it via the SECURITY DEFINER RPCs.
- The admin WhatsApp action uses safe `data-*` wiring (no inline-onclick injection).

## Out of scope (future)
- A repeat-customer loyalty program (deliberately deferred — "don't over-engineer now").
- Customer-facing PWA/push and real online card payments.

## Success criteria
- Submitting checkout places the order with no WhatsApp; confirmation shows code + tracker; a prepay order reveals the wallet number + upload only after placement and on reload.
- Editing the page to send a fake low total, a $0 item price, or an order at 3 AM is rejected by the server.
- Delivery fee + prepay discount + business hours are all changeable from the admin dashboard with no code change.
- The owner can WhatsApp any customer from the order row in one tap.
- `card` method and the loyalty free-credit code are gone; referrals still work.

## Open items
- None blocking. Whether to also drop the unused `free_credits` column is a later cleanup call.
