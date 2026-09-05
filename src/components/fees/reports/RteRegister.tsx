'use client'

// The RTE register.
//
// Section 12(1)(c) seats: the school does not bill the family, it claims from
// the state. The gap between claimed and reimbursed is real money, and the one
// thing this screen must never do is let it be read as a defaulting parent —
// so the totals here are stated as a claim against a government, and the
// student's own bills are not part of this table at all.

import React, { useMemo, useState } from 'react'
import { Landmark, Loader2, Plus } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { exportRows } from '@/lib/feeExports'
import { recordRte, type RteRow } from '@/lib/fees/reports'

const STATE_LABEL: Record<RteRow['status'], string> = {
  enrolled: 'On the register', claimed: 'Claimed', part_reimbursed: 'Part reimbursed',
  reimbursed: 'Reimbursed', rejected: 'Rejected',
}

const STATE_CHIP: Record<RteRow['status'], string> = {
  enrolled:        'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  claimed:         'bg-sky-50 text-sky-700 border border-sky-200',
  part_reimbursed: 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]',
  reimbursed:      'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected:        'bg-rose-50 text-rose-700 border border-rose-200',
}

export default function RteRegister({
  rows, names, yearId, showAmounts, canManage, onChanged,
}: {
  rows: RteRow[]
  names: Map<string, string>
  yearId: string
  showAmounts: boolean
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const [editing, setEditing] = useState<RteRow | null | 'new'>(null)

  const totals = useMemo(() => ({
    claimed: rows.reduce((a, r) => a + Number(r.claimed_amount ?? 0), 0),
    reimbursed: rows.reduce((a, r) => a + Number(r.reimbursed_amount ?? 0), 0),
  }), [rows])
  const pending = totals.claimed - totals.reimbursed

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F4F4F5] flex flex-wrap items-center gap-2">
        <h3 className={`${ADMIN.label} flex-1`}>RTE register</h3>
        {rows.length > 0 && (
          <span className="text-[11px] text-[#71717A]">
            {inr(totals.reimbursed, showAmounts)} of {inr(totals.claimed, showAmounts)} received
            {pending > 0 && ` · ${inr(pending, showAmounts)} still with the state`}
          </span>
        )}
        <button onClick={() => exportRows(
                  rows.map(r => ({
                    Student: names.get(r.student_id) ?? r.student_id,
                    Category: r.category,
                    Period: r.claim_period ?? '',
                    Claimed: showAmounts ? Number(r.claimed_amount) : '••••',
                    Reimbursed: showAmounts ? Number(r.reimbursed_amount) : '••••',
                    Reference: r.government_ref ?? '',
                    Status: STATE_LABEL[r.status],
                  })), 'RTE', 'fee-rte-register')}
                disabled={rows.length === 0} className={ADMIN.ghostBtn}>
          Export
        </button>
        {canManage && (
          <button onClick={() => setEditing('new')} className={ADMIN.ghostBtn}>
            <Plus size={13} /> Record a claim
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#A1A1AA]">
          Nobody on the RTE register this session.
        </p>
      ) : rows.map(r => (
        <div key={r.id}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F4F4F5] last:border-0">
          <div className="flex-1 min-w-[180px]">
            <div className="text-sm text-[#27272A]">{names.get(r.student_id) ?? 'Student'}</div>
            <div className="text-[11px] text-[#A1A1AA]">
              {r.claim_period ?? 'Whole year'}
              {r.government_ref ? ` · ${r.government_ref}` : ''}
              {r.reimbursed_on ? ` · received ${fmtDate(r.reimbursed_on)}` : ''}
            </div>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${STATE_CHIP[r.status]}`}>
            {STATE_LABEL[r.status]}
          </span>
          <span className="text-sm text-[#71717A] w-24 text-right">
            {inr(r.claimed_amount, showAmounts)}
          </span>
          <span className="text-sm font-semibold text-emerald-700 w-24 text-right">
            {inr(r.reimbursed_amount, showAmounts)}
          </span>
          {canManage && (
            <button onClick={() => setEditing(r)} className={ADMIN.ghostBtn}>Update</button>
          )}
        </div>
      ))}

      {editing !== null && (
        <RteEditor
          row={editing === 'new' ? null : editing}
          yearId={yearId}
          names={names}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await onChanged() }}
        />
      )}
    </div>
  )
}

function RteEditor({
  row, yearId, names, onClose, onSaved,
}: {
  row: RteRow | null
  yearId: string
  names: Map<string, string>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [studentId, setStudentId] = useState(row?.student_id ?? '')
  const [period, setPeriod] = useState(row?.claim_period ?? '')
  const [claimed, setClaimed] = useState<number | ''>(row ? Number(row.claimed_amount) : '')
  const [reimbursed, setReimbursed] = useState<number | ''>(row ? Number(row.reimbursed_amount) : '')
  const [ref, setRef] = useState(row?.government_ref ?? '')
  const [on, setOn] = useState(row?.reimbursed_on ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm"
                title={row ? 'Update this claim' : 'Record an RTE claim'}
                icon={<Landmark size={15} />} iconClassName="bg-[#F4F4F5] text-[#52525B]">
      <div className="space-y-3">
        {row ? (
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] px-3 py-2 text-sm text-[#27272A]">
            {names.get(row.student_id) ?? 'Student'}
          </div>
        ) : (
          <label className="block">
            <span className={ADMIN.label}>Student id</span>
            <input value={studentId} onChange={e => setStudentId(e.target.value)}
                   placeholder="Paste the student’s id from their profile page"
                   className={`${ADMIN.inputPlain} mt-1 font-mono text-xs`} />
            <p className="mt-1 text-[11px] text-[#A1A1AA]">
              A claim is usually raised from the student&rsquo;s own fee profile, where the id is
              already known. This box is for entering a batch from a government list.
            </p>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>Claim period</span>
            <input value={period} onChange={e => setPeriod(e.target.value)}
                   placeholder="Q1, or the whole year" className={`${ADMIN.inputPlain} mt-1`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>Government reference</span>
            <input value={ref} onChange={e => setRef(e.target.value)}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>Claimed ₹</span>
            <input type="number" min={0} value={claimed}
                   onChange={e => setClaimed(e.target.value === '' ? '' : Number(e.target.value))}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>Reimbursed ₹</span>
            <input type="number" min={0} value={reimbursed}
                   onChange={e => setReimbursed(e.target.value === '' ? '' : Number(e.target.value))}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>

        <label className="block">
          <span className={ADMIN.label}>Received on</span>
          <input type="date" value={on} onChange={e => setOn(e.target.value)}
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>

        <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
          A reimbursement is posted to the student&rsquo;s ledger as money received, marked as
          coming from the state. Nothing here bills the family.
        </p>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>}
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            const target = row?.student_id ?? studentId.trim()
            if (!target) { setError('Name the student this claim is for.'); return }
            setBusy(true); setError(null)
            try {
              await recordRte({
                student_id: target,
                academic_year_id: yearId,
                claimed: claimed === '' ? undefined : claimed,
                reimbursed: reimbursed === '' ? undefined : reimbursed,
                period: period.trim() || undefined,
                government_ref: ref.trim() || undefined,
                reimbursed_on: on || undefined,
              })
              await onSaved()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That claim was not recorded.')
            } finally { setBusy(false) }
          }}
          disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Save
        </button>
      </div>
    </ModalShell>
  )
}
