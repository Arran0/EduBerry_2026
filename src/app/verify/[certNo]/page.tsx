'use client'

import React, { useEffect, useState, use } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'

// Public certificate verification page. Deliberately NOT wrapped in
// ProtectedLayout — anyone scanning the QR on a printed certificate can open it
// without signing in. It calls the service-role API route, which returns only
// safe snapshot fields.

interface VerifyResult {
  found: boolean
  revoked?: boolean
  certificate?: {
    certificate_no: string
    cert_type: string
    student_name: string
    academic_year: string | null
    issue_date: string
    status: string
  }
}

const CERT_LABELS: Record<string, string> = {
  transfer: 'Transfer Certificate', bonafide: 'Bonafide Certificate', study: 'Study Certificate',
  no_due: 'No-Due Certificate', attendance: 'Attendance Certificate', progress_card: 'Progress Card',
  report_card: 'Report Card', mark_statement: 'Mark Statement', subject_analysis: 'Subject-wise Analysis',
  promotion: 'Promotion Certificate', custom: 'Certificate',
}

function fmt(date?: string | null): string {
  if (!date) return '—'
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function VerifyCertificatePage(props: { params: Promise<{ certNo: string }> }) {
  const params = use(props.params);
  const certNo = decodeURIComponent(params.certNo)
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/certificates/verify/${encodeURIComponent(certNo)}`)
      .then(async res => {
        const json = (await res.json()) as VerifyResult
        if (active) { setResult(json); setLoading(false) }
      })
      .catch(() => { if (active) { setErrored(true); setLoading(false) } })
    return () => { active = false }
  }, [certNo])

  const authentic = result?.found && !result.revoked
  const revoked = result?.found && result.revoked

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FDFCF9' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[#E4E4E7] overflow-hidden">
        <div className="bg-[#27272A] px-6 py-5 flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-lg"><ShieldCheck size={20} className="text-[#B8983C]" /></div>
          <div>
            <h1 className="text-base font-bold text-white">Certificate Verification</h1>
            <p className="text-xs text-white/60 font-mono">{certNo}</p>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-[#71717A]">
              <Loader2 size={18} className="animate-spin" /> Verifying…
            </div>
          ) : errored || !result ? (
            <div className="text-center py-8">
              <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
              <p className="font-semibold text-[#18181B]">Verification unavailable</p>
              <p className="text-sm text-[#71717A] mt-1">Please try again later.</p>
            </div>
          ) : !result.found ? (
            <div className="text-center py-8">
              <XCircle size={44} className="text-rose-500 mx-auto mb-3" />
              <p className="font-bold text-lg text-[#18181B]">Not Found</p>
              <p className="text-sm text-[#71717A] mt-1">No certificate matches this number. It may be invalid or forged.</p>
            </div>
          ) : (
            <>
              <div className="text-center pb-5 border-b border-[#E4E4E7]">
                {authentic ? (
                  <>
                    <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-lg text-emerald-700">Authentic</p>
                    <p className="text-sm text-[#71717A] mt-1">This is a genuine certificate issued by the school.</p>
                  </>
                ) : revoked ? (
                  <>
                    <AlertTriangle size={48} className="text-amber-500 mx-auto mb-3" />
                    <p className="font-bold text-lg text-amber-700">Revoked</p>
                    <p className="text-sm text-[#71717A] mt-1">This certificate was issued but has since been revoked.</p>
                  </>
                ) : null}
              </div>

              <dl className="mt-5 space-y-3">
                <Row label="Document" value={CERT_LABELS[result.certificate!.cert_type] ?? result.certificate!.cert_type} />
                <Row label="Issued To" value={result.certificate!.student_name} />
                <Row label="Academic Year" value={result.certificate!.academic_year ?? '—'} />
                <Row label="Issue Date" value={fmt(result.certificate!.issue_date)} />
                <Row label="Certificate No." value={result.certificate!.certificate_no} mono />
              </dl>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">{label}</dt>
      <dd className={`text-sm font-semibold text-[#18181B] text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}
