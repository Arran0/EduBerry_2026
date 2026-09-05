'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module hub.
//
// This page was an `UnderConstruction` screen with 1,330 lines of a working but
// unreachable implementation below it. That implementation is gone: it was
// built on `school_fees`, one charge for one head, which Round 2 replaced with
// real invoices. Keeping it as a second code path against dead tables would
// have been worse than deleting it.
//
// What replaces it is a hub. Each card is a screen, and a card only appears if
// the person can actually use it — a front-desk account with four permissions
// sees the counter and nothing else, which is the whole point of Round 1.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  BarChart3, ChevronRight, CreditCard, FileText, GraduationCap, Layers,
  Loader2, Lock, Settings, Wallet,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import StudentFeeCard from '@/components/fees/StudentFeeCard'
import { isStaffRole } from '@/lib/supabase'
import { fetchInvoices, fetchPayments } from '@/lib/fees/invoices'
import type { FeePermissionKey } from '@/lib/fees/permissions'

interface Tool {
  title: string
  description: string
  href: string
  icon: React.ElementType
  needs: FeePermissionKey[]
}

const TOOLS: Tool[] = [
  {
    title: 'Fee Counter',
    description: 'Find a student, take the money, print the slip. Cash, UPI, card, cheque.',
    href: '/more/fees/counter',
    icon: Wallet,
    needs: ['fees.collect'],
  },
  {
    title: 'Students',
    description: 'Every fee profile, what each family owes, and bulk profile creation.',
    href: '/more/fees/students',
    icon: GraduationCap,
    needs: ['fees.profile.view'],
  },
  {
    title: 'Bills',
    description: 'Every invoice issued, and generating the next installment.',
    href: '/more/fees/invoices',
    icon: FileText,
    needs: ['fees.profile.view'],
  },
  {
    title: 'Fee Configuration',
    description: 'The price list — heads, groups, per-grade structures and installments.',
    href: '/more/fees/config',
    icon: Layers,
    needs: ['fees.config.manage'],
  },
  {
    title: 'Fee Settings',
    description: 'Who can do what, part-payment rules, numbering, sessions, WhatsApp.',
    href: '/admin/fee-settings',
    icon: Settings,
    needs: ['fees.settings.manage'],
  },
]

function FeesHub() {
  const { profile } = useAuth()
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [totals, setTotals] = useState<{ collected: number; outstanding: number; today: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const staff = profile ? isStaffRole(profile.role) : false
  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year || !staff || !perms.can('fees.profile.view')) { setLoading(false); return }
    setLoading(true)
    try {
      const [invoices, payments] = await Promise.all([
        fetchInvoices({ academicYearId: year.id }),
        fetchPayments({ academicYearId: year.id }),
      ])
      const today = new Date().toISOString().slice(0, 10)
      setTotals({
        collected: invoices.reduce((a, i) => a + (i.paid ?? 0), 0),
        outstanding: invoices.filter(i => i.status !== 'cancelled')
          .reduce((a, i) => a + (i.balance ?? 0), 0),
        today: payments.filter(p => p.paid_on === today && p.status === 'verified')
          .reduce((a, p) => a + (p.amount ?? 0), 0),
      })
    } finally {
      setLoading(false)
    }
  }, [year, staff, perms])

  useEffect(() => { void load() }, [load])

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
  }

  // A student sees their own fees, not the module.
  if (!staff) return <StudentFeeCard />

  if (!perms.can('fees.view')) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Lock size={26} className="mx-auto text-[#D4D4D8] mb-3" />
          <h2 className="text-base font-bold text-[#27272A]">Fees are not part of your role</h2>
          <p className="text-sm text-[#71717A] mt-1">
            An administrator can grant access in Admin Space → Fee Settings → Permissions.
          </p>
        </div>
      </div>
    )
  }

  const visible = TOOLS.filter(t => t.needs.some(k => perms.can(k)))

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <div className="bg-[#27272A] border-b border-[#3F3F46]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
              <CreditCard size={16} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight">Fees</h1>
              <p className="text-xs text-zinc-500">Session {year?.code ?? '—'}</p>
            </div>
          </div>
          <YearScope tone="dark" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {perms.can('fees.profile.view') && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {loading ? (
              [0, 1, 2].map(i => (
                <div key={i} className={`${ADMIN.card} p-4 h-[74px] animate-pulse bg-[#FAFAFA]`} />
              ))
            ) : (
              <>
                <Headline label="Collected" value={inr(totals?.collected, showAmounts)} />
                <Headline label="Outstanding" value={inr(totals?.outstanding, showAmounts)} tone="amber" />
                <Headline label="Today" value={inr(totals?.today, showAmounts)} />
              </>
            )}
          </div>
        )}

        {perms.amountsHidden && (
          <p className="text-xs text-[#A1A1AA] -mt-2">
            Amounts are hidden for your account. The figures are not sent to this device at all,
            so the counts and lists below are still complete.
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {visible.map((tool, i) => {
            const Icon = tool.icon
            return (
              <motion.div key={tool.href}
                          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}>
                <Link href={tool.href}
                      className={`${ADMIN.card} p-4 flex items-start gap-3 hover:border-[#A1A1AA] transition-colors group`}>
                  <div className="w-9 h-9 rounded-lg bg-[#F4F4F5] flex items-center justify-center flex-shrink-0">
                    <Icon size={16} className="text-[#52525B]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-[#27272A]">{tool.title}</div>
                    <p className="text-xs text-[#A1A1AA] mt-0.5 leading-relaxed">{tool.description}</p>
                  </div>
                  <ChevronRight size={15} className="text-[#D4D4D8] group-hover:text-[#71717A] mt-1 flex-shrink-0" />
                </Link>
              </motion.div>
            )
          })}
        </div>

        {perms.can('fees.reports.view') && (
          <div className={`${ADMIN.card} p-4 flex items-start gap-3`}>
            <div className="w-9 h-9 rounded-lg bg-[#F4F4F5] flex items-center justify-center flex-shrink-0">
              <BarChart3 size={16} className="text-[#A1A1AA]" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#27272A]">Collection Center</div>
              <p className="text-xs text-[#A1A1AA] mt-0.5 leading-relaxed">
                Aging, defaulters by class, the collection heatmap and the audit trail arrive in
                Round 4. Every figure it will show is already being recorded.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Headline({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'amber' ? 'text-amber-700' : 'text-[#27272A]'}`}>
        {value}
      </div>
    </div>
  )
}

export default function FeesPage() {
  return (
    <ProtectedLayout>
      <AcademicYearProvider>
        <FeesHub />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
