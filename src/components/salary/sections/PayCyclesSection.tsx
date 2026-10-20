'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Plus, ChevronRight, Users, Bus, Trash2, CalendarRange } from 'lucide-react'
import NewCycleForm from '@/components/salary/NewCycleForm'
import { List, ListHead, Col, CELL } from '@/components/fees/shell'
import {
  SheetSkeleton, SearchField, Note, Btn, Chip, ConfirmModal, Deck, SX,
} from '@/components/salary/ui'
import {
  SalaryCycle, SalaryCycleStatus, CycleTally,
  fetchCycles, fetchCycleTallies, formatPeriod, deleteCycle,
} from '@/lib/salary'
import {
  DriverCycle,
  fetchDriverCycles, fetchDriverCycleTallies, deleteDriverCycle,
} from '@/lib/driverSalary'

/**
 * One template for the heading and every row from `sm` up. Below that the
 * cells fall into a two-line card (see CELL), so a phone never scrolls the
 * list sideways.
 */
const COLS = 'sm:grid-cols-[minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_72px]'

type Kind = 'staff' | 'driver'

interface UnifiedCycle {
  id: string
  kind: Kind
  period_month: number
  period_year: number
  status: SalaryCycleStatus
  href: string
}

function toUnified(cycles: (SalaryCycle | DriverCycle)[], kind: Kind, hrefBase: string): UnifiedCycle[] {
  return cycles.map(c => ({
    id: c.id, kind, period_month: c.period_month, period_year: c.period_year,
    status: c.status, href: `${hrefBase}/${c.id}`,
  }))
}

export default function PayCyclesSection() {
  const [loading, setLoading] = useState(true)
  const [cycles, setCycles] = useState<UnifiedCycle[]>([])
  const [tallies, setTallies] = useState<Record<string, CycleTally>>({})
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<UnifiedCycle | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [staffCycles, staffTallies, driverCycles, driverTallies] = await Promise.all([
      fetchCycles(), fetchCycleTallies(), fetchDriverCycles(), fetchDriverCycleTallies(),
    ])
    const merged = [
      ...toUnified(staffCycles, 'staff', '/more/salary/manage'),
      ...toUnified(driverCycles, 'driver', '/more/bus/payroll'),
    ].sort((a, b) =>
      b.period_year - a.period_year ||
      b.period_month - a.period_month ||
      (a.kind === b.kind ? 0 : a.kind === 'staff' ? -1 : 1)
    )
    setCycles(merged)
    setTallies({ ...staffTallies, ...driverTallies })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true); setError(null)
    const res = pendingDelete.kind === 'staff'
      ? await deleteCycle(pendingDelete.id)
      : await deleteDriverCycle(pendingDelete.id)
    setDeleting(false)
    if (!res.success) { setError(res.error ?? 'Could not delete the cycle'); return }
    setPendingDelete(null)
    load()
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cycles
    return cycles.filter(c => formatPeriod(c.period_month, c.period_year).toLowerCase().includes(q))
  }, [cycles, search])

  const openCount = cycles.filter(c => c.status === 'open').length

  return (
    <>
      <Deck
        title="Pay cycles"
        icon={CalendarRange}
        actions={
          <>
            {!loading && cycles.length > 0 && (
              <SearchField value={search} onChange={setSearch} placeholder="Search months" className="sm:w-56 sm:flex-none" />
            )}
            <Btn tone="dark" onClick={() => setShowNew(true)}><Plus size={14} /> New cycle</Btn>
          </>
        }
      >
        <p className="px-1 pb-2 text-[12px] text-slate-500 leading-snug">
          {loading ? 'One cycle a month covers staff, drivers and support staff.' : `${cycles.length} run · ${openCount} still unlocked`}
        </p>

        <List>
          <ListHead cols={COLS}>
            <Col>Month</Col>
            <Col>Covers</Col>
            <Col>Cycle</Col>
            <Col>Paid out</Col>
            <Col right>Records</Col>
            <span />
          </ListHead>
          {loading ? (
            <SheetSkeleton rows={4} />
          ) : cycles.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <p className="text-[13px] text-slate-500 max-w-sm mx-auto mb-3 leading-relaxed">
                No pay cycles yet. Set base salaries first, then run a month.
              </p>
              <Btn tone="dark" onClick={() => setShowNew(true)} className="mx-auto"><Plus size={14} /> New cycle</Btn>
            </div>
          ) : visible.length === 0 ? (
            <Note>No cycle matches &quot;{search}&quot;.</Note>
          ) : visible.map(c => {
            const tally = tallies[c.id]
            const total = tally?.total ?? 0
            const paid = tally?.paid ?? 0
            const allPaid = total > 0 && paid === total
            const locked = c.status === 'closed'
            return (
              <Link
                key={`${c.kind}-${c.id}`}
                href={c.href}
                className={`relative grid grid-cols-[minmax(0,1fr)_auto_68px] ${COLS} items-center gap-x-3 gap-y-1 sm:gap-y-0
                           px-3.5 py-2.5 border-b border-[#F0ECE3] last:border-b-0 hover:bg-[#FAF7F0] active:bg-[#F5F1E6] transition-colors
                           focus-visible:outline-none focus-visible:bg-[#FAF7F0]`}
              >
                <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${locked ? 'bg-[#27272A]' : 'bg-[#DDD8CC]'}`} />
                <span className={`${CELL.A1} text-[13.5px] font-semibold text-slate-900 leading-snug break-words`}>
                  {formatPeriod(c.period_month, c.period_year)}
                </span>
                <span className={`${CELL.A2} inline-flex items-center gap-1.5 text-[12px] text-slate-500`}>
                  {c.kind === 'staff' ? <Users size={12} className="flex-shrink-0" /> : <Bus size={12} className="flex-shrink-0" />}
                  {c.kind === 'staff' ? 'Staff' : 'Drivers'}
                  <span className="sm:hidden"><Chip tone={locked ? 'dark' : 'neutral'}>{locked ? 'Locked' : 'Open'}</Chip></span>
                </span>
                <span className={CELL.DESKTOP}>
                  <Chip tone={locked ? 'dark' : 'neutral'}>{locked ? 'Locked' : 'Open'}</Chip>
                </span>
                <span className={CELL.B1}>
                  <Chip tone={allPaid ? 'good' : 'gold'}>{allPaid ? 'All paid' : `${paid} of ${total} paid`}</Chip>
                </span>
                <span className={`${CELL.B2} text-[12px] tabular-nums text-slate-500 sm:text-right`}>
                  {total}<span className="sm:hidden"> {total === 1 ? 'record' : 'records'}</span>
                </span>
                <span className={`${CELL.END} flex items-center justify-end gap-0.5`}>
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPendingDelete(c) }}
                    title="Delete cycle"
                    aria-label={`Delete ${formatPeriod(c.period_month, c.period_year)}`}
                    className={`${SX.icon} hover:!text-[#A93232]`}
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                </span>
              </Link>
            )
          })}
        </List>
      </Deck>

      <AnimatePresence>
        {showNew && (
          <NewCycleForm key="new-cycle" onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />
        )}
        {pendingDelete && (
          <ConfirmModal
            key="confirm-delete"
            title={`Delete ${formatPeriod(pendingDelete.period_month, pendingDelete.period_year)} (${pendingDelete.kind === 'staff' ? 'staff' : 'drivers'})?`}
            icon={<Trash2 size={16} />}
            tone="danger"
            confirmLabel="Delete cycle"
            busyLabel="Deleting…"
            busy={deleting}
            error={error}
            onConfirm={confirmDelete}
            onClose={() => { setPendingDelete(null); setError(null) }}
          >
            <p>
              The cycle and every record in it go, including bonuses, deductions and payout references. This
              cannot be undone.
            </p>
            <p>Money already sent from the bank is not affected. Only this app&apos;s copy of the payroll is deleted.</p>
          </ConfirmModal>
        )}
      </AnimatePresence>
    </>
  )
}
