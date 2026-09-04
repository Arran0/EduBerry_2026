'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import FeeSettingsPanel from '@/components/settings/FeeSettingsPanel'
import { AcademicYearProvider } from '@/contexts/AcademicYearContext'

// Fee Settings — everything that governs how money comes in.
//
// The counterpart to Payroll Settings: money in, rather than money out. Both
// were sub-tabs of one App Settings pane, which put the collection credentials
// and the disbursement credentials one click apart and made it easy to
// configure the wrong one.
//
// Round 1 of docs/fee-upgrade-plan.md grew this from a single bank-credentials
// form into six tabs, because the thing keeping the fee module switched off was
// never the bank connection — it was that "who is allowed to do this" had one
// answer for the whole module.

export default function FeeSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
      <AcademicYearProvider>
        <div className="min-h-screen bg-[#F5F5F5]">
          <div className="bg-[#27272A] border-b border-[#3F3F46]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
              <Link href="/more/admin-space" className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0">
                <ArrowLeft size={16} />
              </Link>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
                  <CreditCard size={16} className="text-[#B8983C]" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-white tracking-tight">Fee Settings</h1>
                  <p className="text-xs text-zinc-500">
                    Permissions, policies, numbering, sessions, collection and WhatsApp
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <FeeSettingsPanel />
          </div>
        </div>
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
