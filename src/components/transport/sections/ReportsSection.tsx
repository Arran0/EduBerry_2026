'use client'

/**
 * Transport reports.
 *
 * Every number comes from the nightly rollup, which means today is not in them
 * until tomorrow. That is stated on the screen rather than hidden, because a
 * report that silently mixed a complete yesterday with a third of today would
 * be worse than one that says where it stops.
 *
 * The screen leads with GPS coverage, which is not the report anyone asks for
 * and is the one that decides whether the others can be believed: a route with
 * 30% coverage did not have "no delays", it had no data about delays.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Clock, Download, Gauge, Loader2, Radio, TrendingUp, Users,
} from 'lucide-react'
import { ADMIN, SHEET, Sheet, SheetRowSkeleton } from '@/components/bus/adminUI'
import {
  fetchAttendanceMismatch, fetchGpsHealthReport, fetchOnTimeReport,
  fetchStopDelayReport, fetchUtilisationReport, formatDelay, pct, windowOf,
  REPORT_WINDOWS,
  type GpsHealthRow, type MismatchRow, type OnTimeRow, type StopDelayRow, type UtilisationRow,
} from '@/lib/transport/reports'
import { csvFile } from '@/lib/zip'
import { downloadBlob } from '@/lib/transport/gtfs'
import { DIRECTION_LABELS } from '@/lib/transport/types'
import { EmptyRow } from './FleetSection'

type Tab = 'ontime' | 'utilisation' | 'stops' | 'gps' | 'mismatch'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'ontime', label: 'On time', icon: <Clock size={13} /> },
  { key: 'utilisation', label: 'Seats used', icon: <Users size={13} /> },
  { key: 'stops', label: 'Delay by stop', icon: <TrendingUp size={13} /> },
  { key: 'gps', label: 'GPS health', icon: <Radio size={13} /> },
  { key: 'mismatch', label: 'Bus vs class', icon: <AlertTriangle size={13} /> },
]

export default function ReportsSection() {
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState<Tab>('ontime')
  const [loading, setLoading] = useState(true)

  const [ontime, setOntime] = useState<OnTimeRow[]>([])
  const [util, setUtil] = useState<UtilisationRow[]>([])
  const [stops, setStops] = useState<StopDelayRow[]>([])
  const [gps, setGps] = useState<GpsHealthRow[]>([])
  const [mismatch, setMismatch] = useState<MismatchRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = windowOf(days)
    // Five independent reads, fired together: the summary strip shows figures
    // from more than one of them, so loading them per tab would mean the strip
    // filled in as the admin clicked around.
    const [a, b, c, d, e] = await Promise.all([
      fetchOnTimeReport(from, to),
      fetchUtilisationReport(from, to),
      fetchStopDelayReport(from, to),
      fetchGpsHealthReport(from, to),
      fetchAttendanceMismatch(from, to),
    ])
    setOntime(a); setUtil(b); setStops(c); setGps(d); setMismatch(e)
    setLoading(false)
  }, [days])

  useEffect(() => { load() }, [load])

  const totalArrived = ontime.reduce((n, r) => n + r.stops_arrived, 0)
  const totalOnTime = ontime.reduce((n, r) => n + r.stops_on_time, 0)
  const fleetOnTime = totalArrived > 0 ? Math.round((1000 * totalOnTime) / totalArrived) / 10 : null
  const worstCoverage = gps.length > 0 ? gps[0] : null
  const avgUtil = util.length > 0
    ? Math.round(util.reduce((n, r) => n + (r.utilisation_pct ?? 0), 0) / util.length)
    : null

  const exportCsv = () => {
    const { from, to } = windowOf(days)
    const spec: Record<Tab, { header: string[]; rows: Record<string, unknown>[]; name: string }> = {
      ontime: {
        name: 'on-time',
        header: ['route_name', 'direction', 'runs', 'stops_arrived', 'stops_on_time',
          'on_time_pct', 'avg_delay_seconds', 'max_delay_seconds'],
        rows: ontime as unknown as Record<string, unknown>[],
      },
      utilisation: {
        name: 'seats-used',
        header: ['route_name', 'capacity', 'avg_expected', 'avg_boarded', 'utilisation_pct', 'no_show_pct'],
        rows: util as unknown as Record<string, unknown>[],
      },
      stops: {
        name: 'delay-by-stop',
        header: ['stop_name', 'route_name', 'direction', 'arrivals', 'on_time_pct',
          'avg_delay_seconds', 'max_delay_seconds'],
        rows: stops as unknown as Record<string, unknown>[],
      },
      gps: {
        name: 'gps-health',
        header: ['registration_no', 'display_name', 'runs', 'avg_coverage_pct',
          'worst_coverage_pct', 'longest_gap_seconds', 'total_fixes'],
        rows: gps as unknown as Record<string, unknown>[],
      },
      mismatch: {
        name: 'bus-vs-class',
        header: ['service_date', 'student_name', 'route_name', 'boarding_state', 'class_status'],
        rows: mismatch as unknown as Record<string, unknown>[],
      },
    }
    const { header, rows, name } = spec[tab]
    downloadBlob(
      new Blob([csvFile(header, rows)], { type: 'text/csv;charset=utf-8' }),
      `transport-${name}-${from}-to-${to}.csv`,
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-lg border border-[#E4E4E7] overflow-hidden bg-white">
          {REPORT_WINDOWS.map(w => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                days === w.days ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:bg-[#FAFAFA]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button className={ADMIN.ghostBtn} onClick={exportCsv} disabled={loading}>
          <Download size={13} /> Export this report
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={<Clock size={14} />}
          label="Stops on time"
          value={fleetOnTime == null ? '—' : `${fleetOnTime}%`}
          detail={`${totalOnTime} of ${totalArrived} arrivals`}
          tone={fleetOnTime == null ? 'flat' : fleetOnTime >= 90 ? 'good' : fleetOnTime >= 75 ? 'warn' : 'bad'}
        />
        <Stat
          icon={<Users size={14} />}
          label="Seats used"
          value={avgUtil == null ? '—' : `${avgUtil}%`}
          detail={`${util.length} route${util.length === 1 ? '' : 's'} measured`}
          tone="flat"
        />
        <Stat
          icon={<Radio size={14} />}
          label="Weakest GPS"
          value={worstCoverage?.avg_coverage_pct == null ? '—' : `${worstCoverage.avg_coverage_pct}%`}
          detail={worstCoverage
            ? worstCoverage.display_name ?? worstCoverage.registration_no
            : 'No trips recorded'}
          tone={worstCoverage?.avg_coverage_pct == null ? 'flat'
            : worstCoverage.avg_coverage_pct >= 85 ? 'good'
            : worstCoverage.avg_coverage_pct >= 60 ? 'warn' : 'bad'}
        />
        <Stat
          icon={<AlertTriangle size={14} />}
          label="Bus vs class"
          value={String(mismatch.length)}
          detail="Boarded, then marked absent"
          tone={mismatch.length === 0 ? 'good' : 'warn'}
        />
      </div>

      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-[#E4E4E7]">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-[#B8983C] text-[#27272A]'
                : 'border-transparent text-[#A1A1AA] hover:text-[#52525B]'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Sheet><SheetRowSkeleton /><SheetRowSkeleton /><SheetRowSkeleton /></Sheet>
      ) : tab === 'ontime' ? (
        <Sheet columns={<>
          <span className={`${SHEET.headCell} flex-1`}>Route</span>
          <span className={`${SHEET.headCell} w-24 text-center`}>Trips</span>
          <span className={`${SHEET.headCell} w-28 text-center`}>Arrivals</span>
          <span className={`${SHEET.headCell} w-24 text-right`}>On time</span>
          <span className={`${SHEET.headCell} w-32 text-right`}>Average</span>
          <span className={`${SHEET.headCell} w-32 text-right`}>Worst</span>
        </>}>
          {ontime.length === 0 ? (
            <EmptyRow icon={<Clock size={22} />} title="Nothing rolled up yet"
              detail="Figures appear the night after a trip finishes. Give it until tomorrow morning." />
          ) : ontime.map(r => (
            <Row key={`${r.route_id}-${r.direction}`}
              tone={r.on_time_pct == null ? 'flat' : r.on_time_pct >= 90 ? 'good' : r.on_time_pct >= 75 ? 'warn' : 'bad'}
              title={r.route_name}
              subtitle={DIRECTION_LABELS[r.direction]}
              cells={[
                { w: 'w-24', align: 'text-center', text: String(r.runs) },
                { w: 'w-28', align: 'text-center', text: `${r.stops_on_time}/${r.stops_arrived}` },
                { w: 'w-24', align: 'text-right', text: pct(r.on_time_pct), bold: true },
                { w: 'w-32', align: 'text-right', text: formatDelay(r.avg_delay_seconds) },
                { w: 'w-32', align: 'text-right', text: formatDelay(r.max_delay_seconds) },
              ]} />
          ))}
        </Sheet>
      ) : tab === 'utilisation' ? (
        <Sheet columns={<>
          <span className={`${SHEET.headCell} flex-1`}>Route</span>
          <span className={`${SHEET.headCell} w-24 text-center`}>Seats</span>
          <span className={`${SHEET.headCell} w-28 text-center`}>Assigned</span>
          <span className={`${SHEET.headCell} w-28 text-center`}>Riding</span>
          <span className={`${SHEET.headCell} w-28 text-right`}>Used</span>
          <span className={`${SHEET.headCell} w-28 text-right`}>No-shows</span>
        </>}>
          {util.length === 0 ? (
            <EmptyRow icon={<Users size={22} />} title="Nothing rolled up yet"
              detail="Seat usage is computed from finished trips, the night after they run." />
          ) : util.map(r => (
            <Row key={r.route_id}
              tone={r.utilisation_pct == null ? 'flat'
                : r.utilisation_pct > 100 ? 'bad' : r.utilisation_pct >= 60 ? 'good' : 'warn'}
              title={r.route_name}
              subtitle={r.utilisation_pct != null && r.utilisation_pct > 100
                ? 'Over capacity' : 'Average across the window'}
              cells={[
                { w: 'w-24', align: 'text-center', text: r.capacity == null ? '—' : String(r.capacity) },
                { w: 'w-28', align: 'text-center', text: r.avg_expected == null ? '—' : String(r.avg_expected) },
                { w: 'w-28', align: 'text-center', text: r.avg_boarded == null ? '—' : String(r.avg_boarded) },
                { w: 'w-28', align: 'text-right', text: pct(r.utilisation_pct), bold: true },
                { w: 'w-28', align: 'text-right', text: pct(r.no_show_pct) },
              ]} />
          ))}
        </Sheet>
      ) : tab === 'stops' ? (
        <Sheet columns={<>
          <span className={`${SHEET.headCell} flex-1`}>Stop</span>
          <span className={`${SHEET.headCell} w-28 text-center`}>Arrivals</span>
          <span className={`${SHEET.headCell} w-24 text-right`}>On time</span>
          <span className={`${SHEET.headCell} w-32 text-right`}>Average</span>
          <span className={`${SHEET.headCell} w-32 text-right`}>Worst</span>
        </>}>
          {stops.length === 0 ? (
            <EmptyRow icon={<TrendingUp size={22} />} title="Nothing rolled up yet"
              detail="Once trips finish, the stops that are reliably late show up at the top of this list." />
          ) : stops.map(r => (
            <Row key={`${r.stop_id}-${r.direction}`}
              tone={r.on_time_pct == null ? 'flat' : r.on_time_pct >= 90 ? 'good' : r.on_time_pct >= 75 ? 'warn' : 'bad'}
              title={r.stop_name}
              subtitle={[r.route_name, DIRECTION_LABELS[r.direction]].filter(Boolean).join(' · ')}
              cells={[
                { w: 'w-28', align: 'text-center', text: String(r.arrivals) },
                { w: 'w-24', align: 'text-right', text: pct(r.on_time_pct) },
                { w: 'w-32', align: 'text-right', text: formatDelay(r.avg_delay_seconds), bold: true },
                { w: 'w-32', align: 'text-right', text: formatDelay(r.max_delay_seconds) },
              ]} />
          ))}
        </Sheet>
      ) : tab === 'gps' ? (
        <Sheet columns={<>
          <span className={`${SHEET.headCell} flex-1`}>Vehicle</span>
          <span className={`${SHEET.headCell} w-24 text-center`}>Trips</span>
          <span className={`${SHEET.headCell} w-28 text-right`}>Coverage</span>
          <span className={`${SHEET.headCell} w-28 text-right`}>Worst trip</span>
          <span className={`${SHEET.headCell} w-32 text-right`}>Longest gap</span>
        </>}>
          {gps.length === 0 ? (
            <EmptyRow icon={<Radio size={22} />} title="Nothing rolled up yet"
              detail="GPS coverage per vehicle appears once trips have finished and been rolled up." />
          ) : gps.map(r => (
            <Row key={r.vehicle_id}
              tone={r.avg_coverage_pct == null ? 'flat'
                : r.avg_coverage_pct >= 85 ? 'good' : r.avg_coverage_pct >= 60 ? 'warn' : 'bad'}
              title={r.display_name ?? r.registration_no}
              subtitle={`${r.registration_no} · ${r.total_fixes.toLocaleString()} positions`}
              cells={[
                { w: 'w-24', align: 'text-center', text: String(r.runs) },
                { w: 'w-28', align: 'text-right', text: pct(r.avg_coverage_pct), bold: true },
                { w: 'w-28', align: 'text-right', text: pct(r.worst_coverage_pct) },
                { w: 'w-32', align: 'text-right',
                  text: r.longest_gap_seconds == null ? '—' : `${Math.round(r.longest_gap_seconds / 60)} min` },
              ]} />
          ))}
        </Sheet>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[#71717A] max-w-2xl">
            Children who boarded the morning bus and were then marked absent in class,
            with approved leave already excluded. A row here is a child worth finding —
            and a question no standalone bus tracker can ask, because it does not hold
            class attendance.
          </p>
          <Sheet columns={<>
            <span className={`${SHEET.headCell} flex-1`}>Student</span>
            <span className={`${SHEET.headCell} w-40`}>Route</span>
            <span className={`${SHEET.headCell} w-32 text-right`}>Bus</span>
            <span className={`${SHEET.headCell} w-32 text-right`}>Class</span>
          </>}>
            {mismatch.length === 0 ? (
              <EmptyRow icon={<AlertTriangle size={22} />} title="Nothing to chase"
                detail="Every child who boarded a bus in this window was also marked present in class." />
            ) : mismatch.map((r, i) => (
              <Row key={`${r.student_id}-${r.service_date}-${i}`}
                tone="warn"
                title={r.student_name}
                subtitle={new Date(`${r.service_date}T00:00:00`).toLocaleDateString([], { dateStyle: 'medium' })}
                cells={[
                  { w: 'w-40', align: '', text: r.route_name ?? '—' },
                  { w: 'w-32', align: 'text-right', text: r.boarding_state },
                  { w: 'w-32', align: 'text-right', text: r.class_status, bold: true },
                ]} />
            ))}
          </Sheet>
        </div>
      )}

      <p className="text-[11px] text-[#A1A1AA] flex items-center gap-1.5">
        <Gauge size={11} />
        Figures are rolled up nightly, so today&apos;s trips are not included until tomorrow.
      </p>
    </div>
  )
}

const TONE_BAR: Record<string, string> = {
  good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-rose-400', flat: 'bg-[#E4E4E7]',
}
const TONE_TEXT: Record<string, string> = {
  good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-rose-600', flat: 'text-[#52525B]',
}

function Stat({ icon, label, value, detail, tone }: {
  icon: React.ReactNode; label: string; value: string; detail: string
  tone: 'good' | 'warn' | 'bad' | 'flat'
}) {
  return (
    <div className={`${ADMIN.card} px-3.5 py-3`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="text-[11px] text-[#71717A] truncate mt-0.5">{detail}</p>
    </div>
  )
}

function Row({ tone, title, subtitle, cells }: {
  tone: 'good' | 'warn' | 'bad' | 'flat'
  title: string
  subtitle: string
  cells: { w: string; align: string; text: string; bold?: boolean }[]
}) {
  return (
    <div className={SHEET.row}>
      <div className={`${SHEET.bar} ${TONE_BAR[tone]}`} />
      <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#27272A] truncate">{title}</p>
          <p className="text-[11px] text-[#71717A] truncate">{subtitle}</p>
        </div>
        {cells.map((c, i) => (
          <span key={i}
            className={`${c.w} ${c.align} hidden sm:block text-xs tabular-nums truncate ${
              c.bold ? 'font-bold text-[#27272A]' : 'text-[#52525B]'
            }`}>
            {c.text}
          </span>
        ))}
      </div>
    </div>
  )
}
