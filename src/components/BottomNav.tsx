'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Megaphone, ClipboardList, GraduationCap } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { useTaskNotifications } from '@/hooks/useTaskNotifications'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { useBottomNav } from '@/contexts/BottomNavContext'
import { useHasClassrooms } from '@/hooks/useHasClassrooms'

export default function BottomNav() {
  const { user, profile } = useAuth()
  const pathname = usePathname()
  // While scrolling down we shrink the bar to small circular icon buttons
  // rather than hiding it outright, so navigation stays reachable.
  const [collapsed, setCollapsed] = useState(false)
  const lastScrollY = useRef(0)

  // Hide the nav while the soft keyboard is open — otherwise the browser lifts
  // this `fixed; bottom: 0` bar up on top of the keyboard, where it overlaps the
  // compose bar and gets in the way of typing.
  const { open: keyboardOpen, isMobile } = useKeyboardInset()
  // Pages (e.g. the classroom Discussion tab) can hide the nav imperatively.
  const { hidden: forceHidden } = useBottomNav()
  const hidden = forceHidden || (isMobile && keyboardOpen)

  const isStaff = profile ? isStaffRole(profile.role) : false
  const hasClassrooms = useHasClassrooms(user?.id, profile?.role)
  const { unreadCount: taskUnreadCount } = useTaskNotifications(isStaff ? (user?.id ?? null) : null)

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY
      if (currentY < 10) {
        setCollapsed(false)
      } else if (currentY > lastScrollY.current + 6) {
        setCollapsed(true)
      } else if (currentY < lastScrollY.current - 6) {
        setCollapsed(false)
      }
      lastScrollY.current = currentY
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  if (!user) return null
  // Smart boards have their own header nav — BottomNav is irrelevant for them.
  if (profile?.role === 'smartboard') return null

  const isActive = (href: string) => {
    if (href === '/home') return pathname === '/home' || pathname === '/'
    return pathname.startsWith(href)
  }

  const navItems = [
    { label: 'Home',         href: '/home',          Icon: Home },
    { label: 'Announce',     href: '/announcements', Icon: Megaphone },
    ...(isStaff ? [{ label: 'Tasks', href: '/tasks', Icon: ClipboardList }] : []),
    ...(hasClassrooms ? [{ label: 'Academics', href: '/academics', Icon: GraduationCap }] : []),
  ]

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden flex justify-center transition-transform duration-300 ease-in-out ${
        hidden ? 'translate-y-full' : 'translate-y-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className={`flex items-stretch bg-white/95 backdrop-blur-xl transition-all duration-300 ease-in-out ${
          collapsed
            ? 'h-12 w-auto mb-2 gap-1 px-1.5 rounded-full border border-slate-200/80 shadow-[0_2px_16px_rgba(0,0,0,0.12)]'
            : 'h-14 w-full gap-0 px-0 rounded-none border-t border-slate-200/80 shadow-[0_-2px_16px_rgba(0,0,0,0.07)]'
        }`}
      >
        {navItems.map(({ label, href, Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center justify-center transition-all duration-300 ease-in-out ${
                collapsed
                  ? `w-9 my-auto rounded-full ${active ? 'bg-mps-blue-600 text-white' : 'text-slate-400 active:text-slate-600'}`
                  : `flex-col gap-0.5 flex-1 ${active ? 'text-mps-blue-600' : 'text-slate-400 active:text-slate-600'}`
              }`}
              style={collapsed ? { aspectRatio: '1 / 1' } : undefined}
            >
              {!collapsed && active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-mps-blue-500 rounded-full" />
              )}
              <div className="relative">
                <Icon size={collapsed ? 18 : 22} strokeWidth={active ? 2.5 : 1.8} />
                {href === '/tasks' && taskUnreadCount > 0 && (
                  <span
                    className={`absolute px-0.5 font-bold bg-red-500 text-white rounded-full inline-flex items-center justify-center leading-none ${
                      collapsed
                        ? '-top-1 -right-1.5 min-w-[12px] h-[12px] text-[7px]'
                        : '-top-1.5 -right-2 min-w-[15px] h-[15px] text-[9px]'
                    }`}
                  >
                    {taskUnreadCount > 99 ? '99+' : taskUnreadCount}
                  </span>
                )}
              </div>
              {!collapsed && (
                <span className="text-[10px] font-medium leading-none tracking-tight">{label}</span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
