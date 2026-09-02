'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, Users, Bus, Trash2 } from 'lucide-react'
import NewCycleForm from '@/components/salary/NewCycleForm'
import ModalShell from '@/components/ui/ModalShell'
import {
  Sheet, SheetHead, SheetRow, SheetSkeleton, SearchField, SectionBar, Note, Btn, Chip, Column,
} from '@/components/salary/ui'
import {
  SalaryCycle, SalaryCycleStatus, CycleTally,
  fetchCycles, fetchCycleTallies, formatPeriod, deleteCycle,
} from '@/lib/salary'
import {
  DriverCycle,
  fetchDriverCycles, fetchDriverCycleTallies, deleteDriverCycle,
} from '@/lib/driverSalary'

// Kept narrow enough that a 390px phone sees the period, who it covers and
// both status columns without scrolling — only the record count runs off.
const COLS = [
  'minmax(104px,1.7fr)',  // period
  'minmax(52px,0.6fr)',   // who it covers
  'minmax(62px,0.7fr)',   // lock state
  'minmax(72px,0.9fr)',   // disbursement
  'minmax(46px,0.5fr)',   // records
  '40px',                 // row actions
].join(' ')

const COLUMNS: Column[] = [
  { label: 'Period', className: 'pl-[24px]' },
  { label: 'Covers' },
  { label: 'Cycle' },
  { label: 'Disbursed' },
  { label: 'Records', align: 'right' },
  { label: '' },
]

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
      <SectionBar
        title="Pay cycles"
        hint={loading
          ? 'One cycle per month, staff, drivers & support staff together'
          : `${cycles.length} run · ${openCount} still unlocked`}
        actions={<Btn tone="dark" onClick={() => setShowNew(true)}><Plus size={11} /> New cycle</Btn>}
      />

      {!loading && cycles.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search months…" className="sm:max-w-[16rem]" />
        </div>
      )}

      <Sheet minWidth={452}>
        <SheetHead cols={COLS} columns={COLUMNS} />
        {loading ? (
          <SheetSkeleton rows={4} />
        ) : cycles.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12.5px] text-[#8C8878] max-w-sm mx-auto mb-3">
              No pay cycles yet. Set base salaries first, then run a month.
            </p>
            <Btn tone="dark" onClick={() => setShowNew(true)} className="mx-auto"><Plus size={11} /> New cycle</Btn>
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
            <SheetRow key={`${c.kind}-${c.id}`} cols={COLS} href={c.href} accent={locked ? '#27272A' : '#D9D4C4'}>
              <span className="font-semibold text-[#18181B] text-[11.5px] truncate">
                {formatPeriod(c.period_month, c.period_year)}
              </span>

              <span className="flex items-center gap-1 text-[10.5px] text-[#8C8878] truncate">
                {c.kind === 'staff' ? <Users size={10} /> : <Bus size={10} />}
                {c.kind === 'staff' ? 'Staff' : 'Drivers'}
              </span>

              <span>
                <Chip tone={locked ? 'dark' : 'neutral'}>{locked ? 'Locked' : 'Open'}</Chip>
              </span>

              <span className="flex items-center gap-1.5 min-w-0">
                <Chip tone={allPaid ? 'good' : 'gold'}>{allPaid ? 'All paid' : `${paid}/${total}`}</Chip>
              </span>

              <span className="text-[11px] tabular-nums text-[#8C8878] text-right">{total}</span>

              <span className="flex items-center justify-end gap-0.5">
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setPendingDelete(c) }}
                  title="Delete cycle"
                  aria-label="Delete cycle"
                  className="p-0.5 text-[#CFCABA] hover:text-[#A93232] transition-colors"
                >
                  <Trash2 size={13} />
                </button>
                <ChevronRight size={14} className="text-[#CFCABA] flex-shrink-0" />
              </span>
            </SheetRow>
          )
        })}
      </Sheet>

      <AnimatePresence>
        {showNew && (
          <NewCycleForm onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />
        )}
        {pendingDelete && (
          <ModalShell onClose={() => { setPendingDelete(null); setError(null) }} size="sm" sharp>
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#18181B] mb-2">
              Delete {formatPeriod(pendingDelete.period_month, pendingDelete.period_year)}
              {pendingDelete.kind === 'staff' ? ' · Staff' : ' · Drivers'}?
            </h3>
            <p className="text-[12.5px] text-[#6B675A] mb-4 leading-relaxed">
              This permanently removes the cycle and every record in it, including any bonuses, deductions and
              payout references. It cannot be undone. Payments already made at the bank are not affected — only
              this app&apos;s copy of the payroll is deleted.
            </p>
            {error && <p className="text-[11px] text-[#A93232] mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Btn tone="ghost" onClick={() => { setPendingDelete(null); setError(null) }}>Cancel</Btn>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 bg-[#A93232] hover:bg-[#8E2828] text-white px-2.5 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.08em] leading-none transition-colors disabled:opacity-40"
              >
                {deleting ? 'Deleting…' : 'Delete cycle'}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </>
  )
}
