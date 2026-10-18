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
  const { user, profile, loading } = useAuth()
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

  // Navigating to a new page jumps scroll back to the top, which would
  // otherwise leave the bar collapsed for a beat before the next scroll
  // event catches up — expand it in step with the route change instead.
  useEffect(() => {
    setCollapsed(false)
    lastScrollY.current = 0
  }, [pathname])

  // `loading` stays true until the profile fetch resolves, even though `user`
  // is set synchronously as soon as the session is known — wait for it so a
  // driver/smartboard account doesn't flash the normal nav before its role
  // (checked below) is known.
  if (!user || loading) return null
  // Drivers and smart boards have their own dashboard-only shells (DriverLayout /
  // SmartboardLayout) — BottomNav is irrelevant for them. This used to be
  // implicit (ProtectedLayout, which rendered BottomNav, redirected them away
  // before reaching it), but BottomNav now lives in the root layout and mounts
  // for every route, so it needs its own guard.
  if (profile?.role === 'driver' || profile?.role === 'smartboard') return null

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

  // Collapsed pill needs an explicit pixel width (not `auto`) — CSS can't
  // transition to/from `auto`, which is what made the shrink/expand snap
  // instead of animating. 36px per circular item + 4px gaps + 12px padding.
  const CIRCLE = 36
  const pillWidth = navItems.length * CIRCLE + (navItems.length - 1) * 4 + 12

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden flex justify-center transition-transform duration-300 ease-in-out ${
        hidden ? 'translate-y-full' : 'translate-y-0'
      }`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className={`flex items-center bg-white/[0.97] transition-all duration-300 ease-in-out rounded-full border border-slate-200/80 mb-2 ${
          collapsed
            ? 'h-12 gap-1 px-1.5 shadow-[0_2px_16px_rgba(0,0,0,0.12)]'
            : 'h-14 gap-0 px-2 shadow-[0_2px_16px_rgba(0,0,0,0.1)]'
        }`}
        style={{ width: collapsed ? `${pillWidth}px` : '90%' }}
      >
        {navItems.map(({ label, href, Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setCollapsed(false)}
              className="relative flex flex-col items-center justify-center self-center transition-all duration-300 ease-in-out"
              style={{
                flex: collapsed ? `0 0 ${CIRCLE}px` : '1 1 0%',
                height: collapsed ? CIRCLE : 56,
              }}
            >
              {/* Single indicator that morphs between the expanded top bar and the
                  collapsed filled circle, instead of swapping two mounted elements. */}
              <span
                className={`absolute rounded-full bg-mps-blue-500 transition-all duration-300 ease-in-out ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
                style={
                  collapsed
                    ? { top: '50%', left: '50%', width: CIRCLE, height: CIRCLE, transform: 'translate(-50%, -50%)' }
                    : { top: 0, left: '50%', width: 32, height: 2, transform: 'translate(-50%, 0)' }
                }
              />
              <div
                className={`relative transition-colors duration-300 ease-in-out ${
                  collapsed && active ? 'text-white' : active ? 'text-mps-blue-600' : 'text-slate-400 active:text-slate-600'
                }`}
              >
                <div className={`transition-transform duration-300 ease-in-out ${collapsed ? 'scale-90' : 'scale-100'}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                </div>
                {href === '/tasks' && taskUnreadCount > 0 && (
                  <span
                    className={`absolute px-0.5 font-bold bg-red-500 text-white rounded-full inline-flex items-center justify-center leading-none transition-all duration-300 ease-in-out ${
                      collapsed
                        ? '-top-1 -right-1.5 min-w-[12px] h-[12px] text-[7px]'
                        : '-top-1.5 -right-2 min-w-[15px] h-[15px] text-[9px]'
                    }`}
                  >
                    {taskUnreadCount > 99 ? '99+' : taskUnreadCount}
                  </span>
                )}
              </div>
              {/* grid-template-rows 0fr/1fr trick: animates height without needing
                  to know the label's rendered height, and avoids an abrupt pop
                  in/out from conditionally mounting the element. */}
              <div
                className={`grid w-full transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                  collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                } ${active ? 'text-mps-blue-600' : 'text-slate-400'}`}
              >
                <span className="overflow-hidden text-center text-[10px] font-medium leading-none tracking-tight">
                  {label}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
