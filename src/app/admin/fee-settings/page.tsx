'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import BankCollectSettings from '@/components/settings/BankCollectSettings'

// Fee Settings — how students pay school fees into the school's bank account.
//
// The counterpart to Payroll Settings: money in, rather than money out. Both
// were sub-tabs of one App Settings pane, which put the collection credentials
// and the disbursement credentials one click apart and made it easy to
// configure the wrong one. Bus fees keep their own screen under Bus Finance,
// since they are a different account and a different reconciliation.

export default function FeeSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
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
                <p className="text-xs text-zinc-500">How students pay school fees into your bank account</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <BankCollectSettings ctx="fees" />
        </div>
      </div>
    </ProtectedLayout>
  )
}
