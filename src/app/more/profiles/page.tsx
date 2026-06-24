'use client'

import React from 'react'
import { motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, GraduationCap, Briefcase, Users } from 'lucide-react'

const MANAGERS = [
  {
    title: 'Student Profile Manager',
    description: 'Create, edit, and manage student accounts — admission details, grade, section, family info, and more',
    href: '/more/profiles/students',
    icon: GraduationCap,
    accent: '#2563EB',
    bg: '#EFF6FF',
    badge: 'Students',
  },
  {
    title: 'Staff Profile Manager',
    description: 'Manage all non-student staff — teachers, coordinators, principals, admins, and drivers — with full CBSE-recommended HR details',
    href: '/more/profiles/staff',
    icon: Briefcase,
    accent: '#B8983C',
    bg: '#FEFCE8',
    badge: 'Staff',
  },
]

export default function ProfilesHubPage() {
  const router = useRouter()

  return (
    <ProtectedLayout adminOnly>
      <div className="w-full min-h-screen" style={{ backgroundColor: '#FDFCF9' }} data-page-theme="admin">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <div className="mb-8 flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="w-9 h-9 bg-white border border-[#D4D4D8] flex items-center justify-center hover:bg-[#F4F4F5] transition-colors flex-shrink-0"
            >
              <ChevronLeft size={18} className="text-[#18181B]" />
            </button>
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
              <Users size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#18181B]">Profile Manager</h1>
              <p className="text-xs text-[#71717A]">Choose a manager to create, import, and edit user profiles</p>
            </div>
          </div>

          {/* Cards */}
          <div className="space-y-3">
            {MANAGERS.map((m, i) => {
              const Icon = m.icon
              return (
                <motion.div
                  key={m.href}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07 }}
                >
                  <Link
                    href={m.href}
                    className="group flex items-center gap-4 p-5 bg-white border border-[#E4E4E7] hover:border-[#D4D4D8] hover:shadow-sm active:bg-[#F9F9F9] transition-all"
                  >
                    <div
                      className="w-12 h-12 flex items-center justify-center flex-shrink-0 border"
                      style={{ backgroundColor: m.bg, borderColor: m.accent + '33' }}
                    >
                      <Icon size={22} style={{ color: m.accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-bold text-[#18181B]">{m.title}</p>
                        <span
                          className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border"
                          style={{ color: m.accent, borderColor: m.accent + '40', backgroundColor: m.bg }}
                        >
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-xs text-[#71717A] leading-relaxed">{m.description}</p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="text-[#D4D4D8] group-hover:text-[#A1A1AA] group-hover:translate-x-0.5 transition-all flex-shrink-0"
                    />
                  </Link>
                </motion.div>
              )
            })}
          </div>

        </div>
      </div>
    </ProtectedLayout>
  )
}
