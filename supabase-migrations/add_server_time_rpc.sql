-- Authoritative server clock for staff check-in/check-out. A device's local
-- clock can be set to whatever the user likes, which would let them dodge the
-- late/half-day cutoffs; this RPC gives the client a trustworthy "now" to
-- stamp attendance with instead.
CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO authenticated;
