'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import DriverBaseSalariesSection from '@/components/bus/sections/DriverBaseSalariesSection'

export default function DriverBasePage() {
  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" style={{ minHeight: '100vh' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus?tab=payroll" className="inline-flex items-center gap-1.5 text-sm text-[#5B6676] hover:text-[#13306B] mb-5">
            <ArrowLeft size={16} /> Driver Payroll
          </Link>
          <h1 className="font-display text-2xl font-bold text-[#0B2150] mb-5">Base Salaries</h1>
          <DriverBaseSalariesSection />
        </div>
      </div>
    </ProtectedLayout>
  )
}
