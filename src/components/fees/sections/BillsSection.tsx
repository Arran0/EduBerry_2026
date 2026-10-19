'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Bills — every bill in the session, narrowed by dropdowns.
//
// It opens on today's money: bills paid or part-paid today. Every filter is a
// capsule that opens a menu — when, status, how it was paid, which fee, which
// term, which month — and they combine: a choice within one filter widens it
// ("unpaid or part-paid"), a second filter narrows it ("…and overdue").
//
// A row opens the bill. Taking money, printing the receipt and clearing a
// cheque all happen there, so this screen has no buttons of its own beyond the
// filters.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, CalendarDays, CircleDollarSign, Layers, Loader2, Search, SlidersHorizontal, Tags, Wallet, X,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDay, inr } from '@/components/fees/ui'
import { CELL, Col, Empty, List, ListHead, Notice, Row } from '@/components/fees/shell'
import { DocNo, FeeDeck, FilterMenu, ResetChip } from '@/components/fees/glass'
import NoAccess from '@/components/fees/NoAccess'
import BillSheet, { BillChips } from '@/components/fees/BillSheet'
import { gradeLabel } from '@/lib/grades'
import { monthLabel, sessionMonths } from '@/lib/fees/grid'
import {
  DEFAULT_BILL_FILTERS, MODES, MODE_LABEL, PAY_STATES, PERIODS, SPECIAL_HEADS, TIMINGS,
  fetchBillFacets, fetchBillRegister, periodRange, sameFilters,
  type BillFilters, type BillRegister, type BillRow, type Mode, type PayState, type PeriodKey, type Timing,
} from '@/lib/fees/bills'

const PAGE = 200

/** Every column fixed but the two names, so the figures line up down the list. */
const BILL_COLS = 'sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_64px_minmax(0,124px)_84px_84px] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_76px_172px_100px_100px]'

interface Props {
  filters: BillFilters
  onFiltersChange: (f: BillFilters) => void
  /** Told when money moved, so the tiles above can re-read themselves. */
  onChanged?: () => void
  /** Opens Reminders; on a phone its button lives in this row. */
  onReminders?: () => void
}

export default function BillsSection({ filters, onFiltersChange, onChanged, onReminders }: Props) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const showAmounts = !perms.amountsHidden

  const [data, setData] = useState<BillRegister | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facets, setFacets] = useState<{ terms: { id: string; name: string }[]; heads: { id: string; name: string }[] }>({ terms: [], heads: [] })
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState(filters.search)

  // The search box types freely; the register is asked a moment after typing
  // stops rather than once per keystroke.
  useEffect(() => { setQuery(filters.search) }, [filters.search])
  useEffect(() => {
    if (query === filters.search) return
    const t = setTimeout(() => onFiltersChange({ ...filters, search: query }), 300)
    return () => clearTimeout(t)
  }, [query, filters, onFiltersChange])

  useEffect(() => {
    if (!year) return
    fetchBillFacets(year.id).then(setFacets).catch(() => setFacets({ terms: [], heads: [] }))
  }, [year])

  // Only the latest request may land: a slow answer to an old filter must not
  // overwrite the answer to the new one.
  const ticket = useRef(0)
  const load = useCallback(async () => {
    if (!year) return
    const mine = ++ticket.current
    setLoading(true); setError(null)
    try {
      const r = await fetchBillRegister(year.id, filters, 0, PAGE)
      if (mine === ticket.current) setData(r)
    } catch (e) {
      if (mine === ticket.current) setError(e instanceof Error ? e.message : 'Could not load the bills.')
    } finally {
      if (mine === ticket.current) setLoading(false)
    }
  }, [year, filters])

  useEffect(() => { void load() }, [load])

  const loadMore = async () => {
    if (!year || !data) return
    setMore(true)
    try {
      const r = await fetchBillRegister(year.id, filters, data.rows.length, PAGE)
      setData(d => d ? { ...d, rows: [...d.rows, ...r.rows.filter(x => !d.rows.some(y => y.id === x.id))] } : r)
    } finally {
      setMore(false)
    }
  }

  const months = useMemo(() => (year ? sessionMonths(year.starts_on, year.ends_on) : []), [year])
  const set = (patch: Partial<BillFilters>) => onFiltersChange({ ...filters, ...patch })
  const isDefault = sameFilters(filters, DEFAULT_BILL_FILTERS)
  const range = periodRange(filters.period, filters.custom)

  if (perms.loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  if (!perms.canAny('fees.collect', 'fees.profile.view')) return <NoAccess what="see the bills" />

  const statusValue = [...filters.pay, ...filters.timing]
  const periodLabel = filters.period === 'custom'
    ? range ? (range.from === range.to ? fmtDay(range.from) : `${fmtDay(range.from)} – ${fmtDay(range.to)}`) : 'Pick dates'
    : PERIODS.find(p => p.key === filters.period)?.label ?? 'Today'

  return (
    <>
      <FeeDeck>
        {/* ── The filters ──────────────────────────────────────────────── */}
        <div className="px-1 pb-2.5 space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Name, admission or bill no."
                   className={`${ADMIN.input} !h-10 !rounded-full !pl-9`} />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear the search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterMenu
              label="Status"
              icon={SlidersHorizontal}
              value={statusValue}
              onChange={v => set({
                pay: v.filter(k => PAY_STATES.some(s => s.key === k)) as PayState[],
                timing: v.filter(k => TIMINGS.some(s => s.key === k)) as Exclude<Timing, 'none'>[],
              })}
              options={[
                ...PAY_STATES.map(s => ({ key: s.key, label: s.label, hint: s.hint, group: 'Payment' })),
                ...TIMINGS.map(s => ({ key: s.key, label: s.label, hint: s.hint, group: 'Against the due date' })),
              ]}
              allLabel="Any"
              summary={statusSummary(filters.pay, filters.timing)}
            />
            {/* A phone gets the one filter that matters at the counter; the
                rest are a laptop's. */}
            <div className="hidden sm:contents">
              <FilterMenu
                label="When"
                icon={CalendarDays}
                single
                value={[filters.period]}
                onChange={v => set({ period: (v[0] as PeriodKey) ?? 'today' })}
                options={PERIODS.map(p => ({ key: p.key, label: p.label }))}
                summary={periodLabel}
                active={filters.period !== 'session'}
                footer={filters.period === 'custom' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block min-w-0">
                      <span className="block text-[11.5px] text-slate-500 mb-0.5">From</span>
                      <input type="date" value={filters.custom.from}
                             onChange={e => set({ custom: { ...filters.custom, from: e.target.value } })}
                             className={`${ADMIN.inputPlain} !px-2 !text-[12.5px]`} />
                    </label>
                    <label className="block min-w-0">
                      <span className="block text-[11.5px] text-slate-500 mb-0.5">To</span>
                      <input type="date" value={filters.custom.to}
                             onChange={e => set({ custom: { ...filters.custom, to: e.target.value } })}
                             className={`${ADMIN.inputPlain} !px-2 !text-[12.5px]`} />
                    </label>
                    <p className="col-span-2 text-[11.5px] text-slate-500 leading-snug">
                      A bill counts if it was issued, paid or cancelled on these days.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-slate-500 leading-snug">
                    A bill counts if it was issued, paid or cancelled in this period.
                  </p>
                )}
              />
              <FilterMenu
                label="Paid by"
                icon={Wallet}
                value={filters.modes}
                onChange={v => set({ modes: v as Mode[] })}
                options={MODES.map(m => ({ key: m.key, label: m.label, hint: m.hint }))}
                allLabel="Any"
              />
              <FilterMenu
                label="Fee"
                icon={Tags}
                value={filters.heads}
                onChange={v => set({ heads: v })}
                options={[
                  ...facets.heads.map(h => ({ key: h.id, label: h.name, group: 'Fee heads' })),
                  ...SPECIAL_HEADS.map(h => ({ key: h.key, label: h.label, group: 'Added to bills' })),
                ]}
                allLabel="Any"
              />
              {facets.terms.length > 0 && (
                <FilterMenu
                  label="Term"
                  icon={Layers}
                  value={filters.terms}
                  onChange={v => set({ terms: v })}
                  options={facets.terms.map(t => ({ key: t.id, label: t.name }))}
                  allLabel="Any"
                />
              )}
              <FilterMenu
                label="Month"
                icon={CalendarDays}
                value={filters.months}
                onChange={v => set({ months: v })}
                options={months.map(m => ({ key: m, label: monthLabel(m) }))}
                allLabel="Any"
                width={240}
              />
            </div>
            {onReminders && (
              <button onClick={onReminders} className={`${ADMIN.ghostBtn} h-9 sm:hidden`}>
                <Bell size={14} /> Reminders
              </button>
            )}
            {!isDefault && <ResetChip onClick={() => { setQuery(''); onFiltersChange(DEFAULT_BILL_FILTERS) }} />}
          </div>
        </div>

        {/* ── What matched ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1.5 pb-2 text-[12.5px] text-slate-600">
          <span className="font-semibold text-slate-900">
            {loading && !data ? '…' : `${data?.total ?? 0} bill${data?.total === 1 ? '' : 's'}`}
          </span>
          {data && data.total > 0 && (
            <>
              <span>Billed <b className="font-semibold text-slate-900 tabular-nums">{inr(data.net, showAmounts)}</b></span>
              <span>Received <b className="font-semibold text-[#1F6B42] tabular-nums">{inr(data.paid, showAmounts)}</b></span>
              <span>Owing <b className="font-semibold text-[#8A6A12] tabular-nums">{inr(data.balance, showAmounts)}</b></span>
            </>
          )}
          {loading && data && <Loader2 size={13} className="animate-spin text-slate-400 self-center" />}
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {/* ── The bills ────────────────────────────────────────────────── */}
        {loading && !data ? (
          <div className="fx-card py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : !data || data.rows.length === 0 ? (
          <div className="fx-card">
            <Empty>
              {isDefault
                ? 'Nothing has been paid against a bill today yet.'
                : 'No bills match these filters.'}
            </Empty>
            <div className="flex flex-wrap justify-center gap-2 pb-8 -mt-4 px-4">
              {!isDefault && (
                <button onClick={() => { setQuery(''); onFiltersChange(DEFAULT_BILL_FILTERS) }} className={ADMIN.ghostBtn}>
                  Back to today
                </button>
              )}
              <button onClick={() => onFiltersChange({ ...DEFAULT_BILL_FILTERS, period: 'session', pay: ['unpaid', 'partial'] })}
                      className={ADMIN.ghostBtn}>
                <CircleDollarSign size={14} /> Every bill still owed
              </button>
            </div>
          </div>
        ) : (
          <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
            <ListHead cols={BILL_COLS}>
              <Col>Student</Col>
              <Col>Bill</Col>
              <Col>Due</Col>
              <Col>Status</Col>
              <Col right>Billed</Col>
              <Col right>Owing</Col>
            </ListHead>
            {data.rows.map(b => (
              <BillLine key={b.id} b={b} showAmounts={showAmounts} onOpen={() => setOpenId(b.id)} />
            ))}
            {data.rows.length < data.total && (
              <div className="px-3.5 py-3 border-t border-[#F0ECE3] flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-slate-500">Showing {data.rows.length} of {data.total}</span>
                <button onClick={() => void loadMore()} disabled={more} className={ADMIN.ghostBtn}>
                  {more && <Loader2 size={14} className="animate-spin" />} Show {Math.min(PAGE, data.total - data.rows.length)} more
                </button>
              </div>
            )}
          </List>
        )}
      </FeeDeck>

      {openId && (
        <BillSheet
          invoiceId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { void load(); onChanged?.() }}
        />
      )}
    </>
  )
}

/** What the Status capsule says, in words rather than a count. */
function statusSummary(pay: PayState[], timing: Exclude<Timing, 'none'>[]): string | undefined {
  const all = [...pay.map(p => PAY_STATES.find(s => s.key === p)?.label ?? p),
               ...timing.map(t => TIMINGS.find(s => s.key === t)?.label ?? t)]
  if (all.length === 0) return 'Any'
  if (all.length <= 2) return all.join(', ').replace('Fully paid', 'Paid')
  return `${all.length} picked`
}

function BillLine({ b, showAmounts, onOpen }: { b: BillRow; showAmounts: boolean; onOpen: () => void }) {
  const cls = b.grade === null ? null : `${gradeLabel(b.grade)}${b.section ? ` ${b.section}` : ''}`
  const what = b.issue_title ?? b.term_name ?? (b.bill_month ? monthLabel(b.bill_month) : null)
  const dead = b.pay_state === 'cancelled'
  const owing = b.pay_state === 'unpaid' || b.pay_state === 'partial'
  return (
    <Row cols={BILL_COLS} onClick={onOpen}>
      {/* Who */}
      <span className={`${CELL.A1} min-w-0`}>
        <span className="block text-[13.5px] font-semibold text-slate-900 leading-snug break-words">
          {b.full_name ?? 'Unknown student'}
        </span>
        <span className="hidden sm:block text-[11.5px] text-slate-500 leading-snug break-words">
          {[cls, b.admission_no ? `Adm. ${b.admission_no}` : null].filter(Boolean).join(' · ') || '—'}
        </span>
      </span>

      {/* Which bill */}
      <span className={`${CELL.A2} min-w-0`}>
        <span className="block text-[12px] text-slate-700 leading-snug break-words tabular-nums"><DocNo value={b.number} /></span>
        <span className="hidden sm:block text-[11.5px] text-slate-500 leading-snug break-words">
          {[what, b.modes.length ? b.modes.map(m => MODE_LABEL[m]).join(', ') : null].filter(Boolean).join(' · ')}
        </span>
        {/* A phone keeps to what tells two rows apart: the period, the class, the due date. */}
        <span className="sm:hidden block text-[11.5px] text-slate-500 leading-snug break-words">
          {[what, cls, `due ${fmtDay(b.due_date)}`].filter(Boolean).join(' · ')}
        </span>
      </span>

      <span className={`${CELL.DESKTOP} text-[12.5px] tabular-nums ${b.timing === 'overdue' ? 'text-[#A93232] font-semibold' : 'text-slate-600'}`}>
        {fmtDay(b.due_date)}
      </span>

      <span className={`${CELL.B2} min-w-0`}>
        <BillChips pay={b.pay_state} timing={b.timing} className="justify-end sm:justify-start" />
      </span>

      <span className={`${CELL.DESKTOP} text-right text-[12.5px] tabular-nums ${dead ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
        {inr(b.net, showAmounts)}
      </span>

      <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums ${
        dead ? 'text-slate-400 line-through' : owing ? 'text-[#8A6A12]' : 'max-sm:text-slate-900 sm:text-slate-400 sm:font-medium'}`}>
        {/* A phone shows one figure: what is still owed, or what the bill was
            for once nothing is. */}
        <span className="sm:hidden">{inr(owing ? b.balance : b.net, showAmounts)}</span>
        <span className="max-sm:hidden">{dead || b.pay_state === 'carried' ? '—' : inr(b.balance, showAmounts)}</span>
      </span>
    </Row>
  )
}
