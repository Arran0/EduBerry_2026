'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'

export default function DriverSalaryPage() {
  return (
    <DriverLayout>
      <Link href="/driver" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={16} /> Dashboard
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 flex items-center justify-center">
          <Banknote size={30} className="text-emerald-500" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Salary</h2>
        <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          Your payslips and pay periods will appear here once payroll is set up.
        </p>
      </div>
    </DriverLayout>
  )
}
