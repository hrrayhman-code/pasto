-- ============================================================
-- pg_cron re-alert sweep for owner PWA order alerts (Spec #1, Task 8)
-- ============================================================
-- Run this ONCE in the Supabase SQL Editor AFTER the Edge Function
-- `push-order-alerts` is deployed (Task 6), replacing the two
-- placeholders below with your real values.
--
--   <project-ref>  = your Supabase project ref (e.g. ftgfqlfgqhckqljrufqd)
--   <YOUR_SECRET>  = the same ALERT_TRIGGER_SECRET you set as an Edge
--                    Function secret in Task 6
--
-- Requires the pg_cron and pg_net extensions (Database -> Extensions).
-- Kept out of schema.sql so that schema.sql stays runnable without
-- these project-specific values.
-- ============================================================

-- Re-invoke the push function every 2 minutes; the function itself only
-- re-alerts orders still status='received', alert_acked=false, and within
-- the last 20 minutes (the cap).
select cron.unschedule('push-order-alerts-sweep')
  where exists (select 1 from cron.job where jobname = 'push-order-alerts-sweep');

select cron.schedule('push-order-alerts-sweep', '*/2 * * * *', $$
  select net.http_post(
    url     := 'https://<project-ref>.functions.supabase.co/push-order-alerts',
    headers := jsonb_build_object('Content-Type','application/json','x-alert-secret','<YOUR_SECRET>'),
    body    := '{}'::jsonb
  );
$$);

-- Verify:
--   select * from cron.job where jobname = 'push-order-alerts-sweep';
--   select * from cron.job_run_details order by start_time desc limit 5;
