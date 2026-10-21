'use client'

import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Shield, BookOpen, Users, Home,
  ChevronRight, Lock, ArrowLeft, FileBadge, Briefcase, GraduationCap, MapPin, Clock, Brush,
} from 'lucide-react'

const adminTools = [
  {
    title: 'Student Profile Manager',
    description: 'Create and manage student accounts — admission details, grade, section, family info and more',
    href: '/more/profiles/students',
    icon: GraduationCap,
  },
  {
    title: 'Staff Profile Manager',
    description: 'Manage all non-student staff with full CBSE-recommended HR records, payroll and identity fields',
    href: '/more/profiles/staff',
    icon: Briefcase,
  },
  {
    title: 'Certificate Builder',
    description: 'Issue TC, Bonafide, Study, No-Due, Promotion & custom certificates',
    href: '/admin/certificates',
    icon: FileBadge,
  },
  {
    title: 'Classroom Manager',
    description: 'Create and configure classrooms, manage enrolments and subjects',
    href: '/more/classrooms',
    icon: BookOpen,
  },
  {
    title: 'Homeroom Manager',
    description: 'Set up homerooms, assign students, and configure attendance groups',
    href: '/more/homerooms',
    icon: Home,
  },
  {
    title: 'Teacher Teams',
    description: 'Organise staff into teams and assign coordinator roles',
    href: '/more/teacher-teams',
    icon: Users,
  },
  {
    title: 'Geofencing',
    description: 'The school fence, group fences, and who may check in from anywhere',
    href: '/admin/geofencing',
    icon: MapPin,
  },
  {
    title: 'Attendance Rules',
    description: 'Late and checkout cutoffs, holidays, non-working days and who is tracked',
    href: '/admin/attendance',
    icon: Clock,
  },
  {
    title: 'Design',
    description: 'Branding, school profile, page themes, the login page and banners',
    href: '/admin/design',
    icon: Brush,
  },
]

export default function AdminSpacePage() {
  const { profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  useEffect(() => {
    if (profile && !isAdmin) {
      router.replace('/more')
    }
  }, [profile, isAdmin, router])

  if (!profile || !isAdmin) return null

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-[#F5F5F5]">

        {/* Page header */}
        <div className="bg-[#27272A] border-b border-[#3F3F46]">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
                <Shield size={16} className="text-[#B8983C]" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-white tracking-tight">Admin Space</h1>
                <p className="text-xs text-zinc-500">Administrative tools &amp; configuration</p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-[#3F3F46] text-zinc-400 border border-[#52525B] flex-shrink-0">
              {profile.role}
            </span>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

          {/* Section label */}
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-3">
            Management Tools
          </p>

          {/* Tool list */}
          <div className="border border-[#E4E4E7] bg-white overflow-hidden">
            {adminTools.map((tool, i) => {
              const Icon = tool.icon
              return (
                <motion.div
                  key={tool.href}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    href={tool.href}
                    className={`group flex items-center gap-4 px-4 py-4 hover:bg-[#FAFAFA] active:bg-[#F5F5F5] transition-colors ${
                      i < adminTools.length - 1 ? 'border-b border-[#F0F0F0]' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className="w-10 h-10 bg-[#F5F5F5] border border-[#E4E4E7] group-hover:border-[#D4D4D8] flex items-center justify-center flex-shrink-0 transition-colors">
                      <Icon size={17} className="text-[#27272A]" />
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#18181B]">{tool.title}</p>
                      <p className="text-xs text-[#71717A] mt-0.5 leading-snug">{tool.description}</p>
                    </div>

                    {/* Arrow */}
                    <ChevronRight
                      size={15}
                      className="text-[#D4D4D8] group-hover:text-[#A1A1AA] group-hover:translate-x-0.5 transition-all flex-shrink-0"
                    />
                  </Link>
                </motion.div>
              )
            })}
          </div>

          {/* Warning note */}
          <div className="mt-4 flex items-start gap-2.5 px-4 py-3 bg-white border border-[#E4E4E7]">
            <Lock size={11} className="text-[#B8983C] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#A1A1AA] leading-relaxed">
              Admin-restricted area. Changes made here affect all users and application data.
            </p>
          </div>

        </div>
      </div>
    </ProtectedLayout>
  )
}
