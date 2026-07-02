# Owner PWA Order Alerts — Design

**Status:** Approved (brainstorming) · 2026-07-03
**Sub-project:** 1 of 2 (the other is "Customer ordering system"; separate spec)

## Goal
When a customer places an order, the owner receives a push notification on their
phone ("🍝 New order …") even when the phone is locked and the admin app is
closed — reliably enough to run the business on, using **only free tooling** (no
paid APIs, no purchased services). Tapping the notification opens the admin app
directly to that order. The alert repeats until the owner acknowledges it.

## Current state (what exists today)
- `admin.html` already ships `admin-manifest.json` (`start_url:/admin`, `scope:/admin`) — partially PWA-ready, but there is **no service worker** and no installability/push wiring.
- New-order alerts today rely on: (a) the admin dashboard's realtime pop-up + ringer (`admin.js`) — only works while `admin.html` is open on screen; (b) a 15s polling fallback; and (c) a **Telegram** `pg_net` trigger (`notify_telegram_on_new_order`) that pushes to the owner's phone when locked.
- This design **replaces the Telegram path** with Web Push and keeps (a)/(b) as the in-app experience.

## Constraints
- **Free only.** Web Push (VAPID + service worker) is used; the sender runs as a Supabase Edge Function on the free tier; scheduling uses `pg_cron` (built in). Nothing is purchased.
- **iOS + Android.** iOS delivers Web Push to a PWA **only when installed to the Home Screen** (iOS 16.4+) and after the user grants notification permission. Android/Chrome works from a normal installed PWA.
- **Deploy via the Supabase dashboard** (in-browser Edge Function editor + SQL Editor), guided step-by-step. No local CLI assumed.
- **Multi-device.** Alerts go to every device currently subscribed under the admin account (owner phone + tablet + a helper on the same login).

## Architecture

```
Customer places order → orders INSERT
   │
   ├─(1) Supabase Database Webhook (on INSERT) ──► Edge Function "push-order-alerts"
   │                                                   │ loads subs, signs Web Push (VAPID)
   │                                                   ▼
   │                                       Owner device(s): system notification
   │
   └─(2) pg_cron every 2 min ─(pg_net POST)──────► same Edge Function
            re-sends for orders still status='received' AND alert_acked=false
            AND created_at > now() - interval '20 min'

Owner taps notification → SW focuses/opens admin at /admin?order=<id>
   → admin marks order acknowledged (alert_acked=true) → loop stops
```

## Components

### 1. Service worker — `sw.js` (new, site root so scope covers `/admin`)
- **Responsibility:** receive `push` events and display the notification when the PWA is closed/backgrounded; handle `notificationclick` to focus an existing admin tab or open `/admin?order=<id>`; set/clear the app-icon badge (`navigator.setAppBadge` where supported).
- **Interface (push payload it expects):** JSON `{ title, body, orderId, shortCode, tag }`. Uses `tag` = `orderId` so repeat alerts for the same order collapse into one visible notification instead of stacking.
- **Depends on:** nothing app-specific; pure Web Push / Notifications API.

### 2. Admin PWA client wiring — `admin.html`, `admin.js`
- **Responsibility:**
  - Register `sw.js` on load.
  - Reuse the existing **"Enable order alerts"** button to: request `Notification.permission`, `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:<VAPID public> })`, and upsert the resulting subscription via `PushAPI.saveSubscription()`.
  - **Re-subscribe on every launch** (subscriptions can rotate/expire) and upsert again.
  - **Acknowledge**: when the owner opens an order detail (including via `?order=<id>` deep link) or taps a **"Got it"** control, call `OrdersAPI.acknowledgeAlert(id)`; advancing status also acknowledges.
  - Keep the current in-app ringer / wake-lock for when the PWA is open.
- **Depends on:** the VAPID **public** key (safe to embed, in `js/config.js`), `sw.js`, and the new `PushAPI` / `OrdersAPI.acknowledgeAlert` methods in `js/supabase-client.js`.

### 3. `push_subscriptions` table (new)
```
id          uuid pk default gen_random_uuid()
endpoint    text not null unique          -- the push service URL (identity of a device)
p256dh      text not null                 -- subscription public key
auth        text not null                 -- subscription auth secret
user_id     uuid not null default auth.uid()  -- the admin who subscribed
label       text                          -- optional device label
created_at  timestamptz not null default now()
```
- **RLS:** only `authenticated` can `insert`/`select`/`delete`, restricted to `user_id = auth.uid()`. `anon` has **no** access. Upsert on `endpoint` so re-subscribing the same device updates rather than duplicates.
- The Edge Function reads this table using the **service-role key** (server-side only), bypassing RLS to fan out to all devices.

### 4. `orders` acknowledgement columns (new)
```
alert_acked  boolean     not null default false
acked_at     timestamptz
```
- Set `true` in two ways: (a) explicitly by `acknowledgeAlert(id)` when the owner opens/acks the order; (b) automatically by a small DB trigger on `orders` that sets `alert_acked=true, acked_at=now()` whenever `status` changes away from `received`. The cron only re-alerts rows that are still `status='received' AND alert_acked=false AND created_at > now()-'20 min'`.

### 5. Edge Function `push-order-alerts` (Deno, dashboard editor)
- **Trigger surfaces:** (1) the Database Webhook on `orders` INSERT (immediate first push for the new row); (2) `pg_cron` every 2 min (re-push sweep). Same function handles both — if given a specific `orderId` it targets that order, otherwise it sweeps all un-acknowledged new orders.
- **Auth:** requires a shared secret in an `Authorization`/custom header that both the webhook and the cron send; requests without it are rejected (prevents strangers from triggering pushes). Uses injected `SUPABASE_SERVICE_ROLE_KEY` to query.
- **Secrets (Edge Function config):** `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (a `mailto:`), `ALERT_TRIGGER_SECRET`.
- **Behavior:** for each target order, build the payload and send Web Push to every row in `push_subscriptions`; on `404`/`410` from the push service, delete that subscription row (dead device). Never throws back to the caller in a way that blocks order inserts.
- **Library:** a Deno-compatible web-push implementation (e.g. `esm.sh/web-push`), pinned to an exact version.

### 6. `pg_cron` job (built-in, free)
- Every 2 minutes, `pg_net` `http_post` to the Edge Function URL with the shared secret header and no `orderId` (sweep mode). The function self-limits to the 20-minute window so old orders stop being re-alerted.

### 7. VAPID keys + manifest polish
- Generate a VAPID keypair **once** (free; via the web-push lib or an online generator run locally). Public key → `js/config.js`; private key → Edge Function secret.
- Ensure `admin-manifest.json` has icons/display for a clean Home-Screen install; link it + a theme-color from `admin.html`; register `sw.js`.

## Re-alert loop parameters
- **Cadence:** every **2 minutes**.
- **Stop conditions:** acknowledged (notification tapped / order opened / "Got it") **OR** status advanced past `received` **OR** **20-minute** cap from `created_at`.

## Telegram removal (security bonus)
- Delete the `notify_telegram_on_new_order` function + `trg_notify_telegram_on_order` trigger and the `telegram_bot_token` / `telegram_chat_id` rows from `site_settings`. This **eliminates** the Critical #1 leak surface rather than only patching the RLS around it. (The `site_settings` read-whitelist from the earlier remediation stays; the telegram keys simply no longer exist.)

## Reliability & honesty notes
- iOS Web Push to an installed PWA is good but not equal to a native app. Mitigations baked in: instant first push via webhook, 2-min re-alert sweep, re-subscribe on launch, dead-subscription pruning, app-icon badge.
- **Hard requirement:** the owner must **Add to Home Screen** on iPhone; a Safari tab receives nothing. The "Enable order alerts" button will detect and instruct if the app isn't installed / permission is denied.

## Owner deployment (guided; detailed steps live in the implementation plan)
1. Run one SQL block: `push_subscriptions` table + RLS, `orders.alert_acked/acked_at`, the `pg_cron` schedule, and removal of the Telegram trigger/rows.
2. Paste the Edge Function into the dashboard editor; deploy; set the 4 secrets.
3. Create a Database Webhook on `orders` INSERT → the function (with the secret header).
4. Put the VAPID public key in `js/config.js`; redeploy the static site.
5. On the phone: open `/admin`, Add to Home Screen, open the installed app, tap **Enable order alerts**, allow notifications. Send a test order.

## Security considerations
- No secret reaches the browser (only the public VAPID key, which is designed to be public).
- `push_subscriptions` is RLS-locked to the owner; the anon role cannot read or write it.
- The Edge Function is guarded by a shared trigger secret so it can't be invoked by strangers to spam the owner.

## Out of scope (for this spec)
- Making the **customer** site installable / customer push (belongs to Spec #2 if wanted).
- Customer-facing order-status push (the customer tracker already polls).
- Any change to how customers submit orders (that's Spec #2).

## Success criteria
- With the admin PWA installed on a locked iPhone and Android, placing a test order produces a notification within seconds; tapping it opens the order; leaving it unacknowledged re-alerts every 2 min and stops on acknowledge or at 20 min; a second device also receives the alert; no secret is exposed to `anon`; the Telegram trigger and secret rows are gone.

## Open items
- None blocking. Device `label` capture (naming each device) is optional polish.
