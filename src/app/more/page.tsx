'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import { isStaffRole } from '@/lib/supabase'
import Link from 'next/link'
import {
  MoreHorizontal,
  CreditCard,
  Calendar,
  CalendarDays,
  CalendarRange,
  ArrowRight,
  Shield,
  MessageSquare,
  ClipboardList,
  UserCheck,
  Bus,
  Banknote,
  FileText,
} from 'lucide-react'
import { useStudentLeaveNotifications, useStaffLeaveNotifications } from '@/hooks/useLeaveNotifications'

interface MoreSection {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  badge?: string
  badgeColor?: string
  notificationCount?: number
}

// ── Color utilities ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
}

function lerpHex(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from)
  const [r2, g2, b2] = hexToRgb(to)
  return rgbToHex(Math.round(r1 + (r2 - r1) * t), Math.round(g1 + (g2 - g1) * t), Math.round(b1 + (b2 - b1) * t))
}

function darkenHex(hex: string, amount = 0.2): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(Math.round(r * (1 - amount)), Math.round(g * (1 - amount)), Math.round(b * (1 - amount)))
}

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

function buildIconPalette(gradFrom: string, gradTo: string): Array<[string, string]> {
  const from = HEX_RE.test(gradFrom) ? gradFrom : '#0ea5e9'
  const to   = HEX_RE.test(gradTo)   ? gradTo   : '#22c55e'
  return [
    [from,                       darkenHex(from, 0.18)],
    [lerpHex(from, to, 0.18),    lerpHex(from, to, 0.36)],
    [lerpHex(from, to, 0.36),    lerpHex(from, to, 0.54)],
    [lerpHex(from, to, 0.54),    lerpHex(from, to, 0.72)],
    [lerpHex(from, to, 0.72),    lerpHex(from, to, 0.90)],
    [lerpHex(from, to, 0.84),    to],
  ]
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MorePage() {
  const { user, profile } = useAuth()
  const { pageThemes } = usePageConfig()
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isAdmin = profile?.role === 'admin'
  const isStudent = !isStaff

  const { count: studentLeaveCount } = useStudentLeaveNotifications(user?.id ?? null, isStudent)
  const { count: staffLeaveCount } = useStaffLeaveNotifications(isStaff ? (user?.id ?? null) : null)

  // Derive icon palette from the home page theme (falling back to CSS defaults)
  const homeTheme = pageThemes['home']
  const gradFrom = homeTheme?.gradFrom ?? '#0ea5e9'
  const gradTo   = homeTheme?.gradTo   ?? '#22c55e'
  const palette  = buildIconPalette(gradFrom, gradTo)

  const sections: MoreSection[] = [
    ...( isStaff ? [{
      title: 'Staff OD / Leave Manager',
      description: 'Manage staff leave requests and view leave history',
      href: '/more/staff-leave',
      icon: <CalendarDays size={22} />,
      badge: 'Staff',
      badgeColor: 'bg-slate-100 text-slate-700',
      notificationCount: staffLeaveCount,
    }] : []),
    {
      title: 'Student OD Leave Manager',
      description: 'Apply for OD, casual, or medical leave and track applications',
      href: '/more/leave',
      icon: <Calendar size={22} />,
      notificationCount: studentLeaveCount,
    },
    {
      title: 'Attendance',
      description: 'View your attendance calendar or mark homeroom attendance',
      href: '/more/attendance',
      icon: <ClipboardList size={22} />,
    },
    ...( isStaff ? [{
      title: 'Staff Attendance',
      description: 'Check in for the day and view your attendance history',
      href: '/more/staff-attendance',
      icon: <UserCheck size={22} />,
      badge: 'Staff',
      badgeColor: 'bg-slate-100 text-slate-700',
    }] : []),
    ...( isAdmin ? [{
      title: 'Admin Space',
      description: 'Manage profiles, classrooms, homerooms, teacher teams, and app settings',
      href: '/more/admin-space',
      icon: <Shield size={22} />,
      badge: 'Admin',
      badgeColor: 'bg-slate-100 text-slate-700',
    }] : []),
    {
      title: 'Exam',
      description: 'View exam schedules, results, and grade reports',
      href: '/more/exam',
      icon: <FileText size={22} />,
    },
    {
      title: 'Bus',
      description: isAdmin
        ? 'Manage trips, drivers, passengers, fees, and payroll'
        : 'Track your bus live, see ETA, and pay bus fees',
      href: '/more/bus',
      icon: <Bus size={22} />,
    },
    {
      title: 'Timetable',
      description: 'View your class schedule, periods, and teacher timetables',
      href: '/more/timetable',
      icon: <CalendarRange size={22} />,
    },
    {
      title: 'Fee Manager',
      description: 'View fee structure, payment history, and make payments',
      href: '/more/fees',
      icon: <CreditCard size={22} />,
    },
    ...( isStaff ? [{
      title: 'Salary',
      description: 'View salary details, payslips, and payment history',
      href: '/more/salary',
      icon: <Banknote size={22} />,
      badge: 'Staff',
      badgeColor: 'bg-slate-100 text-slate-700',
    }] : []),
    {
      title: 'Feedback',
      description: 'Share your thoughts, suggestions, and feedback',
      href: '/more/feedback',
      icon: <MessageSquare size={22} />,
    },
  ]

  return (
    <ProtectedLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-slate-100 rounded-xl">
            <MoreHorizontal className="text-slate-600" size={22} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">More Services</h1>
            <p className="text-slate-500 text-sm">Additional tools and features</p>
          </div>
        </div>

        {/* Section List */}
        <div className="flex flex-col gap-3">
          {sections.map((section, idx) => {
            const [c1, c2] = palette[idx % palette.length]
            return (
              <Link
                key={section.href}
                href={section.href}
                className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm active:bg-slate-50 hover:shadow-md transition-shadow"
              >
                {/* Icon with notification badge */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    {section.icon}
                  </div>
                  {!!section.notificationCount && section.notificationCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full inline-flex items-center justify-center leading-none shadow-sm ring-2 ring-white">
                      {section.notificationCount > 4 ? '4+' : section.notificationCount}
                    </span>
                  )}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-[15px]">{section.title}</span>
                    {section.badge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${section.badgeColor}`}>
                        {section.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 text-sm mt-0.5 leading-snug">{section.description}</p>
                </div>

                {/* Arrow */}
                <ArrowRight size={18} className="text-slate-400 flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      </div>
    </ProtectedLayout>
  )
}
