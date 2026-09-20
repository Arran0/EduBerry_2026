-- ─────────────────────────────────────────────────────────────────────────────
-- Fees are for administrators and for the families being billed. Nobody else.
--
-- The permission matrix was built to express "the accountant has 13 keys but
-- not payment reversal", which assumed a fee office of several roles. This
-- school runs it differently: `admin` does the work, students see their own
-- bills, and no other staff role has any business in the module.
--
-- Enforced at the resolver rather than by emptying tables, because a row
-- deleted here is a row a future screen can put back by accident. A teacher
-- granted `fees.collect` by hand — through the matrix, through SQL, through a
-- bug — still resolves to false, because their role is not admin.
--
-- Students are deliberately NOT in this gate. They never hold a fee
-- permission; they reach their own bills through the `student_id = auth.uid()`
-- half of each table's RLS policy, which this does not touch. A student's
-- amounts stay masked for the same reason they always were: they do not hold
-- `fees.view_amounts`, and the `_v` views answer NULL without it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_fee_permission_for(p_user UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- The gate. Only an administrator can hold a fee permission at all, so a
    -- stray grant to any other role resolves to false rather than to access.
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = p_user
               AND p.role = 'admin'
               AND COALESCE(p.is_banned, false) = false)
    AND COALESCE(
      (SELECT g.granted FROM public.fee_user_grants g
        WHERE g.user_id = p_user AND g.permission_key = p_key),
      (SELECT r.granted FROM public.fee_role_grants r
        JOIN public.profiles p ON p.id = p_user AND p.role = r.role
       WHERE r.permission_key = p_key),
      false
    );
$$;

-- Clear the grants the other roles were seeded with, so the matrix and the
-- resolver agree about who holds what. The gate above already makes them
-- inert; leaving them would show a principal 26 ticked boxes that do nothing.
DELETE FROM public.fee_role_grants WHERE role <> 'admin';
DELETE FROM public.fee_user_grants g
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = g.user_id AND p.role = 'admin');

-- Every administrator holds every key by default; individual ones can still be
-- taken away per person, which is what fee_user_grants is for.
INSERT INTO public.fee_role_grants (role, permission_key, granted)
SELECT 'admin', k.key, true FROM public.fee_permissions k
ON CONFLICT (role, permission_key) DO UPDATE SET granted = true;

-- ── The lockout guard ───────────────────────────────────────────────────
-- fee_guard_permission_lockout refuses a change that would leave nobody able
-- to administer fees. With one eligible role that matters more, not less.
NOTIFY pgrst, 'reload schema';
