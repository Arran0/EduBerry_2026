'use client'

import React from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import Link from 'next/link'
import {
  MoreHorizontal,
  CreditCard,
  Calendar,
  CalendarDays,
  ArrowRight,
  Users,
  BookOpen,
  UserPlus,
  MessageSquare,
} from 'lucide-react'

interface MoreSection {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  gradient: string
  badge?: string
  badgeColor?: string
}

export default function MorePage() {
  const { profile } = useAuth()
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isAdmin = profile?.role === 'admin'

  const baseSections: MoreSection[] = [
    {
      title: 'Student Leave Manager',
      description: 'Apply for leave, view balance, and track applications',
      href: '/more/leave',
      icon: <Calendar size={22} />,
      gradient: 'from-cyan-500 to-cyan-600',
    },
    {
      title: 'Fee Manager',
      description: 'View fee structure, payment history, and make payments',
      href: '/more/fees',
      icon: <CreditCard size={22} />,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      title: 'Feedback',
      description: 'Share your thoughts, suggestions, and feedback',
      href: '/more/feedback',
      icon: <MessageSquare size={22} />,
      gradient: 'from-indigo-500 to-indigo-600',
    },
  ]

  const staffSections: MoreSection[] = [
    {
      title: 'Staff Leave Manager',
      description: 'Manage staff leave requests and view leave history',
      href: '/more/staff-leave',
      icon: <CalendarDays size={22} />,
      gradient: 'from-purple-500 to-purple-600',
      badge: 'Staff',
      badgeColor: 'bg-purple-100 text-purple-700',
    },
  ]

  const adminSections: MoreSection[] = [
    {
      title: 'Classroom Management',
      description: 'Create and manage classrooms, add members by email',
      href: '/more/classrooms',
      icon: <BookOpen size={22} />,
      gradient: 'from-blue-500 to-indigo-600',
      badge: 'Admin',
      badgeColor: 'bg-red-100 text-red-700',
    },
    {
      title: 'Teacher Teams',
      description: 'Create teacher teams and assign coordinators',
      href: '/more/teacher-teams',
      icon: <Users size={22} />,
      gradient: 'from-pink-500 to-purple-600',
      badge: 'Admin',
      badgeColor: 'bg-red-100 text-red-700',
    },
    {
      title: 'Profile Management',
      description: 'View and edit user profiles, roles, and assignments',
      href: '/more/profiles',
      icon: <UserPlus size={22} />,
      gradient: 'from-orange-500 to-red-500',
      badge: 'Admin',
      badgeColor: 'bg-red-100 text-red-700',
    },
  ]

  const [studentLeave, ...restBase] = baseSections
  let sections = [studentLeave]
  if (isStaff) sections = [...sections, ...staffSections]
  sections = [...sections, ...restBase]
  if (isAdmin) sections = [...sections, ...adminSections]

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
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm active:bg-slate-50 hover:shadow-md transition-shadow"
            >
              {/* Icon */}
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${section.gradient} flex items-center justify-center text-white flex-shrink-0 shadow-sm`}>
                {section.icon}
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
          ))}
        </div>
      </div>
    </ProtectedLayout>
  )
}
