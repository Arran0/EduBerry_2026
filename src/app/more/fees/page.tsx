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
  BadgePercent, BarChart3, ChevronRight, CreditCard, FileText, GraduationCap,
  Layers, Lock, MessageSquare, Settings, Timer, Wallet,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { inr } from '@/components/fees/ui'
import { FeeScreen, StatStrip, Notice, Loading } from '@/components/fees/shell'
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
    title: 'Collections',
    description: 'Who owes what, sorted by most overdue. Remind one family, a class or everyone.',
    href: '/more/fees/collections',
    icon: MessageSquare,
    needs: ['fees.reminder.send', 'fees.profile.view'],
  },
  {
    title: 'Concessions',
    description: 'Discounts, scholarships and waivers — and the queue of what needs approving.',
    href: '/more/fees/concessions',
    icon: BadgePercent,
    needs: ['fees.discount.apply', 'fees.discount.approve', 'fees.scholarship.manage'],
  },
  {
    title: 'Charges',
    description: 'Late-fee rules and the nightly sweep, plus fines and who is exempt.',
    href: '/more/fees/charges',
    icon: Timer,
    needs: ['fees.latefee.manage', 'fees.fine.apply'],
  },
  {
    title: 'Collection Center',
    description: 'Efficiency against the calendar, the aging cliff, defaulters by class, search.',
    href: '/more/fees/reports',
    icon: BarChart3,
    needs: ['fees.reports.view'],
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
  // Depend on the boolean, not on `perms`. The hook memoises its return now,
  // but a dependency on a plain boolean cannot be broken by a later field
  // being added to it.
  const canSeeProfiles = perms.can('fees.profile.view')

  const load = useCallback(async () => {
    if (!year || !staff || !canSeeProfiles) { setLoading(false); return }
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
  }, [year, staff, canSeeProfiles])

  useEffect(() => { void load() }, [load])

  if (perms.loading) return <Loading />

  // A student sees their own fees, not the module.
  if (!staff) return <StudentFeeCard />

  if (!perms.can('fees.view')) {
    return (
      <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Lock size={26} className="mx-auto text-[#C9C4B4] mb-3" />
          <h2 className="font-display text-base font-bold text-[#18181B]">Fees are not part of your role</h2>
          <p className="text-[12.5px] text-[#8C8878] mt-1">
            An administrator can grant access in Admin Space → Fee Settings → Permissions.
          </p>
        </div>
      </div>
    )
  }

  const visible = TOOLS.filter(t => t.needs.some(k => perms.can(k)))

  return (
    <FeeScreen
      title="Fees"
      subtitle={`Session ${year?.code ?? '—'}`}
      icon={<CreditCard size={17} style={{ color: '#B8983C' }} />}
      actions={<YearScope />}
    >
      {canSeeProfiles && (
        <StatStrip
          loading={loading}
          stats={[
            { label: 'Collected', value: inr(totals?.collected, showAmounts) },
            { label: 'Outstanding', value: inr(totals?.outstanding, showAmounts),
              tone: (totals?.outstanding ?? 0) > 0 ? '#7A6220' : undefined },
            { label: 'Today', value: inr(totals?.today, showAmounts), strong: true },
          ]}
        />
      )}

      {perms.amountsHidden && (
        <Notice>
          Amounts are hidden for your account. The figures are not sent to this device at all,
          so the counts and lists below are still complete.
        </Notice>
      )}

      {/* Two up on a laptop, three on a wide monitor — the cards are short and
          a single column of them on a 2,560px screen is mostly empty paper. */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-px bg-[#F0ECE2] border border-[#E3DFD3]">
        {visible.map((tool, i) => {
          const Icon = tool.icon
          return (
            <motion.div key={tool.href}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}>
              <Link href={tool.href}
                    className="h-full bg-white hover:bg-[#FAF8F2] p-3.5 flex items-start gap-3
 transition-colors group">
                <div className="w-8 h-8 bg-[#F4F1E7] flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="text-[#6B675A]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#18181B]">{tool.title}</div>
                  <p className="text-[11px] text-[#8C8878] mt-0.5 leading-relaxed">{tool.description}</p>
                </div>
                <ChevronRight size={14} className="text-[#C9C4B4] group-hover:text-[#6B675A] mt-1 flex-shrink-0" />
              </Link>
            </motion.div>
          )
        })}
      </div>
    </FeeScreen>
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
