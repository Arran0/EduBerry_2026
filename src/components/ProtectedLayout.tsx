'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import Navbar from '@/components/Navbar'
import BottomNav from '@/components/BottomNav'

interface ProtectedLayoutProps {
  children: React.ReactNode
  staffOnly?: boolean
  adminOnly?: boolean
}

export default function ProtectedLayout({ children, staffOnly = false, adminOnly = false }: ProtectedLayoutProps) {
  const { user, profile, loading, sessionExpired, dataRefreshKey } = useAuth()
  const { branding, brandingLoaded, loginConfig } = usePageConfig()
  const router = useRouter()

  // When the user returns to this tab after ≥ 30 s away, call router.refresh()
  // so that Next.js re-fetches the current page's RSC payload on a fresh HTTP
  // connection.  This pre-warms the Vercel function and re-establishes any
  // connections that the server may have closed during the idle period,
  // preventing subsequent page navigations from hanging on dead connections.
  useEffect(() => {
    let hiddenAt: number | null = null
    const REFRESH_THRESHOLD_MS = 30_000

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= REFRESH_THRESHOLD_MS) {
          router.refresh()
        }
        hiddenAt = null
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [router])

  useEffect(() => {
    // Don't redirect while showing the session-expired overlay — the user
    // should see it and choose to sign in, rather than being silently bounced.
    if (!loading && !user && !sessionExpired) {
      router.push('/login')
    }
  }, [user, loading, router, sessionExpired])

  useEffect(() => {
    if (!loading && user && profile) {
      // Drivers have a dashboard-only experience — keep them out of the normal
      // app entirely. Every normal page renders inside ProtectedLayout, so this
      // single guard covers /home, /tasks, /academics, /more/*, etc.
      if (profile.role === 'driver') {
        router.push('/driver')
      } else if (adminOnly && profile.role !== 'admin') {
        router.push('/home')
      } else if (staffOnly && !['teacher', 'coordinator', 'principal', 'admin'].includes(profile.role)) {
        router.push('/home')
      }
    }
  }, [user, profile, loading, staffOnly, adminOnly, router])

  if (loading) {
    const bgStyle = brandingLoaded
      ? { background: `linear-gradient(135deg, ${loginConfig.pageBgFrom}, ${loginConfig.pageBgMid}, ${loginConfig.pageBgTo})` }
      : { background: '#ffffff' }
    return (
      <div className="min-h-screen flex items-center justify-center" style={bgStyle}>
        <div className="text-center">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden shadow-xl ring-4 ring-white/80">
              <img
                src={branding.logoUrl}
                alt="Logo"
                className="object-cover w-full h-full"
              />
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
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold py-3 px-6 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-md"
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

  // Drivers are redirected to /driver by the effect above — don't flash normal
  // app content (with Navbar) in the meantime.
  if (profile && profile.role === 'driver') {
    return null
  }

  if (adminOnly && profile && profile.role !== 'admin') {
    return null
  }

  if (staffOnly && profile && !['teacher', 'coordinator', 'principal', 'admin'].includes(profile.role)) {
    return null
  }

  return (
    <>
      <Navbar />
      {/*
        key={dataRefreshKey} remounts all page content whenever the tab returns
        from a background period longer than STALE_THRESHOLD_MS (2 min).
        Remounting causes every page's useEffect data-fetches to re-run,
        pulling fresh data from Supabase without a hard refresh.
        The Navbar is intentionally outside the key so it is not disrupted.
      */}
      <main key={dataRefreshKey} className="md:pb-0" style={{ paddingBottom: 'max(4rem, calc(3.5rem + env(safe-area-inset-bottom)))' }}>
        {children}
      </main>
      <BottomNav />
    </>
  )
}
