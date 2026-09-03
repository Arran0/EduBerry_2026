'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Banknote } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'
import HiddenMembersSettings from '@/components/salary/HiddenMembersSettings'
import CycleCalibrationCompact from '@/components/salary/CycleCalibrationCompact'
import { ADMIN } from '@/components/salary/adminUi'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION,
  fetchPayrollCalibration, savePayrollCalibration,
} from '@/lib/payroll'

// Payroll Settings — everything that shapes a pay cycle before one is opened.
//
// Two sections, and the split matters:
//
//   • Salary payout — how money physically leaves the school's bank. The form
//     is the same component App Settings and Driver Payroll Settings mount, so
//     there is one credential form in the product rather than three that drift.
//   • Default cycle settings — the PF / ESI / LOP / bonus calibration a new
//     cycle starts from. Deliberately the same compact form the cycle settings
//     popup shows, because an admin who has learnt one has learnt the other,
//     and a per-cycle override should be recognisably the same rules as the
//     default it is departing from.

export default function PayrollSettingsPage() {
  return <ProtectedLayout adminOnly><PayrollSettings /></ProtectedLayout>
}

function PayrollSettings() {
  const [loading, setLoading] = useState(true)
  const [calibration, setCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setCalibration(await fetchPayrollCalibration())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveCalibration = async () => {
    setSaving(true); setError(null)
    const res = await savePayrollCalibration(calibration)
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    else setError(res.error ?? 'Could not save the calibration')
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Header, matching Admin Space — this page is reached from that list. */}
      <div className="bg-[#27272A] border-b border-[#3F3F46]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
          <Link href="/more/admin-space" className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
              <Banknote size={16} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight">Payroll Settings</h1>
              <p className="text-xs text-zinc-500">Salary payout and default cycle rules</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-8">

        {/* ── Salary payout ─────────────────────────────────────────── */}
        <section>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-1">Salary payout</p>
          <p className="text-xs text-[#71717A] mb-3 leading-relaxed">
            How salaries reach staff bank accounts from your school&apos;s own bank. Driver payroll shares this
            connection and is configured under Bus &amp; Finance in App Settings.
          </p>
          <BankPayoutSettings ctx="salary" />
          <div className="mt-4">
            <HiddenMembersSettings />
          </div>
        </section>

        {/* ── Default cycle settings ────────────────────────────────── */}
        <section>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-1">Default cycle settings</p>
          <p className="text-xs text-[#71717A] mb-3 leading-relaxed">
            What every new pay cycle starts from. These are the same rules the cycle settings popup edits — a
            cycle can still override them for itself, and one that does says so at the top of its sheet.
          </p>

          {loading ? (
            <div className={`${ADMIN.card} h-64 animate-pulse`} />
          ) : (
            <div className="bg-white border border-[#E4E4E7] p-3">
              <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />

              {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}

              <div className="flex items-center gap-2 mt-3">
                <button onClick={saveCalibration} disabled={saving}
                  className="inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-40">
                  {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save defaults'}
                </button>
                <p className="text-[11px] text-[#A1A1AA]">
                  Changing a default does not touch a cycle already running on its own override.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
