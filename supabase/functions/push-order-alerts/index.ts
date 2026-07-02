// Pasto — owner order-alert web push (Spec #1).
// Deployed via the Supabase dashboard Edge Function editor.
// Invoked by (a) a Database Webhook on orders INSERT  -> { record: { id } }
//        and (b) pg_cron every 2 min (sweep mode)     -> {}
// Guarded by a shared secret header `x-alert-secret` (turn OFF "Verify JWT"
// for this function in the dashboard, since the webhook/cron have no user JWT).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,        // e.g. "mailto:pastobyaiman@gmail.com"
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const TRIGGER_SECRET = Deno.env.get("ALERT_TRIGGER_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-alert-secret") !== TRIGGER_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let orderId: string | null = null;
  try {
    const b = await req.json();
    orderId = b?.record?.id ?? b?.orderId ?? null;
  } catch (_) { /* empty body = sweep mode */ }

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

  const { data: subs } = await supabase
    .from("push_subscriptions").select("endpoint, p256dh, auth");

  let sent = 0;
  for (const o of orders) {
    const payload = JSON.stringify({
      title: `🍝 New order #${o.short_code}`,
      body: `${o.customer_name} — Rs. ${o.total}`,
      orderId: o.id,
      shortCode: o.short_code,
      tag: o.id,
    });
    for (const s of (subs ?? [])) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err: any) {
        // 404/410 = the browser dropped this subscription -> prune it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }
  }
  return Response.json({ sent });
});
