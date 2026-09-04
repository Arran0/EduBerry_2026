'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PayrollSettingsPanel from '@/components/settings/PayrollSettingsPanel'

// Payroll Settings. The body is `PayrollSettingsPanel`, mounted here and again
// behind the Salary Manager's settings button — one copy of the settings, two
// ways in.

export default function PayrollSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
      <div className="min-h-screen bg-[#F5F5F5]">
        {/* Header, matching Admin Space — this page is reached from that list. */}
        <div className="bg-[#27272A] border-b border-[#3F3F46]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
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

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <PayrollSettingsPanel />
        </div>
      </div>
    </ProtectedLayout>
  )
}
