-- Photos for tasks on the hosted project (not used on the local test stack).
-- Run once in SQL Editor after migrations/20261023000100_task_photos.sql.
-- pg_cron is already on (supabase/sql/push_live.sql).

-- Every hour: photos decided more than 7 days ago are deleted.
select cron.schedule('zb-photo-purge', '17 * * * *', 'select private.purge_task_photos()');

-- Check:
-- select jobname, schedule, active from cron.job where jobname = 'zb-photo-purge';
