# Pasto — Project Status & Runbook

_Last updated: 2026-07-04. Living summary of what this app is, what's been built, and how to deploy it. Pairs with `CLAUDE.md` (architecture) and the specs/plans under `docs/superpowers/`._

## What this is
**Pasto by Aiman** — a **live, production** single-page ordering website for a home-based Italian pasta business in Karachi. Plain HTML/CSS/JS (no build step) on **Vercel**, talking directly to a hosted **Supabase** backend. Live at **https://www.pastobyaiman.com** (`/admin` = owner dashboard).

- **Supabase project ref:** `ftgfqlfgqhckqljrufqd` (URL + anon key in `js/config.js` — anon key is public by design; RLS is the security boundary).
- **GitHub:** `hrrayhman-code/pasto`. Owner/dev works on branch **`dev`**; **push to `main` → Vercel auto-deploys**.
- **Hard constraint:** **free tooling only** — no paid APIs/gateways (this drove every design choice: Web Push not SMS, Easypaisa/JazzCash screenshots not a card gateway, etc.).

## ⚙️ Deploy workflow (IMPORTANT — two parts)
A change is only live after BOTH, as applicable:
1. **Client** (`*.html`, `js/`, `css/`): merge `dev`→`main` and `git push origin main` → Vercel auto-deploys. Then **hard-refresh** (Ctrl+Shift+R). The customer site has **no service worker**, so a hard refresh is enough; the admin PWA does have one (`sw.js`).
2. **Backend** (`database/schema.sql`): the owner **re-runs the whole `schema.sql`** in Supabase → SQL Editor. It is **idempotent** (safe to re-run). Client edits alone do nothing for backend changes.
- The owner deploys; the assistant cannot reach Supabase/Vercel. Edge Functions are deployed via the **Supabase dashboard editor** (owner is guided; no CLI).
- `.vercelignore` keeps `database/`, `docs/`, `supabase/`, `*.md` out of the public deploy.

## Architecture (see CLAUDE.md for detail)
Browser → Supabase via the `*API` objects in `js/supabase-client.js` (`ReviewsAPI`, `OrdersAPI`, `RewardsAPI`, `MenuAPI`, `SettingsAPI`, `PushAPI`, `AuthAPI`). **RLS + `SECURITY DEFINER` RPCs** are the security boundary. `place_order` is the transactional core (computes totals server-side). Menu/settings are admin-managed in Supabase, not hardcoded.

## Work completed (chronological)
1. **Security audit** (3 parallel agents) → fixed the safe subset: XSS/output escaping, launch-signup `onclick` injection, `site_settings` read-whitelist (Telegram token was anon-readable), payment-proofs anon-list lockdown, coupon-race lock, robots/`.vercelignore`.
2. **Spec #1 — Owner PWA order alerts** (`docs/superpowers/specs/2026-07-03-owner-pwa-order-alerts-design.md`): installable admin PWA + **Web Push** (VAPID). Order INSERT → DB webhook → Edge Function `push-order-alerts` → push to the owner's phone; `pg_cron` re-alerts every 2 min (20-min cap) until acknowledged. **Telegram removed entirely** (its trigger + secret rows). `push_subscriptions` table, `orders.alert_acked`. **Deployed + verified live.**
3. **Spec #2 — Customer ordering** (`.../2026-07-03-customer-ordering-system-design.md`): fully in-app ordering (no WhatsApp hand-off); **COD + Prepay (Easypaisa/JazzCash)**; wallet number revealed **only post-order** + screenshot upload via `attach_payment_proof`; **server-authoritative `place_order`** (recomputes totals from `menu_items`, applies discounts, enforces business hours); flat admin-set delivery fee; removed card method + dead loyalty free-credit; admin "WhatsApp customer" button; admin Site→"Payments & delivery" settings. **Deployed + tested.**
4. **Mobile responsiveness:** hamburger nav (customer), order-tracker max-height/scroll, toast empty-state fix (was a black bar), admin header wrap + section-tab scroll.
5. **Final security hardening:** vendored supabase-js locally (`js/vendor/supabase.js`, no CDN); CSP + security headers in `vercel.json`; `get_loyalty` no longer returns name (PII); **payment-proofs bucket private** + admin views via 5-min signed URLs.
6. **Post-launch bug fixes:** reviews submit (removed anon-illegal `.select()` read-back); delivery-zone coords re-whitelisted + admin-editable; **business hours crossing midnight** (`place_order` now handles 18:00–00:00); prepay upload hides after attach; loyalty stamp-card/free-credit UI removed.

## Deferred (optional, non-blocking)
- Rate-limit/dedup on likes (#15) and launch-signups (#17) — Low severity; need bot-protection infra (captcha/Turnstile).
- Full get_loyalty OTP gating (interim = name removed).

## Gotchas learned (save re-discovery time)
- `place_order` `RETURNS TABLE` output cols (`id`, `total`, …) collide with bare column refs → **qualify table columns** (e.g. `menu_items m … m.id`).
- Prepay flow (Option B): number revealed **after** placing → upload must be post-order (`attach_payment_proof` RPC, anon-callable). Prepay orders start `payment_status='pending'`, flip to `awaiting_verification` on upload.
- Business hours + the client gate both must handle **midnight-crossing** windows (open when `now >= start OR now < end`).
- `site_settings` is anon-read-**whitelisted**; anything the customer JS needs (delivery fee, hours, kitchen coords) must be in the whitelist; secrets (prepay number, telegram) must NOT be.
- Reviews are `pending` on insert and anon can't read them back → don't `.select()` after an anon insert.
- Editing `schema.sql`: it has CRLF/em-dash content; large function splices are easier via a small Node script than exact-match Edits.

## Web Push deploy specifics (Spec #1)
VAPID keys generated locally; **public** key in `js/config.js`, **private** key + `ALERT_TRIGGER_SECRET` + `VAPID_SUBJECT` are **Edge Function secrets** (Supabase dashboard, "Verify JWT" OFF for `push-order-alerts`). Function URL: `https://ftgfqlfgqhckqljrufqd.supabase.co/functions/v1/push-order-alerts`. Cron in `database/cron-push-alerts.sql`. Webhook: Database → Webhooks on `orders` INSERT with header `x-alert-secret`.
