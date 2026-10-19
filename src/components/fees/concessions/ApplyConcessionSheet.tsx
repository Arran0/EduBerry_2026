'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Applying a concession to one bill.
//
// The sheet's job is to say, before the button is pressed, exactly what will
// happen: the bill drops to this figure, and either it applies now or it waits
// for an approver. A clerk who can see that will not promise a family a discount
// that then sits in a queue.
//
// The threshold logic here mirrors the server's, which is the authority. It is
// duplicated on purpose — the server would still refuse an over-threshold
// auto-apply — but showing the reader the same rule beforehand is the whole
// point of the sheet.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react'
import { BadgePercent, Loader2, Info } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { gradeLabel } from '@/lib/grades'
import type { InvoiceRow, ProfileListRow } from '@/lib/fees/invoices'
import {
  applyConcession, type DiscountTypeRow, type ScholarshipRow,
} from '@/lib/fees/charges'

type Kind = 'discount' | 'scholarship' | 'waiver'

export default function ApplyConcessionSheet({
  yearId, people, invoices, types, scholarships, showAmounts, canApprove,
  fixedStudentId, onClose, onDone,
}: {
  yearId: string
  people: ProfileListRow[]
  invoices: InvoiceRow[]
  types: DiscountTypeRow[]
  scholarships: ScholarshipRow[]
  showAmounts: boolean
  canApprove: boolean
  /** Set when opened from a student's own page — the picker is then skipped. */
  fixedStudentId?: string
  onClose: () => void
  onDone: () => void
}) {
  void yearId
  const [query, setQuery] = useState('')
  const [student, setStudent] = useState<ProfileListRow | null>(
    () => people.find(p => p.student_id === fixedStudentId) ?? null)
  const [invoiceId, setInvoiceId] = useState('')
  const [kind, setKind] = useState<Kind>('discount')
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [scholarshipId, setScholarshipId] = useState(scholarships[0]?.id ?? '')
  const [amount, setAmount] = useState(0)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ needsApproval: boolean; label: string } | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter(p => p.full_name.toLowerCase().includes(q) ||
      (p.admission_no ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [people, query])

  const bills = useMemo(
    () => (student ? invoices.filter(i => i.student_id === student.student_id && (i.balance ?? 0) > 0) : []),
    [invoices, student])

  const bill = bills.find(b => b.id === invoiceId) ?? null
  const type = types.find(t => t.id === typeId) ?? null

  // What the chosen type would come to on this bill, so the amount box starts
  // at the right number rather than at zero.
  const suggested = useMemo(() => {
    if (kind !== 'discount' || !type || !bill) return null
    const base = Number(bill.balance ?? 0)
    return type.mode === 'percent'
      ? Math.round(base * (Number(type.value) / 100))
      : Math.min(Number(type.value), base)
  }, [kind, type, bill])

  const effective = amount || suggested || 0
  const after = bill ? Math.max(0, Number(bill.balance ?? 0) - effective) : null
  const tooBig = bill !== null && effective > Number(bill.balance ?? 0)

  // A waiver always waits. A discount waits above its type's threshold, and a
  // type with no threshold set waits every time.
  const willWait = kind === 'waiver'
    ? true
    : kind === 'discount'
      ? (type?.approval_threshold === null || type?.approval_threshold === undefined
          ? true : effective > Number(type.approval_threshold))
      : false

  const submit = async () => {
    if (!bill || !effective) return
    setBusy(true)
    setError(null)
    try {
      const r = await applyConcession({
        invoice_id: bill.id,
        kind,
        amount: effective,
        type_id: kind === 'discount' ? typeId || null : null,
        scholarship_id: kind === 'scholarship' ? scholarshipId || null : null,
        reason: reason.trim() || undefined,
      })
      setResult({ needsApproval: r.needs_approval, label: r.label })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The concession did not go through.')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onDone} sharp size="sm" title={result.needsApproval ? 'Sent for approval' : 'Applied'}
                  icon={<BadgePercent size={15} />} iconClassName="bg-[#EAF5EE] text-[#1F6B42]">
        <p className="text-[13px] text-slate-600 leading-relaxed">
          {result.needsApproval
            ? `${result.label} of ${inr(effective, showAmounts)} is waiting for an approver. The bill has not changed yet — do not tell the family it has.`
            : `${result.label} of ${inr(effective, showAmounts)} is off the bill. The new balance is ${inr(after, showAmounts)}.`}
        </p>
        <div className="flex justify-end mt-4">
          <button onClick={onDone} className={`${ADMIN.darkBtn} px-4`}>Done</button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="md" title="Apply a concession"
      icon={<BadgePercent size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-slate-500">
            {!bill ? 'Pick a bill first.'
              : willWait ? 'This will wait for an approver.'
              : 'This applies straight away.'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
            <button onClick={() => void submit()} disabled={busy || !bill || !effective || tooBig}
                    className={`${ADMIN.darkBtn} px-4`}>
              {busy && <Loader2 size={13} className="animate-spin" />}
              {willWait ? 'Send for approval' : 'Apply'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {!fixedStudentId && (
          <label className="block">
            <span className={ADMIN.label}>Student</span>
            {student ? (
              <div className="mt-1 flex items-center justify-between gap-2 bg-[#FAF8F2] border border-[#E3DFD3] px-3 py-2">
                <span className="text-[13px] text-slate-900">
                  {student.full_name}
                  <span className="text-slate-500"> · {gradeLabel(student.grade)}{student.section ?? ''}</span>
                </span>
                <button onClick={() => { setStudent(null); setInvoiceId('') }}
                        className="text-[12px] text-slate-600 hover:text-slate-900">Change</button>
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
                              className="w-full text-left px-3 py-2 text-[13px] text-slate-900 hover:bg-[#FAF8F2]">
                        {p.full_name}
                        <span className="text-slate-500"> · {gradeLabel(p.grade)}{p.section ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
        )}

        <label className="block">
          <span className={ADMIN.label}>Which bill</span>
          <select value={invoiceId} onChange={e => setInvoiceId(e.target.value)}
                  disabled={!student} className={`${ADMIN.inputPlain} mt-1 disabled:bg-[#FAF8F2]`}>
            <option value="">{student ? 'Choose a bill…' : 'Pick a student first'}</option>
            {bills.map(b => (
              <option key={b.id} value={b.id}>
                {b.number} · due {fmtDate(b.due_date)} · {inr(b.balance, showAmounts)} owing
              </option>
            ))}
          </select>
          {student && bills.length === 0 && (
            <p className="mt-1 text-[12px] text-slate-500">
              Nothing outstanding. A concession can only come off a bill that is still owed.
            </p>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>Kind</span>
            <select value={kind} onChange={e => { setKind(e.target.value as Kind); setAmount(0) }}
                    className={`${ADMIN.inputPlain} mt-1`}>
              <option value="discount">Discount</option>
              <option value="scholarship">Scholarship</option>
              <option value="waiver">One-off waiver</option>
            </select>
          </label>
          {kind === 'discount' ? (
            <label className="block">
              <span className={ADMIN.label}>Type</span>
              <select value={typeId} onChange={e => { setTypeId(e.target.value); setAmount(0) }}
                      className={`${ADMIN.inputPlain} mt-1`}>
                <option value="">Choose…</option>
                {types.filter(t => t.active).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.mode === 'percent' ? `${t.value}%` : `₹${t.value}`}
                  </option>
                ))}
              </select>
            </label>
          ) : kind === 'scholarship' ? (
            <label className="block">
              <span className={ADMIN.label}>Scholarship</span>
              <select value={scholarshipId} onChange={e => setScholarshipId(e.target.value)}
                      className={`${ADMIN.inputPlain} mt-1`}>
                <option value="">Choose…</option>
                {scholarships.filter(s => s.active).map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.remaining !== null && s.remaining !== undefined
                      ? ` · ₹${Number(s.remaining).toLocaleString('en-IN')} left`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex items-end">
              <p className="text-[12px] text-slate-500 leading-snug pb-2">
                A waiver is a decision, not a policy. It always goes to an approver.
              </p>
            </div>
          )}
        </div>

        <label className="block">
          <span className={ADMIN.label}>Amount ₹</span>
          <input type="number" min={0} value={amount || suggested || ''}
                 onChange={e => setAmount(Number(e.target.value))}
                 placeholder={suggested ? String(suggested) : '0'}
                 className={`${ADMIN.inputPlain} mt-1`} />
          {suggested !== null && amount === 0 && (
            <p className="mt-1 text-[12px] text-slate-500">
              {type?.mode === 'percent'
                ? `${type.value}% of what is still owing.`
                : 'The type’s standard amount.'} Change it if this case is different.
            </p>
          )}
        </label>

        <label className="block">
          <span className={ADMIN.label}>Why</span>
          <input value={reason} onChange={e => setReason(e.target.value)}
                 placeholder="Second child in school; father lost his job in June"
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>

        {bill && (
          <div className={`p-3 border ${tooBig ? 'bg-[#FCECEC] border-[#EFCCCC]' : 'bg-[#FAF8F2] border-[#E3DFD3]'}`}>
            {tooBig ? (
              <p className="text-[11px] text-[#A93232] leading-relaxed">
                That is more than the {inr(bill.balance, showAmounts)} still owing on this bill. A
                concession cannot push a bill into credit — reduce it, or split it across bills.
              </p>
            ) : (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-slate-600">
                  {inr(bill.balance, showAmounts)} owing, less {inr(effective, showAmounts)}
                </span>
                <span className="font-bold text-slate-900">{inr(after, showAmounts)}</span>
              </div>
            )}
          </div>
        )}

        {willWait && bill && !tooBig && (
          <div className="flex items-start gap-2 p-3 bg-[#FAF3DF] border border-[#E7D9AE]">
            <Info size={13} className="text-[#7A6220] mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-[#7A6220] leading-relaxed">
              {kind === 'waiver'
                ? 'Waivers always need a second person to sign off.'
                : type?.approval_threshold === null || type?.approval_threshold === undefined
                  ? `Every ${type?.name ?? 'concession'} needs approval.`
                  : `Over ${inr(type.approval_threshold, showAmounts)}, this type needs approval.`}
              {canApprove
                ? ' You hold that permission, but you cannot approve your own request — somebody else will.'
                : ' The bill will not change until it is approved.'}
            </p>
          </div>
        )}

        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-[11px] text-[#A93232]">{error}</div>}
      </div>
    </ModalShell>
  )
}
