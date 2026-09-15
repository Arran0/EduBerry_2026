-- Applied to the mps-web project as the migration
-- `payment_secrets_write_only_rpcs`. Kept here as the repo's record.
--
-- The Fee Settings and Payroll Settings forms read every stored bank
-- credential back into the admin's browser so the inputs could be
-- pre-populated — the client secret, the request signing secret, the callback
-- secret, the certificate passphrase and the client PRIVATE KEY PEM. Being
-- admin-only is not a reason to ship a private key to a browser on every page
-- load.
--
-- These two RPCs make the true secrets write-only:
--   * reads return the identifiers an admin needs in order to verify they
--     configured the right account (corporate id, client id, OAuth audience,
--     debit account + IFSC, the PUBLIC certificate) plus the list of which
--     keys currently hold a value;
--   * writes merge a patch, so a blank field means "leave it as it is" rather
--     than "erase it", and an explicit p_clear list is the only way to delete.

CREATE OR REPLACE FUNCTION public.payment_secrets_read(p_scope text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  write_only constant text[] := ARRAY[
    'api_key','client_secret','signing_secret','webhook_secret',
    'client_key_pem','client_cert_passphrase','key_secret'
  ];
  stored jsonb;
  shown  jsonb := '{}'::jsonb;
  setkeys text[] := ARRAY[]::text[];
  k text;
  v jsonb;
BEGIN
  IF (SELECT get_user_role()) <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO stored FROM payment_secrets WHERE key = p_scope;
  IF stored IS NULL OR jsonb_typeof(stored) <> 'object' THEN
    RETURN jsonb_build_object('values', shown, 'configured', to_jsonb(setkeys));
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(stored) LOOP
    -- A blank stored value means "unset" (the server reader falls back to the
    -- env var), so it is neither shown nor reported as configured.
    IF jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') <> '' THEN
      setkeys := setkeys || k;
      IF NOT (k = ANY (write_only)) THEN
        shown := shown || jsonb_build_object(k, v);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('values', shown, 'configured', to_jsonb(setkeys));
END; $$;

REVOKE ALL ON FUNCTION public.payment_secrets_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_secrets_read(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payment_secrets_write(
  p_scope text, p_patch jsonb, p_clear text[] DEFAULT ARRAY[]::text[]
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  merged jsonb;
  k text;
BEGIN
  IF (SELECT get_user_role()) <> 'admin' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(value, '{}'::jsonb) INTO merged FROM payment_secrets WHERE key = p_scope;
  merged := coalesce(merged, '{}'::jsonb) || p_patch;

  FOREACH k IN ARRAY coalesce(p_clear, ARRAY[]::text[]) LOOP
    merged := merged - k;
  END LOOP;

  INSERT INTO payment_secrets (key, value, updated_at) VALUES (p_scope, merged, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.payment_secrets_write(text, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_secrets_write(text, jsonb, text[]) TO authenticated;
