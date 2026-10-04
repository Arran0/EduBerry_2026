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
import { CELL, Row } from '@/components/fees/shell'
import {
  fetchInstruments, transitionInstrument,
  type InstrumentRow, type ProfileListRow,
} from '@/lib/fees/invoices'

/** The held-cheque list's columns on a laptop; a phone gets `Row`'s card. */
const CHEQUE_COLS = 'sm:grid-cols-[minmax(0,1fr)_112px_104px_auto]'

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
      <p className="text-[11px] text-[#8C8878]">
        A bill stays open until its cheque clears, and bouncing one reopens the bill and adds the
        bank&rsquo;s charge to it automatically.
      </p>

      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-4 py-3 ">{error}</div>
      )}

      <div className={ADMIN.card}>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-[12.5px] text-[#8C8878] text-center">
            No cheques or drafts are being held.
          </p>
        ) : rows.map(r => (
          <Row key={r.id} cols={CHEQUE_COLS}>
            <span className={CELL.A1}>
              <span className="block text-[12.5px] font-medium text-[#18181B] truncate">
                {nameOf(r.student_id)}
              </span>
              <span className="block text-[11px] text-[#8C8878] truncate">
                {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                {r.bank ? ` · ${r.bank}` : ''}
                {r.is_postdated && r.present_on ? ` · present ${fmtDate(r.present_on)}` : ''}
              </span>
            </span>
            <span className={CELL.B2}>
              <span className={`inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${
                r.status === 'deposited'
                  ? 'bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]'
                  : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'
              }`}>
                {r.status}
              </span>
            </span>
            <span className={`${CELL.B1} text-[11.5px] font-semibold text-[#18181B] text-right tabular-nums`}>
              {inr(r.amount, showAmounts)}
            </span>
            {/* Deposited / Cleared / Bounced is what this screen is for, so on a
                phone the three of them get a line of their own across the card
                rather than a 60px column at the right edge. */}
            {canManage && (
              <span className={`${CELL.A3} max-sm:col-span-2 max-sm:mt-1.5 flex items-center justify-end gap-1.5`}>
                {busy === r.id ? <Loader2 size={14} className="animate-spin text-[#8C8878]" /> : (
                  <>
                    {r.status === 'received' && (
                      <button onClick={() => void move(r, 'deposited')}
                              className={ADMIN.ghostBtn}>
                        Deposited
                      </button>
                    )}
                    <button onClick={() => void move(r, 'cleared')}
                            className={ADMIN.darkBtn}>
                      Cleared
                    </button>
                    <button onClick={() => setBouncing(r)}
                            className="inline-flex items-center justify-center gap-1.5 bg-white border border-[#EFCCCC] text-[#A93232] hover:bg-[#FCECEC] text-[11px] font-semibold px-3 py-2">
                      Bounced
                    </button>
                  </>
                )}
              </span>
            )}
          </Row>
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
        <p className="text-[12.5px] text-[#52525B]">
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
          <p className="text-[11px] text-[#8C8878] mt-1.5">
            Added as a named line on the bill this cheque was paying, so the family can see what it is.
          </p>
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-4 py-3 ">{error}</div>
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
