'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Cheques and drafts the school is holding.
//
// This was the counter's second tab, which put a list nobody reads twice a week
// beside the one screen a clerk lives in. It is a popup now, opened from the
// Collection Center's toolbar, and the counter is the counter again.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import {
  fetchInstruments, transitionInstrument,
  type InstrumentRow, type ProfileListRow,
} from '@/lib/fees/invoices'

export default function PostDatedCheques({
  canManage, showAmounts, people,
}: { canManage: boolean; showAmounts: boolean; people: ProfileListRow[] }) {
  const [rows, setRows] = useState<InstrumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [bouncing, setBouncing] = useState<InstrumentRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchInstruments({ status: ['received', 'deposited'] }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const nameOf = (studentId: string) =>
    people.find(p => p.student_id === studentId)?.full_name ?? 'Student'

  const move = async (row: InstrumentRow, to: InstrumentRow['status']) => {
    setBusy(row.id); setError(null)
    try {
      await transitionInstrument(row.id, to)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that cheque.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#8C8878]">
        A bill stays open until its cheque clears, and bouncing one reopens the bill and adds the
        bank&rsquo;s charge to it automatically.
      </p>

      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
      )}

      <div className={ADMIN.card}>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-sm text-[#8C8878] text-center">
            No cheques or drafts are being held.
          </p>
        ) : rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F0ECE2] last:border-0">
            <div className="flex-1 min-w-[180px]">
              <div className="text-sm font-medium text-[#18181B]">{nameOf(r.student_id)}</div>
              <div className="text-xs text-[#8C8878]">
                {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                {r.bank ? ` · ${r.bank}` : ''}
                {r.is_postdated && r.present_on ? ` · present ${fmtDate(r.present_on)}` : ''}
              </div>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
              r.status === 'deposited'
                ? 'bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]'
                : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'
            }`}>
              {r.status}
            </span>
            <span className="text-sm font-semibold text-[#18181B] w-24 text-right">
              {inr(r.amount, showAmounts)}
            </span>
            {canManage && (
              <div className="flex gap-1.5">
                {busy === r.id ? <Loader2 size={14} className="animate-spin text-[#8C8878]" /> : (
                  <>
                    {r.status === 'received' && (
                      <button onClick={() => void move(r, 'deposited')} className={ADMIN.ghostBtn}>
                        Deposited
                      </button>
                    )}
                    <button onClick={() => void move(r, 'cleared')} className={ADMIN.darkBtn}>
                      Cleared
                    </button>
                    <button onClick={() => setBouncing(r)}
                            className="inline-flex items-center gap-1.5 bg-white border border-[#EFCCCC] text-[#A93232] hover:bg-[#FCECEC] text-xs font-semibold px-3 py-2 ">
                      Bounced
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {bouncing && (
        <BounceDialog
          instrument={bouncing}
          studentName={nameOf(bouncing.student_id)}
          onClose={() => setBouncing(null)}
          onDone={() => { setBouncing(null); void load() }}
        />
      )}
    </div>
  )
}

function BounceDialog({
  instrument, studentName, onClose, onDone,
}: {
  instrument: InstrumentRow
  studentName: string
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('Insufficient funds')
  const [charge, setCharge] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await transitionInstrument(instrument.id, 'bounced', reason.trim() || undefined,
        charge ? Number(charge) : undefined)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm"
                title={`${instrument.kind === 'dd' ? 'Draft' : 'Cheque'} ${instrument.number} bounced`}>
      <div className="space-y-4">
        <p className="text-sm text-[#52525B]">
          {studentName}&rsquo;s bill will reopen for the full amount, and the receipt will read
          cancelled to anyone who scans it.
        </p>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Reason the bank gave</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className={ADMIN.inputPlain} />
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Bank charge to pass on (₹)</label>
          <input type="number" min={0} value={charge} onChange={e => setCharge(e.target.value)}
                 placeholder="Leave blank to charge nothing"
                 className={`${ADMIN.inputPlain} max-w-[200px]`} />
          <p className="text-xs text-[#8C8878] mt-1.5">
            Added as a named line on the bill this cheque was paying, so the family can see what it is.
          </p>
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => void submit()} disabled={busy} className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} Record the bounce
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      </div>
    </ModalShell>
  )
}
