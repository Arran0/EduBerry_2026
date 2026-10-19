'use client'

import React from 'react'
import { CreditCard } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import FeeSettingsPanel from '@/components/settings/FeeSettingsPanel'
import { FeeScreen } from '@/components/fees/shell'
import { AcademicYearProvider } from '@/contexts/AcademicYearContext'

// Fee Settings — everything that governs how money comes in.
//
// The counterpart to Payroll Settings: money in, rather than money out. The
// same panel is the Fee module's own Settings tab; this route keeps the admin
// space's link to it working, in the fee module's frame.

export default function FeeSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
      <AcademicYearProvider>
        <FeeScreen
          title="Fee settings"
          subtitle="Permissions, policies, numbering, sessions, collection and WhatsApp"
          icon={<CreditCard size={18} />}
          back={{ href: '/more/admin-space', label: 'Admin space' }}
        >
          <FeeSettingsPanel />
        </FeeScreen>
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
