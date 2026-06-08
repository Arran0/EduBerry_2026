'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import { Banknote } from 'lucide-react'

export default function SalaryPage() {
  return (
    <ProtectedLayout staffOnly>
      <UnderConstruction
        title="Salary Manager"
        description="View salary details, payslips, and payment history. Coming soon!"
        icon={<Banknote className="w-14 h-14 text-yellow-500" strokeWidth={1.5} />}
        backLink="/home"
        backLabel="Back to Home"
      />
    </ProtectedLayout>
  )
}
