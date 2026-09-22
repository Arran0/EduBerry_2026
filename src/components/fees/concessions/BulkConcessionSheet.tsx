'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One discount, many students.
//
// This is what replaces "Staff Ward" and "Sibling" fee groups. Those were a
// second copy of the whole price list, maintained by hand, that a student could
// only be in one of — so a staff ward who is also a second sibling got whichever
// of the two somebody remembered. A concession is a line off the bill instead:
// it stacks, it says what it is on the bill the family reads, it can be
// approved or declined, and removing it puts the money back.
//
// The only thing missing was doing it forty times, which is why groups kept
// winning. So: pick the discount, pick the students — by class or by name —
// and it goes onto every bill they still owe on, with the total shown before
// anything is written.
//
// Each bill is a separate call because each one is a separate decision the
// server is entitled to refuse: under its type's threshold it applies, over it
// it queues for an approver, and a bill somebody already settled takes nothing.
// They run a few at a time rather than all at once, so a class of forty does
// not open forty connections.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react'
import { BadgePercent, Check, Loader2, Users, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, inr } from '@/components/fees/ui'
import { StudentPicker } from '@/components/fees/controls'
import { gradeLabel } from '@/lib/grades'
import type { InvoiceRow, ProfileListRow } from '@/lib/fees/invoices'
import {
  applyConcession, type DiscountTypeRow, type ScholarshipRow,
} from '@/lib/fees/charges'

/** How many bills are in flight at once. Enough to be quick, not a stampede. */
const CONCURRENCY = 4

interface Target {
  student: ProfileListRow
  bills: InvoiceRow[]
  /** What comes off, bill by bill, at this student's balances. */
  amounts: number[]
}

export default function BulkConcessionSheet({
  people, invoices, types, scholarships, showAmounts, onClose, onDone,
}: {
  people: ProfileListRow[]
  invoices: InvoiceRow[]
  types: DiscountTypeRow[]
  scholarships: ScholarshipRow[]
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [kind, setKind] = useState<'discount' | 'scholarship'>('discount')
  const [typeId, setTypeId] = useState(types.find(t => t.active)?.id ?? '')
  const [scholarshipId, setScholarshipId] = useState(scholarships.find(s => s.active)?.id ?? '')
  const [scope, setScope] = useState<'all_unpaid' | 'next_due'>('all_unpaid')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ applied: number; queued: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const type = types.find(t => t.id === typeId) ?? null

  /** Classes, so a whole standard can be picked without forty keystrokes. */
  const classes = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const p of people) {
      const label = `${gradeLabel(p.grade) || '—'}${p.section ?? ''}`
      seen.set(label, [...(seen.get(label) ?? []), p.student_id])
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [people])

  const unpaidOf = useMemo(() => {
    const m = new Map<string, InvoiceRow[]>()
    for (const i of invoices) {
      if ((i.balance ?? 0) <= 0 || i.status === 'cancelled') continue
      m.set(i.student_id, [...(m.get(i.student_id) ?? []), i])
    }
    // Oldest due date first, so "the next bill due" means what it says.
    for (const list of m.values()) list.sort((a, b) => a.due_date.localeCompare(b.due_date))
    return m
  }, [invoices])

  /**
   * What each picked student would get. A percentage is taken per bill, which
   * is how the single-bill sheet does it — so a 25% staff-ward discount is 25%
   * of each term, not 25% of the year applied to whichever bill came first.
   */
  const targets: Target[] = useMemo(() => {
    if (kind === 'discount' && !type) return []
    const out: Target[] = []
    for (const id of picked) {
      const student = people.find(p => p.student_id === id)
      if (!student) continue
      const all = unpaidOf.get(id) ?? []
      const bills = scope === 'next_due' ? all.slice(0, 1) : all
      if (bills.length === 0) continue
      const amounts = bills.map(b => {
        const base = Number(b.balance ?? 0)
        if (kind === 'scholarship' || !type) return base
        return type.mode === 'percent'
          ? Math.round(base * (Number(type.value) / 100))
          : Math.min(Number(type.value), base)
      }).map(a => Math.max(0, a))
      out.push({ student, bills, amounts })
    }
    return out
  }, [picked, people, unpaidOf, scope, kind, type])

  const totalBills = targets.reduce((a, t) => a + t.bills.length, 0)
  const totalOff = targets.reduce((a, t) => a + t.amounts.reduce((x, y) => x + y, 0), 0)
  const withNothingDue = picked.size - targets.length

  // A scholarship is somebody else's money against a budget, so a bulk run
  // needs an amount stated rather than inferred from a percentage.
  const ready = picked.size > 0 && totalBills > 0
    && (kind === 'discount' ? Boolean(typeId) : Boolean(scholarshipId))

  const toggleClass = (ids: string[]) => {
    const next = new Set(picked)
    const allIn = ids.every(id => next.has(id))
    for (const id of ids) { if (allIn) next.delete(id); else next.add(id) }
    setPicked(next)
  }

  const run = async () => {
    setRunning(true); setError(null); setProgress(0)
    const jobs: { invoiceId: string; amount: number }[] = []
    for (const t of targets) {
      t.bills.forEach((b, i) => {
        if (t.amounts[i] > 0) jobs.push({ invoiceId: b.id, amount: t.amounts[i] })
      })
    }

    let applied = 0, queued = 0, failed = 0
    try {
      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        const batch = jobs.slice(i, i + CONCURRENCY)
        const settled = await Promise.allSettled(batch.map(job => applyConcession({
          invoice_id: job.invoiceId,
          kind,
          amount: job.amount,
          type_id: kind === 'discount' ? typeId : null,
          scholarship_id: kind === 'scholarship' ? scholarshipId : null,
          reason: reason.trim() || undefined,
        })))
        for (const s of settled) {
          if (s.status === 'rejected') failed += 1
          else if (s.value.needs_approval) queued += 1
          else applied += 1
        }
        setProgress(Math.min(jobs.length, i + batch.length))
      }
      setResult({ applied, queued, failed })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That run did not finish.')
    } finally {
      setRunning(false)
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onDone} sharp size="sm" title="Done"
                  icon={<Check size={15} />} iconClassName="bg-[#EAF5EE] text-[#1F6B42]">
        <p className="text-sm text-[#6B675A] leading-relaxed">
          {result.applied} bill{result.applied === 1 ? '' : 's'} discounted straight away.
          {result.queued > 0 && (
            <> {result.queued} went to the approval queue — those bills have not changed yet, so
            do not tell those families they have.</>
          )}
          {result.failed > 0 && (
            <span className="text-[#A93232]">
              {' '}{result.failed} did not go through; they are unchanged and can be retried.
            </span>
          )}
        </p>
        <div className="flex justify-end mt-4">
          <button onClick={onDone} className={`${ADMIN.darkBtn} px-4`}>Close</button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="xl"
      title="Apply a discount to many"
      subtitle="Staff wards, siblings, anything a whole set of students gets"
      icon={<BadgePercent size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#8C8878]">
            {running ? `${progress} of ${totalBills} bills…`
              : !ready ? 'Pick a discount and at least one student who owes something.'
              : `${totalBills} bill${totalBills === 1 ? '' : 's'} across ${targets.length} student${
                  targets.length === 1 ? '' : 's'} · ${inr(totalOff, showAmounts)} off`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
            <button onClick={() => void run()} disabled={!ready || running}
                    className={`${ADMIN.darkBtn} px-4`}>
              {running ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Apply
            </button>
          </div>
        </div>
      }
    >
      <div className="grid md:grid-cols-2 gap-3 items-start">
        {/* ── What ───────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={ADMIN.label}>Kind</span>
              <select value={kind} onChange={e => setKind(e.target.value as 'discount' | 'scholarship')}
                      className={`${ADMIN.inputPlain} mt-1`}>
                <option value="discount">Discount</option>
                <option value="scholarship">Scholarship</option>
              </select>
            </label>
            {kind === 'discount' ? (
              <label className="block">
                <span className={ADMIN.label}>Which one</span>
                <select value={typeId} onChange={e => setTypeId(e.target.value)}
                        className={`${ADMIN.inputPlain} mt-1`}>
                  <option value="">Choose…</option>
                  {types.filter(t => t.active).map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.mode === 'percent' ? `${t.value}%` : `₹${t.value}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className={ADMIN.label}>Which one</span>
                <select value={scholarshipId} onChange={e => setScholarshipId(e.target.value)}
                        className={`${ADMIN.inputPlain} mt-1`}>
                  <option value="">Choose…</option>
                  {scholarships.filter(s => s.active).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {kind === 'discount' && types.filter(t => t.active).length === 0 && (
            <p className="text-[11.5px] text-[#7A6220] bg-[#FAF3DF] border border-[#E7D9AE] p-2.5 leading-relaxed">
              No discount types yet. Make one first — &ldquo;Staff ward, 50%&rdquo;,
              &ldquo;Second sibling, 25%&rdquo; — under Discount types. Each says how much comes
              off and above what amount it needs somebody to approve it.
            </p>
          )}

          <div>
            <span className={ADMIN.label}>Off which bills</span>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <button onClick={() => setScope('all_unpaid')}
                      className={`px-2 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.06em]
                                  leading-none border transition-colors ${
                        scope === 'all_unpaid'
                          ? 'bg-[#27272A] text-white border-[#27272A]'
                          : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4]'}`}>
                Every unpaid bill
              </button>
              <button onClick={() => setScope('next_due')}
                      className={`px-2 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.06em]
                                  leading-none border transition-colors ${
                        scope === 'next_due'
                          ? 'bg-[#27272A] text-white border-[#27272A]'
                          : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4]'}`}>
                Just the next one due
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[#8C8878] leading-snug">
              Bills already paid are never touched, and a bill issued later is not covered by this
              run — a standing discount is applied again when the next term is billed.
            </p>
          </div>

          <label className="block">
            <span className={ADMIN.label}>Why</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
                   placeholder="Staff ward — 2026-27"
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>

        {/* ── Who ────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div>
            <span className={ADMIN.label}>Who gets it</span>
            <div className="mt-1">
              <StudentPicker
                people={people}
                exclude={picked}
                onPick={p => setPicked(prev => new Set(prev).add(p.student_id))}
                placeholder="Add by name or admission number…"
              />
            </div>
          </div>

          <div>
            <span className="text-[10.5px] text-[#8C8878]">or a whole class</span>
            <div className="flex flex-wrap gap-1 mt-1 max-h-24 overflow-y-auto">
              {classes.map(([label, ids]) => {
                const on = ids.every(id => picked.has(id))
                return (
                  <button key={label} onClick={() => toggleClass(ids)}
                          className={`px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em]
                                      leading-none border transition-colors ${
                            on ? 'bg-[#27272A] text-white border-[#27272A]'
                               : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4]'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={`${ADMIN.card} max-h-64 overflow-y-auto`}>
            <div className="px-2.5 py-1.5 border-b border-[#F0ECE2] flex items-center gap-2 sticky top-0 bg-white">
              <Users size={12} className="text-[#8C8878]" />
              <span className={`${ADMIN.label} flex-1`}>{picked.size} picked</span>
              {picked.size > 0 && (
                <button onClick={() => setPicked(new Set())}
                        className="text-[10px] font-bold uppercase tracking-wider text-[#8C8878] hover:text-[#A93232]">
                  Clear
                </button>
              )}
            </div>
            {picked.size === 0 ? (
              <p className="px-2.5 py-4 text-[11.5px] text-[#8C8878]">
                Nobody picked yet.
              </p>
            ) : [...picked].map(id => {
              const p = people.find(x => x.student_id === id)
              const t = targets.find(x => x.student.student_id === id)
              return (
                <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[#F0ECE2] last:border-0">
                  <span className="flex-1 text-[12px] text-[#18181B] truncate">
                    {p?.full_name ?? 'Student'}
                    <span className="text-[#8C8878]">
                      {' · '}{gradeLabel(p?.grade ?? null) || '—'}{p?.section ?? ''}
                    </span>
                  </span>
                  <span className={`text-[11.5px] tabular-nums ${
                    t ? 'text-[#18181B] font-semibold' : 'text-[#8C8878]'}`}>
                    {t ? inr(t.amounts.reduce((a, b) => a + b, 0), showAmounts) : 'nothing due'}
                  </span>
                  <button onClick={() => setPicked(prev => {
                            const next = new Set(prev); next.delete(id); return next
                          })}
                          className="p-0.5 text-[#C9C4B4] hover:text-[#A93232]">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>

          {withNothingDue > 0 && (
            <p className="text-[11px] text-[#8C8878]">
              {withNothingDue} of them owe nothing right now and will be skipped.
            </p>
          )}

          {error && (
            <div className="p-2.5 bg-[#FCECEC] border border-[#EFCCCC] text-[11.5px] text-[#A93232]">
              {error}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}
