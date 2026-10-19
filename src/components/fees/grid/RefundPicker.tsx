'use client'

// Pricing's Refund button: find the student, then ask for the refund on the
// same sheet the fee profile uses. Approval still happens in the refund queue.

import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Undo2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, inr } from '@/components/fees/ui'
import { gradeLabel } from '@/lib/grades'
import { fetchPayments, fetchProfileList, type PaymentRow, type ProfileListRow } from '@/lib/fees/invoices'
import RequestRefundSheet from '@/components/fees/reports/RequestRefundSheet'

export default function RefundPicker({ yearId, showAmounts, onClose, onDone }: {
  yearId: string
  showAmounts: boolean
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [rows, setRows] = useState<ProfileListRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ row: ProfileListRow; payments: PaymentRow[] } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => { fetchProfileList(yearId).then(setRows).catch(() => setRows([])) }, [yearId])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const paid = (rows ?? []).filter(r => (r.paid ?? 0) > 0)
    return (q ? paid.filter(r => r.full_name.toLowerCase().includes(q) || (r.admission_no ?? '').toLowerCase().includes(q)) : paid)
      .slice(0, 40)
  }, [rows, query])

  if (picked) {
    return (
      <RequestRefundSheet
        studentId={picked.row.student_id} studentName={picked.row.full_name} yearId={yearId}
        payments={picked.payments} stillOwing={picked.row.outstanding ?? 0} showAmounts={showAmounts}
        onClose={() => setPicked(null)}
        onDone={() => onDone(`Refund for ${picked.row.full_name} sent for approval.`)}
      />
    )
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Refund" subtitle="Pick the student being refunded"
                icon={<Undo2 size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]">
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
               placeholder="Name or admission number" className={`${ADMIN.input} !pl-9`} />
      </div>
      {rows === null ? (
        <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-slate-500">No student with a payment matches.</p>
      ) : (
        <div className="max-h-[50dvh] overflow-y-auto border border-[#ECE7DA] divide-y divide-[#F0ECE2]">
          {shown.map(r => (
            <button key={r.id} disabled={!!opening}
                    onClick={async () => {
                      setOpening(r.id)
                      try {
                        setPicked({ row: r, payments: await fetchPayments({ academicYearId: yearId, studentId: r.student_id }) })
                      } finally { setOpening(null) }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#FAF7F0] disabled:opacity-60">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900 break-words">{r.full_name}</span>
                <span className="block text-[11.5px] text-slate-500">
                  {r.grade !== null ? `${gradeLabel(r.grade)}${r.section ? ` ${r.section}` : ''}` : '—'}
                  {r.admission_no ? ` · Adm. ${r.admission_no}` : ''}
                </span>
              </span>
              {opening === r.id
                ? <Loader2 size={14} className="animate-spin text-slate-400" />
                : <span className="text-[12px] text-slate-600 tabular-nums">{inr(r.paid, showAmounts)} paid</span>}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  )
}
