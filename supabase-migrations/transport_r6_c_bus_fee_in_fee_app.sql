-- ============================================================================
-- transport_r6_c_bus_fee_in_fee_app — bus fees are billed by the fee app
-- ============================================================================
-- Safe to re-run. Run after transport_r6_b_route_direction_fee_mode.sql.
--
-- Every session gets a default monthly fee head, "Bus fee" (is_transport), and
-- bus fees are raised as ordinary fee-app bills under it: fee_invoices with one
-- fee_invoice_lines row per route the child rides, the route's id in
-- source_id. So bus fees are collected, receipted, reminded and reported by
-- the fee app like any other fee, and either app can issue a month:
--
--   - Transport → Configuration → "Issue a month of bus fees", or a route's
--     Fees tab;
--   - Fees → the grid's monthly issue, where the Bus fee column is priced per
--     route rather than per grade.
--
-- Both call fee_issue_transport(). What a rider is billed is decided by their
-- route (transport_r6_b): by stop (transport_stop_fees) or by student
-- (transport_student_assignments.fee_amount). A route whose pricing is not
-- chosen yet bills nobody; a rider with no price is skipped and counted.
--
-- A month is never billed twice for the same child and route: a live
-- (non-cancelled) bill line for that head, route, child and month blocks it,
-- and undoing the issue in the fee app cancels its bills, which frees the
-- month again. Running a month a second time bills only whoever was missed.
-- ============================================================================

-- ── The head ────────────────────────────────────────────────────────────
-- Internal: finds the session's monthly transport head, creating it if
-- needed. Not callable by clients; fee_issue_transport checks permission.
CREATE OR REPLACE FUNCTION public.fee_transport_head(p_year UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.fee_heads
   WHERE academic_year_id = p_year AND is_transport AND frequency = 'monthly'
   ORDER BY active DESC, (code = 'BUS_FEE') DESC, created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.fee_heads (academic_year_id, category_id, name, code, description,
                                default_amount, is_transport, frequency, active, sort)
  VALUES (p_year, (SELECT id FROM public.fee_categories WHERE code = 'TRANSPORT'),
          'Bus fee', 'BUS_FEE',
          'Priced per route in Transport — by stop or by student. Issued monthly.',
          0, true, 'monthly', true, 900)
  ON CONFLICT (academic_year_id, code) DO UPDATE SET is_transport = true, frequency = 'monthly'
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fee_transport_head(UUID) FROM PUBLIC, anon, authenticated;

-- Every existing session gets its head now.
SELECT public.fee_transport_head(id) FROM public.academic_years;

-- ── Issuing a month ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_issue_transport(
  p_year    UUID,
  p_month   DATE,
  p_due     DATE DEFAULT NULL,
  p_routes  UUID[] DEFAULT NULL,
  p_commit  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_head      UUID;
  v_month     DATE := date_trunc('month', p_month)::DATE;
  v_month_end DATE := (date_trunc('month', p_month) + INTERVAL '1 month - 1 day')::DATE;
  v_due       DATE;
  v_title     TEXT;
  v_issue     UUID;
  v_all       JSONB;
  v_ready     JSONB;
  v_s         RECORD;
  v_line      RECORD;
  v_profile   UUID;
  v_invoice   UUID;
  v_seq       BIGINT;
  v_number    TEXT;
  v_inv_total NUMERIC(12,2);
  v_sort      INT;
  v_total     NUMERIC(12,2) := 0;
  v_invoices  INT := 0;
  v_lines     INT := 0;
  v_already   INT;
  v_unpriced  INT;
  v_unset     INT;
  v_by_route  JSONB;
BEGIN
  IF NOT public.fee_requires('fees.invoice.generate') THEN
    RAISE EXCEPTION 'You do not have permission to issue fees';
  END IF;
  IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month to issue'; END IF;

  v_head := public.fee_transport_head(p_year);
  v_due := COALESCE(p_due,
    (SELECT due_date FROM public.fee_months WHERE academic_year_id = p_year AND month = v_month),
    v_month + 9);
  v_title := 'Bus fee — ' || to_char(v_month, 'FMMonth YYYY');

  -- Every current rider on the chosen running routes, priced by their route.
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::JSONB) INTO v_all FROM (
    SELECT a.student_id, a.route_id, r.name AS route_name, r.fee_mode,
           CASE r.fee_mode
             WHEN 'student' THEN a.fee_amount
             WHEN 'stop' THEN sf.amount
           END AS amount,
           EXISTS (
             SELECT 1 FROM public.fee_invoice_lines l
               JOIN public.fee_invoices i ON i.id = l.invoice_id
               JOIN public.fee_issues s ON s.id = i.issue_id
              WHERE l.fee_head_id = v_head AND l.source_id = a.route_id
                AND i.student_id = a.student_id AND i.status <> 'cancelled'
                AND s.bill_month = v_month
           ) AS already
      FROM public.transport_student_assignments a
      JOIN public.transport_routes r ON r.id = a.route_id
      LEFT JOIN public.transport_stop_fees sf ON sf.stop_id = COALESCE(a.pickup_stop_id, a.drop_stop_id)
     WHERE a.ended_on IS NULL
       AND a.started_on <= v_month_end
       AND r.active AND r.archived_at IS NULL
       AND (p_routes IS NULL OR a.route_id = ANY (p_routes))
  ) x;

  SELECT
    COUNT(*) FILTER (WHERE (e ->> 'already')::BOOLEAN),
    COUNT(*) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN AND e ->> 'fee_mode' IS NOT NULL
                       AND COALESCE((e ->> 'amount')::NUMERIC, 0) <= 0),
    COUNT(*) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN AND e ->> 'fee_mode' IS NULL),
    COALESCE(jsonb_agg(e) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN
                                    AND COALESCE((e ->> 'amount')::NUMERIC, 0) > 0), '[]'::JSONB)
    INTO v_already, v_unpriced, v_unset, v_ready
    FROM jsonb_array_elements(v_all) e;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'route_id', route_id, 'route_name', route_name,
           'ready', ready, 'total', total, 'already', already, 'unpriced', unpriced, 'unset', unset)
           ORDER BY route_name), '[]'::JSONB)
    INTO v_by_route
    FROM (
      SELECT e ->> 'route_id' AS route_id, e ->> 'route_name' AS route_name,
             COUNT(*) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN AND COALESCE((e ->> 'amount')::NUMERIC, 0) > 0) AS ready,
             COALESCE(SUM((e ->> 'amount')::NUMERIC) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN AND COALESCE((e ->> 'amount')::NUMERIC, 0) > 0), 0) AS total,
             COUNT(*) FILTER (WHERE (e ->> 'already')::BOOLEAN) AS already,
             COUNT(*) FILTER (WHERE NOT (e ->> 'already')::BOOLEAN AND e ->> 'fee_mode' IS NOT NULL AND COALESCE((e ->> 'amount')::NUMERIC, 0) <= 0) AS unpriced,
             bool_or(e ->> 'fee_mode' IS NULL) AS unset
        FROM jsonb_array_elements(v_all) e
       GROUP BY 1, 2
    ) g;

  v_lines := jsonb_array_length(v_ready);
  SELECT COALESCE(SUM((e ->> 'amount')::NUMERIC), 0) INTO v_total FROM jsonb_array_elements(v_ready) e;
  SELECT COUNT(DISTINCT e ->> 'student_id') INTO v_invoices FROM jsonb_array_elements(v_ready) e;

  IF p_commit AND v_lines > 0 THEN
    INSERT INTO public.fee_issues (academic_year_id, kind, bill_month, due_date, title, filters, issued_by)
    VALUES (p_year, 'grid', v_month, v_due, v_title,
            jsonb_build_object('head_ids', jsonb_build_array(v_head), 'transport', true,
                               'routes', to_jsonb(p_routes)),
            (SELECT auth.uid()))
    RETURNING id INTO v_issue;

    -- Marks the month as issued on the grid's Bus fee column. A second run in
    -- the same month adds bills without a second marker.
    INSERT INTO public.fee_issue_cells (issue_id, academic_year_id, grade, group_id, head_id, term_id, bill_month)
    VALUES (v_issue, p_year, NULL, NULL, v_head, NULL, v_month)
    ON CONFLICT DO NOTHING;

    -- One bill per child, a line per route they ride.
    FOR v_s IN SELECT DISTINCT (e ->> 'student_id')::UUID AS student_id
                 FROM jsonb_array_elements(v_ready) e LOOP
      v_profile := public.fee_ensure_profile(v_s.student_id, p_year);
      SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', p_year);
      INSERT INTO public.fee_invoices (profile_id, student_id, academic_year_id, issue_id,
                                       number, seq, issue_date, due_date, created_by, status)
      VALUES (v_profile, v_s.student_id, p_year, v_issue, v_number, v_seq, CURRENT_DATE, v_due,
              (SELECT auth.uid()), 'pending')
      RETURNING id INTO v_invoice;

      v_sort := 0; v_inv_total := 0;
      FOR v_line IN SELECT (e ->> 'route_id')::UUID AS route_id, e ->> 'route_name' AS route_name,
                           (e ->> 'amount')::NUMERIC AS amount
                      FROM jsonb_array_elements(v_ready) e
                     WHERE (e ->> 'student_id')::UUID = v_s.student_id
                     ORDER BY e ->> 'route_name' LOOP
        v_sort := v_sort + 1;
        v_inv_total := v_inv_total + v_line.amount;
        INSERT INTO public.fee_invoice_lines (invoice_id, kind, fee_head_id, label, amount, source_id, sort)
        VALUES (v_invoice, 'fee', v_head,
                format('Bus fee — %s — %s', v_line.route_name, to_char(v_month, 'FMMonth YYYY')),
                v_line.amount, v_line.route_id, v_sort);
      END LOOP;

      PERFORM public.fee_post_ledger(v_s.student_id, p_year, 'invoice', v_inv_total, 0,
        'fee_invoices', v_invoice, format('Bill %s — %s', v_number, v_title));
    END LOOP;

    UPDATE public.fee_issues SET student_count = v_invoices, invoice_count = v_invoices, total = v_total
     WHERE id = v_issue;
    PERFORM public.fee_log('issue.create', 'fee_issues', v_issue, NULL, p_year, NULL,
      jsonb_build_object('title', v_title, 'transport', true, 'lines', v_lines, 'invoices', v_invoices), NULL, v_total);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit AND v_lines > 0, 'issue_id', v_issue, 'head_id', v_head,
    'title', v_title, 'month', v_month, 'due_date', v_due,
    'lines', v_lines, 'invoices', v_invoices, 'total', v_total,
    'already', v_already, 'unpriced', v_unpriced, 'unset', v_unset,
    'by_route', v_by_route);
END $$;

REVOKE ALL ON FUNCTION public.fee_issue_transport(UUID, DATE, DATE, UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_issue_transport(UUID, DATE, DATE, UUID[], BOOLEAN) TO authenticated;
