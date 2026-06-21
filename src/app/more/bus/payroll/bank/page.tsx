'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import DriverBankAccountsSection from '@/components/bus/sections/DriverBankAccountsSection'

export default function DriverBankPage() {
  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" style={{ minHeight: '100vh' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus?tab=payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-5">
            <ArrowLeft size={16} /> Driver Payroll
          </Link>
          <h1 className="font-display text-2xl font-bold text-[#18181B] mb-5">Bank Accounts</h1>
          <DriverBankAccountsSection />
        </div>
      </div>
    </ProtectedLayout>
  )
}
