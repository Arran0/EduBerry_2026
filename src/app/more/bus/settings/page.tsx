'use client'

import React from 'react'
import Link from 'next/link'
import { ArrowLeft, Info } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import BankCollectSettings from '@/components/settings/BankCollectSettings'

// Bus fee settings. Mounts the same collection form as App Settings and the
// school Fee Settings page — one form in the product rather than three that
// drift apart — because a school links its bank account once and it receives
// both school and bus fees.

export default function BusFeeSettingsPage() {
  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/admin/settings" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> App Settings
        </Link>

        <h1 className="font-display text-2xl font-bold text-slate-800 mb-1">Bus Fee Settings</h1>
        <p className="text-sm text-slate-500 mb-6">How passengers pay bus fees into your school&apos;s bank account.</p>

        <div className="flex items-start gap-2 mb-5 p-3 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-700">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>This is the <strong>same site-wide bank arrangement</strong> used by school fees — link the account once and it receives both.</span>
        </div>

        <BankCollectSettings ctx="bus" />
      </div>
    </ProtectedLayout>
  )
}
