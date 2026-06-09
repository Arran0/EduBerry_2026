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
  Users, Shield, BookOpen, AlertCircle, CheckCircle, Loader2, ArrowRight,
} from 'lucide-react'

type AuthMode = 'login' | 'signup'

const roleOptions: {
  value: UserRole; label: string; Icon: React.ElementType;
  description: string; color: string
}[] = [
  { value: 'student',     label: 'Student',     Icon: GraduationCap, description: 'Homework, grades & coursework', color: '#0ea5e9' },
  { value: 'teacher',     label: 'Teacher',     Icon: BookOpen,      description: 'Manage classes and progress',  color: '#10b981' },
  { value: 'coordinator', label: 'Coordinator', Icon: Users,         description: 'Coordinate academics',         color: '#8b5cf6' },
  { value: 'principal',   label: 'Principal',   Icon: Shield,        description: 'School administration',        color: '#f59e0b' },
  { value: 'admin',       label: 'Admin',       Icon: Shield,        description: 'Full system access',           color: '#f43f5e' },
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
        {/* Subtle large circle in the bg for depth */}
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
          {/* Logo */}
          <div className="mb-8 drop-shadow-xl">
            <MPSLogo size="lg" withRipple src={branding.logoUrl || undefined} />
          </div>

          {/* School name */}
          <h1 className="text-white font-display font-bold text-[1.9rem] xl:text-[2.2rem] leading-tight tracking-tight mb-3">
            {loginConfig.schoolName}
          </h1>

          {/* Divider */}
          <div className="w-10 h-[2px] rounded-full bg-white/30 mb-4" />

          {/* Tagline */}
          <p className="text-white/55 text-xs uppercase tracking-[0.25em] font-medium">
            {loginConfig.tagline}
          </p>
        </motion.div>

        {/* Bottom version badge */}
        <div className="absolute bottom-8 left-0 right-0 flex justify-center">
          <span className="text-white/30 text-[10px] tracking-widest uppercase">
            {branding.appTitle}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════ */}
      {/* RIGHT — Form                           */}
      {/* ══════════════════════════════════════ */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Top bar (desktop) */}
        <div className="hidden lg:flex items-center justify-end px-10 pt-8">
          <p className="text-sm text-slate-400">
            {mode === 'login' ? "Don't have an account?" : 'Already have one?'}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setSuccess(null) }}
              className="ml-1.5 font-semibold transition-colors"
              style={{ color: primaryColor }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        {/* Centered form */}
        <div className="flex-1 flex items-center justify-center px-8 sm:px-14 py-10">
          <motion.div
            className="w-full max-w-[380px]"
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
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </h2>
              <p className="text-slate-400 text-sm mt-1.5">
                {mode === 'login'
                  ? `Welcome back to ${branding.appTitle}`
                  : 'Fill in the details to get started'}
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
            <AnimatePresence>
              {success && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  className="flex items-start gap-2.5 p-3.5 mb-6 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700">
                  <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                  <span className="text-xs leading-relaxed">{success}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Full Name — signup only */}
              <AnimatePresence>
                {mode === 'signup' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <SleekInput
                      label="Full Name" icon={<User size={15} />} type="text"
                      value={fullName} onChange={setFullName}
                      placeholder="Your full name" required={mode === 'signup'}
                      primaryColor={primaryColor}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

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

              {/* Confirm Password — signup only */}
              <AnimatePresence>
                {mode === 'signup' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <SleekInput
                      label="Confirm Password" icon={<Lock size={15} />}
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword} onChange={setConfirmPassword}
                      placeholder="••••••••" required={mode === 'signup'}
                      primaryColor={primaryColor}
                      suffix={
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                          {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      }
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Role selector — signup only */}
              <AnimatePresence>
                {mode === 'signup' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <p className="text-xs font-medium text-slate-500 mb-2">I am a</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {roleOptions.map(({ value, label, Icon, description, color }) => {
                        const isActive = role === value
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setRole(value)}
                            title={description}
                            className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl border transition-all duration-200 text-center ${
                              isActive ? 'border-transparent shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                            style={isActive ? { background: color + '18', borderColor: color + '60' } : {}}
                          >
                            <Icon size={16} style={{ color: isActive ? color : '#94a3b8' }} />
                            <span className={`text-[9px] font-semibold leading-none`}
                              style={{ color: isActive ? color : '#94a3b8' }}>
                              {label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      {roleOptions.find(r => r.value === role)?.description}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.99] mt-2"
                style={{ background: primaryColor }}
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" />{mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
                  : <>{mode === 'login' ? 'Sign In' : 'Create Account'}<ArrowRight size={15} /></>
                }
              </button>
            </form>

            {/* Mobile mode toggle */}
            <p className="lg:hidden text-center text-sm text-slate-400 mt-6">
              {mode === 'login' ? "Don't have an account?" : 'Already have one?'}
              <button
                type="button"
                onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setSuccess(null) }}
                className="ml-1.5 font-semibold transition-colors"
                style={{ color: primaryColor }}
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </motion.div>
        </div>

        {/* Footer */}
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
      <div
        className="relative rounded-xl transition-all duration-200"
        style={{
          boxShadow: focused ? `0 0 0 2px ${primaryColor}30` : undefined,
        }}
      >
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
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
          className="w-full pl-10 pr-10 py-3 border rounded-xl text-sm text-slate-800 placeholder:text-slate-400 bg-slate-50/70 focus:bg-white focus:outline-none transition-all duration-200"
          style={{ borderColor: focused ? primaryColor : '#e2e8f0' }}
        />
        {suffix}
      </div>
    </div>
  )
}
