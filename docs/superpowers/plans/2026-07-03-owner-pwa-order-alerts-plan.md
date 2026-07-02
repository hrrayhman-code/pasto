# Owner PWA Order Alerts — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. This repo has **no test runner** (static site, no `package.json`), so each task's "verify" step is a concrete DevTools / SQL / curl check, not a unit test. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a customer places an order, push a "New order" notification to the owner's installed PWA (iPhone/Android, even locked), re-alerting every 2 min until acknowledged — using only free tooling, replacing Telegram.

**Architecture:** Web Push (VAPID) from a Supabase Edge Function. Order INSERT → Database Webhook → Edge Function sends a signed push to every device in `push_subscriptions`. `pg_cron` re-invokes the function every 2 min for un-acknowledged new orders (20-min cap). The admin PWA registers a service worker, subscribes to push, and acknowledges on open/"Got it"/status-advance.

**Tech Stack:** Web Push API + Service Worker, Supabase Edge Functions (Deno, `npm:web-push`), `pg_cron` + `pg_net`, plain DOM.

**Spec:** `docs/superpowers/specs/2026-07-03-owner-pwa-order-alerts-design.md`

## Global Constraints
- **Free only** — VAPID/web-push, Edge Functions free tier, `pg_cron`. Nothing purchased.
- **Deploy via Supabase dashboard** (in-browser Edge Function editor + SQL Editor) + `npx` locally for VAPID keys. Guided step-by-step.
- **No repo edit is live until deployed:** backend = re-run SQL / deploy function; client = redeploy static site.
- Re-alert cadence **2 min**, cap **20 min** from `created_at`; stop on acknowledge or status advance past `received`.
- Service worker at site root (`/sw.js`) so its scope covers `/admin`.
- Keep `js/supabase-client.js` as the only place raw `sb` data calls live (add a `PushAPI` object; extend `OrdersAPI`).

## File structure
- Create `sw.js` — service worker: `push` + `notificationclick`.
- Create `supabase/functions/push-order-alerts/index.ts` — Edge Function (kept in repo for reference; deployed via dashboard).
- Modify `database/schema.sql` — `push_subscriptions`, `orders.alert_acked/acked_at` + ack trigger, remove Telegram, `pg_cron` job.
- Modify `js/config.js` — `VAPID_PUBLIC_KEY`.
- Modify `js/supabase-client.js` — `PushAPI`, `OrdersAPI.acknowledgeAlert`.
- Modify `js/admin.js` — SW registration, push subscribe on enable + on launch, acknowledge wiring, `?order=` deep link.
- Modify `admin.html` — no structural change (manifest + button already exist); confirm scripts.

---

## Task 1: Generate VAPID keys (one-time, local)

**Files:** none in repo yet (values used in Tasks 4 & 6).

- [ ] **Step 1: Generate the keypair.** In a terminal (Node is installed):
```bash
npx web-push generate-vapid-keys
```
Output looks like:
```
Public Key:  BEl62iUYgUiv...   (87-char base64url)
Private Key: aUeF...            (43-char base64url)
```
- [ ] **Step 2: Record both keys** somewhere safe for the next tasks. The **public** key goes into `js/config.js` (Task 4); the **private** key becomes an Edge Function secret (Task 6). Never commit the private key.
- [ ] **Step 3: Verify** both strings are base64url (only `A–Z a–z 0–9 - _`), public ~87 chars, private ~43 chars.

## Task 2: Backend schema — subscriptions, ack columns, remove Telegram

**Files:** Modify `database/schema.sql` (append a new section near the end, before the closing "Done" comment).

**Interfaces produced:** table `public.push_subscriptions(endpoint unique, p256dh, auth, user_id default auth.uid())`; `public.orders.alert_acked boolean`, `acked_at timestamptz`; trigger auto-acks on status advance.

- [ ] **Step 1: Add the SQL.** Append:
```sql
-- ============================================================
-- WEB PUSH — owner PWA order alerts (replaces Telegram)
-- ============================================================
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
-- Only the logged-in admin can manage their own device subscriptions; anon has none.
create policy "own_push_subs" on public.push_subscriptions for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Acknowledgement state on orders
alter table public.orders add column if not exists alert_acked boolean not null default false;
alter table public.orders add column if not exists acked_at   timestamptz;

-- Auto-acknowledge when the owner advances an order off 'received'
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

-- Remove the Telegram path entirely (Critical #1 surface deleted, not patched)
drop trigger if exists trg_notify_telegram_on_order on public.orders;
drop function if exists public.notify_telegram_on_new_order();
delete from public.site_settings where key in ('telegram_bot_token','telegram_chat_id');
```
Also **delete the old Telegram function/trigger/seed block** already in `schema.sql` (the `notify_telegram_on_new_order` definition, its trigger, and the `insert ... ('telegram_bot_token'...)` seed) so re-running doesn't recreate them.
- [ ] **Step 2: Deploy.** Paste the whole `schema.sql` into Supabase → SQL Editor → Run. Expect "Success. No rows returned."
- [ ] **Step 3: Verify (SQL Editor):**
```sql
select count(*) from public.push_subscriptions;                         -- 0, table exists
select column_name from information_schema.columns
  where table_name='orders' and column_name in ('alert_acked','acked_at'); -- 2 rows
select tgname from pg_trigger where tgname='trg_notify_telegram_on_order'; -- 0 rows (gone)
select * from public.site_settings where key like 'telegram%';           -- 0 rows
```
- [ ] **Step 4: Verify anon lockout (logged-out browser console on the site):**
```js
await sb.from('push_subscriptions').select('*')   // → [] or error, never other people's subs
```
- [ ] **Step 5: Commit** `database/schema.sql`.

## Task 3: Client data layer — PushAPI + acknowledgeAlert

**Files:** Modify `js/supabase-client.js` (add `PushAPI` after `SettingsAPI`; add `acknowledgeAlert` inside `OrdersAPI`).

**Interfaces produced:** `PushAPI.saveSubscription(pushSub)`, `PushAPI.removeSubscription(endpoint)`, `OrdersAPI.acknowledgeAlert(id)`.

- [ ] **Step 1: Add `PushAPI`.** After the `SettingsAPI` object:
```js
// ==================================================
// PUSH SUBSCRIPTIONS API  (admin PWA web-push)
// ==================================================
const PushAPI = {
  async saveSubscription(pushSub) {
    const j = pushSub.toJSON();
    if (!j.endpoint || !j.keys) throw new Error('Invalid push subscription');
    const { error } = await sb.from('push_subscriptions').upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: 'endpoint' }
    );
    if (error) throw error;
  },
  async removeSubscription(endpoint) {
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw error;
  }
};
```
- [ ] **Step 2: Add `acknowledgeAlert` to `OrdersAPI`** (next to `setStatus`):
```js
  async acknowledgeAlert(id) {
    const { error } = await sb.from('orders')
      .update({ alert_acked: true, acked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
```
- [ ] **Step 3: Verify** syntax: `node --check js/supabase-client.js` → no output (OK).
- [ ] **Step 4: Commit** `js/supabase-client.js`.

## Task 4: Service worker + registration + VAPID public key

**Files:** Create `sw.js` (root); Modify `js/config.js` (add `VAPID_PUBLIC_KEY`).

**Interfaces produced:** a registered SW at scope `/` that shows push notifications and routes clicks to `/admin?order=<id>`; global `VAPID_PUBLIC_KEY`.

- [ ] **Step 1: Create `sw.js`:**
```js
// Pasto admin PWA service worker — order-alert push
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const title = d.title || '🍝 New order';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || 'order',       // same order collapses instead of stacking
      renotify: true,              // but still re-alerts (buzzes) each time
      requireInteraction: true,    // stays until tapped (Android)
      icon: '/assets/logo-icon.png',
      badge: '/assets/logo-icon.png',
      data: { orderId: d.orderId || null }
    })
  );
  if (self.registration.setAppBadge) { self.registration.setAppBadge(1).catch(() => {}); }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const orderId = event.notification.data && event.notification.data.orderId;
  const url = orderId ? `/admin?order=${orderId}` : '/admin';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.includes('/admin')) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url); } catch (_) {} } return; }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
```
- [ ] **Step 2: Add the VAPID public key to `js/config.js`** (top level, after the `SUPABASE` block):
```js
// Web Push (owner PWA order alerts). Public key is safe to expose.
// Generated once via `npx web-push generate-vapid-keys` (Task 1).
const VAPID_PUBLIC_KEY = 'PASTE_YOUR_VAPID_PUBLIC_KEY_HERE';
```
- [ ] **Step 3: Verify** `node --check sw.js` and `node --check js/config.js` → OK. Confirm `assets/logo-icon.png` exists (it's referenced by the existing notif code); if only `logo-icon.svg` exists, use that path instead in `sw.js`.
- [ ] **Step 4: Commit** `sw.js`, `js/config.js`.

## Task 5: Admin push subscribe / acknowledge / deep-link

**Files:** Modify `js/admin.js`.

**Interfaces consumed:** `PushAPI`, `OrdersAPI.acknowledgeAlert`, `VAPID_PUBLIC_KEY`, existing `requestNotifPermission` (`admin.js:1476`), `acknowledgeNewOrder` (bound to `noa-ack-btn`), `showDashboard`.

- [ ] **Step 1: Add a base64url→Uint8Array helper and a subscribe routine** (near the top of `admin.js`):
```js
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function ensurePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (typeof VAPID_PUBLIC_KEY !== 'string' || VAPID_PUBLIC_KEY.includes('PASTE_')) {
    console.warn('[Pasto Admin] VAPID_PUBLIC_KEY not set'); return null;
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  await PushAPI.saveSubscription(sub);   // re-save on every launch (Spec: re-subscribe on launch)
  return sub;
}
```
- [ ] **Step 2: Wire it into `requestNotifPermission`.** After the `result === 'granted'` branch succeeds (`admin.js:1488`), add `await ensurePushSubscription();` so enabling alerts also subscribes to push. Keep the existing local test-notification + chime.
- [ ] **Step 3: Re-subscribe on launch.** In `showDashboard` (admin.js ~156), after it reveals the dashboard, add:
```js
if (Notification.permission === 'granted') { ensurePushSubscription().catch(e => console.warn(e)); }
```
- [ ] **Step 4: Acknowledge on the in-app "Acknowledge" button.** In `acknowledgeNewOrder` (`admin.js:1338`), the shown order is held in the module var `_currentAlertOrder`. Capture its id **before** the existing code clears the state, and ack it after `stopRinger()`:
```js
function acknowledgeNewOrder() {
  const ackedId   = _currentAlertOrder?.id;
  const ackedCode = _currentAlertOrder?.short_code;
  stopRinger();
  if (ackedId) OrdersAPI.acknowledgeAlert(ackedId).catch(() => {});
  // ...existing queue / hideNewOrderAlert / toast logic unchanged...
}
```
Advancing status also acks via the DB trigger — calling `acknowledgeAlert` here too is safe (idempotent).
- [ ] **Step 5: Handle the `?order=<id>` deep link.** In `showDashboard` (`admin.js:156`), after render, add (uses the real section-nav selector — there is **no** `switchTab`; sections switch via `.admin-section-tab[data-section=...]` buttons):
```js
const oid = new URLSearchParams(location.search).get('order');
if (oid) {
  OrdersAPI.acknowledgeAlert(oid).catch(() => {});
  document.querySelector('.admin-section-tab[data-section="orders"]')?.click();
  loadOrders().then(() => {
    const row = document.querySelector(`[data-order-id="${oid}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  history.replaceState({}, '', '/admin');
}
```
Order rows don't yet carry `data-order-id` — add it in `renderOrderRow` (`admin.js:467`): `<article class="admin-row ..." data-order-id="${escapeHTML(o.id)}">`.
- [ ] **Step 6: Verify** `node --check js/admin.js` → OK.
- [ ] **Step 7: Commit** `js/admin.js`.

## Task 6: Edge Function `push-order-alerts`

**Files:** Create `supabase/functions/push-order-alerts/index.ts` (repo copy); deploy the same code via the dashboard.

**Interfaces produced:** an HTTP endpoint that, given `{record:{id}}` (webhook) or `{}` (cron sweep) + header `x-alert-secret`, sends web-push to all `push_subscriptions` for the target order(s) and prunes dead subs.

- [ ] **Step 1: Create the function code:**
```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,        // e.g. "mailto:pastobyaiman@gmail.com"
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);
const TRIGGER_SECRET = Deno.env.get("ALERT_TRIGGER_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-alert-secret") !== TRIGGER_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  let orderId: string | null = null;
  try { const b = await req.json(); orderId = b?.record?.id ?? b?.orderId ?? null; } catch (_) { /* sweep */ }

  const cols = "id, short_code, customer_name, total";
  let orders: any[] = [];
  if (orderId) {
    const { data } = await supabase.from("orders").select(cols).eq("id", orderId).limit(1);
    orders = data ?? [];
  } else {
    const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data } = await supabase.from("orders").select(cols)
      .eq("status", "received").eq("alert_acked", false).gt("created_at", cutoff);
    orders = data ?? [];
  }
  if (!orders.length) return Response.json({ sent: 0 });

  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
  let sent = 0;
  for (const o of orders) {
    const payload = JSON.stringify({
      title: `🍝 New order #${o.short_code}`,
      body: `${o.customer_name} — Rs. ${o.total}`,
      orderId: o.id, shortCode: o.short_code, tag: o.id
    });
    for (const s of (subs ?? [])) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }
  }
  return Response.json({ sent });
});
```
- [ ] **Step 2: Deploy via dashboard.** Supabase → Edge Functions → **Create function** → name `push-order-alerts` → paste the code → **Deploy**. Then **Details → toggle OFF "Verify JWT"** (we guard with `x-alert-secret` instead, so the webhook/cron can call it without a user token).
- [ ] **Step 3: Set the secrets.** Edge Functions → **Secrets** (or `Settings → Edge Functions → Secrets`): add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from Task 1), `VAPID_SUBJECT` = `mailto:pastobyaiman@gmail.com`, `ALERT_TRIGGER_SECRET` = a long random string you invent. (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
- [ ] **Step 4: Note the function URL** — `https://<project-ref>.functions.supabase.co/push-order-alerts` (shown in the dashboard). Needed for Tasks 7 & 8.
- [ ] **Step 5: Verify with a subscription present.** After Task 5 is deployed and you've tapped "Enable order alerts" once on a device (so a row exists in `push_subscriptions`), run from a terminal:
```bash
curl -X POST "https://<project-ref>.functions.supabase.co/push-order-alerts" \
  -H "Content-Type: application/json" -H "x-alert-secret: <YOUR_SECRET>" -d "{}"
```
Expected: a JSON `{ "sent": N }` and, if a new un-acked order exists, a notification on the device. A wrong/missing secret returns `401`.
- [ ] **Step 6: Commit** `supabase/functions/push-order-alerts/index.ts`.

## Task 7: Database Webhook — instant first push

**Files:** none (Supabase dashboard config).

- [ ] **Step 1: Create the webhook.** Supabase → **Database → Webhooks → Create** → table `orders`, event **INSERT**, type **HTTP Request**, method **POST**, URL = the function URL from Task 6, and add an HTTP header `x-alert-secret: <YOUR_SECRET>` (+ `Content-Type: application/json`).
- [ ] **Step 2: Verify.** Insert a test order from the site (or SQL Editor). Within a couple seconds the subscribed device gets "🍝 New order #…". Check the function's **Logs** tab shows a 200 with `sent ≥ 1`.

## Task 8: pg_cron re-alert sweep (2-min loop)

**Files:** Modify `database/schema.sql` (append; requires the function URL + secret, so it comes after Task 6).

- [ ] **Step 1: Enable extensions** (Supabase → Database → Extensions): enable **pg_cron** and **pg_net** (pg_net already used by the old Telegram code).
- [ ] **Step 2: Add the cron SQL** (append to `schema.sql`, filling in the real URL + secret):
```sql
-- Re-alert un-acknowledged new orders every 2 min (20-min window enforced in the function)
select cron.unschedule('push-order-alerts-sweep')
  where exists (select 1 from cron.job where jobname = 'push-order-alerts-sweep');
select cron.schedule('push-order-alerts-sweep', '*/2 * * * *', $$
  select net.http_post(
    url     := 'https://<project-ref>.functions.supabase.co/push-order-alerts',
    headers := jsonb_build_object('Content-Type','application/json','x-alert-secret','<YOUR_SECRET>'),
    body    := '{}'::jsonb
  );
$$);
```
- [ ] **Step 3: Run** the block in the SQL Editor.
- [ ] **Step 4: Verify.** Place a test order and **don't** acknowledge it. Confirm a repeat notification arrives ~2 min later, and that it **stops** once you tap it (or advance the order's status). Check `select * from cron.job_run_details order by start_time desc limit 5;` shows successful runs.
- [ ] **Step 5: Commit** `database/schema.sql` (with the URL; the secret in cron is DB-internal, not client-exposed — acceptable, but you may store it in a private settings row instead if preferred).

## Task 9: Install the PWA + full end-to-end verification

**Files:** none (device + deploy).

- [ ] **Step 1: Redeploy the static site** to Vercel (so `sw.js`, `config.js`, `admin.js` changes are live).
- [ ] **Step 2: Install on iPhone.** Safari → open `/admin` → Share → **Add to Home Screen**. Open the **installed** app (not the Safari tab) → sign in → tap **🔔 Enable order alerts** → allow. (iOS delivers web push only to the home-screen-installed PWA.)
- [ ] **Step 3: Install on Android** (Chrome → Install app) and enable alerts there too.
- [ ] **Step 4: E2E.** From another device, place a test order. Verify: both installed devices get the push within seconds; tapping opens the order; leaving it unacked re-alerts at ~2 min; acknowledging (tap / "Acknowledge · Start Cooking" / advance status) stops it; after 20 min it stops regardless.
- [ ] **Step 5: Confirm Telegram is gone** — no Telegram message arrives, and `select * from site_settings where key like 'telegram%'` is empty.
- [ ] **Step 6: Final commit** if any path/icon tweaks were needed.

---

## Self-review
- **Spec coverage:** service worker (T4), admin subscribe + re-subscribe-on-launch + acknowledge + deep link (T5), `push_subscriptions` + RLS (T2), `orders.alert_acked` + auto-ack trigger (T2), Edge Function w/ secret guard + dead-sub pruning (T6), DB webhook instant push (T7), `pg_cron` 2-min / 20-min loop (T8), multi-device (subscriptions keyed by endpoint, function fans out to all — T2/T6), Telegram removal (T2), VAPID (T1), install + E2E (T9). All spec components mapped.
- **Placeholders:** the only intentional fill-ins are `PASTE_YOUR_VAPID_PUBLIC_KEY_HERE`, `<project-ref>`, `<YOUR_SECRET>`, `VAPID_SUBJECT` email — all owner-specific secrets/URLs, flagged explicitly, not vague steps.
- **Type/name consistency:** `PushAPI.saveSubscription` / `removeSubscription`, `OrdersAPI.acknowledgeAlert`, `ensurePushSubscription`, `urlBase64ToUint8Array`, `VAPID_PUBLIC_KEY`, payload shape `{title,body,orderId,shortCode,tag}` (produced in T6, consumed in T4) all match across tasks. `data-order-id` used consistently in T5.
- **Verified identifiers (no longer assumptions):** `assets/logo-icon.png` exists (referenced at `admin.js:1426`, `admin.html:22`); `showDashboard` (`admin.js:156`), `loadOrders` (`admin.js:373`), `acknowledgeNewOrder` + `_currentAlertOrder` (`admin.js:1338`/`1255`) confirmed; section nav is `.admin-section-tab[data-section="orders"]` (`admin.html:89`) — there is no `switchTab`. Plan updated to match.
