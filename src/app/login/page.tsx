'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Mail, Lock, AlertCircle, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'

// Pre-seeded to avoid SSR/hydration mismatch
const PARTICLES = [
  { id: 0,  left: 8,  size: 2,   duration: 13, delay: 0,   opacity: 0.3  },
  { id: 1,  left: 20, size: 1.5, duration: 16, delay: 2.5, opacity: 0.2  },
  { id: 2,  left: 33, size: 2.5, duration: 11, delay: 4,   opacity: 0.25 },
  { id: 3,  left: 47, size: 1,   duration: 19, delay: 1,   opacity: 0.15 },
  { id: 4,  left: 58, size: 2,   duration: 14, delay: 6.5, opacity: 0.22 },
  { id: 5,  left: 70, size: 1.5, duration: 17, delay: 3,   opacity: 0.28 },
  { id: 6,  left: 82, size: 3,   duration: 12, delay: 8,   opacity: 0.18 },
  { id: 7,  left: 92, size: 1,   duration: 15, delay: 5,   opacity: 0.3  },
  { id: 8,  left: 14, size: 2,   duration: 18, delay: 7,   opacity: 0.22 },
  { id: 9,  left: 40, size: 1.5, duration: 13, delay: 9.5, opacity: 0.2  },
  { id: 10, left: 62, size: 2,   duration: 16, delay: 1.5, opacity: 0.24 },
  { id: 11, left: 77, size: 1,   duration: 10, delay: 3.5, opacity: 0.16 },
  { id: 12, left: 26, size: 2,   duration: 14, delay: 11,  opacity: 0.2  },
  { id: 13, left: 52, size: 1.5, duration: 20, delay: 6,   opacity: 0.18 },
  { id: 14, left: 88, size: 2.5, duration: 13, delay: 4.5, opacity: 0.22 },
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
  const logoSrc       = branding.logoUrl || '/logo.png'

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
    // Outer container — background = right panel so rounded corners of left panel blend in
    <div
      className="min-h-screen flex relative"
      style={{ background: `linear-gradient(160deg, ${rightBgFrom} 0%, ${rightBgMid} 50%, ${rightBgTo} 100%)` }}
    >

      {/* ━━━ Left Brand Panel ━━━ */}
      <div
        className="hidden lg:flex lg:w-[42%] relative flex-col items-center justify-center overflow-hidden"
        style={{ background: `linear-gradient(160deg, ${c1} 0%, ${c3} 50%, ${c2} 100%)` }}
      >

        {/* ── Deep animated orbs ── */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 600, height: 600,
            top: -200, left: -200,
            background: `radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 65%)`,
            filter: 'blur(50px)',
          }}
          animate={{ x: [0, 35, -22, 0], y: [0, -45, 28, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 480, height: 480,
            bottom: -140, right: -140,
            background: `radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)`,
            filter: 'blur(50px)',
          }}
          animate={{ x: [0, -28, 18, 0], y: [0, 32, -22, 0] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── Slow-rotating aurora overlay ── */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `conic-gradient(from 0deg at 60% 40%,
              rgba(255,255,255,0.08) 0deg,
              transparent 80deg,
              rgba(255,255,255,0.06) 160deg,
              transparent 240deg,
              rgba(255,255,255,0.08) 320deg,
              transparent 360deg)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
        />

        {/* ── Dot grid ── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        {/* ── Decorative concentric rings ── */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {[500, 370, 240].map((size, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-white/[0.07]"
              style={{ width: size, height: size }}
              animate={{ scale: [1, 1.04, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 5 + i * 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.8 }}
            />
          ))}
        </div>

        {/* ── Floating particles ── */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {PARTICLES.map(p => (
            <motion.div
              key={p.id}
              className="absolute rounded-full bg-white"
              style={{ left: `${p.left}%`, bottom: -8, width: p.size, height: p.size }}
              animate={{ y: [0, -1100], opacity: [0, p.opacity, p.opacity * 0.8, 0] }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: 'linear',
                times: [0, 0.08, 0.92, 1],
              }}
            />
          ))}
        </div>

        {/* ── Scan line (sweeps top-to-bottom, repeats) ── */}
        <motion.div
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            height: 2,
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 30%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0.45) 70%, transparent 100%)',
            filter: 'blur(1px)',
          }}
          animate={{ top: ['-1%', '101%'] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear', repeatDelay: 4 }}
        />

        {/* ── Panel content ── */}
        <motion.div
          className="relative z-10 flex flex-col items-center text-white px-12 text-center"
          initial={{ opacity: 0, x: -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >

          {/* ── Logo with spinning gradient ring ── */}
          <div className="relative mb-7 flex items-center justify-center" style={{ width: 148, height: 148 }}>

            {/* Outer pulsing glow */}
            <motion.div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ background: 'rgba(255,255,255,0.22)', filter: 'blur(22px)', margin: '-10px' }}
              animate={{ opacity: [0.35, 0.75, 0.35], scale: [0.85, 1.1, 0.85] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Spinning conic-gradient border ring */}
            <motion.div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                background: `conic-gradient(
                  rgba(255,255,255,0.95) 0deg,
                  rgba(255,255,255,0.25) 90deg,
                  rgba(255,255,255,0.05) 150deg,
                  rgba(255,255,255,0.25) 210deg,
                  rgba(255,255,255,0.95) 270deg,
                  rgba(255,255,255,0.25) 330deg,
                  rgba(255,255,255,0.95) 360deg
                )`,
                padding: '3px',
                WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                WebkitMaskComposite: 'xor',
                maskComposite: 'exclude',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
            />

            {/* Inner static ring */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ border: '1.5px solid rgba(255,255,255,0.2)' }}
            />

            {/* Logo image */}
            <div
              className="relative z-10 rounded-full overflow-hidden"
              style={{
                width: 128, height: 128,
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              <Image
                src={logoSrc}
                alt={loginConfig.schoolName || 'School Logo'}
                width={128}
                height={128}
                className="object-cover w-full h-full rounded-full"
                unoptimized={logoSrc !== '/logo.png'}
              />
            </div>
          </div>

          {/* School name */}
          <motion.h1
            className="text-[1.85rem] font-display font-bold leading-tight mb-1"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.55 }}
          >
            {loginConfig.schoolName || branding.appTitle}
          </motion.h1>

          {/* Tagline */}
          {loginConfig.tagline && (
            <motion.p
              className="text-sm mb-6"
              style={{ color: 'rgba(255,255,255,0.65)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.5 }}
            >
              {loginConfig.tagline}
            </motion.p>
          )}

          {/* Welcome text */}
          {loginConfig.welcomeText && (
            <motion.h2
              className="text-base font-semibold mb-6"
              style={{ color: 'rgba(255,255,255,0.85)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.42, duration: 0.5 }}
            >
              {loginConfig.welcomeText}
            </motion.h2>
          )}

          {/* Feature list — spring stagger */}
          {loginConfig.features.length > 0 && (
            <ul className="space-y-3 text-left w-full max-w-[270px]">
              {loginConfig.features.map((feature, i) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-3 text-sm"
                  style={{ color: 'rgba(255,255,255,0.82)' }}
                  initial={{ opacity: 0, x: -22 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.5 + i * 0.12,
                    type: 'spring',
                    stiffness: 280,
                    damping: 22,
                  }}
                >
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.55 + i * 0.12, type: 'spring', stiffness: 400, damping: 18 }}
                  >
                    <CheckCircle2 size={15} style={{ color: 'rgba(255,255,255,0.65)', flexShrink: 0 }} />
                  </motion.span>
                  {feature}
                </motion.li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>

      {/* ━━━ True arc at the panel boundary (SVG overlay) ━━━ */}
      {/* Sits on the outer container, positioned at the 42% boundary */}
      <svg
        className="hidden lg:block absolute top-0 pointer-events-none select-none"
        style={{ left: 'calc(42% - 52px)', width: 104, height: '100%', zIndex: 10 }}
        viewBox="0 0 104 1000"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="arcPanelBg" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0%"   stopColor={rightBgFrom} />
            <stop offset="50%"  stopColor={rightBgMid}  />
            <stop offset="100%" stopColor={rightBgTo}   />
          </linearGradient>
        </defs>
        {/* Arc from top-right → curves 68px to the left at the midpoint → back to bottom-right */}
        <path d="M104,0 C36,200 36,800 104,1000 L104,0Z" fill="url(#arcPanelBg)" />
      </svg>

      {/* ━━━ Right Form Panel ━━━ */}
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
            <Image
              src={logoSrc}
              alt={loginConfig.schoolName || 'Logo'}
              width={64}
              height={64}
              className="object-cover w-full h-full rounded-full"
              unoptimized={logoSrc !== '/logo.png'}
            />
          </div>
          <h1 className="font-display font-bold text-lg text-gray-800">
            {loginConfig.schoolName || branding.appTitle}
          </h1>
          {loginConfig.tagline && (
            <p className="text-xs text-gray-500 mt-0.5">{loginConfig.tagline}</p>
          )}
        </motion.div>

        {/* Card entrance → then gentle float loop */}
        <motion.div
          className="w-full max-w-[440px]"
          initial={{ opacity: 0, y: 26, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            animate={{ y: [-5, 5, -5] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          >
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: '#ffffff',
                boxShadow: `0 10px 50px rgba(0,0,0,0.10), 0 3px 10px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)`,
              }}
            >
              {/* Top colour-matched accent line */}
              <div
                className="h-1"
                style={{ background: `linear-gradient(90deg, ${c1}, ${c3}, ${c2})` }}
              />

              <div className="px-8 pt-8 pb-8">

                {/* Card heading */}
                <motion.div
                  className="text-center mb-7"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22, duration: 0.5 }}
                >
                  <h2 className="text-[1.5rem] font-display font-bold text-gray-900">Welcome Back</h2>
                  <p className="text-sm text-gray-400 mt-1.5">Sign in to access your dashboard</p>
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
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.32, duration: 0.45 }}
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
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4, duration: 0.45 }}
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
                    transition={{ delay: 0.48, duration: 0.45 }}
                    className="pt-1"
                  >
                    <button
                      type="submit"
                      disabled={loading}
                      className="login-cta w-full relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.985]"
                      style={{
                        background: btnColor,
                        color: btnTextColor,
                        boxShadow: `0 4px 20px ${btnColor}50`,
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
        </motion.div>

        {/* Footer */}
        <motion.p
          className="mt-6 text-[11px] text-center text-gray-400 tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65 }}
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
