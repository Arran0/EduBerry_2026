-- Index behind the Operations rail's paged alert list.
--
-- The rail now reads 10 alerts at a time ordered by severity, first_seen_at and id,
-- all descending (see fetchOpenAlerts in src/lib/transport/runs.ts for why the order
-- moved off last_seen_at). The existing idx_transport_alerts_open covers
-- (severity, last_seen_at DESC) and only WHERE status = 'open', so it served neither
-- the new ordering nor the acknowledged half of the filter.
--
-- With this in place a page costs 0.298ms and touches 10 rows, against 6,694 before.

CREATE INDEX IF NOT EXISTS idx_transport_alerts_live_paging
  ON public.transport_alerts USING btree (severity DESC, first_seen_at DESC, id DESC)
  WHERE status = ANY (ARRAY['open'::transport_alert_status, 'acknowledged'::transport_alert_status]);
