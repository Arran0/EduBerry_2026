'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import { UserRole } from '@/lib/supabase'
import MPSLogo from '@/components/MPSLogo'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, Mail, Lock, User, GraduationCap,
  Users, Shield, BookOpen, AlertCircle, CheckCircle, Loader2, Sparkles,
} from 'lucide-react'

type AuthMode = 'login' | 'signup'

const roleOptions: {
  value: UserRole; label: string; Icon: React.ElementType;
  description: string; gradFrom: string; gradTo: string
}[] = [
  { value: 'student',     label: 'Student',     Icon: GraduationCap, description: 'Access homework, grades & coursework',  gradFrom: '#38bdf8', gradTo: '#3b82f6' },
  { value: 'teacher',     label: 'Teacher',     Icon: BookOpen,      description: 'Manage classes and student progress',   gradFrom: '#34d399', gradTo: '#059669' },
  { value: 'coordinator', label: 'Coordinator', Icon: Users,         description: 'Coordinate academic activities',        gradFrom: '#a78bfa', gradTo: '#7c3aed' },
  { value: 'principal',   label: 'Principal',   Icon: Shield,        description: 'School administration access',          gradFrom: '#fbbf24', gradTo: '#f97316' },
  { value: 'admin',       label: 'Admin',       Icon: Shield,        description: 'Full system access',                   gradFrom: '#fb7185', gradTo: '#db2777' },
]

export default function LoginPage() {
  const { user, signIn, signUp, loading: authLoading } = useAuth()
  const { loginConfig, branding, brandingLoaded } = usePageConfig()
  const router = useRouter()

  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('student')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
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
    setSuccess(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) { setError('Passwords do not match'); setLoading(false); return }
        if (password.length < 6) { setError('Password must be at least 6 characters'); setLoading(false); return }
        const { error } = await signUp(email, password, fullName, role)
        if (error) setError(error.message)
        else { setSuccess('Account created! You can now sign in.'); setMode('login'); setPassword(''); setConfirmPassword('') }
      } else {
        const { error } = await signIn(email, password)
        if (error) setError(error.message)
      }
    } catch { setError('An unexpected error occurred') }
    finally { setLoading(false) }
  }

  const panelGrad = `linear-gradient(150deg, ${loginConfig.gradientFrom}, ${loginConfig.gradientMid}, ${loginConfig.gradientTo})`
  const pageBg = `linear-gradient(135deg, ${loginConfig.pageBgFrom ?? '#bfdbfe'}, ${loginConfig.pageBgMid ?? '#f0f9ff'}, ${loginConfig.pageBgTo ?? '#bbf7d0'})`

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: brandingLoaded ? pageBg : '#ffffff' }}>
        <div className="text-center">
          {brandingLoaded && branding.logoUrl && (
            <div className="w-20 h-20 mx-auto mb-4 rounded-full overflow-hidden shadow-lg ring-4 ring-white">
              <img src={branding.logoUrl} alt="Logo" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="spinner mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ background: pageBg }}>

      {/* ── Animated background blobs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute -top-48 -left-48 w-[36rem] h-[36rem] rounded-full opacity-30 blur-3xl"
          style={{ background: loginConfig.gradientFrom }}
          animate={{ x: [0, 55, -25, 18, 0], y: [0, -45, 55, -20, 0], scale: [1, 1.1, 0.9, 1.06, 1] }}
          transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-48 -right-48 w-[30rem] h-[30rem] rounded-full opacity-25 blur-3xl"
          style={{ background: loginConfig.gradientTo }}
          animate={{ x: [0, -45, 30, -15, 0], y: [0, 35, -50, 18, 0], scale: [1, 0.87, 1.2, 0.95, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
        />
        <motion.div
          className="absolute top-1/2 right-1/4 -translate-y-1/2 w-80 h-80 rounded-full opacity-15 blur-3xl"
          style={{ background: loginConfig.gradientMid }}
          animate={{ scale: [1, 1.3, 0.82, 1.15, 1], rotate: [0, 120, 240, 360] }}
          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* LEFT PANEL — Branding                         */}
      {/* ══════════════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-1/2 xl:w-[44%] relative overflow-hidden"
        style={{ background: panelGrad }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-32 -left-32 w-80 h-80 rounded-full bg-white/10" />
        <div className="absolute top-1/4 -left-16 w-40 h-40 rounded-full bg-white/15" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-white/10" />
        <div className="absolute top-1/3 right-6 w-48 h-48 rounded-full bg-white/[0.07]" />
        <div className="absolute bottom-1/4 left-20 w-28 h-28 rounded-full bg-white/10" />

        {/* Background image overlay */}
        {loginConfig.bgImageUrl && (
          <div className="absolute inset-0 z-[1]">
            <img src={loginConfig.bgImageUrl} alt="" className="w-full h-full object-cover opacity-20" />
          </div>
        )}

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-12 xl:px-16 text-white text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="flex flex-col items-center w-full max-w-sm"
          >
            {/* Logo */}
            <div className="relative mb-7">
              <MPSLogo size="lg" withRipple src={branding.logoUrl || undefined} />
            </div>

            {/* School name */}
            <motion.h1
              className="text-3xl xl:text-4xl font-display font-bold tracking-tight mb-2 drop-shadow-sm"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              {loginConfig.schoolName}
            </motion.h1>

            {/* Tagline */}
            <motion.p
              className="text-white/70 text-sm xl:text-base font-light tracking-[0.3em] mb-4 uppercase"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              {loginConfig.tagline}
            </motion.p>

            {/* Divider */}
            <motion.div
              className="w-14 h-px bg-white/30 mb-6"
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            />

            {/* Welcome text */}
            <motion.h2
              className="text-lg font-medium text-white/65 mb-9"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.55 }}
            >
              {loginConfig.welcomeText}
            </motion.h2>

            {/* Feature highlight cards */}
            <div className="space-y-3 w-full">
              {loginConfig.features.map((feature, index) => (
                <motion.div
                  key={feature}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.65 + index * 0.12 }}
                  className="flex items-center gap-3 bg-white/10 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20"
                >
                  <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={13} className="text-white/90" />
                  </div>
                  <span className="text-white/85 text-sm font-medium text-left">{feature}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* RIGHT PANEL — Form                             */}
      {/* ══════════════════════════════════════════════ */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="w-full max-w-[420px]"
        >
          {/* Mobile branding */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <MPSLogo size="md" src={branding.logoUrl || undefined} className="ring-2 ring-white/60 shadow-lg" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-800">{branding.appTitle}</h1>
              <p className="text-xs text-slate-500">{branding.appSubtitle}</p>
            </div>
          </div>

          {/* Form Card */}
          <div className="relative bg-white/85 backdrop-blur-2xl rounded-[2rem] overflow-hidden shadow-2xl shadow-slate-300/50 ring-1 ring-white/70">
            {/* Gradient accent top stripe */}
            <div className="h-[3px]" style={{ background: panelGrad }} />

            <div className="p-7 sm:p-8">

              {/* Mode toggle pill */}
              <div className="flex bg-slate-100/90 rounded-2xl p-1 mb-7 gap-1">
                {(['login', 'signup'] as AuthMode[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError(null); setSuccess(null) }}
                    className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 ${
                      mode === m
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {m === 'login' ? 'Sign In' : 'Create Account'}
                  </button>
                ))}
              </div>

              {/* Heading */}
              <div className="mb-6">
                <h2 className="font-display text-2xl font-bold text-slate-800 leading-tight">
                  {mode === 'login' ? 'Welcome back' : 'Join us today'}
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  {mode === 'login' ? 'Sign in to your school portal' : 'Create your school account'}
                </p>
              </div>

              {/* Alerts */}
              <AnimatePresence>
                {sessionExpired && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="flex items-center gap-2.5 p-3.5 mb-5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800"
                  >
                    <AlertCircle size={15} className="flex-shrink-0" />
                    <span className="text-xs">Your session expired. Please sign in again.</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="flex items-center gap-2.5 p-3.5 mb-5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700"
                  >
                    <AlertCircle size={15} className="flex-shrink-0" />
                    <span className="text-xs">{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {success && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="flex items-center gap-2.5 p-3.5 mb-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700"
                  >
                    <CheckCircle size={15} className="flex-shrink-0" />
                    <span className="text-xs">{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Full Name — signup only */}
                <AnimatePresence>
                  {mode === 'signup' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <LoginInput
                        label="Full Name" icon={<User size={15} />} type="text"
                        value={fullName} onChange={setFullName}
                        placeholder="Enter your full name" required={mode === 'signup'}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <LoginInput
                  label="Email Address" icon={<Mail size={15} />} type="email"
                  value={email} onChange={setEmail}
                  placeholder="Enter your email" required
                />

                <LoginInput
                  label="Password" icon={<Lock size={15} />}
                  type={showPassword ? 'text' : 'password'}
                  value={password} onChange={setPassword}
                  placeholder="Enter your password" required
                  suffix={
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />

                {/* Confirm Password — signup only */}
                <AnimatePresence>
                  {mode === 'signup' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <LoginInput
                        label="Confirm Password" icon={<Lock size={15} />}
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword} onChange={setConfirmPassword}
                        placeholder="Confirm your password" required={mode === 'signup'}
                        suffix={
                          <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5">
                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Role selector — signup only */}
                <AnimatePresence>
                  {mode === 'signup' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
                        Your Role
                      </label>
                      <div className="grid grid-cols-5 gap-1.5">
                        {roleOptions.map(({ value, label, Icon, description, gradFrom, gradTo }) => {
                          const isActive = role === value
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setRole(value)}
                              title={description}
                              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all duration-200 ${
                                isActive
                                  ? 'border-transparent shadow-md shadow-slate-200 scale-[1.06]'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                              }`}
                              style={isActive ? { background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` } : {}}
                            >
                              <Icon size={17} className={isActive ? 'text-white' : 'text-slate-400'} />
                              <span className={`text-[9px] font-bold leading-none tracking-wide ${isActive ? 'text-white' : 'text-slate-400'}`}>
                                {label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1.5 pl-0.5">
                        {roleOptions.find(r => r.value === role)?.description}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-xl hover:shadow-slate-300/50 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
                  style={{ background: loading ? '#94a3b8' : panelGrad }}
                >
                  {loading ? (
                    <><Loader2 className="animate-spin" size={17} />{mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
                  ) : (
                    mode === 'login' ? 'Sign In' : 'Create Account'
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-slate-400 text-xs mt-5">
            © {new Date().getFullYear()} {loginConfig.schoolName}. All rights reserved.
          </p>
        </motion.div>
      </div>
    </div>
  )
}

function LoginInput({
  label, icon, type, value, onChange, placeholder, required, suffix,
}: {
  label: string
  icon: React.ReactNode
  type: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  required?: boolean
  suffix?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          {icon}
        </div>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full pl-10 pr-10 py-3 bg-slate-50/80 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/60 focus:border-blue-300 transition-all duration-200"
        />
        {suffix}
      </div>
    </div>
  )
}
