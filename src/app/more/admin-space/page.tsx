'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Admin Space — the index of the school's administrative tools.
//
// Grouped the way a settings app groups them: who is in the school, how
// teaching is organised, how attendance is scored, and how the app looks. Each
// group is one solid sheet of rows; each row leads with its own coloured tile
// so a tool is found by colour before its name is read.
//
// Fee and payroll settings are not here: each opens from the Settings button
// on its own module's banner (Fees, Salary), next to the work it governs.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Shield, BookOpen, Users, Home, ChevronRight, ChevronLeft, Lock, FileBadge, Briefcase, GraduationCap,
  MapPin, Clock, Brush,
} from 'lucide-react'

interface Tool {
  title: string
  description: string
  href: string
  icon: LucideIcon
  /** The tile's fill: two stops, top-left to bottom-right. */
  tint: [string, string]
}

const GROUPS: { title: string; tools: Tool[] }[] = [
  {
    title: 'People',
    tools: [
      {
        title: 'Student profiles',
        description: 'Admission details, grade, section and family information',
        href: '/more/profiles/students',
        icon: GraduationCap,
        tint: ['#4F7BD9', '#2F55B0'],
      },
      {
        title: 'Staff profiles',
        description: 'HR records, payroll and identity fields for everyone who is not a student',
        href: '/more/profiles/staff',
        icon: Briefcase,
        tint: ['#6B6BD6', '#4A44AE'],
      },
      {
        title: 'Certificates',
        description: 'Transfer, bonafide, study, no-due, promotion and custom certificates',
        href: '/admin/certificates',
        icon: FileBadge,
        tint: ['#D6A33E', '#B07F1F'],
      },
    ],
  },
  {
    title: 'Teaching',
    tools: [
      {
        title: 'Classrooms',
        description: 'Create classrooms, manage enrolments and subjects',
        href: '/more/classrooms',
        icon: BookOpen,
        tint: ['#2FA7A0', '#1B7F7A'],
      },
      {
        title: 'Homerooms',
        description: 'Set up homerooms, assign students and attendance groups',
        href: '/more/homerooms',
        icon: Home,
        tint: ['#45A867', '#2D8049'],
      },
      {
        title: 'Teacher teams',
        description: 'Organise staff into teams and assign coordinators',
        href: '/more/teacher-teams',
        icon: Users,
        tint: ['#D9668F', '#B0436B'],
      },
    ],
  },
  {
    title: 'Attendance',
    tools: [
      {
        title: 'Geofencing',
        description: 'The school fence, group fences, and who may check in from anywhere',
        href: '/admin/geofencing',
        icon: MapPin,
        tint: ['#E0644F', '#B8432F'],
      },
      {
        title: 'Attendance rules',
        description: 'Late and checkout cutoffs, holidays, non-working days and who is tracked',
        href: '/admin/attendance',
        icon: Clock,
        tint: ['#E58A3A', '#C0661C'],
      },
    ],
  },
  {
    title: 'Look and feel',
    tools: [
      {
        title: 'Design',
        description: 'Branding, school profile, page themes, the login page and banners',
        href: '/admin/design',
        icon: Brush,
        tint: ['#8A6FCC', '#6449A6'],
      },
    ],
  },
]

export default function AdminSpacePage() {
  const { profile } = useAuth()
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  useEffect(() => {
    if (profile && !isAdmin) {
      router.replace('/more')
    }
  }, [profile, isAdmin, router])

  if (!profile || !isAdmin) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="admin" className="min-h-screen overflow-x-clip">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-14">

          {/* Header — the back capsule, then the title on the page itself. */}
          <button
            onClick={() => router.back()}
            className="lg-pill inline-flex items-center gap-1 h-8 pl-2 pr-3.5 text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
          >
            <ChevronLeft size={15} /> More
          </button>

          <div className="mt-4 sm:mt-6 mb-6 sm:mb-8 flex items-end gap-4">
            <span className="w-14 h-14 sm:w-16 sm:h-16 rounded-[18px] flex-shrink-0 inline-flex items-center justify-center text-[#E9D7A1] shadow-[inset_0_1px_0_rgba(255,255,255,.14),inset_0_-2px_0_#B8983C,0_16px_30px_-18px_rgba(15,23,42,.9)]"
              style={{ background: 'linear-gradient(155deg,#3D3B40 0%,#27272A 70%)' }}>
              <Shield size={26} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[1.65rem] sm:text-[2.1rem] font-bold leading-[1.1] tracking-[-0.02em] text-[#1F1E22]">
                Admin Space
              </h1>
              <p className="text-[13px] sm:text-[14px] text-slate-500 mt-1">The tools that run the school, in one place</p>
            </div>
            <span className="hidden sm:inline-flex items-center h-7 px-3 rounded-full bg-white text-[12px] font-semibold text-slate-600 ring-1 ring-black/[.06] shadow-[0_1px_2px_rgba(15,23,42,.05)] flex-shrink-0">
              Signed in as {profile.role}
            </span>
          </div>

          {/* Groups — two columns on a laptop, one on a phone. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6 sm:gap-y-7 items-start">
            {GROUPS.map((group, gi) => (
              <motion.section
                key={group.title}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                aria-labelledby={`admin-group-${gi}`}
              >
                <h2 id={`admin-group-${gi}`} className="px-4 mb-2 text-[13px] font-semibold text-slate-500">{group.title}</h2>
                <ul className="bg-white rounded-[22px] border border-black/[.06] shadow-[0_1px_2px_rgba(15,23,42,.04),0_18px_36px_-26px_rgba(15,23,42,.45)] overflow-hidden">
                  {group.tools.map((tool, i) => (
                    <li key={tool.href}>
                      <ToolRow tool={tool} last={i === group.tools.length - 1} />
                    </li>
                  ))}
                </ul>
              </motion.section>
            ))}
          </div>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-[12px] text-slate-500 text-center">
            <Lock size={12} className="text-[#B8983C] flex-shrink-0" />
            Only admins see this space. Changes here apply to everyone.
          </p>
        </div>
      </div>
    </ProtectedLayout>
  )
}

function ToolRow({ tool, last }: { tool: Tool; last: boolean }) {
  const Icon = tool.icon
  return (
    <Link
      href={tool.href}
      className="group relative flex items-center gap-3.5 pl-4 pr-3 py-3 hover:bg-[#F7F5F1] active:bg-[#F0EDE6] transition-colors focus-visible:outline-none focus-visible:bg-[#F7F5F1]"
    >
      <span
        className="w-10 h-10 rounded-[12px] flex-shrink-0 inline-flex items-center justify-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_6px_12px_-8px_rgba(15,23,42,.7)] transition-transform duration-200 group-hover:scale-[1.04]"
        style={{ background: `linear-gradient(140deg, ${tool.tint[0]}, ${tool.tint[1]})` }}
      >
        <Icon size={19} strokeWidth={2} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14.5px] font-semibold text-slate-900 leading-snug">{tool.title}</span>
        <span className="block text-[12.5px] text-slate-500 leading-snug mt-0.5">{tool.description}</span>
      </span>
      <ChevronRight size={17} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition flex-shrink-0" />
      {/* The hairline between rows starts after the tile, the way a grouped list draws it. */}
      {!last && <span aria-hidden className="absolute bottom-0 right-0 left-[4.4rem] h-px bg-black/[.06]" />}
    </Link>
  )
}
