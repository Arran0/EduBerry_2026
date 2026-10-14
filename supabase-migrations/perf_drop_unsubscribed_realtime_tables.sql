-- Stop paying Realtime for three tables nobody listens to.
--
-- Realtime's WAL decoder is the single largest consumer of database CPU on this
-- project — 5,961,605 calls and 40,330 seconds (11.2 hours), more than three times
-- the Task Manager query that took the API down at 08:45. Every write to a published
-- table is decoded and then run through that table's RLS policies once per subscriber
-- to decide who may see it.
--
-- `supabase_realtime` published nine tables. The app opens exactly four channels, and
-- between them they subscribe to six:
--
--   transport_trip_runs, transport_run_stops, transport_run_passengers,
--   transport_alerts        (OperationsSection, useChildTransport, useRunLive)
--   leave_applications, leave_approvals                     (useLeaveRealtime)
--
-- The other three have no subscriber anywhere in the codebase, yet carry 166,280
-- writes between them — `tasks` alone accounts for 163,914. All of that was decoded
-- and RLS-checked for an audience of nobody, on the same two burstable vCPUs the
-- teachers are waiting on at 08:45.
--
-- Dropping a table from the publication changes nothing a client can observe unless
-- something subscribes to it. If a task-realtime feature is added later, re-add the
-- table in the same breath as the subscription:
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

ALTER PUBLICATION supabase_realtime DROP TABLE public.tasks;
ALTER PUBLICATION supabase_realtime DROP TABLE public.task_comments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.task_checklist_items;
