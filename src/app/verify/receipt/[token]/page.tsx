'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Public document verification. No login.
//
// Someone is standing with a piece of paper, having scanned the QR on it. They
// want one thing: is this real? So the answer is the first thing on the page,
// in a word, before any detail.
//
// This mirrors /verify/[certNo], which already does the same for certificates.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, Check, Clock, Loader2, ShieldOff, X } from 'lucide-react'
import type { VerifyResult } from '@/lib/fees/invoices'

const STATE: Record<string, {
  tone: string; icon: React.ReactNode; head: string; blurb: string
}> = {
  VALID: {
    tone: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    icon: <Check size={30} className="text-emerald-600" />,
    head: 'Genuine',
    blurb: 'This document matches the school’s records exactly.',
  },
  CANCELLED: {
    tone: 'bg-rose-50 border-rose-200 text-rose-800',
    icon: <X size={30} className="text-rose-600" />,
    head: 'Cancelled',
    blurb: 'This document was issued but has since been cancelled or reversed. It is not proof of payment.',
  },
  ALTERED: {
    tone: 'bg-rose-50 border-rose-200 text-rose-800',
    icon: <ShieldOff size={30} className="text-rose-600" />,
    head: 'Does not match',
    blurb: 'The record behind this document has changed since it was issued. Contact the school office.',
  },
  'NOT YET CLEARED': {
    tone: 'bg-amber-50 border-amber-200 text-amber-900',
    icon: <Clock size={30} className="text-amber-600" />,
    head: 'Not yet cleared',
    blurb: 'A receipt was issued against a cheque or draft that has not cleared. The bill is still open until it does.',
  },
  'NOT FOUND': {
    tone: 'bg-[#F4F4F5] border-[#E4E4E7] text-[#52525B]',
    icon: <AlertTriangle size={30} className="text-[#A1A1AA]" />,
    head: 'Not found',
    blurb: 'No document with this code exists. Check the code, or ask the school office.',
  },
}

export default function VerifyFeeDocumentPage() {
  const params = useParams<{ token: string }>()
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = params?.token
    if (!token) { setLoading(false); return }
    fetch(`/api/fees/verify/${encodeURIComponent(String(token))}`)
      .then(r => r.json())
      .then(j => setResult(j?.success ? (j as VerifyResult) : { kind: 'unknown', valid: false, state: 'NOT FOUND' }))
      .catch(() => setResult({ kind: 'unknown', valid: false, state: 'NOT FOUND' }))
      .finally(() => setLoading(false))
  }, [params])

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#A1A1AA]" />
      </main>
    )
  }

  const state = STATE[result?.state ?? 'NOT FOUND'] ?? STATE['NOT FOUND']
  const isReceipt = result?.kind === 'receipt'
  const money = (n?: number) =>
    n === undefined || n === null ? '—'
      : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <main className="min-h-screen bg-[#F5F5F5] px-4 py-10">
      <div className="max-w-md mx-auto">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-[#A1A1AA] mb-4">
          {result?.school ?? 'Fee document check'}
        </p>

        <div className={`border rounded-xl p-6 text-center ${state.tone}`}>
          <div className="w-14 h-14 mx-auto rounded-full bg-white/70 flex items-center justify-center mb-3">
            {state.icon}
          </div>
          <h1 className="text-xl font-bold">{state.head}</h1>
          <p className="text-sm mt-2 leading-relaxed">{state.blurb}</p>
        </div>

        {result && result.kind !== 'unknown' && (
          <div className="mt-4 bg-white border border-[#E4E4E7] rounded-xl divide-y divide-[#F4F4F5]">
            <Row label={isReceipt ? 'Receipt number' : 'Invoice number'} value={result.number} mono />
            <Row label="Student" value={result.student} />
            {isReceipt ? (
              <>
                <Row label="Received on" value={result.paid_on} />
                <Row label="Method" value={result.method} />
                <Row label="Amount" value={money(result.amount)} strong />
              </>
            ) : (
              <>
                <Row label="Issued" value={result.issued_on} />
                <Row label="Due" value={result.due_on} />
                <Row label="Bill total" value={money(result.amount)} />
                <Row label="Paid" value={money(result.paid)} />
                <Row label="Still due" value={money(result.balance)} strong />
              </>
            )}
            {result.reason && <Row label="Reason" value={result.reason} />}
          </div>
        )}

        <p className="text-center text-xs text-[#A1A1AA] mt-6 leading-relaxed">
          This check reads the school&rsquo;s live records and re-computes the document&rsquo;s
          own signature. Nothing here needs an account.
        </p>
      </div>
    </main>
  )
}

function Row({
  label, value, mono, strong,
}: { label: string; value?: string | null; mono?: boolean; strong?: boolean }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-xs font-bold uppercase tracking-wider text-[#A1A1AA]">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} ${strong ? 'font-bold text-[#27272A]' : 'text-[#52525B]'}`}>
        {value}
      </span>
    </div>
  )
}
