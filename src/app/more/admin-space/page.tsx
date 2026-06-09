'use client'

import React, { useEffect } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Shield,
  ArrowRight,
  UserPlus,
  BookOpen,
  Users,
  Home,
  Settings,
} from 'lucide-react'

const adminTools = [
  {
    title: 'Profile Manager',
    description: 'View and edit user profiles, roles, and assignments',
    href: '/more/profiles',
    icon: <UserPlus size={22} />,
    gradient: 'from-orange-500 to-red-500',
  },
  {
    title: 'Classroom Manager',
    description: 'Create and manage classrooms, add members by email',
    href: '/more/classrooms',
    icon: <BookOpen size={22} />,
    gradient: 'from-blue-500 to-indigo-600',
  },
  {
    title: 'Homeroom Manager',
    description: 'Manage homerooms, assign students, and track attendance groups',
    href: '/more/homerooms',
    icon: <Home size={22} />,
    gradient: 'from-green-500 to-emerald-600',
  },
  {
    title: 'Teacher Teams Manager',
    description: 'Create teacher teams and assign coordinators',
    href: '/more/teacher-teams',
    icon: <Users size={22} />,
    gradient: 'from-pink-500 to-purple-600',
  },
  {
    title: 'App Settings',
    description: 'Configure site themes, banners, and appearance',
    href: '/admin/settings',
    icon: <Settings size={22} />,
    gradient: 'from-slate-500 to-slate-600',
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
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-red-50 rounded-xl">
            <Shield className="text-red-600" size={22} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Admin Space</h1>
            <p className="text-slate-500 text-sm">Administrative tools and management</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {adminTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm active:bg-slate-50 hover:shadow-md transition-shadow"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center text-white flex-shrink-0 shadow-sm`}>
                {tool.icon}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-slate-800 text-[15px]">{tool.title}</span>
                <p className="text-slate-500 text-sm mt-0.5 leading-snug">{tool.description}</p>
              </div>
              <ArrowRight size={18} className="text-slate-400 flex-shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </ProtectedLayout>
  )
}
