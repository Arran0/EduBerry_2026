'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fines — a charge for something that happened.
//
// This popup used to be "Late fees & fines", and the late-fee half of it was a
// read-only list of what the rules had charged. Nobody opened it for that: a
// late fee is already on the bill, and "which bills are late" is the ledger
// with Overdue ticked, one filter away on the screen behind this one. What was
// left was the half somebody actually comes here to do — put a charge on a
// family for a broken window or a lost book — so that is all this is now.
//
// A fine raised on its own slip carries its own due date. A library book fine
// issued in March is not due with April's term fee, and the office was
// previously stuck with a flat fourteen days from the server.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Gavel, Loader2, Plus } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { StudentPicker } from '@/components/fees/controls'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { todayISO } from '@/lib/fees/ledger'
import {
  fetchUnpaidInvoices, fetchProfileList,
  type InvoiceRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  addFine, fetchFineCategories, fetchFines, waiveFine,
  type FineCategoryRow, type FineRow,
} from '@/lib/fees/charges'

export default function FinesSection({ onChanged }: { onChanged?: () => void }) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [fines, setFines] = useState<FineRow[]>([])
  const [categories, setCategories] = useState<FineCategoryRow[]>([])
  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [waiving, setWaiving] = useState<FineRow | null>(null)

  const showAmounts = !perms.amountsHidden
  const canFine = perms.can('fees.fine.apply')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [fs, cats, list, inv] = await Promise.all([
        fetchFines(year.id),
        fetchFineCategories(),
        fetchProfileList(year.id),
        fetchUnpaidInvoices(year.id),
      ])
      setFines(fs); setCategories(cats); setPeople(list); setInvoices(inv)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the fines.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const reload = useCallback(async () => { await load(); onChanged?.() }, [load, onChanged])

  const names = useMemo(() => {
    const m = new Map<string, ProfileListRow>()
    people.forEach(p => m.set(p.student_id, p))
    return m
  }, [people])

  const live = fines.filter(f => f.status === 'applied')
  const total = live.reduce((a, f) => a + Number(f.amount ?? 0), 0)
  const catName = (id: string | null) => categories.find(c => c.id === id)?.name ?? 'Fine'

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!canFine) return <NoAccess what="work with fines" />
  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }

  return (
    <>
      {error && (
        <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>
      )}

      <div className={ADMIN.card}>
        <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex flex-wrap items-center gap-2">
          <h3 className={`${ADMIN.label} flex-1`}>Fines this session</h3>
          <span className="text-xs text-[#6B675A]">
            {live.length} live · {inr(total, showAmounts)}
          </span>
          <button onClick={() => setAdding(true)} className={ADMIN.darkBtn}>
            <Plus size={13} /> Add a fine
          </button>
        </div>

        {fines.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#8C8878]">
            No fines this session. A fine is a one-off charge — a damaged book, a broken window —
            and it either joins a bill the family already owes or raises its own slip with its
            own due date.
          </p>
        ) : fines.map(f => (
          <div key={f.id}
               className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
            <div className="flex-1 min-w-[190px]">
              <div className="text-sm text-[#18181B]">
                {names.get(f.student_id)?.full_name ?? 'Student'}
                <span className="text-[#8C8878]">
                  {' · '}{gradeLabel(names.get(f.student_id)?.grade ?? null) || '—'}
                  {names.get(f.student_id)?.section ?? ''}
                </span>
              </div>
              <div className="text-[11px] text-[#8C8878]">
                {catName(f.category_id)}{f.reason ? ` · ${f.reason}` : ''}
                {' · '}{fmtDate(f.created_at.slice(0, 10))}
              </div>
            </div>
            {f.status === 'waived' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                               bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                Waived {f.waived_amount ? inr(f.waived_amount, showAmounts) : ''}
              </span>
            )}
            <span className={`text-sm font-semibold w-24 text-right ${
              f.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
              {inr(f.amount, showAmounts)}
            </span>
            {f.status === 'applied' && (
              <button onClick={() => setWaiving(f)} className={ADMIN.ghostBtn}>
                <Ban size={13} /> Waive
              </button>
            )}
          </div>
        ))}
      </div>

      {adding && year && (
        <AddFineSheet
          yearId={year.id}
          categories={categories}
          people={people}
          invoices={invoices}
          showAmounts={showAmounts}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); void reload() }}
        />
      )}

      {waiving && (
        <WaiveDialog
          body={`${inr(waiving.amount, showAmounts)} against ${
            names.get(waiving.student_id)?.full_name ?? 'this student'}. Waiving credits it back to the bill; the fine itself stays on record.`}
          onClose={() => setWaiving(null)}
          onSubmit={async reason => {
            await waiveFine(waiving.id, reason)
            setWaiving(null)
            await reload()
          }}
        />
      )}
    </>
  )
}

// ── Adding one ────────────────────────────────────────────────────────────
function AddFineSheet({
  yearId, categories, people, invoices, showAmounts, onClose, onDone,
}: {
  yearId: string
  categories: FineCategoryRow[]
  people: ProfileListRow[]
  invoices: InvoiceRow[]
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [student, setStudent] = useState<ProfileListRow | null>(null)
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '')
  const [amount, setAmount] = useState<number>(Number(categories[0]?.default_amount ?? 0))
  const [reason, setReason] = useState('')
  const [attachTo, setAttachTo] = useState<string>('')
  /** Only used when the fine raises its own slip; a bill it joins keeps its own. */
  const [dueDate, setDueDate] = useState<string>(() => todayISO(14))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only bills this student still owes on can absorb a fine — adding one to a
  // settled bill would reopen a receipt the family already has.
  const openBills = useMemo(
    () => (student ? invoices.filter(i => i.student_id === student.student_id && (i.balance ?? 0) > 0) : []),
    [invoices, student])

  const ownSlip = attachTo === ''

  const submit = async () => {
    if (!student || !amount) return
    setBusy(true)
    setError(null)
    try {
      await addFine({
        student_id: student.student_id,
        academic_year_id: yearId,
        amount,
        category_id: categoryId || null,
        reason: reason.trim() || undefined,
        invoice_id: attachTo || null,
        due_date: ownSlip ? dueDate : undefined,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the fine.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="md" title="Add a fine"
      icon={<Gavel size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#8C8878]">
            {!student ? 'Pick a student first.'
              : ownSlip ? `Raises its own bill, due ${fmtDate(dueDate)}.`
              : 'Joins a bill the family already owes.'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
            <button onClick={() => void submit()} disabled={busy || !student || !amount}
                    className={`${ADMIN.darkBtn} px-4`}>
              {busy && <Loader2 size={13} className="animate-spin" />} Add fine
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className={ADMIN.label}>Student</span>
          {student ? (
            <div className="mt-1 flex items-center justify-between gap-2 bg-[#FAF8F2] border border-[#E3DFD3] px-3 py-2">
              <span className="text-sm text-[#18181B]">
                {student.full_name}
                <span className="text-[#8C8878]"> · {gradeLabel(student.grade)}{student.section ?? ''}</span>
              </span>
              <button onClick={() => { setStudent(null); setAttachTo('') }}
                      className="text-xs text-[#6B675A] hover:text-[#18181B]">Change</button>
            </div>
          ) : (
            <div className="mt-1">
              <StudentPicker people={people} onPick={p => setStudent(p as ProfileListRow)} autoFocus />
            </div>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>What for</span>
            <select value={categoryId}
                    onChange={e => {
                      setCategoryId(e.target.value)
                      const c = categories.find(x => x.id === e.target.value)
                      if (c && Number(c.default_amount) > 0) setAmount(Number(c.default_amount))
                    }}
                    className={`${ADMIN.inputPlain} mt-1`}>
              {categories.length === 0 && <option value="">Fine</option>}
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={ADMIN.label}>Amount ₹</span>
            <input type="number" min={1} value={amount}
                   onChange={e => setAmount(Number(e.target.value))}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>

        <label className="block">
          <span className={ADMIN.label}>Note</span>
          <input value={reason} onChange={e => setReason(e.target.value)}
                 placeholder="Library book returned three weeks late"
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>

        <div>
          <span className={ADMIN.label}>Bill it how</span>
          <div className="mt-1 space-y-1.5">
            <label className="flex items-start gap-2 p-2.5 border border-[#E3DFD3] cursor-pointer hover:bg-[#FAF8F2]">
              <input type="radio" checked={ownSlip} onChange={() => setAttachTo('')} className="mt-0.5" />
              <span className="text-xs text-[#18181B] flex-1">
                Its own slip
                <span className="block text-[11px] text-[#8C8878] mt-0.5">
                  A separate bill the family can pay on its own, with its own date.
                </span>
              </span>
            </label>

            {ownSlip && (
              <label className="flex flex-wrap items-center gap-2 pl-8 pb-1">
                <span className={ADMIN.label}>Due on</span>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                       className="bg-white border border-[#E3DFD3] px-2 py-1 text-[12px] text-[#18181B]
                                  focus:outline-none focus:border-[#27272A]" />
                <span className="text-[11px] text-[#8C8878]">
                  After this it is overdue like any other bill, and any late-fee rule that covers
                  it applies.
                </span>
              </label>
            )}

            {openBills.map(i => (
              <label key={i.id}
                     className="flex items-start gap-2 p-2.5 border border-[#E3DFD3] cursor-pointer hover:bg-[#FAF8F2]">
                <input type="radio" checked={attachTo === i.id} onChange={() => setAttachTo(i.id)}
                       className="mt-0.5" />
                <span className="text-xs text-[#18181B]">
                  Add to {i.number}
                  <span className="block text-[11px] text-[#8C8878] mt-0.5">
                    Due {fmtDate(i.due_date)} · {inr(i.balance, showAmounts)} still owing. The family
                    pays it with the fees they were already about to pay.
                  </span>
                </span>
              </label>
            ))}
            {student && openBills.length === 0 && (
              <p className="text-[11px] text-[#8C8878]">
                Nothing outstanding to add it to, so this fine raises its own slip.
              </p>
            )}
          </div>
        </div>

        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>}
      </div>
    </ModalShell>
  )
}

// ── A reason, required ────────────────────────────────────────────────────
function WaiveDialog({
  body, onClose, onSubmit,
}: {
  body: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Waive this fine"
                icon={<Ban size={15} />} iconClassName="bg-[#FCECEC] text-[#A93232]">
      <p className="text-sm text-[#6B675A] leading-relaxed">{body}</p>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Why — this goes on the audit trail."
                className={`${ADMIN.inputPlain} mt-3 resize-none`} autoFocus />
      {error && <p className="mt-2 text-xs text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            if (!reason.trim()) { setError('A reason is required.'); return }
            setBusy(true)
            setError(null)
            try { await onSubmit(reason.trim()) }
            catch (e) { setError(e instanceof Error ? e.message : 'That did not go through.') }
            finally { setBusy(false) }
          }}
          disabled={busy}
          className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Waive
        </button>
      </div>
    </ModalShell>
  )
}
