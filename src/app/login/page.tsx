'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import MPSLogo from '@/components/MPSLogo'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, AlertCircle, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'

// Pre-seeded to avoid SSR/hydration mismatch
const PARTICLES = [
  { id: 0,  left: 8,  size: 2,   duration: 13, delay: 0,   opacity: 0.28, primary: true  },
  { id: 1,  left: 20, size: 1.5, duration: 16, delay: 2.5, opacity: 0.18, primary: false },
  { id: 2,  left: 33, size: 2.5, duration: 11, delay: 4,   opacity: 0.22, primary: true  },
  { id: 3,  left: 47, size: 1,   duration: 19, delay: 1,   opacity: 0.14, primary: false },
  { id: 4,  left: 58, size: 2,   duration: 14, delay: 6.5, opacity: 0.2,  primary: true  },
  { id: 5,  left: 70, size: 1.5, duration: 17, delay: 3,   opacity: 0.24, primary: false },
  { id: 6,  left: 82, size: 3,   duration: 12, delay: 8,   opacity: 0.16, primary: true  },
  { id: 7,  left: 91, size: 1,   duration: 15, delay: 5,   opacity: 0.28, primary: false },
  { id: 8,  left: 14, size: 2,   duration: 18, delay: 7,   opacity: 0.2,  primary: true  },
  { id: 9,  left: 40, size: 1.5, duration: 13, delay: 9.5, opacity: 0.18, primary: false },
  { id: 10, left: 62, size: 2,   duration: 16, delay: 1.5, opacity: 0.22, primary: true  },
  { id: 11, left: 77, size: 1,   duration: 10, delay: 3.5, opacity: 0.14, primary: false },
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

  const c1 = loginConfig.gradientFrom    ?? '#0ea5e9'
  const c2 = loginConfig.gradientTo      ?? '#22c55e'
  const c3 = loginConfig.gradientMid     ?? '#0284c7'
  const btnColor      = loginConfig.buttonColor     ?? c1
  const btnTextColor  = loginConfig.buttonTextColor ?? '#ffffff'
  const rightBgFrom   = loginConfig.pageBgFrom ?? '#f0f9ff'
  const rightBgMid    = loginConfig.pageBgMid  ?? '#f5f3ff'
  const rightBgTo     = loginConfig.pageBgTo   ?? '#f0fdf4'

  if (authLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: `linear-gradient(160deg, ${rightBgFrom}, ${rightBgTo})` }}
      >
        <div className="flex flex-col items-center gap-4">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-black/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="spinner" style={{ borderTopColor: c1 }} />
        </div>
      </div>
    )
  }

  return (
    // Outer container — its background shows through the left panel's rounded corner
    <div
      className="min-h-screen flex"
      style={{ background: `linear-gradient(160deg, ${rightBgFrom} 0%, ${rightBgMid} 50%, ${rightBgTo} 100%)` }}
    >

      {/* ── Left Brand Panel ── */}
      <div
        className="hidden lg:flex lg:w-[42%] relative flex-col items-center justify-center overflow-hidden"
        style={{
          background: `linear-gradient(160deg, ${c1} 0%, ${c3} 50%, ${c2} 100%)`,
          borderRadius: '0 2.5rem 2.5rem 0',
        }}
      >
        {/* Background animated orbs */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 560, height: 560,
            top: -160, left: -160,
            background: `radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 65%)`,
            filter: 'blur(40px)',
          }}
          animate={{ x: [0, 28, -18, 0], y: [0, -38, 22, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 440, height: 440,
            bottom: -120, right: -120,
            background: `radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 65%)`,
            filter: 'blur(40px)',
          }}
          animate={{ x: [0, -22, 14, 0], y: [0, 28, -18, 0] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Decorative rings */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center" style={{ opacity: 0.1 }}>
          <div className="absolute w-[480px] h-[480px] rounded-full border border-white" />
          <div className="absolute w-[340px] h-[340px] rounded-full border border-white" />
        </div>

        {/* Dot grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.09) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {PARTICLES.map(p => (
            <motion.div
              key={p.id}
              className="absolute rounded-full bg-white"
              style={{ left: `${p.left}%`, bottom: -8, width: p.size, height: p.size }}
              animate={{ y: [0, -1000], opacity: [0, p.opacity, p.opacity * 0.8, 0] }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'linear',
                times: [0, 0.1, 0.9, 1],
              }}
            />
          ))}
        </div>

        {/* Panel content */}
        <motion.div
          className="relative z-10 flex flex-col items-center text-white px-12 text-center"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Logo circle */}
          <div className="relative mb-7">
            <motion.div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ background: 'rgba(255,255,255,0.2)', margin: '-8px', filter: 'blur(16px)' }}
              animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.88, 1.12, 0.88] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.35)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <MPSLogo size="md" src={branding.logoUrl || undefined} />
            </div>
          </div>

          <h1 className="text-[1.8rem] font-display font-bold leading-tight mb-1">
            {loginConfig.schoolName || branding.appTitle}
          </h1>
          {loginConfig.tagline && (
            <p className="text-white/65 text-sm mb-6">{loginConfig.tagline}</p>
          )}

          {loginConfig.welcomeText && (
            <h2 className="text-base font-semibold mb-6 text-white/85">{loginConfig.welcomeText}</h2>
          )}

          {loginConfig.features.length > 0 && (
            <ul className="space-y-3 text-left w-full max-w-[270px]">
              {loginConfig.features.map((feature, i) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-2.5 text-white/80 text-sm"
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + i * 0.1, duration: 0.45 }}
                >
                  <CheckCircle2 size={15} className="flex-shrink-0 text-white/60" />
                  {feature}
                </motion.li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>

      {/* ── Right Form Panel ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 min-h-screen">

        {/* Mobile-only: compact branding strip */}
        <motion.div
          className="lg:hidden flex flex-col items-center mb-8"
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden mb-3"
            style={{
              background: `linear-gradient(135deg, ${c1}25, ${c2}25)`,
              border: `2px solid ${c1}40`,
            }}
          >
            <MPSLogo size="sm" src={branding.logoUrl || undefined} />
          </div>
          <h1 className="font-display font-bold text-lg text-gray-800">
            {loginConfig.schoolName || branding.appTitle}
          </h1>
          {loginConfig.tagline && (
            <p className="text-xs text-gray-500 mt-0.5">{loginConfig.tagline}</p>
          )}
        </motion.div>

        {/* Login Card */}
        <motion.div
          className="w-full max-w-[440px]"
          initial={{ opacity: 0, y: 22, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: '#ffffff',
              boxShadow: '0 8px 40px rgba(0,0,0,0.09), 0 2px 8px rgba(0,0,0,0.05)',
            }}
          >
            {/* Top accent line */}
            <div
              className="h-1"
              style={{ background: `linear-gradient(90deg, ${c1}, ${c3}, ${c2})` }}
            />

            <div className="px-8 pt-8 pb-8">
              {/* Card header */}
              <motion.div
                className="text-center mb-7"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className="text-2xl font-display font-bold text-gray-900">Welcome Back</h2>
                <p className="text-sm text-gray-500 mt-1.5">Sign in to access your dashboard</p>
              </motion.div>

              {/* Alerts */}
              <AnimatePresence>
                {sessionExpired && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mb-4"
                  >
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl text-amber-700 bg-amber-50 border border-amber-200">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <span className="text-xs leading-relaxed">Your session expired. Please sign in again.</span>
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
                    className="overflow-hidden mb-4"
                  >
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl text-rose-700 bg-rose-50 border border-rose-200">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <span className="text-xs leading-relaxed">{error}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <LightInput
                    label="Email Address"
                    icon={<Mail size={15} />}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="Enter your email"
                    required
                    accentColor={c1}
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.38 }}
                >
                  <LightInput
                    label="Password"
                    icon={<Lock size={15} />}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={setPassword}
                    placeholder="Enter your password"
                    required
                    accentColor={c1}
                    suffix={
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(s => !s)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    }
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.46 }}
                  className="pt-1"
                >
                  <button
                    type="submit"
                    disabled={loading}
                    className="login-cta w-full relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.985]"
                    style={{
                      background: btnColor,
                      color: btnTextColor,
                      boxShadow: `0 4px 18px ${btnColor}45`,
                    }}
                  >
                    <span className="login-cta-shimmer absolute inset-0 pointer-events-none" />
                    {loading ? (
                      <>
                        <Loader2 size={15} className="animate-spin relative z-10" />
                        <span className="relative z-10">Signing in…</span>
                      </>
                    ) : (
                      <>
                        <span className="relative z-10">Sign In</span>
                        <ArrowRight size={14} className="login-cta-arrow relative z-10" />
                      </>
                    )}
                  </button>
                </motion.div>
              </form>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.p
          className="mt-6 text-[11px] text-center text-gray-400 tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          © {new Date().getFullYear()} {loginConfig.schoolName || branding.appTitle}
        </motion.p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Light-themed input field
// ─────────────────────────────────────────────────────────
function LightInput({
  label, icon, type, value, onChange, placeholder, required, suffix, accentColor,
}: {
  label: string
  icon: React.ReactNode
  type: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  required?: boolean
  suffix?: React.ReactNode
  accentColor: string
}) {
  const [focused, setFocused] = useState(false)

  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 text-gray-600">{label}</label>
      <div
        className="relative rounded-xl transition-all duration-200"
        style={{
          background: focused ? '#fafafa' : '#f7f7f8',
          border: `1.5px solid ${focused ? accentColor + '80' : '#e5e7eb'}`,
          boxShadow: focused ? `0 0 0 3px ${accentColor}18` : 'none',
        }}
      >
        <div
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? accentColor : '#9ca3af' }}
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
          className="w-full pl-10 pr-10 py-3 text-sm bg-transparent focus:outline-none text-gray-800 placeholder:text-gray-400"
        />
        {suffix}
      </div>
    </div>
  )
}
