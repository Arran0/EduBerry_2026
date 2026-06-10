'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import Image from 'next/image'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
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

// Convex arc: right edge of the panel is an ellipse arc centered on the left
// edge — widest at vertical center, tapering toward top and bottom corners
const PANEL_CLIP = 'ellipse(100% 85% at 0% 50%)'

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

  // ── Mouse parallax (-1..1, spring-smoothed) ──
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 45, damping: 18 })
  const sy = useSpring(my, { stiffness: 45, damping: 18 })
  const orb1x  = useTransform(sx, (v: number) => v * 30)
  const orb1y  = useTransform(sy, (v: number) => v * 22)
  const orb2x  = useTransform(sx, (v: number) => v * -24)
  const orb2y  = useTransform(sy, (v: number) => v * -18)
  const logoX  = useTransform(sx, (v: number) => v * 10)
  const logoY  = useTransform(sy, (v: number) => v * 8)
  const tiltX  = useTransform(sy, (v: number) => v * -3.5)
  const tiltY  = useTransform(sx, (v: number) => v * 3.5)

  const handleMouseMove = (e: React.MouseEvent) => {
    mx.set((e.clientX / window.innerWidth) * 2 - 1)
    my.set((e.clientY / window.innerHeight) * 2 - 1)
  }

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
  const schoolName    = loginConfig.schoolName || branding.appTitle

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
    // Outer container — background = right panel; left panel is clipped convex on top of it
    <div
      className="min-h-screen flex relative"
      style={{ background: `linear-gradient(160deg, ${rightBgFrom} 0%, ${rightBgMid} 50%, ${rightBgTo} 100%)` }}
      onMouseMove={handleMouseMove}
    >

      {/* ━━━ Left Brand Panel — convex arched right edge ━━━ */}
      <div
        className="hidden lg:flex lg:w-[45%] relative flex-col items-center justify-center"
        style={{
          background: `linear-gradient(160deg, ${c1} 0%, ${c3} 50%, ${c2} 100%)`,
          clipPath: PANEL_CLIP,
          WebkitClipPath: PANEL_CLIP,
        }}
      >

        {/* ── Deep animated orbs (mouse parallax) ── */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 600, height: 600,
            top: -200, left: -200,
            background: `radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 65%)`,
            filter: 'blur(50px)',
            x: orb1x, y: orb1y,
          }}
        />
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 480, height: 480,
            bottom: -140, right: -100,
            background: `radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)`,
            filter: 'blur(50px)',
            x: orb2x, y: orb2y,
          }}
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
          {[520, 390, 260].map((size, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border border-white/[0.08]"
              style={{ width: size, height: size }}
              animate={{ scale: [1, 1.04, 1], opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 5 + i * 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.8 }}
            />
          ))}
        </div>

        {/* ── Floating particles (clipped by the arc) ── */}
        <div className="absolute inset-0 pointer-events-none">
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
          className="relative z-10 flex flex-col items-center text-white px-14 text-center"
          initial={{ opacity: 0, x: -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >

          {/* ── Logo: glow + spinning ring + orbiting satellites (parallax) ── */}
          <motion.div
            className="relative mb-7 flex items-center justify-center"
            style={{ width: 148, height: 148, x: logoX, y: logoY }}
          >

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

            {/* Orbiting satellite dots */}
            <motion.div
              className="absolute pointer-events-none"
              style={{ inset: -10 }}
              animate={{ rotate: 360 }}
              transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
            >
              <div
                className="absolute rounded-full bg-white"
                style={{
                  width: 7, height: 7, top: -3, left: '50%', marginLeft: -3.5,
                  boxShadow: '0 0 10px rgba(255,255,255,0.9), 0 0 22px rgba(255,255,255,0.45)',
                }}
              />
            </motion.div>
            <motion.div
              className="absolute pointer-events-none"
              style={{ inset: -22 }}
              animate={{ rotate: -360 }}
              transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
            >
              <div
                className="absolute rounded-full bg-white/80"
                style={{
                  width: 4.5, height: 4.5, top: '50%', right: -2, marginTop: -2.25,
                  boxShadow: '0 0 8px rgba(255,255,255,0.7)',
                }}
              />
            </motion.div>

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
                alt={schoolName || 'School Logo'}
                width={128}
                height={128}
                className="object-cover w-full h-full rounded-full"
                unoptimized={logoSrc !== '/logo.png'}
              />
            </div>
          </motion.div>

          {/* School name — word-by-word rising reveal */}
          <h1 className="text-[1.85rem] font-display font-bold leading-tight mb-1 flex flex-wrap justify-center gap-x-[0.45rem]">
            {schoolName.split(' ').map((word: string, wi: number) => (
              <span key={wi} className="inline-block overflow-hidden pb-0.5">
                <motion.span
                  className="inline-block"
                  initial={{ y: '115%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 + wi * 0.09, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                >
                  {word}
                </motion.span>
              </span>
            ))}
          </h1>

          {/* Tagline */}
          {loginConfig.tagline && (
            <motion.p
              className="text-sm mb-6"
              style={{ color: 'rgba(255,255,255,0.65)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
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
              transition={{ delay: 0.58, duration: 0.5 }}
            >
              {loginConfig.welcomeText}
            </motion.h2>
          )}

          {/* Feature list — spring stagger */}
          {loginConfig.features.length > 0 && (
            <ul className="space-y-3 text-left w-full max-w-[270px]">
              {loginConfig.features.map((feature: string, i: number) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-3 text-sm"
                  style={{ color: 'rgba(255,255,255,0.82)' }}
                  initial={{ opacity: 0, x: -22 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.66 + i * 0.12,
                    type: 'spring',
                    stiffness: 280,
                    damping: 22,
                  }}
                >
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.72 + i * 0.12, type: 'spring', stiffness: 400, damping: 18 }}
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

      {/* ━━━ Right Form Panel ━━━ */}
      <div className="flex-1 relative flex flex-col items-center justify-center px-6 py-12 min-h-screen overflow-hidden">

        {/* Soft drifting colour blobs behind the card */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 380, height: 380,
            top: '8%', right: '-6%',
            background: `radial-gradient(circle, ${c1}1f 0%, transparent 68%)`,
            filter: 'blur(46px)',
          }}
          animate={{ x: [0, -26, 16, 0], y: [0, 22, -16, 0] }}
          transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 320, height: 320,
            bottom: '4%', left: '2%',
            background: `radial-gradient(circle, ${c2}1c 0%, transparent 68%)`,
            filter: 'blur(46px)',
          }}
          animate={{ x: [0, 22, -14, 0], y: [0, -20, 14, 0] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Mobile-only: compact branding strip */}
        <motion.div
          className="lg:hidden relative z-10 flex flex-col items-center mb-8"
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
              alt={schoolName || 'Logo'}
              width={64}
              height={64}
              className="object-cover w-full h-full rounded-full"
              unoptimized={logoSrc !== '/logo.png'}
            />
          </div>
          <h1 className="font-display font-bold text-lg text-gray-800">{schoolName}</h1>
          {loginConfig.tagline && (
            <p className="text-xs text-gray-500 mt-0.5">{loginConfig.tagline}</p>
          )}
        </motion.div>

        {/* Card: entrance → 3D mouse tilt + gentle float */}
        <motion.div
          className="relative z-10 w-full max-w-[440px]"
          initial={{ opacity: 0, y: 26, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 1100 }}
          >
            <motion.div
              animate={{ y: [-4, 4, -4] }}
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
                      <motion.button
                        type="submit"
                        disabled={loading}
                        className="login-cta w-full relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: btnColor,
                          color: btnTextColor,
                          boxShadow: `0 4px 20px ${btnColor}50`,
                        }}
                        whileHover={{ scale: 1.015, boxShadow: `0 6px 28px ${btnColor}70` }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
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
                      </motion.button>
                    </motion.div>
                  </form>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Footer */}
        <motion.p
          className="relative z-10 mt-6 text-[11px] text-center text-gray-400 tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65 }}
        >
          © {new Date().getFullYear()} {schoolName}
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
