'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The public pay page.
//
// Reached from a WhatsApp link, with no login. The person opening it is
// standing in a kitchen holding a phone, so: what is owed, for whom, and one
// button.
//
// The token reveals nothing on its own — it resolves through a SECURITY DEFINER
// function that returns only what is printed on the bill — and it expires and
// can be revoked, because a WhatsApp message gets forwarded and kept.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldOff } from 'lucide-react'

interface Resolved {
  ok: boolean
  reason?: string | null
  number?: string
  student?: string
  due_on?: string
  amount?: number
  paid?: number
  balance?: number
  status?: string
  school?: string
}

const REFUSALS: Record<string, { icon: React.ReactNode; head: string; blurb: string }> = {
  not_found: {
    icon: <AlertTriangle size={28} className="text-slate-400" />,
    head: 'Link not found',
    blurb: 'This payment link does not exist. Please check the message, or contact the school office.',
  },
  expired: {
    icon: <Clock size={28} className="text-amber-500" />,
    head: 'Link expired',
    blurb: 'This payment link has expired. Ask the school office to send a fresh one — the bill itself is unaffected.',
  },
  revoked: {
    icon: <ShieldOff size={28} className="text-rose-500" />,
    head: 'Link withdrawn',
    blurb: 'This payment link has been withdrawn by the school. Please contact the office.',
  },
  cancelled: {
    icon: <ShieldOff size={28} className="text-rose-500" />,
    head: 'Bill cancelled',
    blurb: 'This bill has been cancelled and nothing is owed on it. Contact the office if that is unexpected.',
  },
}

const money = (n?: number | null) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const fmtDate = (iso?: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`
}

export default function PayPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token ?? '')
  const [data, setData] = useState<Resolved | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return }
    try {
      const res = await fetch(`/api/fees/pay/${encodeURIComponent(token)}`)
      const json = await res.json()
      setData(json?.success ? json : { ok: false, reason: 'not_found' })
    } catch {
      setData({ ok: false, reason: 'not_found' })
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </main>
    )
  }

  if (!data?.ok) {
    const r = REFUSALS[data?.reason ?? 'not_found'] ?? REFUSALS.not_found
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="max-w-sm mx-auto text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-white border border-slate-200 flex items-center justify-center mb-4">
            {r.icon}
          </div>
          <h1 className="text-lg font-bold text-slate-800">{r.head}</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">{r.blurb}</p>
        </div>
      </main>
    )
  }

  const settled = (data.balance ?? 0) <= 0

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-sm mx-auto space-y-4">
        <p className="text-center text-xs font-bold uppercase tracking-widest text-slate-400">
          {data.school}
        </p>

        {settled ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <CheckCircle2 size={30} className="text-emerald-600 mx-auto mb-2" />
            <h1 className="text-lg font-bold text-emerald-900">Already paid</h1>
            <p className="text-sm text-emerald-800 mt-1">
              Nothing is outstanding on bill {data.number}. Thank you.
            </p>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-2xl p-6 shadow-lg shadow-violet-200">
            <p className="text-violet-100 text-sm">Amount due</p>
            <p className="text-4xl font-bold mt-1">{money(data.balance)}</p>
            <p className="text-violet-100 text-xs mt-2">
              For {data.student} · due {fmtDate(data.due_on)}
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <Row label="Bill" value={data.number} mono />
          <Row label="Student" value={data.student} />
          <Row label="Due on" value={fmtDate(data.due_on)} />
          <Row label="Bill total" value={money(data.amount)} />
          {(data.paid ?? 0) > 0 && <Row label="Already paid" value={money(data.paid)} />}
          {!settled && <Row label="Still due" value={money(data.balance)} strong />}
        </div>

        {!settled && (
          <>
            <button
              disabled
              className="w-full bg-slate-200 text-slate-500 font-semibold py-3.5 rounded-xl cursor-not-allowed"
            >
              Pay {money(data.balance)}
            </button>
            <p className="text-xs text-slate-400 text-center leading-relaxed">
              Online payment is being connected to the school&rsquo;s bank account. Until it is
              live, the school office can take this at the counter and the amount above is what
              is owed.
            </p>
          </>
        )}

        <p className="text-xs text-slate-400 text-center leading-relaxed pt-2">
          This page reads the school&rsquo;s live records. The link expires, and no account is needed.
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
      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} ${
        strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
        {value}
      </span>
    </div>
  )
}
