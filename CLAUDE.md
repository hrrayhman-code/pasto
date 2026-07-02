# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pasto is a single-page ordering website for a home-based Italian pasta brand in Karachi ("Pasto by Aiman"). It is **plain HTML/CSS/JS with no build step and no framework**, served as static files (Vercel) that talk **directly to a hosted Supabase project from the browser**. There is no application server of our own — Supabase (Postgres + Auth + Storage + Realtime + a pg_net trigger) is the entire backend.

> Note: `README.md` is stale — it describes an earlier WhatsApp-only, no-backend version. `SUPABASE_SETUP.md` reflects the current system. Trust the code and `database/schema.sql` over `README.md`.

## Running & developing

There is no build, lint, or test tooling (no `package.json`). Serve the folder statically and open it in a browser:

```bash
# any static server works; examples:
python -m http.server 5500      # then open http://localhost:5500
npx serve .                     # or VS Code "Live Server" (Ritwick Dey) on :5500
```

- `index.html` = customer site. `admin.html` = owner dashboard (requires Supabase Auth login).
- **`vercel.json`** sets `cleanUrls`, so in production `admin.html` is reachable at `/admin`.
- To point at a different Supabase project, edit `SUPABASE.url` / `SUPABASE.anonKey` at the top of `js/config.js`.

### Backend / database changes

The **entire backend lives in `database/schema.sql`** — tables, RLS policies, `SECURITY DEFINER` RPCs, triggers, and storage buckets. To apply changes: paste the file into **Supabase Dashboard → SQL Editor → Run**. The script is intentionally **idempotent** (`create ... if not exists`, `on conflict do nothing`, drop-then-create for policies/functions), so it is safe to re-run after edits. When changing an RPC's return type, follow the existing pattern of `drop function if exists ...` before `create or replace` (Postgres rejects return-type changes otherwise — the file has comments explaining why `place_order`/`track_order` are defined at the very end).

Admin login accounts are created manually in Supabase → Authentication → Users (not in code).

## Architecture — the big picture

The mental model that requires reading several files at once:

**1. Browser → Supabase, mediated by an API layer.**
`js/supabase-client.js` creates the global `sb` client and defines every data operation as a method on one of these objects: `ReviewsAPI`, `OrdersAPI`, `RewardsAPI` (coupons+loyalty), `MenuAPI`, `SettingsAPI`, `LaunchSignupsAPI`, `AuthAPI`. **Both `app.js` and `admin.js` go through these objects** — they never inline raw `sb` queries for core operations. Add new data access here, not in the page scripts.

**2. RLS is the security boundary — not the client.** The Supabase `anon` key in `config.js` is public by design. What actually protects data is Row-Level Security in `schema.sql`. The pattern:
- Public/`anon` may only `select` *approved* reviews and *active* menu items, `insert` *pending* reviews and launch signups. It cannot read the `orders`/`loyalty`/`coupons` tables directly.
- Anything a customer needs that touches protected data goes through a **`SECURITY DEFINER` RPC** granted to `anon`: `place_order`, `track_order`, `validate_coupon`, `get_loyalty`, `increment_review_likes`. These run with elevated rights but constrain exactly what they expose (e.g. `track_order` returns only status + first name, never the full PII row).
- `authenticated` (the logged-in admin) has full `using (true)` access to every table.

When adding a customer-facing feature that reads or writes protected tables, the correct move is almost always a new `SECURITY DEFINER` RPC + a method on the matching `*API` object — not loosening an RLS policy.

**3. Orders are computed server-side in one RPC.** `place_order` (schema.sql, defined at the end) is the transactional core: it validates the payload, applies the **buy-5-get-1-free** rule, applies coupon and **bank-transfer (5%)** discounts, upserts the customer's `loyalty` row (keyed by phone), inserts the `orders` row with a generated `short_code` (e.g. `#A1B2C3`), and returns the code + the customer's referral code. The client passes a `p_total`; be aware the server currently trusts several client-supplied values.

**4. Data-driven content.** Menu items and site chrome are **not hardcoded** for production — `app.js` fetches `menu_items` and `site_settings` (hero image, delivery zone, bank details) from Supabase on load, and only falls back to the hardcoded `MENU` array in `config.js` if the API call fails. Editing prices/menu is done in the admin dashboard (`menu_items` table), not in `config.js`.

**5. Status lifecycle & live updates.** Order status flows `received → preparing → baking → out_for_delivery → delivered` (plus `cancelled`); the canonical list + labels are `ORDER_FLOW` / `ORDER_LABELS` in `supabase-client.js`. The customer's tracker polls `track_order` every ~15s; the admin dashboard gets new orders via the Supabase **Realtime** publication (added to `supabase_realtime` at the bottom of `schema.sql`). Two triggers fire on the `orders` table: `activate_referral_on_delivery` (creates a 10%-off coupon from the buyer's referral code once an order is delivered) and `notify_telegram_on_new_order` (pg_net POST to the Telegram Bot API on insert; token/chat-id read from `site_settings`).

**6. Front-end structure.** `js/app.js` is organized into clearly commented sections (STATE, RENDER MENU, REVIEWS, CART OPERATIONS, DELIVERY ZONE CHECK, BUSINESS HOURS, SUBMIT ORDER, LIVE ORDER TRACKER, LIVE MENU + SITE SETTINGS, INITIALIZATION). Cart state persists in `localStorage`. Two gates block checkout: a **launch-date countdown** (`launchDate` in `config.js`) and a **business-hours** window (`businessHoursStart`/`End`, Asia/Karachi). These gates are currently client-side only.

## Config that matters (`js/config.js`)

`config.js` holds the Supabase keys, contact details (WhatsApp/phone/Instagram/email), currency, delivery hours copy, the **business-hours window**, and the **`launchDate`** gate. The `MENU`/`REVIEWS` data there is now only a first-paint fallback — the live source is Supabase.
