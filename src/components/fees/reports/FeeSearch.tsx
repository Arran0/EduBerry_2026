'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One box over students, bill numbers, receipt numbers, UTRs and cheque
// numbers — and over questions.
//
// The question side is the part worth being careful about. What a person types
// is read by `parseQuestion` into one of a closed set of shapes, and only that
// shape reaches the database. There is no branch anywhere in which typed text
// becomes part of a query. When nothing matches, the box says so and falls back
// to plain search rather than confidently answering a different question.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Download, FileText, GraduationCap, Landmark, Loader2, Receipt, Search, Send, Sparkles,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN } from '@/components/fees/ui'
import { exportRows } from '@/lib/feeExports'
import { sendReminders } from '@/lib/fees/charges'
import type { InvoiceRow } from '@/lib/fees/invoices'
import {
  parseQuestion, runQuestion, searchFees,
  type ParsedQuestion, type QuestionAnswer, type SearchHit,
} from '@/lib/fees/reports'

const ICONS: Record<SearchHit['kind'], React.ElementType> = {
  student: GraduationCap, invoice: FileText, receipt: Receipt, cheque: Landmark,
}

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  student: 'Student', invoice: 'Bill', receipt: 'Receipt', cheque: 'Cheque',
}

const EXAMPLES = [
  'which students of class 5 haven’t paid?',
  'biggest defaulters',
  'who paid today',
  'families with no number on file',
]

export default function FeeSearch({
  yearId, showAmounts, canRemind, unpaid, onClose,
}: {
  yearId: string
  showAmounts: boolean
  canRemind: boolean
  /** Every unpaid bill, so an answer's Remind button need not re-query. */
  unpaid: InvoiceRow[]
  onClose: () => void
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [answer, setAnswer] = useState<QuestionAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [reminding, setReminding] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const question: ParsedQuestion | null = useMemo(() => parseQuestion(term), [term])

  // Plain search runs as you type, debounced. The question, which is a much
  // heavier query, waits for Enter or the button.
  useEffect(() => {
    if (term.trim().length < 2) { setHits([]); return }
    let cancelled = false
    const timer = setTimeout(() => {
      void searchFees(term).then(r => { if (!cancelled) setHits(r) }).catch(() => {})
    }, 180)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [term])

  const ask = async () => {
    if (!question) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      setAnswer(await runQuestion(question, yearId, showAmounts))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That question could not be answered.')
    } finally {
      setBusy(false)
    }
  }

  const remindAnswer = async () => {
    if (!answer || answer.studentIds.length === 0) return
    setReminding(true)
    setError(null)
    try {
      const ids = new Set(answer.studentIds)
      const bills = unpaid.filter(i => ids.has(i.student_id)).map(i => i.id)
      if (bills.length === 0) { setNote('Nothing outstanding to remind about.'); return }
      const result = await sendReminders(bills, 'fee_reminder_overdue')
      setNote(`${result.queued} reminder${result.queued === 1 ? '' : 's'} queued.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not queued.')
    } finally {
      setReminding(false)
    }
  }

  return (
    <ModalShell onClose={onClose} sharp size="lg" minHClass="sm:min-h-[30rem]"
                title="Search the fee records"
                subtitle="A name, a bill number, a receipt, a UTR, a cheque — or a question."
                icon={<Search size={15} />} iconClassName="bg-[#F4F1E7] text-[#52525B]">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8878]" />
            <input value={term}
                   onChange={e => { setTerm(e.target.value); setAnswer(null) }}
                   onKeyDown={e => { if (e.key === 'Enter' && question) void ask() }}
                   placeholder="Type a name, a number, or ask a question"
                   className={ADMIN.input} autoFocus />
          </div>
          {question && (
            <button onClick={() => void ask()} disabled={busy} className={ADMIN.darkBtn}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Answer
            </button>
          )}
        </div>

        {question && !answer && (
          <div className="flex items-start gap-2 p-3 bg-[#FAF3DF] border border-[#E7D9AE]">
            <Sparkles size={13} className="text-[#7A6220] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[#7A6220] leading-relaxed">
              Read as: <strong>{question.label}</strong>. Press Answer to run it.
            </p>
          </div>
        )}

        {term.trim().length >= 4 && !question && hits.length === 0 && !busy && (
          <p className="text-xs text-[#8C8878] leading-relaxed">
            Nothing matched, and that did not read as a question I know. Try one of these:{' '}
            {EXAMPLES.map((ex, i) => (
              <React.Fragment key={ex}>
                {i > 0 && ' · '}
                <button onClick={() => setTerm(ex.replace(/’/g, "'"))}
                        className="text-[#6B675A] underline hover:text-[#18181B]">{ex}</button>
              </React.Fragment>
            ))}
          </p>
        )}

        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>}
        {note && <div className="p-3 bg-[#EAF5EE] border border-[#C6E3D2] text-xs text-[#1F6B42]">{note}</div>}

        {answer ? (
          <div className="border border-[#E3DFD3]">
            <div className="px-3 py-2 bg-[#FAF8F2] border-b border-[#E3DFD3] flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[#18181B] flex-1">
                {answer.label} · {answer.rows.length} row{answer.rows.length === 1 ? '' : 's'}
              </span>
              {canRemind && answer.studentIds.length > 0 && (
                <button onClick={() => void remindAnswer()} disabled={reminding}
                        className={ADMIN.ghostBtn}>
                  {reminding ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Remind these {answer.studentIds.length}
                </button>
              )}
              <button onClick={() => exportRows(answer.rows, 'Answer',
                                                `fee-${answer.label.toLowerCase().replace(/\W+/g, '-')}`)}
                      disabled={answer.rows.length === 0} className={ADMIN.ghostBtn}>
                <Download size={13} /> Export
              </button>
            </div>
            <div className="max-h-[22rem] overflow-auto">
              {answer.rows.length === 0 ? (
                <p className="px-3 py-8 text-sm text-[#8C8878] text-center">Nothing matched that.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-white sticky top-0">
                    <tr className="text-[10px] uppercase tracking-widest text-[#8C8878]">
                      {answer.columns.map(c => (
                        <th key={c} className="text-left px-3 py-2 font-bold border-b border-[#E3DFD3]">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {answer.rows.map((row, i) => (
                      <tr key={i} className="border-b border-[#F0ECE2] last:border-0">
                        {answer.columns.map(c => (
                          <td key={c} className="px-3 py-1.5 text-[#18181B]">
                            {typeof row[c] === 'number'
                              ? row[c].toLocaleString('en-IN')
                              : String(row[c] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : hits.length > 0 ? (
          <div className="border border-[#E3DFD3] max-h-[24rem] overflow-auto">
            {hits.map(hit => {
              const Icon = ICONS[hit.kind]
              const href = hit.student_id ? `/more/fees/students/${hit.student_id}` : '/more/fees'
              return (
                <Link key={`${hit.kind}-${hit.id}`} href={href} onClick={onClose}
                      className="flex items-center gap-3 px-3 py-2 border-b border-[#F0ECE2]
                                 last:border-0 hover:bg-[#FAF8F2]">
                  <Icon size={14} className="text-[#8C8878] flex-shrink-0" />
                  <span className="text-sm text-[#18181B] flex-1 min-w-0 truncate">{hit.title}</span>
                  <span className="text-[11px] text-[#8C8878]">{hit.subtitle}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                                   bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                    {KIND_LABEL[hit.kind]}
                  </span>
                </Link>
              )
            })}
          </div>
        ) : null}
      </div>
    </ModalShell>
  )
}
