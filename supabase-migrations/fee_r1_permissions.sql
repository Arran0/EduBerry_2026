-- ============================================================================
-- fee_r1_permissions — 28 granular fee permissions, and server-side masking
-- ============================================================================
-- Round 1 of docs/fee-upgrade-plan.md. Run after fee_r1_academic_years.sql.
-- Safe to re-run.
--
-- Before this migration the whole fee module was gated by one predicate,
-- `get_user_role() = 'admin'`, in RLS and in the UI. That makes the front desk
-- an administrator or nothing: to let a clerk take a payment you must also let
-- them edit the price list and reverse a completed payment. Schools are right
-- to refuse that, so the module stayed switched off.
--
-- Three tables and one function replace it:
--
--   fee_permissions  the catalogue of keys (data, not an enum, so a new key is
--                    a seed row rather than a type migration)
--   fee_role_grants  the default answer for a role
--   fee_user_grants  a per-person override; NULL row = inherit the role
--
-- Resolution is user grant > role grant > false. Nothing is implicit: an admin
-- holds all 28 because they are seeded 28 rows, and each one can be taken away.
-- That is how "the accountant has 13 permissions but not payment reversal,
-- which is the principal's alone" is expressible at all.

-- ── Catalogue ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_permissions (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  help         TEXT NOT NULL,
  category     TEXT NOT NULL,
  sort         INT  NOT NULL DEFAULT 0,
  -- Shown with a warning in the matrix. These are the ones that move money
  -- backwards or rewrite what a family owes.
  is_dangerous BOOLEAN NOT NULL DEFAULT false
);

-- ── Role defaults ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_role_grants (
  role           TEXT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.fee_permissions(key) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL DEFAULT false,
  updated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission_key)
);

-- ── Per-person overrides ────────────────────────────────────────────────
-- The absence of a row means "inherit the role". A row with granted = false is
-- a deliberate revocation and outranks the role, which is what makes a
-- principal-only reversal permission possible without inventing a new role.
CREATE TABLE IF NOT EXISTS public.fee_user_grants (
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.fee_permissions(key) ON DELETE CASCADE,
  granted        BOOLEAN NOT NULL,
  note           TEXT,
  granted_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_fee_user_grants_user ON public.fee_user_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_fee_user_grants_key  ON public.fee_user_grants(permission_key);

-- ── Resolution ──────────────────────────────────────────────────────────
-- STABLE so the planner evaluates it once per statement rather than once per
-- row when it appears in an RLS predicate; SECURITY DEFINER so it can read the
-- grant tables regardless of the caller's own policies (otherwise the
-- permission check would need a permission to run).
CREATE OR REPLACE FUNCTION public.has_fee_permission_for(p_user UUID, p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT g.granted FROM public.fee_user_grants g
      WHERE g.user_id = p_user AND g.permission_key = p_key),
    (SELECT r.granted FROM public.fee_role_grants r
      JOIN public.profiles p ON p.id = p_user AND p.role = r.role
     WHERE r.permission_key = p_key),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_fee_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_fee_permission_for((SELECT auth.uid()), p_key);
$$;

-- One round trip for the client hook, instead of 28.
CREATE OR REPLACE FUNCTION public.my_fee_permissions()
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(k.key ORDER BY k.key), ARRAY[]::TEXT[])
    FROM public.fee_permissions k
   WHERE public.has_fee_permission_for((SELECT auth.uid()), k.key);
$$;

-- ── Service-role context ────────────────────────────────────────────────
-- API routes build a service-role client and check the caller's permission in
-- the route (src/lib/fees/serverGuard.ts) before calling anything here. When
-- such a route calls a SECURITY DEFINER RPC there is no JWT, so auth.uid() is
-- NULL and has_fee_permission() would refuse work that has already been
-- authorised one layer up. `fee_requires` is the check every fee RPC uses:
-- an interactive caller must hold the key; a service-role caller has been
-- vouched for already. Reaching service_role needs the secret key, which never
-- leaves the server.
CREATE OR REPLACE FUNCTION public.fee_is_service_context()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  -- The JWT role claim. Not current_user, and not session_user either:
  --   current_user — inside SECURITY DEFINER this is the function's owner
  --     (postgres), so the answer is "yes, service role" for every caller.
  --     That was the privilege escalation.
  --   session_user — PostgREST connects as `authenticator` and SET ROLEs per
  --     request, so this is `authenticator` for ALL API traffic, service-role
  --     calls included. It locks the API routes out instead.
  -- PostgREST sets request.jwt.claims from the verified JWT, and SECURITY
  -- DEFINER does not touch it, so the claim is both accurate and unforgeable.
  SELECT CASE
    WHEN nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN COALESCE(
             nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
             '') = 'service_role'
    -- No claims at all means this is not a PostgREST request: pg_cron, a
    -- migration, psql. Those hold a database connection already. The
    -- session_user guard stops an unauthenticated PostgREST request, which
    -- still arrives as `authenticator`, from taking this branch.
    ELSE session_user NOT IN ('authenticator', 'anon', 'authenticated', 'service_role')
  END;
$$;

CREATE OR REPLACE FUNCTION public.fee_requires(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- The service-role test is spelled out here rather than delegated, so a
  -- future edit to the helper cannot silently make this return true for
  -- everyone. It has done exactly that once. See fee_is_service_context()
  -- for why this reads the JWT claim rather than current_user/session_user.
  SELECT (CASE
    WHEN nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN COALESCE(
             nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
             '') = 'service_role'
    -- No claims at all means this is not a PostgREST request: pg_cron, a
    -- migration, psql. Those hold a database connection already. The
    -- session_user guard stops an unauthenticated PostgREST request, which
    -- still arrives as `authenticator`, from taking this branch.
    ELSE session_user NOT IN ('authenticator', 'anon', 'authenticated', 'service_role')
  END)
      OR public.has_fee_permission(p_key);
$$;

-- ── Masking ─────────────────────────────────────────────────────────────
-- Every money column in every fee view is wrapped in this. A user without
-- `fees.view_amounts` gets NULL from the database, so the number is not in the
-- response body at all — this is not a CSS blur and cannot be undone in
-- devtools. Round 2 builds the views; the helper lands here so R2's views and
-- R1's settings screen agree about what masking means.
CREATE OR REPLACE FUNCTION public.fee_visible_amount(p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN public.has_fee_permission('fees.view_amounts') THEN p_amount END;
$$;

-- ── The 28 keys ─────────────────────────────────────────────────────────
INSERT INTO public.fee_permissions (key, label, help, category, sort, is_dangerous) VALUES
  ('fees.view',              'Open the fee module',        'See the Fee Manager at all. Without this the module is not in the menu.',                        'Access',        10, false),
  ('fees.view_amounts',      'See amounts',                'See rupee figures. Without it, dashboards, counts and lists still work but every amount is hidden — and never leaves the server.', 'Access', 20, false),

  ('fees.config.manage',     'Edit the price list',        'Create and change fee categories, heads, groups, structures and installments.',                  'Configuration', 30, false),
  ('fees.config.clone_year', 'Clone a year',               'Copy an entire year''s fee plan forward to the next session.',                                   'Configuration', 40, false),
  ('fees.settings.manage',   'Change fee settings',        'Receipt numbering, partial-payment rules, grace days, approval thresholds.',                     'Configuration', 50, false),
  ('fees.permissions.manage','Change who can do what',     'Edit this permission matrix. Give it to as few people as possible.',                             'Configuration', 60, true),

  ('fees.profile.view',      'Open a student''s fees',     'Look up a student and see their fee profile, bills and payment history.',                        'Students',      70, false),
  ('fees.profile.create',    'Create fee profiles',        'Create fee profiles, individually or in bulk for a class or the whole school.',                  'Students',      80, false),

  ('fees.invoice.generate',  'Generate bills',             'Run invoice generation for an installment.',                                                     'Invoicing',     90, false),
  ('fees.invoice.autogen',   'Switch on auto-generation',  'Turn nightly automatic bill generation on or off for an installment.',                           'Invoicing',    100, false),
  ('fees.invoice.cancel',    'Cancel a bill',              'Void an issued invoice. The bill is kept and marked cancelled, never deleted.',                   'Invoicing',    110, true),
  ('fees.invoice.send',      'Send a bill',                'Send an invoice to the guardian by WhatsApp, SMS, email or the app.',                            'Invoicing',    120, false),

  ('fees.collect',           'Take a payment',             'Collect money at the counter — cash, UPI, card, bank transfer, cheque.',                         'Collection',   130, false),
  ('fees.collect.backdate',  'Backdate a payment',         'Record a payment as received on an earlier date. Affects which day''s collection it lands in.',  'Collection',   140, true),
  ('fees.receipt.print',     'Print a receipt',            'Print or download a receipt, on A4 or a thermal printer.',                                       'Collection',   150, false),
  ('fees.payment.reverse',   'Reverse a payment',          'Reverse a completed payment. Requires a written reason; the receipt is invalidated and the bill reopens.', 'Collection', 160, true),
  ('fees.instrument.manage', 'Handle cheques',             'Move a cheque or DD through deposited, cleared or bounced, and record bank charges.',            'Collection',   170, false),

  ('fees.discount.apply',    'Apply a discount',           'Put a discount on a specific bill.',                                                             'Concessions',  180, false),
  ('fees.discount.approve',  'Approve a discount',         'Clear discounts that are above the approval threshold and waiting.',                             'Concessions',  190, true),
  ('fees.scholarship.manage','Manage scholarships',        'Create scholarships, set budgets and award them to students.',                                   'Concessions',  200, false),
  ('fees.waiver.approve',    'Approve a waiver',           'Approve or decline a hardship waiver request.',                                                  'Concessions',  210, true),

  ('fees.fine.apply',        'Add a fine',                 'Add a fine to a student, as its own slip or onto a bill they are already paying.',               'Charges',      220, false),
  ('fees.latefee.manage',    'Manage late fees',           'Write late-fee rules, run the sweep, exempt a bill, waive a charge.',                            'Charges',      230, true),

  ('fees.reminder.send',     'Send reminders',             'Send payment reminders manually, and configure the automatic schedule.',                         'Collections',  240, false),

  ('fees.refund.approve',    'Approve a refund',           'Approve a refund request and mark it paid out.',                                                 'Money out',    250, true),

  ('fees.reports.view',      'See the Collection Center',  'Open the reporting hub — collections, outstanding, aging, defaulters.',                          'Oversight',    260, false),
  ('fees.audit.view',        'See the activity log',       'Read the full audit trail of who did what, when, and what changed.',                             'Oversight',    270, false),
  ('fees.rte.manage',        'Manage the RTE register',    'Maintain RTE students, prepare government claims and record reimbursements.',                     'Oversight',    280, false)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, help = EXCLUDED.help,
      category = EXCLUDED.category, sort = EXCLUDED.sort,
      is_dangerous = EXCLUDED.is_dangerous;

-- ── Role defaults ───────────────────────────────────────────────────────
-- Every (role, key) pair gets a row, including the false ones, so the settings
-- matrix renders a complete grid without inventing absent state, and so
-- "granted = false" is a fact somebody set rather than a gap.
INSERT INTO public.fee_role_grants (role, permission_key, granted)
SELECT r.role, k.key,
       CASE
         -- An administrator starts with everything, and can be cut back.
         WHEN r.role = 'admin' THEN true
         -- A principal oversees and approves, but does not own the price list
         -- or the permission matrix.
         WHEN r.role = 'principal'
           THEN k.key NOT IN ('fees.config.manage', 'fees.permissions.manage')
         ELSE false
       END
  FROM (VALUES ('admin'), ('principal'), ('coordinator'), ('teacher'),
               ('student'), ('driver'), ('smartboard')) AS r(role)
 CROSS JOIN public.fee_permissions k
ON CONFLICT (role, permission_key) DO NOTHING;

-- ── Presets ─────────────────────────────────────────────────────────────
-- A preset writes fee_user_grants, not a role, so it composes with whatever
-- role the person already has and shows up in the matrix as an explicit
-- override rather than hidden behaviour.
CREATE OR REPLACE FUNCTION public.apply_fee_permission_preset(p_user UUID, p_preset TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys  TEXT[];
  v_count INT;
BEGIN
  IF NOT public.fee_requires('fees.permissions.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change fee permissions';
  END IF;

  v_keys := CASE p_preset
    -- The front desk: look a student up, take the money, print the slip.
    WHEN 'clerk' THEN ARRAY[
      'fees.view', 'fees.profile.view', 'fees.collect', 'fees.receipt.print']
    -- The office: everything operational, but not reversal, not the matrix,
    -- and not the price list.
    WHEN 'accountant' THEN ARRAY[
      'fees.view', 'fees.view_amounts', 'fees.profile.view', 'fees.profile.create',
      'fees.invoice.generate', 'fees.invoice.send', 'fees.collect',
      'fees.receipt.print', 'fees.instrument.manage', 'fees.discount.apply',
      'fees.fine.apply', 'fees.reminder.send', 'fees.reports.view']
    -- Oversight and approvals, including the reversal the clerk must not have.
    WHEN 'principal' THEN ARRAY[
      'fees.view', 'fees.view_amounts', 'fees.profile.view',
      'fees.payment.reverse', 'fees.invoice.cancel', 'fees.discount.approve',
      'fees.waiver.approve', 'fees.refund.approve', 'fees.latefee.manage',
      'fees.reports.view', 'fees.audit.view']
    WHEN 'none' THEN ARRAY[]::TEXT[]
    WHEN 'full' THEN (SELECT array_agg(key) FROM public.fee_permissions)
    ELSE NULL
  END;

  IF v_keys IS NULL THEN
    RAISE EXCEPTION 'Unknown preset: %', p_preset;
  END IF;

  DELETE FROM public.fee_user_grants WHERE user_id = p_user;

  INSERT INTO public.fee_user_grants (user_id, permission_key, granted, granted_by, note)
  SELECT p_user, k.key, k.key = ANY(v_keys), (SELECT auth.uid()),
         format('Preset: %s', p_preset)
    FROM public.fee_permissions k;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ── Lockout guard ───────────────────────────────────────────────────────
-- Revoking `fees.permissions.manage` from the last person who holds it leaves
-- nobody able to grant it back, and the only repair is a hand-written SQL
-- statement against production. Refuse instead.
CREATE OR REPLACE FUNCTION public.fee_guard_permission_lockout()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_holders INT;
BEGIN
  SELECT count(*) INTO v_holders
    FROM public.profiles p
   WHERE public.has_fee_permission_for(p.id, 'fees.permissions.manage');

  IF v_holders = 0 THEN
    RAISE EXCEPTION 'That would leave nobody able to manage fee permissions';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS fee_user_grants_lockout ON public.fee_user_grants;
CREATE CONSTRAINT TRIGGER fee_user_grants_lockout
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_user_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fee_guard_permission_lockout();

DROP TRIGGER IF EXISTS fee_role_grants_lockout ON public.fee_role_grants;
CREATE CONSTRAINT TRIGGER fee_role_grants_lockout
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_role_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fee_guard_permission_lockout();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_role_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_user_grants  ENABLE ROW LEVEL SECURITY;

-- The catalogue is not sensitive and the client needs it to render the matrix
-- and to reason about what it is missing.
DROP POLICY IF EXISTS "Authenticated read fee permission catalogue" ON public.fee_permissions;
CREATE POLICY "Authenticated read fee permission catalogue" ON public.fee_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Manage fee permission catalogue" ON public.fee_permissions;
CREATE POLICY "Manage fee permission catalogue" ON public.fee_permissions
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.permissions.manage'))
  WITH CHECK (public.has_fee_permission('fees.permissions.manage'));

DROP POLICY IF EXISTS "Authenticated read fee role grants" ON public.fee_role_grants;
CREATE POLICY "Authenticated read fee role grants" ON public.fee_role_grants
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Manage fee role grants" ON public.fee_role_grants;
CREATE POLICY "Manage fee role grants" ON public.fee_role_grants
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.permissions.manage'))
  WITH CHECK (public.has_fee_permission('fees.permissions.manage'));

-- A person may always read their own overrides — the client hook needs it, and
-- knowing what you are allowed to do is not privileged information.
DROP POLICY IF EXISTS "Read own fee grants" ON public.fee_user_grants;
CREATE POLICY "Read own fee grants" ON public.fee_user_grants
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.permissions.manage'));

DROP POLICY IF EXISTS "Manage fee user grants" ON public.fee_user_grants;
CREATE POLICY "Manage fee user grants" ON public.fee_user_grants
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.permissions.manage'))
  WITH CHECK (public.has_fee_permission('fees.permissions.manage'));

-- ── Grants ──────────────────────────────────────────────────────────────
GRANT SELECT ON public.fee_permissions, public.fee_role_grants, public.fee_user_grants TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.fee_permissions, public.fee_role_grants, public.fee_user_grants TO authenticated;

GRANT EXECUTE ON FUNCTION public.has_fee_permission(TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_fee_permission_for(UUID, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_fee_permissions()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_visible_amount(NUMERIC)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fee_permission_preset(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_is_service_context()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_requires(TEXT)                   TO authenticated;

-- Anonymous callers have no fee permissions and no business asking.
REVOKE EXECUTE ON FUNCTION public.has_fee_permission(TEXT)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_fee_permission_for(UUID, TEXT)    FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_fee_permissions()                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_fee_permission_preset(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fee_requires(TEXT)                    FROM anon;

NOTIFY pgrst, 'reload schema';
