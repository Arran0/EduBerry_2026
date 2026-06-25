'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { LogIn, Clock, LogOut, MonitorPlay, Home, Megaphone } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'

interface SmartboardLayoutProps {
  children: React.ReactNode
}

/**
 * Dashboard-only shell for smart board accounts. Like DriverLayout it renders
 * NO app Navbar — a board only ever sees its own dashboard. A slim header
 * carries the logo, the board's homeroom name, and sign-out.
 *
 * Access rules:
 *   • Not signed in            → /login (unless showing the session-expired overlay)
 *   • Signed in, not smartboard → /home (this layout is smartboard-only)
 * The complementary guard in ProtectedLayout bounces boards OUT of normal
 * pages, so the two together keep each audience in its own area.
 */
export default function SmartboardLayout({ children }: SmartboardLayoutProps) {
  const { user, profile, loading, sessionExpired, dataRefreshKey, signOut } = useAuth()
  const { branding, brandingLoaded, loginConfig } = usePageConfig()
  const router = useRouter()
  const pathname = usePathname()

  // Permanent smart-board nav. Home is the dashboard; Announcement lists the
  // homeroom's notices. Active when the path is the item's route (Home also
  // covers classroom pages, which open inside this same board shell).
  const navItems = [
    { label: 'Home', href: '/smartboard', icon: Home, active: pathname === '/smartboard' || pathname.startsWith('/classrooms') },
    { label: 'Announcement', href: '/announcements', icon: Megaphone, active: pathname.startsWith('/announcements') },
  ]

  useEffect(() => {
    if (!loading && !user && !sessionExpired) {
      router.push('/login')
    }
  }, [user, loading, router, sessionExpired])

  useEffect(() => {
    if (!loading && user && profile && profile.role !== 'smartboard') {
      router.push('/home')
    }
  }, [user, profile, loading, router])

  if (loading) {
    const bgStyle = brandingLoaded
      ? { background: `linear-gradient(135deg, ${loginConfig.pageBgFrom}, ${loginConfig.pageBgMid}, ${loginConfig.pageBgTo})` }
      : { background: '#ffffff' }
    return (
      <div className="min-h-screen flex items-center justify-center" style={bgStyle}>
        <div className="text-center">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden shadow-xl ring-4 ring-white/80">
              <img src={branding.logoUrl} alt="Logo" className="object-cover w-full h-full" />
            </div>
          )}
          <div className="spinner mx-auto mb-2" />
        </div>
      </div>
    )
  }

  if (!user) {
    if (sessionExpired) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-50 flex items-center justify-center">
              <Clock size={32} className="text-amber-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Session Expired</h2>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              Your session has timed out due to inactivity. Please sign in again to continue.
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold py-3 px-6 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <LogIn size={18} />
              Sign in again
            </button>
          </div>
        </div>
      )
    }
    return null
  }

  // A non-board briefly here before the redirect effect fires — render nothing.
  if (profile && profile.role !== 'smartboard') {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Slim board header (no app Navbar) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-600 flex-shrink-0">
              {branding.logoUrl
                ? <img src={branding.logoUrl} alt="Logo" className="object-cover w-full h-full" />
                : <MonitorPlay size={18} className="text-white" />}
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="text-sm font-semibold text-slate-800 truncate leading-tight">
                {profile?.full_name ?? 'Smart Board'}
              </p>
              <p className="text-[11px] text-slate-400 leading-tight">Smart Board</p>
            </div>
          </div>

          {/* Permanent nav: Home · Announcement */}
          <nav className="flex items-center gap-1">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    item.active
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={16} /> <span className="hidden xs:inline sm:inline">{item.label}</span>
                </Link>
              )
            })}
          </nav>

          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-rose-600 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors"
          >
            <LogOut size={15} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* key remounts page content after a long background period (matches ProtectedLayout) */}
      <main key={dataRefreshKey} className="max-w-6xl mx-auto">
        {children}
      </main>
    </div>
  )
}
