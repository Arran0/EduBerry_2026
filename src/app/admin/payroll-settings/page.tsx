'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, Settings } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PayrollSettingsPanel from '@/components/settings/PayrollSettingsPanel'
import { IconChip } from '@/components/salary/ui'

// Payroll Settings. The body is `PayrollSettingsPanel`, mounted here and again
// behind the Salary Manager's settings button — one copy of the settings, two
// ways in.

export default function PayrollSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="salary" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-14">
          <Link href="/more/admin-space"
            className="lg-pill inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 mb-3 text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 transition-colors">
            <ArrowLeft size={14} /> Admin Space
          </Link>

          <div className="flex items-center gap-3 mb-4 sm:mb-5">
            <IconChip icon={Settings} />
            <div className="min-w-0">
              <h1 className="font-display text-[1.3rem] sm:text-[1.6rem] font-bold leading-[1.15] text-slate-900 headline break-words">
                Payroll settings
              </h1>
              <p className="text-[12.5px] text-slate-500 mt-0.5 leading-snug">Payout bank, hidden people and the rules a new cycle starts with</p>
            </div>
          </div>

          <div className="fx-card p-4 sm:p-5">
            <PayrollSettingsPanel />
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
