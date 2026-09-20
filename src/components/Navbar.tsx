'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import { isStaffRole, getDisplayRole, getRoleBadgeColor } from '@/lib/supabase'
import MPSLogo from './MPSLogo'
import Avatar from './Avatar'
import { useTaskNotifications } from '@/hooks/useTaskNotifications'
import { useAnnouncementNotifications } from '@/hooks/useAnnouncementNotifications'
import { useHasClassrooms } from '@/hooks/useHasClassrooms'
import { useScrolled } from '@/hooks/useScrolled'
import {
  Home,
  ClipboardList,
  User,
  LogOut,
  ChevronDown,
  Menu,
  X,
  GraduationCap,
  Megaphone,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  staffOnly?: boolean
  children?: {
    label: string
    href: string
    icon: React.ReactNode
  }[]
}

const getNavItems = (isStaff: boolean, hasClassrooms: boolean): NavItem[] => {
  const items: NavItem[] = [
    { label: 'Home',          href: '/home',          icon: <Home size={17} /> },
    { label: 'Announcements', href: '/announcements', icon: <Megaphone size={17} /> },
  ]

  if (isStaff) {
    items.push({ label: 'Task Manager', href: '/tasks', icon: <ClipboardList size={17} /> })
  }

  if (hasClassrooms) {
    items.push({ label: 'Academics', href: '/academics', icon: <GraduationCap size={17} /> })
  }

  return items
}

export default function Navbar() {
  const { user, profile, signOut, loading } = useAuth()
  const { branding } = usePageConfig()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const profileDropdownRef = useRef<HTMLDivElement>(null)

  const isStaff = profile ? isStaffRole(profile.role) : false
  const hasClassrooms = useHasClassrooms(user?.id, profile?.role)
  // Once the user starts scrolling, the full-width bar dissolves and its three
  // groups (brand / links / profile) float apart into separate stadium-shaped
  // pills — two of them on phones, where the links group is hidden. Mirrors the
  // way BottomNav shrinks into a pill, and keeps the page feeling content-first
  // while every control stays exactly where it was.
  const scrolled = useScrolled()

  // Applied to each group so it morphs between "flat section of one bar" and
  // "free-floating stadium chunk". Transparent border/ring in both states so
  // nothing jumps by a pixel when the styles swap.
  // `pointer-events-auto` re-arms the chunks themselves: once scrolled the bar
  // is transparent, so it is turned into a click-through strip (below) and the
  // gaps between chunks hand taps to the content underneath.
  const chunk = `pointer-events-auto transition-all duration-300 ease-out border ${
    scrolled
      ? 'rounded-full border-slate-200/70 bg-white/85 backdrop-blur-xl shadow-[0_6px_24px_rgba(15,23,42,0.12)]'
      : 'rounded-full border-transparent bg-transparent shadow-none'
  }`

  const { unreadCount: taskUnreadCount } = useTaskNotifications(isStaff ? (user?.id ?? null) : null)
  const { unreadCount: announcementUnreadCount } = useAnnouncementNotifications(user?.id ?? null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // Don't interfere with the mobile panel — it manages its own state
      if (!mobileMenuOpen) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setActiveDropdown(null)
        }
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mobileMenuOpen])

  const isActive = (href: string) => {
    if (href === '/home') return pathname === '/home' || pathname === '/'
    return pathname.startsWith(href)
  }

  const filteredNavItems = getNavItems(isStaff, hasClassrooms === true)

  if (loading) {
    return (
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200/80 shadow-sm pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <MPSLogo size="sm" src={branding.logoUrl || undefined} />
              <div>
                <h1 className="font-display text-lg font-bold gradient-text leading-tight">{branding.appTitle}</h1>
                <p className="text-[11px] text-slate-400 leading-tight">{branding.appSubtitle}</p>
              </div>
            </div>
            <div className="spinner" />
          </div>
        </div>
      </nav>
    )
  }

  if (!user) return null

  return (
    <>
      <nav className={`sticky top-0 z-50 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-300 border-b ${
        scrolled
          ? 'bg-transparent border-transparent shadow-none pointer-events-none'
          : 'bg-white/95 backdrop-blur-xl border-slate-200/80 shadow-sm'
      }`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className={`flex items-center justify-between transition-all duration-300 ease-out ${
            scrolled ? 'h-[3.75rem] gap-2' : 'h-16 gap-0'
          }`}>

            {/* Chunk 1 — logo + branding */}
            <Link
              href="/home"
              className={`flex items-center group flex-shrink-0 ${chunk} ${
                scrolled ? 'gap-2 px-1.5 md:pr-3 py-1' : 'gap-3 px-0 py-0'
              }`}
            >
              <MPSLogo size="sm" src={branding.logoUrl || undefined} className="transition-transform duration-200 group-hover:scale-105" />
              {/* On phones the scrolled brand chunk drops its wordmark so it
                  shrinks to a compact logo pill; desktop keeps the title. */}
              <div className={scrolled ? 'hidden md:block' : 'block'}>
                <h1 className="font-display text-base font-bold gradient-text leading-tight">{branding.appTitle}</h1>
                <p className={`text-[11px] text-slate-400 leading-tight transition-all duration-300 ${
                  scrolled ? 'hidden' : 'hidden sm:block'
                }`}>{branding.appSubtitle}</p>
              </div>
            </Link>

            {/* Chunk 2 (desktop only) — nav links */}
            <div className={`hidden md:flex items-center ${chunk} ${
              scrolled ? 'gap-0.5 px-1.5 py-1' : 'gap-0.5 px-0 py-0'
            }`} ref={dropdownRef}>
              {filteredNavItems.map((item) => {
                const active = isActive(item.href)
                return (
                  <div key={item.label} className="relative">
                    {item.children ? (
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}
                        className={`flex items-center gap-1.5 px-3 text-sm font-medium transition-all duration-300 ${
                          scrolled ? 'py-1.5 rounded-full' : 'py-2 rounded-xl'
                        } ${
                          active
                            ? 'text-mps-blue-600 bg-mps-blue-50'
                            : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <span className={active ? 'text-mps-blue-500' : 'text-slate-400'}>{item.icon}</span>
                        {item.label}
                        <ChevronDown
                          size={14}
                          className={`text-slate-400 transition-transform duration-200 ${activeDropdown === item.label ? 'rotate-180' : ''}`}
                        />
                      </button>
                    ) : (
                      <Link
                        href={item.href}
                        className={`flex items-center gap-1.5 px-3 text-sm font-medium transition-all duration-300 ${
                          scrolled ? 'py-1.5 rounded-full' : 'py-2 rounded-xl'
                        } ${
                          active
                            ? 'text-mps-blue-600 bg-mps-blue-50'
                            : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <span className={active ? 'text-mps-blue-500' : 'text-slate-400'}>{item.icon}</span>
                        {item.label}
                        {item.href === '/tasks' && taskUnreadCount > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full leading-none">
                            {taskUnreadCount > 99 ? '99+' : taskUnreadCount}
                          </span>
                        )}
                        {item.href === '/announcements' && announcementUnreadCount > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full leading-none">
                            {announcementUnreadCount > 99 ? '99+' : announcementUnreadCount}
                          </span>
                        )}
                      </Link>
                    )}

                    {item.children && (
                      <div className={`dropdown-menu ${activeDropdown === item.label ? 'open' : ''}`}>
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className="dropdown-item"
                            onClick={() => setActiveDropdown(null)}
                          >
                            <span className="text-slate-400">{child.icon}</span>
                            <span>{child.label}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Chunk 3 (2 on phones) — profile + mobile toggle */}
            <div className={`flex items-center ${chunk} ${
              scrolled ? 'gap-1 px-1 py-1' : 'gap-2 px-0 py-0'
            }`}>

              {/* Profile button */}
              <div className="relative" ref={profileDropdownRef}>
                <button
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className={`flex items-center gap-2.5 pl-1 pr-2.5 py-1 hover:bg-slate-100 transition-all duration-300 ${
                    scrolled ? 'rounded-full' : 'rounded-xl'
                  }`}
                >
                  <Avatar
                    avatarUrl={profile?.avatar_url}
                    name={profile?.full_name}
                    email={user.email}
                    size={scrolled ? 30 : 34}
                    className="ring-2 ring-white shadow-sm transition-all duration-300"
                  />
                  <div className={`text-left transition-all duration-300 ${scrolled ? 'hidden lg:block' : 'hidden sm:block'}`}>
                    <p className="text-sm font-semibold text-slate-700 leading-tight truncate max-w-[110px]">
                      {profile?.full_name?.split(' ')[0] || 'User'}
                    </p>
                    <p className={`text-[10px] px-1.5 py-0.5 rounded-full inline-block leading-tight ${
                      profile ? getRoleBadgeColor(profile.role, profile.is_non_teaching) : 'bg-slate-100 text-slate-600'
                    }`}>
                      {profile ? getDisplayRole(profile) : '\u2026'}
                    </p>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-slate-400 transition-transform duration-200 ${
                      scrolled ? 'hidden lg:block' : 'hidden sm:block'
                    } ${profileDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <div className={`dropdown-menu w-60 ${profileDropdownOpen ? 'open' : ''}`}>
                  <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-slate-50">
                    <p className="text-sm font-semibold text-slate-800">{profile?.full_name}</p>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>
                  </div>
                  <Link
                    href="/profile"
                    className="dropdown-item"
                    onClick={() => setProfileDropdownOpen(false)}
                  >
                    <User size={16} className="text-slate-400" />
                    <span>My Profile</span>
                  </Link>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false)
                      signOut()
                      router.push('/login')
                    }}
                    className="dropdown-item w-full text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut size={16} className="text-rose-500" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

              {/* Mobile hamburger */}
              <button
                onClick={() => { setMobileMenuOpen(prev => !prev); setActiveDropdown(null) }}
                className={`md:hidden p-2 hover:bg-slate-100 transition-all duration-300 text-slate-600 ${
                  scrolled ? 'rounded-full' : 'rounded-xl'
                }`}
              >
                {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop \u2014 clicks outside the panel close the menu */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden"
            onClick={() => { setMobileMenuOpen(false); setActiveDropdown(null) }}
          />
          {/* Panel \u2014 sibling to backdrop so touch events never reach it */}
          <div
            className={`fixed z-50 w-72 max-h-[calc(100vh-5rem)] bg-white shadow-2xl overflow-y-auto md:hidden transition-all duration-300 ${
              scrolled
                ? 'right-3 top-[3.75rem] rounded-3xl border border-slate-200/70'
                : 'right-0 top-16 rounded-bl-3xl'
            }`}
          >
            {/* Profile summary */}
            <div className="px-4 py-4 bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 flex items-center gap-3">
              <Avatar avatarUrl={profile?.avatar_url} name={profile?.full_name} email={user.email} size={40} className="ring-2 ring-white" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{profile?.full_name}</p>
                <p className={`text-[10px] px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${profile ? getRoleBadgeColor(profile.role, profile.is_non_teaching) : 'bg-slate-100 text-slate-600'}`}>
                  {profile ? getDisplayRole(profile) : '\u2026'}
                </p>
              </div>
            </div>

            <div className="p-3 space-y-0.5">
              {filteredNavItems.map((item) => (
                <div key={item.label}>
                  {item.children ? (
                    <>
                      <button
                        onClick={() => setActiveDropdown(activeDropdown === item.label ? null : item.label)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400">{item.icon}</span>
                          <span className="font-medium text-slate-700 text-sm">{item.label}</span>
                        </div>
                        <ChevronDown
                          size={15}
                          className={`text-slate-400 transition-transform ${activeDropdown === item.label ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {activeDropdown === item.label && (
                        <div className="ml-8 mt-0.5 space-y-0.5">
                          {item.children.map((child) => (
                            <Link
                              key={child.href}
                              href={child.href}
                              className="flex items-center gap-3 px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors text-sm"
                              onClick={() => { setMobileMenuOpen(false); setActiveDropdown(null) }}
                            >
                              <span className="text-slate-400">{child.icon}</span>
                              <span>{child.label}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                        isActive(item.href)
                          ? 'bg-mps-blue-50 text-mps-blue-600 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50 font-medium'
                      }`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <span className={isActive(item.href) ? 'text-mps-blue-500' : 'text-slate-400'}>{item.icon}</span>
                      {item.label}
                      {item.href === '/tasks' && taskUnreadCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full leading-none ml-auto">
                          {taskUnreadCount > 99 ? '99+' : taskUnreadCount}
                        </span>
                      )}
                      {item.href === '/announcements' && announcementUnreadCount > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-red-500 text-white rounded-full leading-none ml-auto">
                          {announcementUnreadCount > 99 ? '99+' : announcementUnreadCount}
                        </span>
                      )}
                    </Link>
                  )}
                </div>
              ))}

              <div className="border-t border-slate-100 pt-2 mt-2 space-y-0.5">
                <Link
                  href="/profile"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <User size={17} className="text-slate-400" />
                  My Profile
                </Link>
                <button
                  onClick={() => { setMobileMenuOpen(false); signOut(); router.push('/login') }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors text-sm font-medium"
                >
                  <LogOut size={17} className="text-rose-500" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
