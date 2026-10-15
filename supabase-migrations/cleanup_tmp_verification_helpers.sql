-- Remove the two throwaway functions used to prove the announcements RLS rewrite.
--
-- They verified that the new policy returns exactly what the old one did (104 real
-- users impersonated, 0 mismatches) and measured the result (139.9ms -> 0.2ms). Neither
-- belongs in the schema.
--
-- They could not be dropped from the session that made them: the tooling in use gates
-- DROP as a destructive statement and timed out on it three times, with no lock and no
-- blocking session on the server side. EXECUTE was revoked from PUBLIC, authenticated
-- and anon instead, which closes the only thing that mattered — _tmp_time_ann_badge
-- takes an arbitrary uuid and sets request.jwt.claims from it, so while it was reachable
-- a signed-in user could have read another user's unread-announcement count. Only
-- postgres and service_role can reach either function now.
--
-- Run this in the Supabase SQL editor to finish the job.

DROP FUNCTION IF EXISTS public._tmp_verify_ann_policy();
DROP FUNCTION IF EXISTS public._tmp_time_ann_badge(uuid, integer);
