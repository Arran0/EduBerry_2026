'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { LogIn, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import Navbar from '@/components/Navbar'

interface ProtectedLayoutProps {
  children: React.ReactNode
  staffOnly?: boolean
  adminOnly?: boolean
}

export default function ProtectedLayout({ children, staffOnly = false, adminOnly = false }: ProtectedLayoutProps) {
  const { user, profile, loading, sessionExpired } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Don't redirect while showing the session-expired overlay — the user
    // should see it and choose to sign in, rather than being silently bounced.
    if (!loading && !user && !sessionExpired) {
      router.push('/login')
    }
  }, [user, loading, router, sessionExpired])

  useEffect(() => {
    if (!loading && user && profile) {
      if (adminOnly && profile.role !== 'admin') {
        router.push('/home')
      } else if (staffOnly && !['teacher', 'coordinator', 'principal', 'admin'].includes(profile.role)) {
        router.push('/home')
      }
    }
  }, [user, profile, loading, staffOnly, adminOnly, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-mps-blue-100 via-slate-50 to-mps-green-100">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden shadow-xl ring-4 ring-white/80">
            <Image
              src="/logo.png"
              alt="MPS Logo"
              width={80}
              height={80}
              className="object-cover w-full h-full"
              priority
            />
          </div>
          <div className="spinner mx-auto mb-2" />
          <p className="text-slate-600 text-sm font-medium">Loading...</p>
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

  if (adminOnly && profile && profile.role !== 'admin') {
    return null
  }

  if (staffOnly && profile && !['teacher', 'coordinator', 'principal', 'admin'].includes(profile.role)) {
    return null
  }

  return (
    <>
      <Navbar />
      <main className="animate-fade-in">
        {children}
      </main>
      <footer className="mt-auto py-4 text-center text-xs text-slate-400 border-t border-slate-100 bg-white/60 backdrop-blur-sm">
        Built by <span className="font-medium text-slate-500">Your Company Name</span>
      </footer>
    </>
  )
}
