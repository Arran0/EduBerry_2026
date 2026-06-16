'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Megaphone, ClipboardList, GraduationCap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { useTaskNotifications } from '@/hooks/useTaskNotifications'

export default function BottomNav() {
  const { user, profile } = useAuth()
  const pathname = usePathname()
  const [visible, setVisible] = useState(true)
  const lastScrollY = useRef(0)

  const isStaff = profile ? isStaffRole(profile.role) : false
  const { unreadCount: taskUnreadCount } = useTaskNotifications(isStaff ? (user?.id ?? null) : null)

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY
      if (currentY < 10) {
        setVisible(true)
      } else if (currentY > lastScrollY.current + 6) {
        setVisible(false)
      } else if (currentY < lastScrollY.current - 6) {
        setVisible(true)
      }
      lastScrollY.current = currentY
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  if (!user) return null

  const isActive = (href: string) => {
    if (href === '/home') return pathname === '/home' || pathname === '/'
    return pathname.startsWith(href)
  }

  const navItems = [
    { label: 'Home',         href: '/home',          Icon: Home },
    { label: 'Announce',     href: '/announcements', Icon: Megaphone },
    ...(isStaff ? [{ label: 'Tasks', href: '/tasks', Icon: ClipboardList }] : []),
    { label: 'Academics',    href: '/academics',     Icon: GraduationCap },
  ]

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 backdrop-blur-xl border-t border-slate-200/80 shadow-[0_-2px_16px_rgba(0,0,0,0.07)] transition-transform duration-300 ease-in-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch h-14">
        {navItems.map(({ label, href, Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 transition-colors duration-150 ${
                active ? 'text-mps-blue-600' : 'text-slate-400 active:text-slate-600'
              }`}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-mps-blue-500 rounded-full" />
              )}
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                {href === '/tasks' && taskUnreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 text-[9px] font-bold bg-red-500 text-white rounded-full inline-flex items-center justify-center leading-none">
                    {taskUnreadCount > 99 ? '99+' : taskUnreadCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none tracking-tight">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
