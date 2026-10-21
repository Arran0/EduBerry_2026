-- Revoke browser access to fee functions superseded by a newer overload.
--
-- fee_r3_actor_attribution.sql re-created several fee RPCs with an extra
-- trailing `p_actor UUID` parameter. CREATE OR REPLACE with a different
-- argument list adds an overload instead of replacing the function, so the
-- older versions are still live — and still EXECUTE-granted to `authenticated`.
-- The app always passes p_actor (src/lib/fees/charges.ts), so it only ever
-- reaches the new versions; a hand-written supabase.rpc() that leaves p_actor
-- out lands on the old ones, which miss rules added since:
--
-- 1. fee_decide_concession(UUID, BOOLEAN, TEXT) has no "nobody signs off their
--    own request" check. Anyone holding both fees.discount.apply and
--    fees.discount.approve can raise a concession of any size and approve it
--    themselves — the maker-checker control the new version enforces.
--
-- 2. fee_log(TEXT, TEXT, UUID, UUID, UUID, JSONB, JSONB, TEXT, NUMERIC) lets any
--    signed-in account — a student included — write arbitrary rows into
--    fee_audit_log, the module's tamper-proof record (fabricated "reversals"
--    or "waivers" against real students). 23 call sites inside fee/transport
--    functions still use this form, so it is revoked, not dropped; all 24
--    callers are SECURITY DEFINER and run as the owner.
--
-- 3. fee_apply_concession(…8 args) and fee_reverse_payment(UUID, TEXT) carry
--    the same checks as their replacements today, but an orphaned overload is
--    where the next hardening will be forgotten. Same treatment.
--
-- fee_post_ledger's old overload was already revoked in fee_r2_ledger.sql.

REVOKE EXECUTE ON FUNCTION public.fee_decide_concession(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fee_log(TEXT, TEXT, UUID, UUID, UUID, JSONB, JSONB, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fee_apply_concession(UUID, TEXT, NUMERIC, UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fee_reverse_payment(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
