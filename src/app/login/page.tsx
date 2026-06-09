'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import MPSLogo from '@/components/MPSLogo'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, AlertCircle, Loader2, ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const { user, signIn, loading: authLoading } = useAuth()
  const { loginConfig, branding, brandingLoaded } = usePageConfig()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    if (user && !authLoading) router.push('/home')
  }, [user, authLoading, router])

  useEffect(() => {
    if (sessionStorage.getItem('session_expired')) {
      sessionStorage.removeItem('session_expired')
      setSessionExpired(true)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
    } catch { setError('An unexpected error occurred') }
    finally { setLoading(false) }
  }

  const panelGrad = `linear-gradient(160deg, ${loginConfig.gradientFrom}, ${loginConfig.gradientMid}, ${loginConfig.gradientTo})`
  const primaryColor = loginConfig.gradientFrom ?? '#0ea5e9'

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full overflow-hidden shadow ring-2 ring-slate-100">
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="spinner mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">

      {/* ══════════════════════════════════════ */}
      {/* LEFT — Brand panel                     */}
      {/* ══════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[42%] xl:w-[38%] relative flex-col items-center justify-center px-14 xl:px-20"
        style={{ background: panelGrad }}
      >
        <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full translate-x-1/3 translate-y-1/3"
          style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="absolute top-0 left-0 w-48 h-48 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ background: 'rgba(255,255,255,0.08)' }} />

        {loginConfig.bgImageUrl && (
          <div className="absolute inset-0">
            <img src={loginConfig.bgImageUrl} alt="" className="w-full h-full object-cover opacity-20" />
          </div>
        )}

        <motion.div
          className="relative z-10 flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-8 drop-shadow-xl">
            <MPSLogo size="lg" withRipple src={branding.logoUrl || undefined} />
          </div>

          <h1 className="text-white font-display font-bold text-[1.9rem] xl:text-[2.2rem] leading-tight tracking-tight mb-3">
            {loginConfig.schoolName}
          </h1>

          <div className="w-10 h-[2px] rounded-full bg-white/30 mb-4" />

          <p className="text-white/55 text-xs uppercase tracking-[0.25em] font-medium">
            {loginConfig.tagline}
          </p>
        </motion.div>

        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
          <span className="text-white/30 text-[10px] tracking-widest uppercase">
            {branding.appTitle}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════ */}
      {/* RIGHT — Sign-in form                   */}
      {/* ══════════════════════════════════════ */}
      <div className="flex-1 flex flex-col bg-white">
        <div className="flex-1 flex items-center justify-center px-8 sm:px-14 py-10">
          <motion.div
            className="w-full max-w-[360px]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
          >
            {/* Mobile branding */}
            <div className="lg:hidden flex items-center gap-3 mb-10">
              <MPSLogo size="sm" src={branding.logoUrl || undefined} />
              <div>
                <p className="font-display text-base font-bold text-slate-800">{branding.appTitle}</p>
                <p className="text-[11px] text-slate-400">{branding.appSubtitle}</p>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-[1.75rem] font-display font-bold text-slate-900 leading-tight">
                Sign in
              </h2>
              <p className="text-slate-400 text-sm mt-1.5">
                Welcome back to {branding.appTitle}
              </p>
            </div>

            {/* Alerts */}
            <AnimatePresence>
              {sessionExpired && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="flex items-start gap-2.5 p-3.5 mb-6 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  <span className="text-xs leading-relaxed">Your session expired. Please sign in again.</span>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="flex items-start gap-2.5 p-3.5 mb-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  <span className="text-xs leading-relaxed">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <SleekInput
                label="Email" icon={<Mail size={15} />} type="email"
                value={email} onChange={setEmail}
                placeholder="your@email.com" required
                primaryColor={primaryColor}
              />

              <SleekInput
                label="Password" icon={<Lock size={15} />}
                type={showPassword ? 'text' : 'password'}
                value={password} onChange={setPassword}
                placeholder="••••••••" required
                primaryColor={primaryColor}
                suffix={
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99]"
                style={{ background: primaryColor }}
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" />Signing in…</>
                  : <>Sign In <ArrowRight size={15} /></>
                }
              </button>
            </form>
          </motion.div>
        </div>

        <p className="text-center text-slate-300 text-[11px] pb-6">
          © {new Date().getFullYear()} {loginConfig.schoolName}
        </p>
      </div>
    </div>
  )
}

function SleekInput({
  label, icon, type, value, onChange, placeholder, required, suffix, primaryColor,
}: {
  label: string
  icon: React.ReactNode
  type: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  required?: boolean
  suffix?: React.ReactNode
  primaryColor: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      <div className="relative rounded-xl transition-all duration-200"
        style={{ boxShadow: focused ? `0 0 0 2px ${primaryColor}30` : undefined }}>
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          {icon}
        </div>
        <input
          type={type} value={value} onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={placeholder} required={required}
          className="w-full pl-10 pr-10 py-3 border rounded-xl text-sm text-slate-800 placeholder:text-slate-400 bg-slate-50/70 focus:bg-white focus:outline-none transition-all duration-200"
          style={{ borderColor: focused ? primaryColor : '#e2e8f0' }}
        />
        {suffix}
      </div>
    </div>
  )
}
