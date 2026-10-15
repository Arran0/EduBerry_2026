'use client'

// The refund queue: request → approve → pay out.
//
// Three steps on one list, because the person who has to act next is not the
// same person at each step and the list should say which of them is waiting.
// The database refuses a self-approval, so the button is not the safeguard —
// but hiding it from the requester saves them from finding out the hard way.

import React, { useState } from 'react'
import { Banknote, Check, Loader2, Undo2, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { CELL, Row } from '@/components/fees/shell'
import { useAuth } from '@/contexts/AuthContext'
import { decideRefund, payRefund, type RefundRow } from '@/lib/fees/reports'

/** The queue's columns on a laptop; a phone gets `Row`'s card. */
const REFUND_COLS = 'sm:grid-cols-[minmax(0,1fr)_132px_104px_236px]'

const STATE_CHIP: Record<RefundRow['status'], string> = {
  requested: 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]',
  approved:  'bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]',
  paid_out:  'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]',
  declined:  'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]',
  cancelled: 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]',
}

const STATE_LABEL: Record<RefundRow['status'], string> = {
  requested: 'Waiting', approved: 'Approved, not paid', paid_out: 'Paid out',
  declined: 'Declined', cancelled: 'Cancelled',
}

const METHODS = [
  ['bank_transfer', 'Bank transfer'], ['cash', 'Cash'], ['cheque', 'Cheque'],
  ['upi', 'UPI'], ['adjustment', 'Adjustment against a bill'],
] as const

export default function RefundQueue({
  rows, names, showAmounts, canDecide, onChanged,
}: {
  rows: RefundRow[]
  names: Map<string, string>
  showAmounts: boolean
  canDecide: boolean
  onChanged: () => Promise<void> | void
}) {
  const { user } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [paying, setPaying] = useState<RefundRow | null>(null)
  const [declining, setDeclining] = useState<RefundRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const waiting = rows.filter(r => r.status === 'requested').length
  const owed = rows.filter(r => r.status === 'approved')
    .reduce((a, r) => a + Number(r.amount), 0)

  const approve = async (row: RefundRow) => {
    setBusy(row.id)
    setError(null)
    try {
      await decideRefund(row.id, true)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That approval did not go through.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Refunds</h3>
        <span className="text-[11px] text-[#6B675A]">
          {waiting} waiting
          {owed > 0 && ` · ${inr(owed, showAmounts)} approved but not yet paid`}
        </span>
      </div>

      {error && <p className="px-4 py-2 text-[11px] text-[#A93232] bg-[#FCECEC]">{error}</p>}

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[12.5px] text-[#8C8878]">
          No refunds this session. One is raised from a student&rsquo;s profile when they have
          overpaid or withdrawn.
        </p>
      ) : rows.map(r => {
        const mine = r.requested_by !== null && r.requested_by === user?.id
        return (
          <Row key={r.id} cols={REFUND_COLS}>
            <span className={CELL.A1}>
              <span className="block text-[12.5px] text-[#18181B] truncate">
                {names.get(r.student_id) ?? 'Student'}
              </span>
              <span className="block text-[11px] text-[#8C8878]">
                {r.reason}
                {' · asked '}{fmtDate(r.requested_at.slice(0, 10))}
                {r.paid_on ? ` · paid ${fmtDate(r.paid_on)}${r.reference ? ` · ${r.reference}` : ''}` : ''}
              </span>
            </span>
            <span className={CELL.B2}>
              <span className={`inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${STATE_CHIP[r.status]}`}>
                {STATE_LABEL[r.status]}
              </span>
            </span>
            <span className={`${CELL.B1} text-[11.5px] font-semibold text-[#18181B] text-right tabular-nums`}>
              {inr(r.amount, showAmounts)}
            </span>
            {/* Decline and Approve are a decision, so on a phone they get their
                own line across the card rather than being squeezed in beside
                the amount. */}
            <span className={`${CELL.A3} max-sm:col-span-2 flex items-center justify-end gap-1.5
                              ${canDecide && (r.status === 'requested' || r.status === 'approved')
                                ? 'max-sm:mt-1.5' : ''}`}>
              {canDecide && r.status === 'requested' && (
                mine ? (
                  <span className="text-[11px] text-[#8C8878]">
                    Yours — somebody else signs this off
                  </span>
                ) : (
                  <>
                    <button onClick={() => setDeclining(r)}
                            className={ADMIN.ghostBtn}>
                      <X size={13} /> Decline
                    </button>
                    <button onClick={() => void approve(r)} disabled={busy === r.id}
                            className={ADMIN.darkBtn}>
                      {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Approve
                    </button>
                  </>
                )
              )}
              {canDecide && r.status === 'approved' && (
                <button onClick={() => setPaying(r)} className={ADMIN.darkBtn}>
                  <Banknote size={13} /> Pay out
                </button>
              )}
            </span>
          </Row>
        )
      })}

      {paying && (
        <PayOutDialog
          row={paying} showAmounts={showAmounts}
          onClose={() => setPaying(null)}
          onDone={async () => { setPaying(null); await onChanged() }}
        />
      )}

      {declining && (
        <DeclineDialog
          row={declining} showAmounts={showAmounts}
          onClose={() => setDeclining(null)}
          onDone={async () => { setDeclining(null); await onChanged() }}
        />
      )}
    </div>
  )
}

function PayOutDialog({
  row, showAmounts, onClose, onDone,
}: {
  row: RefundRow
  showAmounts: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [method, setMethod] = useState<string>('bank_transfer')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Pay out this refund"
                icon={<Banknote size={15} />} iconClassName="bg-[#EAF5EE] text-[#1F6B42]">
      <p className="text-[12.5px] text-[#6B675A] leading-relaxed">
        {inr(row.amount, showAmounts)} leaves the school. It is posted to the family&rsquo;s ledger
        as a debit, so their balance goes up by that much — which is what giving it back means.
      </p>
      <label className="block mt-3">
        <span className={ADMIN.label}>How</span>
        <select value={method} onChange={e => setMethod(e.target.value)}
                className={`${ADMIN.inputPlain} mt-1`}>
          {METHODS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="block mt-3">
        <span className={ADMIN.label}>Reference</span>
        <input value={reference} onChange={e => setReference(e.target.value)}
               placeholder="UTR, cheque number, or how it was handed over"
               className={`${ADMIN.inputPlain} mt-1`} />
      </label>
      {error && <p className="mt-2 text-[11px] text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-1.5 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            setBusy(true); setError(null)
            try { await payRefund(row.id, method, reference.trim() || undefined); await onDone() }
            catch (e) { setError(e instanceof Error ? e.message : 'The pay-out did not go through.') }
            finally { setBusy(false) }
          }}
          disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Pay out
        </button>
      </div>
    </ModalShell>
  )
}

function DeclineDialog({
  row, showAmounts, onClose, onDone,
}: {
  row: RefundRow
  showAmounts: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Decline this refund"
                icon={<Undo2 size={15} />} iconClassName="bg-[#FCECEC] text-[#A93232]">
      <p className="text-[12.5px] text-[#6B675A] leading-relaxed">
        {inr(row.amount, showAmounts)}. Whoever asked for it will read your reason, so write it for
        them rather than for the file.
      </p>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder="Why this is not being refunded"
                className={`${ADMIN.inputPlain} mt-3 resize-none`} autoFocus />
      {error && <p className="mt-2 text-[11px] text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-1.5 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            if (note.trim().length < 3) { setError('A reason is required.'); return }
            setBusy(true); setError(null)
            try { await decideRefund(row.id, false, note.trim()); await onDone() }
            catch (e) { setError(e instanceof Error ? e.message : 'That did not go through.') }
            finally { setBusy(false) }
          }}
          disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Decline
        </button>
      </div>
    </ModalShell>
  )
}
