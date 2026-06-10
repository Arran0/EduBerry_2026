'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import MPSLogo from '@/components/MPSLogo'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, AlertCircle, Loader2, ArrowRight } from 'lucide-react'

// Pre-seeded to avoid SSR/hydration mismatch
const PARTICLES = [
  { id: 0,  left: 7,  size: 2,   duration: 13, delay: 0,   opacity: 0.35, primary: true  },
  { id: 1,  left: 15, size: 1.5, duration: 16, delay: 2.5, opacity: 0.2,  primary: false },
  { id: 2,  left: 23, size: 2.5, duration: 11, delay: 4,   opacity: 0.3,  primary: true  },
  { id: 3,  left: 31, size: 1,   duration: 19, delay: 1,   opacity: 0.15, primary: false },
  { id: 4,  left: 40, size: 2,   duration: 14, delay: 6.5, opacity: 0.25, primary: true  },
  { id: 5,  left: 48, size: 1.5, duration: 17, delay: 3,   opacity: 0.3,  primary: false },
  { id: 6,  left: 57, size: 3,   duration: 12, delay: 8,   opacity: 0.2,  primary: true  },
  { id: 7,  left: 64, size: 1,   duration: 15, delay: 5,   opacity: 0.35, primary: false },
  { id: 8,  left: 72, size: 2,   duration: 18, delay: 7,   opacity: 0.25, primary: true  },
  { id: 9,  left: 80, size: 1.5, duration: 13, delay: 9.5, opacity: 0.2,  primary: false },
  { id: 10, left: 88, size: 2,   duration: 16, delay: 1.5, opacity: 0.3,  primary: true  },
  { id: 11, left: 94, size: 1,   duration: 10, delay: 3.5, opacity: 0.15, primary: false },
  { id: 12, left: 12, size: 2.5, duration: 14, delay: 5.5, opacity: 0.3,  primary: false },
  { id: 13, left: 36, size: 1.5, duration: 17, delay: 2,   opacity: 0.2,  primary: true  },
  { id: 14, left: 60, size: 2,   duration: 12, delay: 7.5, opacity: 0.35, primary: false },
  { id: 15, left: 76, size: 1,   duration: 20, delay: 4.5, opacity: 0.2,  primary: true  },
]

export default function LoginPage() {
  const { user, signIn, loading: authLoading } = useAuth()
  const { loginConfig, branding, brandingLoaded } = usePageConfig()
  const router = useRouter()

  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
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
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const c1 = loginConfig.gradientFrom ?? '#0ea5e9'
  const c2 = loginConfig.gradientTo   ?? '#22c55e'
  const c3 = loginConfig.gradientMid  ?? '#6366f1'

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#030712' }}>
        <div className="flex flex-col items-center gap-4">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-white/10">
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="spinner" style={{ borderTopColor: c1 }} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-12"
      style={{ background: '#030712' }}
    >

      {/* ── Animated gradient orbs ── */}
      <motion.div
        className="absolute rounded-full pointer-events-none select-none"
        style={{
          width: 720, height: 720,
          top: -260, left: -180,
          background: `radial-gradient(circle, ${c1}55 0%, transparent 68%)`,
          filter: 'blur(72px)',
        }}
        animate={{ x: [0, 50, -25, 0], y: [0, -55, 35, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full pointer-events-none select-none"
        style={{
          width: 620, height: 620,
          bottom: -200, right: -160,
          background: `radial-gradient(circle, ${c2}45 0%, transparent 68%)`,
          filter: 'blur(72px)',
        }}
        animate={{ x: [0, -45, 22, 0], y: [0, 45, -35, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute rounded-full pointer-events-none select-none"
        style={{
          width: 420, height: 420,
          top: '38%', left: '52%',
          marginLeft: -210, marginTop: -210,
          background: `radial-gradient(circle, ${c3}30 0%, transparent 68%)`,
          filter: 'blur(90px)',
        }}
        animate={{ scale: [1, 1.35, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ── Dot-grid overlay ── */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* ── Floating particles ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        {PARTICLES.map(p => (
          <motion.div
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.left}%`,
              bottom: -12,
              width: p.size,
              height: p.size,
              background: p.primary ? c1 : c2,
            }}
            animate={{
              y: [0, -1300],
              opacity: [0, p.opacity, p.opacity * 0.9, 0],
            }}
            transition={{
              duration: p.duration,
              delay: p.delay,
              repeat: Infinity,
              ease: 'linear',
              times: [0, 0.12, 0.88, 1],
            }}
          />
        ))}
      </div>

      {/* ── Main card ── */}
      <motion.div
        className="relative z-10 w-full max-w-[420px]"
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Gradient border layer */}
        <div
          className="absolute -inset-px rounded-2xl"
          style={{
            background: `linear-gradient(140deg, ${c1}80 0%, ${c3}40 45%, ${c2}70 100%)`,
          }}
        />

        {/* Card body */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(5, 10, 26, 0.90)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
          }}
        >
          {/* Top accent line */}
          <div
            className="h-[2px]"
            style={{
              background: `linear-gradient(90deg, transparent, ${c1} 30%, ${c2} 70%, transparent)`,
            }}
          />

          <div className="px-9 pt-8 pb-7">

            {/* ─ Logo & branding ─ */}
            <motion.div
              className="flex flex-col items-center mb-8"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.18 }}
            >
              <div className="relative mb-4">
                {/* Pulsing glow behind logo */}
                <motion.div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    background: `radial-gradient(circle, ${c1}60, transparent 70%)`,
                    filter: 'blur(18px)',
                    margin: '-8px',
                  }}
                  animate={{ opacity: [0.45, 0.9, 0.45], scale: [0.85, 1.15, 0.85] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                />
                <MPSLogo size="lg" withRipple src={branding.logoUrl || undefined} />
              </div>

              <h1 className="text-white font-display font-bold text-[1.15rem] text-center leading-snug">
                {loginConfig.schoolName || branding.appTitle}
              </h1>
              {loginConfig.tagline && (
                <p
                  className="text-[10px] font-semibold tracking-[0.24em] uppercase mt-1.5"
                  style={{ color: `${c1}90` }}
                >
                  {loginConfig.tagline}
                </p>
              )}
            </motion.div>

            {/* ─ Divider ─ */}
            <motion.div
              className="flex items-center gap-3 mb-7"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32 }}
            >
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <span
                className="text-[9px] font-bold tracking-[0.3em]"
                style={{ color: 'rgba(255,255,255,0.22)' }}
              >
                SIGN IN
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </motion.div>

            {/* ─ Alerts ─ */}
            <AnimatePresence>
              {sessionExpired && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden mb-5"
                >
                  <div
                    className="flex items-start gap-2.5 p-3.5 rounded-xl text-amber-300"
                    style={{
                      background: 'rgba(251,191,36,0.07)',
                      border: '1px solid rgba(251,191,36,0.18)',
                    }}
                  >
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5 opacity-80" />
                    <span className="text-xs leading-relaxed opacity-90">
                      Your session expired. Please sign in again.
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden mb-5"
                >
                  <div
                    className="flex items-start gap-2.5 p-3.5 rounded-xl text-rose-300"
                    style={{
                      background: 'rgba(244,63,94,0.08)',
                      border: '1px solid rgba(244,63,94,0.2)',
                    }}
                  >
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5 opacity-80" />
                    <span className="text-xs leading-relaxed opacity-90">{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ─ Form ─ */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.42, delay: 0.38 }}
              >
                <DarkInput
                  label="Email address"
                  icon={<Mail size={13} />}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="your@email.com"
                  required
                  primaryColor={c1}
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.42, delay: 0.46 }}
              >
                <DarkInput
                  label="Password"
                  icon={<Lock size={13} />}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  required
                  primaryColor={c1}
                  suffix={
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200"
                      style={{ color: 'rgba(255,255,255,0.25)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
                    >
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  }
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, delay: 0.55 }}
                className="pt-1"
              >
                <button
                  type="submit"
                  disabled={loading}
                  className="login-cta w-full relative overflow-hidden flex items-center justify-center gap-2 py-[13px] rounded-xl text-white text-sm font-semibold transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.985]"
                  style={{
                    background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
                    boxShadow: `0 4px 28px ${c1}35`,
                  }}
                >
                  {/* Shimmer layer */}
                  <span className="login-cta-shimmer absolute inset-0 pointer-events-none" />
                  {loading ? (
                    <>
                      <Loader2 size={14} className="animate-spin relative z-10" />
                      <span className="relative z-10">Signing in…</span>
                    </>
                  ) : (
                    <>
                      <span className="relative z-10">Sign In</span>
                      <ArrowRight size={13} className="login-cta-arrow relative z-10" />
                    </>
                  )}
                </button>
              </motion.div>
            </form>
          </div>

          {/* Footer */}
          <div className="pb-6 text-center">
            <span
              className="text-[10px] tracking-[0.22em] uppercase"
              style={{ color: 'rgba(255,255,255,0.14)' }}
            >
              © {new Date().getFullYear()} {loginConfig.schoolName || branding.appTitle}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Dark-themed input field
// ─────────────────────────────────────────────────────────
function DarkInput({
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
      <label
        className="block text-[10px] font-bold mb-1.5 uppercase tracking-[0.2em]"
        style={{ color: focused ? `${primaryColor}bb` : 'rgba(255,255,255,0.3)' }}
      >
        {label}
      </label>
      <div
        className="relative rounded-xl transition-all duration-200"
        style={{
          background: focused ? 'rgba(255,255,255,0.065)' : 'rgba(255,255,255,0.032)',
          border: `1px solid ${focused ? primaryColor + '55' : 'rgba(255,255,255,0.075)'}`,
          boxShadow: focused ? `0 0 0 3px ${primaryColor}14` : 'none',
        }}
      >
        <div
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? primaryColor : 'rgba(255,255,255,0.22)' }}
        >
          {icon}
        </div>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          required={required}
          className="w-full pl-10 pr-10 py-3 text-sm bg-transparent focus:outline-none"
          style={{ color: 'rgba(255,255,255,0.9)' }}
        />
        {suffix}
      </div>
    </div>
  )
}
