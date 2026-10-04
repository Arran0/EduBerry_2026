'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Late fees & fines — what has actually been charged.
//
// The other half of the old Charges screen. The rules that produce these live
// with the price list, in Fee Configuration; this is the tracking side, which
// the office reads when a guardian asks why a bill grew — so it sits in the
// Collection Center, one button away from the ledger, and not behind a tab.
//
// Both lists are on screen together rather than behind a folder each: a waiver
// decision is usually taken looking at both.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Gavel, Loader2, Plus, ShieldOff } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { CELL, Row } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import {
  fetchUnpaidInvoices, fetchProfileList,
  type InvoiceRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  addFine, fetchFineCategories, fetchFines, fetchLateFeeCharges,
  setLateFeeExemption, waiveFine, waiveLateFee,
  type FineCategoryRow, type FineRow, type LateFeeChargeRow,
} from '@/lib/fees/charges'

/** The two lists' columns on a laptop; a phone folds each row into a card. */
const CHARGE_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,280px)_120px_104px_auto]'
const FINE_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)_minmax(0,160px)_104px_auto]'

export default function LateFeeTrackingSection({ onChanged }: { onChanged?: () => void }) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [charges, setCharges] = useState<LateFeeChargeRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [fines, setFines] = useState<FineRow[]>([])
  const [categories, setCategories] = useState<FineCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fining, setFining] = useState(false)

  const showAmounts = !perms.amountsHidden
  const canManage = perms.can('fees.latefee.manage')
  const canFine = perms.can('fees.fine.apply')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [inv, list, fs, cats] = await Promise.all([
        fetchUnpaidInvoices(year.id),
        fetchProfileList(year.id),
        fetchFines(year.id),
        fetchFineCategories(),
      ])
      setInvoices(inv); setPeople(list); setFines(fs); setCategories(cats)
      setCharges(await fetchLateFeeCharges(inv.map(i => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load late fees and fines.')
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

  const byInvoice = useMemo(() => {
    const m = new Map<string, InvoiceRow>()
    invoices.forEach(i => m.set(i.id, i))
    return m
  }, [invoices])

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!canManage && !canFine) return <NoAccess what="see late fees or fines" />
  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }

  return (
    <>
      {error && (
        <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>
      )}

      <ChargedList
        charges={charges} invoices={byInvoice} names={names}
        showAmounts={showAmounts} canManage={canManage} onChanged={reload}
      />

      <FinesList
        fines={fines} categories={categories} names={names}
        showAmounts={showAmounts} canFine={canFine}
        onAdd={() => setFining(true)} onChanged={reload}
      />

      {fining && year && (
        <AddFineSheet
          yearId={year.id}
          categories={categories}
          people={people}
          invoices={invoices}
          showAmounts={showAmounts}
          onClose={() => setFining(false)}
          onDone={() => { setFining(false); void reload() }}
        />
      )}
    </>
  )
}

function ChargedList({
  charges, invoices, names, showAmounts, canManage, onChanged,
}: {
  charges: LateFeeChargeRow[]
  invoices: Map<string, InvoiceRow>
  names: Map<string, ProfileListRow>
  showAmounts: boolean
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const [waiving, setWaiving] = useState<LateFeeChargeRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const live = charges.filter(c => c.status === 'charged')
  const total = live.reduce((a, c) => a + Number(c.amount ?? 0), 0)

  const exempt = async (invoiceId: string) => {
    setBusy(invoiceId)
    try {
      await setLateFeeExemption(invoiceId, true, 'Exempted from the late fees screen')
      await onChanged()
    } finally { setBusy(null) }
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Late fees charged</h3>
        <span className="text-xs text-[#6B675A]">
          {live.length} charge{live.length === 1 ? '' : 's'} · {inr(total, showAmounts)}
        </span>
      </div>
      {charges.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing has been charged.</p>
      ) : charges.map(c => {
        const inv = invoices.get(c.invoice_id)
        const who = inv ? names.get(inv.student_id) : undefined
        return (
          <Row key={c.id} cols={CHARGE_COLS}>
            <span className={`${CELL.A1} block text-[13px] sm:text-sm text-[#18181B] truncate`}>
              {who?.full_name ?? 'Student'}
            </span>
            <span className={`${CELL.A2} block text-[11px] text-[#8C8878] font-mono truncate`}>
              {inv?.number ?? '—'} · {c.days_late} days late at {fmtDate(c.as_of)}
            </span>
            <span className={CELL.B2}>
              {c.status !== 'charged' && (
                <span className="inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5
                                 bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                  {c.status === 'waived' ? 'Waived' : 'Recalculated'}
                </span>
              )}
            </span>
            <span className={`${CELL.B1} text-[14px] sm:text-sm font-semibold text-right tabular-nums ${
              c.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
              {inr(c.amount, showAmounts)}
            </span>
            {canManage && c.status === 'charged' && (
              <span className={`${CELL.A3} max-sm:col-span-2 max-sm:mt-1.5 flex items-center gap-1.5 sm:justify-end`}>
                <button onClick={() => setWaiving(c)}
                        className={`${ADMIN.ghostBtn} max-sm:flex-1 max-sm:py-2`}>Waive</button>
                <button onClick={() => void exempt(c.invoice_id)} disabled={busy === c.invoice_id}
                        title="Never charge this bill a late fee again"
                        className={`${ADMIN.ghostBtn} max-sm:flex-1 max-sm:py-2`}>
                  <ShieldOff size={13} /> Exempt bill
                </button>
              </span>
            )}
          </Row>
        )
      })}

      {waiving && (
        <ReasonDialog
          title="Waive this late fee"
          verb="Waive"
          body={`${inr(waiving.amount, showAmounts)} charged on ${fmtDate(waiving.as_of)}. Waiving credits it back to the bill; the charge itself stays on record.`}
          onClose={() => setWaiving(null)}
          onSubmit={async reason => {
            await waiveLateFee(waiving.id, reason)
            setWaiving(null)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

// ── Fines ─────────────────────────────────────────────────────────────────
function FinesList({
  fines, categories, names, showAmounts, canFine, onAdd, onChanged,
}: {
  fines: FineRow[]
  categories: FineCategoryRow[]
  names: Map<string, ProfileListRow>
  showAmounts: boolean
  canFine: boolean
  onAdd: () => void
  onChanged: () => Promise<void> | void
}) {
  const [waiving, setWaiving] = useState<FineRow | null>(null)
  const cat = (id: string | null) => categories.find(c => c.id === id)?.name ?? 'Fine'

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Fines</h3>
        {canFine && (
          <button onClick={onAdd} className={ADMIN.ghostBtn}><Plus size={13} /> Add a fine</button>
        )}
      </div>
      {fines.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">No fines this session.</p>
      ) : fines.map(f => (
        <Row key={f.id} cols={FINE_COLS}>
          <span className={`${CELL.A1} block text-[13px] sm:text-sm text-[#18181B] truncate`}>
            {names.get(f.student_id)?.full_name ?? 'Student'}
          </span>
          <span className={`${CELL.A2} block text-[11px] text-[#8C8878] truncate`}>
            {cat(f.category_id)}{f.reason ? ` · ${f.reason}` : ''}
          </span>
          <span className={CELL.B2}>
            {f.status === 'waived' && (
              <span className="inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5
                               bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                Waived {f.waived_amount ? inr(f.waived_amount, showAmounts) : ''}
              </span>
            )}
          </span>
          <span className={`${CELL.B1} text-[14px] sm:text-sm font-semibold text-right tabular-nums ${
            f.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
            {inr(f.amount, showAmounts)}
          </span>
          <span className={`${CELL.B3} flex justify-end`}>
            {canFine && f.status === 'applied' && (
              <button onClick={() => setWaiving(f)} className={`${ADMIN.ghostBtn} max-sm:py-1.5`}>
                <Ban size={13} /> Waive
              </button>
            )}
          </span>
        </Row>
      ))}

      {waiving && (
        <ReasonDialog
          title="Waive this fine"
          verb="Waive"
          body={`${inr(waiving.amount, showAmounts)} against ${names.get(waiving.student_id)?.full_name ?? 'this student'}.`}
          onClose={() => setWaiving(null)}
          onSubmit={async reason => {
            await waiveFine(waiving.id, reason)
            setWaiving(null)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

// ── Add a fine ────────────────────────────────────────────────────────────
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
  const [query, setQuery] = useState('')
  const [student, setStudent] = useState<ProfileListRow | null>(null)
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '')
  const [amount, setAmount] = useState<number>(Number(categories[0]?.default_amount ?? 0))
  const [reason, setReason] = useState('')
  const [attachTo, setAttachTo] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter(p => p.full_name.toLowerCase().includes(q) ||
      (p.admission_no ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [people, query])

  // Only bills this student still owes on can absorb a fine — adding one to a
  // settled bill would reopen a receipt the family already has.
  const openBills = useMemo(
    () => (student ? invoices.filter(i => i.student_id === student.student_id && (i.balance ?? 0) > 0) : []),
    [invoices, student])

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
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !student || !amount}
                  className={`${ADMIN.darkBtn} px-4`}>
            {busy && <Loader2 size={13} className="animate-spin" />} Add fine
          </button>
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
            <>
              <input value={query} onChange={e => setQuery(e.target.value)}
                     placeholder="Type a name or admission number"
                     className={`${ADMIN.inputPlain} mt-1`} autoFocus />
              {matches.length > 0 && (
                <div className="mt-1 border border-[#E3DFD3] divide-y divide-[#F0ECE2]">
                  {matches.map(p => (
                    <button key={p.student_id} onClick={() => { setStudent(p); setQuery('') }}
                            className="w-full text-left px-3 py-2 text-sm text-[#18181B] hover:bg-[#FAF8F2]">
                      {p.full_name}
                      <span className="text-[#8C8878]"> · {gradeLabel(p.grade)}{p.section ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
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
              <input type="radio" checked={attachTo === ''} onChange={() => setAttachTo('')}
                     className="mt-0.5" />
              <span className="text-xs text-[#18181B]">
                Its own slip
                <span className="block text-[11px] text-[#8C8878] mt-0.5">
                  A separate bill the family can pay on its own.
                </span>
              </span>
            </label>
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
                Nothing outstanding to add it to, so this fine will raise its own slip.
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
function ReasonDialog({
  title, verb, body, onClose, onSubmit,
}: {
  title: string
  verb: string
  body: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title={title}
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
          {busy && <Loader2 size={13} className="animate-spin" />} {verb}
        </button>
      </div>
    </ModalShell>
  )
}
