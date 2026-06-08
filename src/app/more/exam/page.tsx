'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import { FileText } from 'lucide-react'

export default function ExamPage() {
  return (
    <ProtectedLayout>
      <UnderConstruction
        title="Exam Manager"
        description="View exam schedules, results, and grade reports. Coming soon!"
        icon={<FileText className="w-14 h-14 text-amber-500" strokeWidth={1.5} />}
        backLink="/home"
        backLabel="Back to Home"
      />
    </ProtectedLayout>
  )
}
