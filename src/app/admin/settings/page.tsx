'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import { ICON_MAP } from '@/components/PageIcon'
import {
  PageId, PageIconMap, PAGE_DEFAULTS, PAGE_LABELS, AVAILABLE_ICONS, GRADIENT_OPTIONS,
  SiteBranding, BRANDING_DEFAULTS,
  LoginPageConfig, LOGIN_DEFAULTS,
  PageThemeMap, THEME_PALETTES,
  savePageIconConfig, saveBranding, saveLoginConfig, savePageThemes,
  uploadSiteAsset,
  AnnouncementBannerConfig, fetchPageBanner, savePageBanner, BANNER_PRESETS,
  BANNER_DEFAULT, TASK_BANNER_DEFAULT, ACADEMICS_BANNER_DEFAULT, EXAM_BANNER_DEFAULT,
  ATTENDANCE_BANNER_DEFAULT, STAFF_ATTENDANCE_BANNER_DEFAULT,
  LEAVE_BANNER_DEFAULT, STAFF_LEAVE_BANNER_DEFAULT,
  FEES_BANNER_DEFAULT, SALARY_BANNER_DEFAULT,
  BUS_BANNER_DEFAULT, TIMETABLE_BANNER_DEFAULT, FEEDBACK_BANNER_DEFAULT,
} from '@/lib/pageConfig'
import { swatchBackground, gradientLuminance, isDarkLum } from '@/lib/bannerStyle'
import {
  Check, RotateCcw, Save, Settings, Palette, Image as ImageIcon,
  Type, LogIn, Layout, Upload, X, Plus, Trash2, Loader2, MapPin, Navigation,
  Clock, CalendarOff, ShieldCheck, Search, Bus, CreditCard, Banknote,
  QrCode, Info, Monitor, ListChecks, ChevronDown, Lock, Building2, Copy, Repeat,
} from 'lucide-react'
import { SchoolProfile, SCHOOL_PROFILE_DEFAULTS, fetchSchoolProfile, saveSchoolProfile } from '@/lib/schoolProfile'
import {
  fetchGeofenceConfig, saveGeofenceConfig, GeofenceConfig,
  fetchAttendanceConfig, saveAttendanceConfig, AttendanceConfig,
  fetchAllStaff, setStaffExemption,
  fetchAllDayTimingRules, fetchAllTrackedStaff, saveDayTimings,
  DayTimingGroup, DayTimingScope,
  fetchAllHolidayRules, saveHolidays, HolidayGroup,
} from '@/lib/attendance'
import { fetchTeamsForDropdown } from '@/lib/teams'
import { UserProfile } from '@/lib/supabase'

const DayTimingModalDynamic = dynamic(
  () => import('@/components/attendance/DayTimingModal'),
  { ssr: false }
)

const HolidayModalDynamic = dynamic(
  () => import('@/components/attendance/HolidayModal'),
  { ssr: false }
)

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function dayTimingScopeKey(scope: DayTimingScope): string {
  return scope.type === 'weekday' ? `weekday-${scope.weekday}` : `date-${scope.date}`
}

interface DayTimingScopeGroup {
  scope: DayTimingScope
  key: string
  label: string
  rows: DayTimingGroup[]
}

// One row per rule in the DB, but the UI manages a whole scope (date or weekday)
// as a single unit — group rows back together for display.
function groupDayTimingRules(rules: DayTimingGroup[]): DayTimingScopeGroup[] {
  const map = new Map<string, DayTimingScopeGroup>()
  for (const r of rules) {
    const scope: DayTimingScope = r.scope_type === 'weekday'
      ? { type: 'weekday', weekday: r.scope_weekday as number }
      : { type: 'date', date: r.scope_date as string }
    const key = dayTimingScopeKey(scope)
    if (!map.has(key)) {
      const label = scope.type === 'weekday'
        ? `Every ${WEEKDAY_NAMES[scope.weekday]}`
        : new Date(scope.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      map.set(key, { scope, key, label, rows: [] })
    }
    map.get(key)!.rows.push(r)
  }
  return [...map.values()]
}

interface HolidayDateGroup {
  date: string
  label: string
  rows: HolidayGroup[]
}

// One row per rule in the DB, but the UI manages a whole date as a single unit.
function groupHolidayRules(rules: HolidayGroup[]): HolidayDateGroup[] {
  const map = new Map<string, HolidayDateGroup>()
  for (const r of rules) {
    if (!map.has(r.date)) {
      const label = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      map.set(r.date, { date: r.date, label, rows: [] })
    }
    map.get(r.date)!.rows.push(r)
  }
  return [...map.values()]
}
// Payment / payout config — fees & bus share one gateway store; salary & driver share one payout store.
import {
  RazorpayConfig, UpiConfig, SmartCollectConfig,
  fetchRazorpayConfig, saveRazorpayConfig, fetchUpiConfig, saveUpiConfig,
  fetchSmartCollectConfig, saveSmartCollectConfig,
} from '@/lib/fees'
import { PayoutConfig, fetchPayoutConfig, savePayoutConfig } from '@/lib/salary'
import {
  RazorpaySecrets, SmartCollectSecrets, PayoutSecrets,
  fetchPaymentSecrets, savePaymentSecrets,
} from '@/lib/paymentSecrets'

type Tab = 'branding' | 'school-profile' | 'page-themes' | 'login' | 'banners' | 'geofence' | 'attendance' | 'payments' | 'bus'

const PAGE_IDS = Object.keys(PAGE_DEFAULTS) as PageId[]

// Per-page gradient banners — mirrors the Page Themes list (admin-space pages excluded;
// they stay on the uncustomisable Edzee theme). Home is covered by the image banner above.
const PAGE_BANNERS: { key: string; label: string; default: AnnouncementBannerConfig }[] = [
  { key: 'announcement_banner',     label: 'Announcements',      default: BANNER_DEFAULT },
  { key: 'task_banner',             label: 'Tasks',              default: TASK_BANNER_DEFAULT },
  { key: 'academics_banner',        label: 'Academics',          default: ACADEMICS_BANNER_DEFAULT },
  { key: 'exam_banner',             label: 'Exams',              default: EXAM_BANNER_DEFAULT },
  { key: 'attendance_banner',       label: 'Student Attendance', default: ATTENDANCE_BANNER_DEFAULT },
  { key: 'staff_attendance_banner', label: 'Staff Attendance',   default: STAFF_ATTENDANCE_BANNER_DEFAULT },
  { key: 'leave_banner',            label: 'Student OD/Leave',   default: LEAVE_BANNER_DEFAULT },
  { key: 'staff_leave_banner',      label: 'Staff Leave',        default: STAFF_LEAVE_BANNER_DEFAULT },
  { key: 'fees_banner',             label: 'Fees',               default: FEES_BANNER_DEFAULT },
  { key: 'salary_banner',           label: 'Salary',             default: SALARY_BANNER_DEFAULT },
  { key: 'bus_banner',              label: 'Bus & Transport',    default: BUS_BANNER_DEFAULT },
  { key: 'timetable_banner',        label: 'Timetable',          default: TIMETABLE_BANNER_DEFAULT },
  { key: 'feedback_banner',         label: 'Feedback',           default: FEEDBACK_BANNER_DEFAULT },
]

// ── Admin palette ──────────────────────────────
const ai = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-3">{children}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={ai}
    />
  )
}

function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-9 h-9 border border-[#D4D4D8] cursor-pointer p-0.5 bg-white"
      />
      <TextInput value={value} onChange={onChange} placeholder="#000000" />
    </div>
  )
}

interface UploadFieldProps {
  label: string; currentUrl: string
  onUpload: (file: File) => Promise<void>; onClear: () => void
  uploading: boolean; accept?: string; previewCircle?: boolean
}
function UploadField({ label, currentUrl, onUpload, onClear, uploading, accept = 'image/*', previewCircle }: UploadFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      {label && <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">{label}</label>}
      <div className="flex items-center gap-3">
        {currentUrl ? (
          <div className="relative flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="" className={`w-14 h-14 object-cover border border-[#D4D4D8] ${previewCircle ? 'rounded-full' : ''}`} />
            <button onClick={onClear} className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white flex items-center justify-center shadow">
              <X size={10} />
            </button>
          </div>
        ) : (
          <div className={`w-14 h-14 bg-[#F5F5F5] border-2 border-dashed border-[#D4D4D8] flex items-center justify-center ${previewCircle ? 'rounded-full' : ''}`}>
            <ImageIcon size={18} className="text-[#D4D4D8]" />
          </div>
        )}
        <div className="flex-1 space-y-1">
          <button onClick={() => ref.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors disabled:opacity-50">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : 'Upload Image'}
          </button>
          {currentUrl && <p className="text-[10px] text-[#A1A1AA] truncate max-w-[180px]">{currentUrl.split('/').pop()}</p>}
        </div>
        <input ref={ref} type="file" accept={accept} className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) await onUpload(f); e.target.value = '' }} />
      </div>
    </div>
  )
}

// ── Inline payment-settings primitives (admin palette) ─────────────────────────

const selectCls = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 p-3 bg-white border border-[#E4E4E7]">
      <span className="text-sm text-[#18181B]">{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}

function SettingsCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#F5F5F5] border border-[#E4E4E7] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 bg-[#27272A] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h3 className="text-sm font-bold text-[#18181B]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function PwInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="password" autoComplete="off" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} className={ai}
    />
  )
}

// Read-only display of the app's full webhook endpoint that the school admin
// pastes into their bank / PSP / Razorpay dashboard, with one-click copy. The
// origin is resolved client-side so the URL always matches wherever the app is
// deployed — no hardcoded domain to keep in sync.
function WebhookUrlField({ path }: { path: string }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const url = origin ? `${origin}${path}` : path
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — admin can still select the text manually */
    }
  }
  return (
    <Field label="Webhook URL (paste at your bank / gateway)">
      <div className="flex items-center gap-2">
        <input readOnly value={url} onFocus={e => e.target.select()}
          className={`${ai} font-mono bg-[#FAFAFA] text-[#52525B]`} />
        <button type="button" onClick={copy}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
    </Field>
  )
}

function InfoNote({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'info' }) {
  const Icon = tone === 'info' ? Info : ShieldCheck
  return (
    <div className="flex items-start gap-2 mt-4 p-3 bg-white border border-[#E4E4E7] text-xs text-[#71717A] leading-relaxed">
      <Icon size={14} className="flex-shrink-0 mt-0.5 text-[#B8983C]" />
      <span>{children}</span>
    </div>
  )
}

// Collapsible "how to set this up" walkthrough + a reassuring "why it's safe" panel.
// Used by both the gateway (collect) and payout (disburse) editors so admins always
// have step-by-step guidance and a clear safety story before touching credentials.
interface SetupStep { title: string; body: React.ReactNode }
function SetupGuide({ steps, safety }: { steps: SetupStep[]; safety: React.ReactNode[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-[#E4E4E7] bg-white">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 px-4 py-3 text-left">
        <div className="w-8 h-8 bg-[#27272A] flex items-center justify-center flex-shrink-0">
          <ListChecks size={15} className="text-[#B8983C]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-[#18181B]">Setup guide</p>
          <p className="text-[11px] text-[#71717A]">{steps.length} simple steps · about 5 minutes</p>
        </div>
        <ChevronDown size={16} className={`text-[#71717A] transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-[#E4E4E7]">
          <ol className="space-y-3 mt-3.5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-[#27272A] text-[#F5F5F5] text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <div className="flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-[#18181B]">{s.title}</p>
                  <p className="text-xs text-[#71717A] leading-relaxed mt-0.5">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* Why this is safe — gold "trust" panel */}
          <div className="mt-4 p-3.5 bg-[#FAF8F1] border border-[#E8DFBF]">
            <div className="flex items-center gap-2 mb-2.5">
              <Lock size={13} className="text-[#B8983C]" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#8A6D1F]">Why this is safe</p>
            </div>
            <ul className="space-y-2">
              {safety.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-[#5C5640] leading-relaxed">
                  <ShieldCheck size={13} className="flex-shrink-0 mt-0.5 text-[#B8983C]" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function SaveButton({ saving, saved, label, onClick }: { saving: boolean; saved: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick} disabled={saving}
      className="mt-4 flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors"
    >
      {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
      {saving ? 'Saving…' : saved ? 'Saved!' : label}
    </button>
  )
}

function InlineTabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string; icon: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-[#E4E4E7] mb-5">
      {items.map(it => (
        <button key={it.id} onClick={() => onChange(it.id)}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-medium transition-colors border-b-2 ${value === it.id ? 'border-[#27272A] text-[#18181B]' : 'border-transparent text-[#71717A] hover:text-[#18181B]'}`}>
          <span className="flex-shrink-0">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { profile } = useAuth()
  const { pageIcons, branding, loginConfig, pageThemes, reload } = usePageConfig()

  const [tab, setTab] = useState<Tab>('branding')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [geofenceDraft, setGeofenceDraft] = useState<GeofenceConfig>({ enabled: false, lat: null, lng: null, radius_m: 200 })
  const [geofenceLoaded, setGeofenceLoaded] = useState(false)
  const [savingGeofence, setSavingGeofence] = useState(false)
  const [savedGeofence, setSavedGeofence] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)

  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceConfig>({ late_cutoff: null, checkout_cutoff: null })
  const [attendanceLoaded, setAttendanceLoaded] = useState(false)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [savedAttendance, setSavedAttendance] = useState(false)
  const [staffList, setStaffList] = useState<UserProfile[]>([])
  const [exemptQuery, setExemptQuery] = useState('')
  const [exemptSaving, setExemptSaving] = useState<string | null>(null)

  const [dayTimingRules, setDayTimingRules] = useState<DayTimingGroup[]>([])
  const [dayTimingTeams, setDayTimingTeams] = useState<{ id: string; name: string }[]>([])
  const [trackedStaff, setTrackedStaff] = useState<UserProfile[]>([])
  const [showTimingModal, setShowTimingModal] = useState(false)
  const [editingScope, setEditingScope] = useState<DayTimingScope | null>(null)
  const [clearingScopeKey, setClearingScopeKey] = useState<string | null>(null)

  const [holidayRules, setHolidayRules] = useState<HolidayGroup[]>([])
  const [showHolidayModal, setShowHolidayModal] = useState(false)
  const [editingHolidayDate, setEditingHolidayDate] = useState<string | null>(null)
  const [clearingHolidayDate, setClearingHolidayDate] = useState<string | null>(null)

  const [draftIcons, setDraftIcons] = useState<PageIconMap>(pageIcons)
  const [draftBranding, setDraftBranding] = useState<SiteBranding>(branding)
  const [draftLogin, setDraftLogin] = useState<LoginPageConfig>(loginConfig)
  const [draftThemes, setDraftThemes] = useState<PageThemeMap>(pageThemes)

  const [selectedPage, setSelectedPage] = useState<PageId>('tasks')
  const [selectedThemePage, setSelectedThemePage] = useState<string>('home')
  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({})

  const [bannerDrafts, setBannerDrafts] = useState<Record<string, AnnouncementBannerConfig>>({})
  const [bannersLoaded, setBannersLoaded] = useState(false)
  const [bannerSaving, setBannerSaving] = useState<string | null>(null)
  const [bannerSaved, setBannerSaved] = useState<string | null>(null)
  const [selectedBannerKey, setSelectedBannerKey] = useState(PAGE_BANNERS[0].key)

  // ── Payment gateway (shared by Fee Setting + Bus Fee) ──
  const [paymentsSub, setPaymentsSub] = useState<'fees' | 'salary'>('fees')
  const [busSub, setBusSub] = useState<'busfee' | 'driver'>('busfee')
  const [gatewayLoaded, setGatewayLoaded] = useState(false)
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [rzpSecrets, setRzpSecrets] = useState<RazorpaySecrets>({ key_secret: '', webhook_secret: '' })
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  const [sc, setSc] = useState<SmartCollectConfig>({ enabled: false, mode: 'reference', provider_name: '' })
  const [scSecrets, setScSecrets] = useState<SmartCollectSecrets>({ base_url: '', api_key: '', webhook_secret: '' })
  const [gwSaving, setGwSaving] = useState<string | null>(null)
  const [gwSaved, setGwSaved] = useState<string | null>(null)

  // ── Payout config (shared by Salary Payout + Driver Payout) ──
  const [payoutLoaded, setPayoutLoaded] = useState(false)
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig>({ enabled: false, provider: 'manual', key_id: '' })
  const [payoutSecrets, setPayoutSecrets] = useState<PayoutSecrets>({ key_secret: '', account_number: '', webhook_secret: '' })
  const [payoutSaving, setPayoutSaving] = useState(false)
  const [payoutSaved, setPayoutSaved] = useState(false)

  // ── School Profile (CBSE institutional info) ──
  const [schoolDraft, setSchoolDraft] = useState<SchoolProfile>(SCHOOL_PROFILE_DEFAULTS)
  const [schoolLoaded, setSchoolLoaded] = useState(false)
  const [savingSchool, setSavingSchool] = useState(false)
  const [savedSchool, setSavedSchool] = useState(false)

  useEffect(() => {
    setDraftIcons(pageIcons); setDraftBranding(branding)
    setDraftLogin(loginConfig); setDraftThemes(pageThemes)
  }, [pageIcons, branding, loginConfig, pageThemes])

  useEffect(() => {
    if (!geofenceLoaded) {
      fetchGeofenceConfig().then(cfg => { if (cfg) setGeofenceDraft(cfg); setGeofenceLoaded(true) })
    }
  }, [geofenceLoaded])

  useEffect(() => {
    if (tab === 'attendance' && !attendanceLoaded) {
      Promise.all([
        fetchAttendanceConfig(), fetchAllStaff(),
        fetchAllDayTimingRules(), fetchTeamsForDropdown(), fetchAllTrackedStaff(),
        fetchAllHolidayRules(),
      ]).then(([cfg, staff, rules, teams, tracked, holRules]) => {
        setAttendanceDraft(cfg); setStaffList(staff)
        setDayTimingRules(rules); setDayTimingTeams(teams); setTrackedStaff(tracked)
        setHolidayRules(holRules)
        setAttendanceLoaded(true)
      })
    }
  }, [tab, attendanceLoaded])

  useEffect(() => {
    if (tab === 'banners' && !bannersLoaded) {
      Promise.all(PAGE_BANNERS.map(p => fetchPageBanner(p.key, p.default))).then(results => {
        const map: Record<string, AnnouncementBannerConfig> = {}
        PAGE_BANNERS.forEach((p, i) => { map[p.key] = results[i] })
        setBannerDrafts(map)
        setBannersLoaded(true)
      })
    }
  }, [tab, bannersLoaded])

  useEffect(() => {
    if ((tab === 'payments' || tab === 'bus') && !gatewayLoaded) {
      Promise.all([
        fetchRazorpayConfig(), fetchUpiConfig(), fetchSmartCollectConfig(),
        fetchPaymentSecrets('razorpay'), fetchPaymentSecrets('smart_collect'),
      ]).then(([r, u, s, rSec, sSec]) => {
        setRzp(r); setUpi(u); setSc(s)
        setRzpSecrets({ key_secret: rSec.key_secret ?? '', webhook_secret: rSec.webhook_secret ?? '' })
        setScSecrets({ base_url: sSec.base_url ?? '', api_key: sSec.api_key ?? '', webhook_secret: sSec.webhook_secret ?? '' })
        setGatewayLoaded(true)
      })
    }
  }, [tab, gatewayLoaded])

  useEffect(() => {
    if ((tab === 'payments' || tab === 'bus') && !payoutLoaded) {
      Promise.all([fetchPayoutConfig(), fetchPaymentSecrets('payout')]).then(([c, s]) => {
        setPayoutCfg(c)
        setPayoutSecrets({ key_secret: s.key_secret ?? '', account_number: s.account_number ?? '', webhook_secret: s.webhook_secret ?? '' })
        setPayoutLoaded(true)
      })
    }
  }, [tab, payoutLoaded])

  useEffect(() => {
    if (tab === 'school-profile' && !schoolLoaded) {
      fetchSchoolProfile().then(p => { setSchoolDraft(p); setSchoolLoaded(true) })
    }
  }, [tab, schoolLoaded])

  if (profile && profile.role !== 'admin') return null

  const setUploading = (key: string, val: boolean) => setUploadingMap(prev => ({ ...prev, [key]: val }))

  async function uploadAndSet(key: string, file: File, onSuccess: (url: string) => void) {
    setUploading(key, true)
    const url = await uploadSiteAsset(file, key)
    if (url) onSuccess(url)
    setUploading(key, false)
  }

  function updateIcon(pageId: PageId, patch: Partial<PageIconMap[PageId]>) {
    setDraftIcons(prev => ({ ...prev, [pageId]: { ...prev[pageId], ...patch } }))
  }
  function updateBranding(patch: Partial<SiteBranding>) { setDraftBranding(prev => ({ ...prev, ...patch })) }
  function updateLogin(patch: Partial<LoginPageConfig>) { setDraftLogin(prev => ({ ...prev, ...patch })) }
  function updateFeature(index: number, value: string) {
    setDraftLogin(prev => { const f = [...prev.features]; f[index] = value; return { ...prev, features: f } })
  }
  function addFeature() { setDraftLogin(prev => ({ ...prev, features: [...prev.features, ''] })) }
  function removeFeature(index: number) { setDraftLogin(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== index) })) }

  async function handleSave() {
    setSaving(true)
    await Promise.all([savePageIconConfig(draftIcons), saveBranding(draftBranding), saveLoginConfig(draftLogin), savePageThemes(draftThemes)])
    await reload()
    setSaved(true); setTimeout(() => setSaved(false), 2500); setSaving(false)
  }

  const currentIcon = draftIcons[selectedPage]

  async function handleSaveGeofence() {
    setSavingGeofence(true)
    await saveGeofenceConfig(geofenceDraft)
    setSavedGeofence(true); setTimeout(() => setSavedGeofence(false), 2500); setSavingGeofence(false)
  }

  async function handleSaveAttendance() {
    setSavingAttendance(true)
    await saveAttendanceConfig(attendanceDraft)
    setSavedAttendance(true); setTimeout(() => setSavedAttendance(false), 2500); setSavingAttendance(false)
  }

  async function handleSaveBanner(key: string) {
    const cfg = bannerDrafts[key]
    if (!cfg) return
    setBannerSaving(key)
    await savePageBanner(key, cfg)
    setBannerSaving(null)
    setBannerSaved(key)
    setTimeout(() => setBannerSaved(s => s === key ? null : s), 2500)
  }

  function updateBannerDraft(key: string, patch: Partial<AnnouncementBannerConfig>) {
    setBannerDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  async function saveGateway(which: 'rzp' | 'upi' | 'sc') {
    setGwSaving(which)
    if (which === 'rzp') {
      await Promise.all([saveRazorpayConfig(rzp), savePaymentSecrets('razorpay', { ...rzpSecrets })])
    } else if (which === 'upi') {
      await saveUpiConfig(upi)
    } else {
      await Promise.all([saveSmartCollectConfig(sc), savePaymentSecrets('smart_collect', { ...scSecrets })])
    }
    setGwSaving(null)
    setGwSaved(which)
    setTimeout(() => setGwSaved(s => s === which ? null : s), 2000)
  }

  async function savePayout() {
    setPayoutSaving(true)
    await Promise.all([savePayoutConfig(payoutCfg), savePaymentSecrets('payout', { ...payoutSecrets })])
    setPayoutSaving(false)
    setPayoutSaved(true)
    setTimeout(() => setPayoutSaved(false), 2000)
  }

  async function reloadHolidayRules() {
    setHolidayRules(await fetchAllHolidayRules())
  }

  async function handleClearHoliday(date: string) {
    if (!profile) return
    setClearingHolidayDate(date)
    const ok = await saveHolidays(date, [], profile.id)
    if (ok) await reloadHolidayRules()
    setClearingHolidayDate(null)
  }

  async function reloadDayTimingRules() {
    setDayTimingRules(await fetchAllDayTimingRules())
  }

  async function handleClearDayTiming(scope: DayTimingScope) {
    if (!profile) return
    setClearingScopeKey(dayTimingScopeKey(scope))
    const ok = await saveDayTimings(scope, [], profile.id)
    if (ok) await reloadDayTimingRules()
    setClearingScopeKey(null)
  }

  async function handleToggleExempt(staff: UserProfile) {
    setExemptSaving(staff.id)
    const next = !staff.geofence_exempt
    const ok = await setStaffExemption(staff.id, next)
    if (ok) setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, geofence_exempt: next } : s))
    setExemptSaving(null)
  }

  function getCurrentLocation() {
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setGeofenceDraft(prev => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude })); setGettingLocation(false) },
      () => setGettingLocation(false),
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  // ── Tab renderers ─────────────────────────────────────────────────────────

  function updateSchool(patch: Partial<SchoolProfile>) { setSchoolDraft(prev => ({ ...prev, ...patch })) }

  async function handleSaveSchool() {
    setSavingSchool(true)
    await saveSchoolProfile(schoolDraft)
    setSavedSchool(true); setTimeout(() => setSavedSchool(false), 2500); setSavingSchool(false)
  }

  function renderSchoolProfile() {
    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Institutional Details</SectionLabel>
          <p className="text-xs text-[#71717A] mb-4">
            These appear on the letterhead and footer of every generated certificate. The school
            name, tagline and logo come from the Branding tab.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="CBSE Affiliation No.">
              <TextInput value={schoolDraft.affiliation_no} onChange={v => updateSchool({ affiliation_no: v })} placeholder="e.g. 1930456" />
            </Field>
            <Field label="School Code">
              <TextInput value={schoolDraft.school_code} onChange={v => updateSchool({ school_code: v })} placeholder="e.g. 56789" />
            </Field>
            <Field label="Recognition / DISE No.">
              <TextInput value={schoolDraft.recognition_no} onChange={v => updateSchool({ recognition_no: v })} placeholder="State recognition number" />
            </Field>
            <Field label="Principal Name">
              <TextInput value={schoolDraft.principal_name} onChange={v => updateSchool({ principal_name: v })} placeholder="e.g. Dr. A. Sharma" />
            </Field>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Address &amp; Contact</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Street Address">
                <TextInput value={schoolDraft.address} onChange={v => updateSchool({ address: v })} placeholder="Building, street, area" />
              </Field>
            </div>
            <Field label="City"><TextInput value={schoolDraft.city} onChange={v => updateSchool({ city: v })} /></Field>
            <Field label="State"><TextInput value={schoolDraft.state} onChange={v => updateSchool({ state: v })} /></Field>
            <Field label="Pincode"><TextInput value={schoolDraft.pincode} onChange={v => updateSchool({ pincode: v })} /></Field>
            <Field label="Phone"><TextInput value={schoolDraft.phone} onChange={v => updateSchool({ phone: v })} /></Field>
            <Field label="Email"><TextInput value={schoolDraft.email} onChange={v => updateSchool({ email: v })} /></Field>
            <Field label="Website"><TextInput value={schoolDraft.website} onChange={v => updateSchool({ website: v })} placeholder="https://" /></Field>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>School Seal</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">Printed above the principal&apos;s signature on certificates.</p>
          <UploadField label="" currentUrl={schoolDraft.seal_url} uploading={!!uploadingMap['school-seal']}
            onUpload={f => uploadAndSet('school-seal', f, url => updateSchool({ seal_url: url }))}
            onClear={() => updateSchool({ seal_url: '' })} />
        </div>

        <SaveButton saving={savingSchool} saved={savedSchool} label="Save School Profile" onClick={handleSaveSchool} />
      </div>
    )
  }

  function renderBranding() {
    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>App Identity</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="App Title (navbar)">
              <TextInput value={draftBranding.appTitle} onChange={v => updateBranding({ appTitle: v })} placeholder="MPS Web" />
            </Field>
            <Field label="App Subtitle (navbar)">
              <TextInput value={draftBranding.appSubtitle} onChange={v => updateBranding({ appSubtitle: v })} placeholder="School Name" />
            </Field>
            <Field label="School Name">
              <TextInput value={draftBranding.schoolName} onChange={v => updateBranding({ schoolName: v })} placeholder="School name" />
            </Field>
            <Field label="Tagline">
              <TextInput value={draftBranding.tagline} onChange={v => updateBranding({ tagline: v })} placeholder="Excel · Enrich · Enlighten" />
            </Field>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Logo &amp; Favicon</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadField label="App Logo" currentUrl={draftBranding.logoUrl} uploading={!!uploadingMap['logo']} previewCircle
              onUpload={f => uploadAndSet('logo', f, url => updateBranding({ logoUrl: url }))}
              onClear={() => updateBranding({ logoUrl: '' })} />
            <UploadField label="Favicon" currentUrl={draftBranding.faviconUrl} uploading={!!uploadingMap['favicon']}
              onUpload={f => uploadAndSet('favicon', f, url => updateBranding({ faviconUrl: url }))}
              onClear={() => updateBranding({ faviconUrl: '' })} />
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Brand Colors</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">Used for primary UI accents, buttons, and gradients across the app.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Primary Color">
              <ColorInput value={draftBranding.primaryColor} onChange={v => updateBranding({ primaryColor: v })} label="Primary" />
            </Field>
            <Field label="Secondary Color">
              <ColorInput value={draftBranding.secondaryColor} onChange={v => updateBranding({ secondaryColor: v })} label="Secondary" />
            </Field>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Preview</SectionLabel>
          <div className="flex items-center gap-3 p-3 bg-white border border-[#D4D4D8] w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draftBranding.logoUrl || '/logo.png'} alt="" className="w-10 h-10 object-cover border border-[#D4D4D8]" style={{ borderRadius: '50%' }}
              onError={e => { (e.target as HTMLImageElement).src = '/logo.png' }} />
            <div>
              <p className="text-sm font-bold" style={{ backgroundImage: `linear-gradient(135deg, ${draftBranding.primaryColor}, ${draftBranding.secondaryColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {draftBranding.appTitle || 'App Title'}
              </p>
              <p className="text-xs text-[#71717A]">{draftBranding.appSubtitle || 'School name'}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderPageIcons() {
    return (
      <div className="flex flex-col sm:flex-row gap-0 min-h-[480px]">
        {/* Page list */}
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-[#E4E4E7] p-1 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-visible flex-shrink-0">
          {PAGE_IDS.map(pageId => {
            const cfg = draftIcons[pageId]
            const Icon = ICON_MAP[cfg.iconName]
            return (
              <button key={pageId} onClick={() => setSelectedPage(pageId)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all flex-shrink-0 w-full text-left border-l-2 ${selectedPage === pageId ? 'border-l-[#525252] bg-[#E4E4E7] text-[#18181B]' : 'border-l-transparent text-[#71717A] hover:bg-[#EBEBEB] hover:text-[#18181B]'}`}>
                <div className={`p-0.5 bg-gradient-to-br ${cfg.gradientFrom} ${cfg.gradientTo} flex-shrink-0 overflow-hidden`} style={{ width: 18, height: 18 }}>
                  {cfg.customImageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cfg.customImageUrl} alt="" className="w-full h-full object-cover" />
                    : Icon && <Icon size={12} className="text-white" />
                  }
                </div>
                <span className="truncate">{PAGE_LABELS[pageId]}</span>
              </button>
            )
          })}
        </div>

        {/* Editor */}
        <div className="flex-1 p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#18181B]">{PAGE_LABELS[selectedPage]}</h3>
            <button onClick={() => setDraftIcons(prev => ({ ...prev, [selectedPage]: PAGE_DEFAULTS[selectedPage] }))}
              className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#18181B] transition-colors">
              <RotateCcw size={10} /> Reset
            </button>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[#F5F5F5] border border-[#E4E4E7] mb-4">
            <div className={`p-2 bg-gradient-to-br ${currentIcon.gradientFrom} ${currentIcon.gradientTo} overflow-hidden`}>
              {currentIcon.customImageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={currentIcon.customImageUrl} alt="" className="w-6 h-6 object-cover" />
                : (() => { const I = ICON_MAP[currentIcon.iconName]; return I ? <I className="text-white" size={22} /> : null })()
              }
            </div>
            <div>
              <p className="text-sm font-bold text-[#18181B]">{PAGE_LABELS[selectedPage]}</p>
              <p className="text-[10px] text-[#A1A1AA] uppercase tracking-widest">Live preview</p>
            </div>
          </div>

          <div className="mb-4">
            <SectionLabel>Custom Image (overrides icon)</SectionLabel>
            <UploadField label="" currentUrl={currentIcon.customImageUrl ?? ''} uploading={!!uploadingMap[`icon-${selectedPage}`]}
              onUpload={f => uploadAndSet(`icon-${selectedPage}`, f, url => updateIcon(selectedPage, { customImageUrl: url }))}
              onClear={() => updateIcon(selectedPage, { customImageUrl: undefined })} />
          </div>

          <div className="mb-4">
            <SectionLabel>Preset Icon</SectionLabel>
            <div className="grid grid-cols-8 gap-1">
              {AVAILABLE_ICONS.map(name => {
                const Icon = ICON_MAP[name]
                if (!Icon) return null
                const isSelected = currentIcon.iconName === name && !currentIcon.customImageUrl
                return (
                  <button key={name} title={name}
                    onClick={() => updateIcon(selectedPage, { iconName: name, customImageUrl: undefined })}
                    className={`p-2 flex items-center justify-center transition-all border ${isSelected ? 'border-[#27272A] bg-[#27272A] text-white' : 'border-[#E4E4E7] bg-[#F5F5F5] hover:border-[#525252] text-[#71717A]'}`}>
                    <Icon size={13} />
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Icon Background Color</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {GRADIENT_OPTIONS.map(opt => {
                const isSelected = currentIcon.gradientFrom === opt.from && currentIcon.gradientTo === opt.to
                return (
                  <button key={opt.label}
                    onClick={() => updateIcon(selectedPage, { gradientFrom: opt.from, gradientTo: opt.to })}
                    className={`flex items-center gap-2 px-2.5 py-2 text-xs border transition-all ${isSelected ? 'border-[#27272A] bg-white shadow-sm' : 'border-[#E4E4E7] bg-[#F5F5F5] hover:bg-white hover:border-[#D4D4D8]'}`}>
                    <div className={`w-4 h-4 bg-gradient-to-br ${opt.from} ${opt.to} flex-shrink-0`} />
                    <span className="text-[#71717A] truncate">{opt.label}</span>
                    {isSelected && <Check size={9} className="ml-auto text-[#525252] flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderPageThemes() {
    const PAGE_THEME_LABELS: Record<string, string> = {
      home: 'Home', announcements: 'Announcements', tasks: 'Tasks',
      academics: 'Academics', exam: 'Exams', bus: 'Bus & Transport',
      'staff-attendance': 'Staff Attendance', 'student-attendance': 'Student Attendance',
      'staff-leave': 'Staff Leave', 'student-leave': 'Student OD/Leave',
      fees: 'Fees', salary: 'Salary', timetable: 'Timetable', feedback: 'Feedback',
    }
    const themePages = ['home', 'announcements', 'tasks', 'academics', 'exam', 'student-attendance', 'staff-attendance', 'student-leave', 'staff-leave', 'fees', 'salary', 'bus', 'timetable', 'feedback']
    const t = selectedThemePage

    return (
      <div className="flex flex-col sm:flex-row gap-0 min-h-[480px]">
        <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-[#E4E4E7] p-1 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-y-auto sm:overflow-visible flex-shrink-0">
          {themePages.map(pageId => {
            const theme = draftThemes[pageId]
            return (
              <button key={pageId} onClick={() => setSelectedThemePage(pageId)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all flex-shrink-0 w-full text-left border-l-2 ${t === pageId ? 'border-l-[#525252] bg-[#E4E4E7] text-[#18181B]' : 'border-l-transparent text-[#71717A] hover:bg-[#EBEBEB] hover:text-[#18181B]'}`}>
                <div className="w-3.5 h-3.5 flex-shrink-0 border border-[#D4D4D8]"
                  style={{ background: theme ? `linear-gradient(135deg,${theme.gradFrom},${theme.gradTo})` : '#e2e8f0' }} />
                <span className="truncate">{PAGE_THEME_LABELS[pageId] ?? pageId}</span>
                {theme && <span className="ml-auto text-[9px] bg-[#E4E4E7] text-[#71717A] px-1">●</span>}
              </button>
            )
          })}
        </div>

        <div className="flex-1 p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#18181B]">{PAGE_THEME_LABELS[t] ?? t} — Page Theme</h3>
            {draftThemes[t] && (
              <button onClick={() => setDraftThemes(prev => { const n = { ...prev }; delete n[t]; return n })}
                className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#18181B] transition-colors">
                <RotateCcw size={10} /> Reset to default
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 mb-4">Choose a preset palette to override this page&apos;s default color theme. These colours affect the page background, primary buttons, accents, and icon colours.</p>

          {(['light', 'dark'] as const).map(variant => (
            <div key={variant} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-3 h-3 rounded-full border ${variant === 'light' ? 'bg-white border-slate-300' : 'bg-slate-800 border-slate-600'}`} />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {variant === 'light' ? 'Light Palettes' : 'Dark Palettes'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {THEME_PALETTES.filter(p => p.variant === variant).map(({ id, label, theme }) => {
                  const current = draftThemes[t]
                  const isSelected = current?.primary === theme.primary
                  return (
                    <button key={id}
                      onClick={() => setDraftThemes(prev => ({ ...prev, [t]: theme }))}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all ${isSelected ? 'border-slate-400 bg-white shadow-sm' : 'border-transparent bg-slate-50 hover:bg-white hover:border-slate-200'}`}>
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <div className="w-8 h-5 rounded-t-lg shadow-sm"
                          style={{ backgroundImage: swatchBackground(theme.gradFrom, theme.gradTo), backgroundSize: '120px, auto', backgroundBlendMode: 'soft-light' }} />
                        <div className="w-8 h-3 rounded-b-lg border border-slate-200"
                          style={{ background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgMid}, ${theme.bgTo})` }} />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-700">{label}</p>
                        <div className="flex gap-1 mt-0.5">
                          {[theme.primary, theme.accent, theme.bgFrom].map(c => (
                            <span key={c} className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: c }} />
                          ))}
                        </div>
                      </div>
                      {isSelected && <Check size={14} className="ml-auto text-slate-500 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {draftThemes[t] && (
            <div className="mt-5 pt-4 border-t border-[#E4E4E7]">
              <SectionLabel>Fine-tune Colors</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary"><ColorInput value={draftThemes[t]!.primary} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, primary: v } }))} label="Primary" /></Field>
                <Field label="Accent"><ColorInput value={draftThemes[t]!.accent} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, accent: v } }))} label="Accent" /></Field>
                <Field label="Gradient Start"><ColorInput value={draftThemes[t]!.gradFrom} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, gradFrom: v } }))} label="Grad Start" /></Field>
                <Field label="Gradient End"><ColorInput value={draftThemes[t]!.gradTo} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, gradTo: v } }))} label="Grad End" /></Field>
                <Field label="Background Start"><ColorInput value={draftThemes[t]!.bgFrom ?? '#f8fafc'} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, bgFrom: v } }))} label="Bg Start" /></Field>
                <Field label="Background Mid"><ColorInput value={draftThemes[t]!.bgMid ?? '#f1f5f9'} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, bgMid: v } }))} label="Bg Mid" /></Field>
                <Field label="Background End"><ColorInput value={draftThemes[t]!.bgTo ?? '#f9fafb'} onChange={v => setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, bgTo: v } }))} label="Bg End" /></Field>
                <div className="col-span-2">
                  <p className="text-[10px] text-[#71717A] mb-1 uppercase tracking-widest">Background preview</p>
                  <div className="h-5 border border-[#E4E4E7]" style={{ background: `linear-gradient(135deg, ${draftThemes[t]!.bgFrom ?? '#f8fafc'}, ${draftThemes[t]!.bgMid ?? '#f1f5f9'}, ${draftThemes[t]!.bgTo ?? '#f9fafb'})` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderLogin() {
    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Text Content</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="School Name (left panel)"><TextInput value={draftLogin.schoolName} onChange={v => updateLogin({ schoolName: v })} /></Field>
            <Field label="Tagline"><TextInput value={draftLogin.tagline} onChange={v => updateLogin({ tagline: v })} /></Field>
            <Field label="Welcome Text"><TextInput value={draftLogin.welcomeText} onChange={v => updateLogin({ welcomeText: v })} /></Field>
          </div>
        </div>
        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Panel Gradient</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1 (top)"><ColorInput value={draftLogin.gradientFrom} onChange={v => updateLogin({ gradientFrom: v })} label="From" /></Field>
            <Field label="Color 2 (mid)"><ColorInput value={draftLogin.gradientMid} onChange={v => updateLogin({ gradientMid: v })} label="Mid" /></Field>
            <Field label="Color 3 (bottom)"><ColorInput value={draftLogin.gradientTo} onChange={v => updateLogin({ gradientTo: v })} label="To" /></Field>
          </div>
          <div className="mt-2 h-7 border border-[#E4E4E7]" style={{ background: `linear-gradient(135deg, ${draftLogin.gradientFrom}, ${draftLogin.gradientMid}, ${draftLogin.gradientTo})` }} />
        </div>
        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Right Panel Background</SectionLabel>
          <p className="text-[10px] text-[#A1A1AA] -mt-2 mb-3">The light panel on the right side of the login screen</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1"><ColorInput value={draftLogin.pageBgFrom ?? '#f0f9ff'} onChange={v => updateLogin({ pageBgFrom: v })} label="From" /></Field>
            <Field label="Color 2"><ColorInput value={draftLogin.pageBgMid ?? '#f5f3ff'} onChange={v => updateLogin({ pageBgMid: v })} label="Mid" /></Field>
            <Field label="Color 3"><ColorInput value={draftLogin.pageBgTo ?? '#f0fdf4'} onChange={v => updateLogin({ pageBgTo: v })} label="To" /></Field>
          </div>
          <div className="mt-2 h-7 border border-[#E4E4E7]" style={{ background: `linear-gradient(135deg, ${draftLogin.pageBgFrom ?? '#f0f9ff'}, ${draftLogin.pageBgMid ?? '#f5f3ff'}, ${draftLogin.pageBgTo ?? '#f0fdf4'})` }} />
        </div>
        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Sign In Button</SectionLabel>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Button Color">
              <ColorInput value={draftLogin.buttonColor ?? draftLogin.gradientFrom} onChange={v => updateLogin({ buttonColor: v })} label="Button" />
            </Field>
            <Field label="Button Text Color">
              <ColorInput value={draftLogin.buttonTextColor ?? '#ffffff'} onChange={v => updateLogin({ buttonTextColor: v })} label="Text" />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="flex items-center justify-center px-6 py-2.5 rounded-lg text-sm font-semibold w-36"
              style={{
                background: draftLogin.buttonColor ?? draftLogin.gradientFrom,
                color: draftLogin.buttonTextColor ?? '#ffffff',
              }}
            >
              Sign In Preview
            </div>
            <p className="text-[10px] text-[#A1A1AA]">Live preview of the Sign In button</p>
          </div>
        </div>
        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Background Image (optional)</SectionLabel>
          <UploadField label="Displayed as a subtle overlay on the left panel" currentUrl={draftLogin.bgImageUrl} uploading={!!uploadingMap['login-bg']}
            onUpload={f => uploadAndSet('login-bg', f, url => updateLogin({ bgImageUrl: url }))}
            onClear={() => updateLogin({ bgImageUrl: '' })} />
        </div>
        <div className="border-t border-[#E4E4E7] pt-5">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Feature List (bullet points)</SectionLabel>
            <button onClick={addFeature} className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#18181B] font-medium transition-colors">
              <Plus size={11} /> Add
            </button>
          </div>
          <div className="space-y-2">
            {draftLogin.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput value={f} onChange={v => updateFeature(i, v)} placeholder={`Feature ${i + 1}`} />
                <button onClick={() => removeFeature(i)} className="text-[#D4D4D8] hover:text-rose-400 transition-colors flex-shrink-0"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderGeofence() {
    return (
      <div className="space-y-5">
        <div>
          <SectionLabel>Geofencing (Staff Attendance)</SectionLabel>
          <p className="text-xs text-[#71717A] mb-4">When enabled, staff must be within the set radius of school coordinates during self check-in.</p>

          <div className="flex items-center gap-3 p-3 bg-[#F5F5F5] border border-[#E4E4E7] mb-4">
            <button
              role="switch" aria-checked={geofenceDraft.enabled}
              onClick={() => setGeofenceDraft(prev => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none ${geofenceDraft.enabled ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${geofenceDraft.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <div>
              <p className="text-sm font-medium text-[#18181B]">Enable Geofencing</p>
              <p className="text-xs text-[#71717A]">{geofenceDraft.enabled ? 'Active — GPS checked on check-in' : 'Disabled — no GPS required'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="School Latitude">
              <input type="number" step="0.000001" value={geofenceDraft.lat ?? ''} onChange={e => setGeofenceDraft(prev => ({ ...prev, lat: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="e.g. 12.971599" className={ai} />
            </Field>
            <Field label="School Longitude">
              <input type="number" step="0.000001" value={geofenceDraft.lng ?? ''} onChange={e => setGeofenceDraft(prev => ({ ...prev, lng: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="e.g. 77.594566" className={ai} />
            </Field>
            <Field label="Radius (metres)">
              <input type="number" min={10} max={5000} step={10} value={geofenceDraft.radius_m} onChange={e => setGeofenceDraft(prev => ({ ...prev, radius_m: parseInt(e.target.value, 10) || 200 }))} className={ai} />
            </Field>
          </div>

          <button onClick={getCurrentLocation} disabled={gettingLocation}
            className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#F5F5F5] text-[#18181B] border border-[#D4D4D8] hover:bg-[#EBEBEB] disabled:opacity-50 transition-colors">
            {gettingLocation ? <><Loader2 size={13} className="animate-spin" /> Getting location…</> : <><Navigation size={13} /> Get Current Location</>}
          </button>
          <p className="text-[11px] text-[#A1A1AA] mt-1">Auto-fills latitude and longitude from your browser&apos;s GPS.</p>

          {geofenceDraft.lat != null && geofenceDraft.lng != null && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-[#F5F5F5] border border-[#D4D4D8] text-sm text-[#18181B]">
              <MapPin size={13} className="text-[#71717A] flex-shrink-0" />
              <span>{geofenceDraft.lat.toFixed(6)}, {geofenceDraft.lng.toFixed(6)} — {geofenceDraft.radius_m}m radius</span>
            </div>
          )}
        </div>
        <div className="pt-3 border-t border-[#E4E4E7]">
          <button onClick={handleSaveGeofence} disabled={savingGeofence}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors">
            {savingGeofence ? <Loader2 size={13} className="animate-spin" /> : savedGeofence ? <Check size={13} /> : <Save size={13} />}
            {savingGeofence ? 'Saving…' : savedGeofence ? 'Saved!' : 'Save Geofence Settings'}
          </button>
        </div>
      </div>
    )
  }

  function renderAttendance() {
    const filteredStaff = exemptQuery.trim()
      ? staffList.filter(s => s.full_name.toLowerCase().includes(exemptQuery.trim().toLowerCase()) || s.email.toLowerCase().includes(exemptQuery.trim().toLowerCase()))
      : staffList
    const exemptCount = staffList.filter(s => s.geofence_exempt).length
    const dayTimingGroups = groupDayTimingRules(dayTimingRules)
    const holidayDateGroups = groupHolidayRules(holidayRules)

    if (!attendanceLoaded) {
      return <div className="py-12 text-center text-[#71717A] text-sm"><Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…</div>
    }

    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Late &amp; Checkout Timing</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">
            Staff who check in after the late cutoff are marked <strong>Late</strong>.
            Staff who check out before the checkout cutoff are marked <strong>Half Day</strong>.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Late cutoff (local time)">
              <input type="time" value={attendanceDraft.late_cutoff ?? ''} onChange={e => setAttendanceDraft(d => ({ ...d, late_cutoff: e.target.value || null }))}
                className="px-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
            </Field>
            {attendanceDraft.late_cutoff && (
              <button onClick={() => setAttendanceDraft(d => ({ ...d, late_cutoff: null }))} className="text-xs text-[#71717A] hover:text-[#18181B] pb-2 transition-colors">Clear</button>
            )}
            <Field label="Checkout cutoff (local time)">
              <input type="time" value={attendanceDraft.checkout_cutoff ?? ''} onChange={e => setAttendanceDraft(d => ({ ...d, checkout_cutoff: e.target.value || null }))}
                className="px-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
            </Field>
            {attendanceDraft.checkout_cutoff && (
              <button onClick={() => setAttendanceDraft(d => ({ ...d, checkout_cutoff: null }))} className="text-xs text-[#71717A] hover:text-[#18181B] pb-2 transition-colors">Clear</button>
            )}
            <button onClick={handleSaveAttendance} disabled={savingAttendance}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors">
              {savingAttendance ? <Loader2 size={13} className="animate-spin" /> : savedAttendance ? <Check size={13} /> : <Save size={13} />}
              {savingAttendance ? 'Saving…' : savedAttendance ? 'Saved!' : 'Save Timing'}
            </button>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <div className="flex items-center justify-between mb-1">
            <SectionLabel>Custom Cutoffs</SectionLabel>
            <button
              onClick={() => { setEditingScope(null); setShowTimingModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] transition-colors"
            >
              <Plus size={12} /> Add Override
            </button>
          </div>
          <p className="text-xs text-[#71717A] mb-3">
            Override the late/checkout cutoff above for a specific date, or repeat it every week on chosen weekdays — for everyone or just specific teams.
            The same control is available on the Staff Attendance page, next to each date.
          </p>
          {dayTimingGroups.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] flex items-center gap-1.5"><Clock size={12} className="text-[#71717A]" /> No cutoff overrides yet.</p>
          ) : (
            <div className="space-y-px max-h-72 overflow-y-auto">
              {dayTimingGroups.map(g => {
                const everyone = g.rows.find(r => r.is_default)
                const overrides = g.rows.filter(r => !r.is_default)
                return (
                  <div key={g.key} className="flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]">
                    {g.scope.type === 'weekday'
                      ? <Repeat size={13} className="text-[#71717A] flex-shrink-0" />
                      : <Clock size={13} className="text-[#71717A] flex-shrink-0" />}
                    <span className="text-sm font-medium text-[#18181B] flex-shrink-0">{g.label}</span>
                    <span className="text-sm text-[#71717A] flex-1 truncate">
                      {everyone
                        ? `Everyone: late after ${everyone.late_cutoff.slice(0, 5)}, half day before ${everyone.checkout_cutoff.slice(0, 5)}`
                        : `${overrides.length} team override${overrides.length === 1 ? '' : 's'}`}
                    </span>
                    <button
                      onClick={() => { setEditingScope(g.scope); setShowTimingModal(true) }}
                      className="text-[#71717A] hover:text-[#18181B] transition-colors flex-shrink-0 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleClearDayTiming(g.scope)}
                      disabled={clearingScopeKey === g.key}
                      className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0 disabled:opacity-50"
                    >
                      {clearingScopeKey === g.key ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <div className="flex items-center justify-between mb-1">
            <SectionLabel>Holidays</SectionLabel>
            <button
              onClick={() => { setEditingHolidayDate(null); setShowHolidayModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] transition-colors"
            >
              <Plus size={12} /> Add Holiday
            </button>
          </div>
          <p className="text-xs text-[#71717A] mb-3">
            Declare a holiday for the whole school, or just specific teams. Staff aren&apos;t auto-marked absent when covered.
            The same control is available on the Staff Attendance page.
          </p>
          {holidayDateGroups.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] flex items-center gap-1.5"><CalendarOff size={12} className="text-[#71717A]" /> No holidays declared yet.</p>
          ) : (
            <div className="space-y-px max-h-64 overflow-y-auto">
              {holidayDateGroups.map(g => {
                const everyone = g.rows.find(r => r.is_default)
                const overrides = g.rows.filter(r => !r.is_default)
                return (
                  <div key={g.date} className="flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]">
                    <CalendarOff size={13} className="text-[#71717A] flex-shrink-0" />
                    <span className="text-sm font-medium text-[#18181B] flex-shrink-0">{g.label}</span>
                    <span className="text-sm text-[#71717A] flex-1 truncate">
                      {everyone ? everyone.name : `${overrides.length} team holiday${overrides.length === 1 ? '' : 's'}`}
                    </span>
                    <button
                      onClick={() => { setEditingHolidayDate(g.date); setShowHolidayModal(true) }}
                      className="text-[#71717A] hover:text-[#18181B] transition-colors flex-shrink-0 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleClearHoliday(g.date)}
                      disabled={clearingHolidayDate === g.date}
                      className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0 disabled:opacity-50"
                    >
                      {clearingHolidayDate === g.date ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Geofence Exemptions</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">Exempted staff can check in outside the school geofence ({exemptCount} exempted).</p>
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
            <input type="text" value={exemptQuery} onChange={e => setExemptQuery(e.target.value)} placeholder="Search staff…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
          </div>
          <div className="space-y-px max-h-80 overflow-y-auto">
            {filteredStaff.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#18181B] truncate">{s.full_name}</p>
                  <p className="text-[11px] text-[#71717A] truncate capitalize">{s.role} · {s.email}</p>
                </div>
                {s.geofence_exempt && <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0" />}
                <button
                  role="switch" aria-checked={!!s.geofence_exempt} disabled={exemptSaving === s.id}
                  onClick={() => handleToggleExempt(s)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${s.geofence_exempt ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${s.geofence_exempt ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
            {filteredStaff.length === 0 && <p className="text-xs text-[#A1A1AA] py-3 text-center">No staff match your search.</p>}
          </div>
        </div>

        {showTimingModal && profile && (
          <DayTimingModalDynamic
            initialDate={new Date().toISOString().split('T')[0]}
            initialScope={editingScope ?? undefined}
            viewerId={profile.id}
            teams={dayTimingTeams}
            allStaff={trackedStaff}
            onClose={() => { setShowTimingModal(false); setEditingScope(null) }}
            onSaved={() => { reloadDayTimingRules(); setEditingScope(null) }}
          />
        )}

        {showHolidayModal && profile && (
          <HolidayModalDynamic
            initialDate={editingHolidayDate ?? new Date().toISOString().split('T')[0]}
            viewerId={profile.id}
            teams={dayTimingTeams}
            allStaff={trackedStaff}
            onClose={() => { setShowHolidayModal(false); setEditingHolidayDate(null) }}
            onSaved={() => { reloadHolidayRules(); setEditingHolidayDate(null) }}
          />
        )}
      </div>
    )
  }

  function renderBanners() {
    const selected = PAGE_BANNERS.find(p => p.key === selectedBannerKey) ?? PAGE_BANNERS[0]
    const draft = bannerDrafts[selectedBannerKey] ?? selected.default

    return (
      <div className="space-y-6">
        {/* Image uploads — home & profile */}
        <div>
          <SectionLabel>Image Banners</SectionLabel>
          <div className="space-y-4">
            <UploadField label="Home Page Banner Image" currentUrl={''} uploading={!!uploadingMap['home-banner']}
              onUpload={async f => {
                setUploading('home-banner', true)
                const url = await uploadSiteAsset(f, 'welcome_banner')
                if (url) {
                  const { supabase } = await import('@/lib/supabase')
                  await supabase.from('site_settings').upsert({ key: 'welcome_banner', value: url }, { onConflict: 'key' })
                }
                setUploading('home-banner', false)
              }}
              onClear={async () => {
                const { supabase } = await import('@/lib/supabase')
                await supabase.from('site_settings').upsert({ key: 'welcome_banner', value: '' }, { onConflict: 'key' })
              }} />
            <UploadField label="Profile Page Banner Image" currentUrl={''} uploading={!!uploadingMap['profile-banner']}
              onUpload={async f => {
                setUploading('profile-banner', true)
                const url = await uploadSiteAsset(f, 'profile_banner')
                if (url) {
                  const { supabase } = await import('@/lib/supabase')
                  await supabase.from('site_settings').upsert({ key: 'profile_banner', value: url }, { onConflict: 'key' })
                }
                setUploading('profile-banner', false)
              }}
              onClear={async () => {
                const { supabase } = await import('@/lib/supabase')
                await supabase.from('site_settings').upsert({ key: 'profile_banner', value: '' }, { onConflict: 'key' })
              }} />
          </div>
        </div>

        {/* Per-page gradient banners */}
        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Page Gradient Banners</SectionLabel>
          <p className="text-xs text-[#71717A] mb-4">Customise the header banner colour for each page. Changes take effect immediately for all users.</p>

          {!bannersLoaded ? (
            <div className="py-10 text-center text-[#71717A] text-sm">
              <Loader2 size={15} className="animate-spin inline mr-2 text-[#71717A]" /> Loading…
            </div>
          ) : (
            <div className="flex border border-[#D4D4D8] overflow-hidden min-h-[380px]">
              {/* Page list sidebar */}
              <div className="w-40 border-r border-[#E4E4E7] flex flex-col flex-shrink-0 overflow-y-auto">
                {PAGE_BANNERS.map(p => {
                  const cfg = bannerDrafts[p.key] ?? p.default
                  const isSelected = p.key === selectedBannerKey
                  return (
                    <button
                      key={p.key}
                      onClick={() => setSelectedBannerKey(p.key)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-left transition-all border-l-2 ${
                        isSelected
                          ? 'border-l-[#525252] bg-[#E4E4E7] text-[#18181B]'
                          : 'border-l-transparent text-[#71717A] hover:bg-[#EBEBEB] hover:text-[#18181B]'
                      }`}
                    >
                      <div
                        className="w-4 h-4 flex-shrink-0 border border-[#D4D4D8]"
                        style={{ background: `linear-gradient(135deg, ${cfg.gradFrom}, ${cfg.gradTo})` }}
                      />
                      <span className="truncate">{p.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Editor panel */}
              <div className="flex-1 p-5 space-y-5 overflow-y-auto bg-[#F5F5F5]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#18181B]">{selected.label}</h3>
                  <button
                    onClick={() => updateBannerDraft(selectedBannerKey, selected.default)}
                    className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#18181B] transition-colors"
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                </div>

                {/* Live preview strip — text colour mirrors the live banner */}
                {(() => {
                  const previewDark = draft.imageUrl ? true : isDarkLum(gradientLuminance(draft.gradFrom, draft.gradTo))
                  const previewStyle: React.CSSProperties = draft.imageUrl
                    ? { backgroundImage: `url(${draft.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { backgroundImage: swatchBackground(draft.gradFrom, draft.gradTo), backgroundSize: '160px, auto', backgroundBlendMode: 'soft-light' }
                  return (
                    <div className="h-12 border border-[#D4D4D8] flex items-center px-4 gap-3" style={previewStyle}>
                      <div className={`w-7 h-7 flex items-center justify-center ${previewDark ? 'bg-white/20' : 'bg-black/10'}`}>
                        <Layout size={14} className={previewDark ? 'text-white' : 'text-slate-800'} />
                      </div>
                      <div>
                        <p className={`text-xs font-bold leading-tight ${previewDark ? 'text-white' : 'text-slate-900'}`}>{selected.label}</p>
                        <p className={`text-[10px] leading-tight ${previewDark ? 'text-white/70' : 'text-slate-600'}`}>Banner preview</p>
                      </div>
                    </div>
                  )
                })()}

                {/* Preset swatches — 4 bright + 4 dark, with mild grain */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-2">Presets</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {BANNER_PRESETS.map(preset => {
                      const isActive = draft.gradFrom === preset.from && draft.gradTo === preset.to
                      return (
                        <button
                          key={preset.label}
                          onClick={() => updateBannerDraft(selectedBannerKey, { gradFrom: preset.from, gradTo: preset.to, imageUrl: '' })}
                          className={`relative flex flex-col overflow-hidden border transition-all ${isActive ? 'border-[#27272A] shadow-sm' : 'border-[#D4D4D8] hover:border-[#71717A]'}`}
                        >
                          <div className="h-6" style={{ backgroundImage: swatchBackground(preset.from, preset.to), backgroundSize: '120px, auto', backgroundBlendMode: 'soft-light' }} />
                          <span className="text-[10px] text-[#71717A] py-1 bg-white text-center">{preset.label}</span>
                          {isActive && <Check size={9} className={`absolute top-1 right-1 drop-shadow ${preset.variant === 'bright' ? 'text-slate-900' : 'text-white'}`} />}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Custom colours */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-2">Custom Colours</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Gradient Start">
                      <ColorInput value={draft.gradFrom} onChange={v => updateBannerDraft(selectedBannerKey, { gradFrom: v })} label="Start" />
                    </Field>
                    <Field label="Gradient End">
                      <ColorInput value={draft.gradTo} onChange={v => updateBannerDraft(selectedBannerKey, { gradTo: v })} label="End" />
                    </Field>
                  </div>
                </div>

                {/* Save */}
                <button
                  onClick={() => handleSaveBanner(selectedBannerKey)}
                  disabled={bannerSaving === selectedBannerKey}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors"
                >
                  {bannerSaving === selectedBannerKey
                    ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                    : bannerSaved === selectedBannerKey
                    ? <><Check size={13} /> Saved!</>
                    : <><Save size={13} /> Save {selected.label} Banner</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Inline gateway editor (Razorpay / UPI / Smart Collect) ──
  // ctx switches the user-facing copy & webhook endpoints between the Fees and Bus modules.
  // Both modules share the same underlying gateway credentials site-wide.
  function renderGatewayEditor(ctx: 'fees' | 'bus') {
    const isBus = ctx === 'bus'
    const payer = isBus ? 'passengers' : 'students'
    const rzpWebhook = isBus ? '/api/bus/razorpay/webhook' : '/api/fees/razorpay/webhook'
    const upiWebhook = isBus ? '/api/bus/upi/webhook' : '/api/fees/upi/webhook'

    if (!gatewayLoaded) {
      return <div className="py-12 text-center text-[#71717A] text-sm"><Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…</div>
    }

    const gatewaySteps: SetupStep[] = [
      { title: 'Pick how you’ll collect', body: <>The two no-fee options need no gateway sign-up: a <strong>UPI QR</strong> {payer} scan, plus <strong>auto-reconciliation</strong> so payments tick off by themselves. Add <strong>Razorpay</strong> later only if you also want card / netbanking.</> },
      { title: 'Add your UPI ID (fee-free)', body: <>Enter the school&apos;s UPI ID (VPA) and payee name in the UPI card below. {payer === 'passengers' ? 'Passengers' : 'Students'} scan and pay you directly — no gateway cut — each fee carrying a unique reference.</> },
      { title: 'Turn on auto-reconciliation', body: <>In <strong>Smart Collect</strong>, switch on auto-confirm and choose a matching mode: <em>Reference</em> (one UPI ID, unique reference per fee) or <em>Virtual VPA</em> (provider allots a unique VPA per fee). This is what marks fees paid automatically instead of by hand.</> },
      { title: 'Connect your bank / PSP webhook', body: <>Copy the Smart Collect <strong>Webhook URL</strong> below into your bank or PSP dashboard for incoming-payment notifications, and paste its signing secret into <em>Webhook Secret</em>. Virtual-VPA mode also needs the API base URL and key.</> },
      { title: 'Add Razorpay (optional, for cards)', body: <>Want card &amp; netbanking too? Open a free Razorpay account, paste the <em>Key ID</em> / <em>Key Secret</em> below, and add a <em>payment.captured</em> webhook using the Razorpay Webhook URL on that card.</> },
      { title: 'Enable, save & test', body: <>Flip on the methods you&apos;re using, press <strong>Save</strong>, then send a small test (a ₹1 UPI payment, or a <code>rzp_test_…</code> card) to confirm it reconciles end-to-end.</> },
    ]
    const gatewaySafety: React.ReactNode[] = [
      <>Every key and secret is stored <strong>admin-only</strong> — {payer} can never read them, and nothing is baked into the server code.</>,
      <>Money lands <strong>directly in your own Razorpay / bank account</strong>; the app only records that a payment happened — it never holds your funds.</>,
      <>Incoming webhooks are <strong>signature-verified (HMAC)</strong>, so a payment notification can&apos;t be forged.</>,
      <>You stay in full control: start in test mode, then rotate or remove any credential whenever you like.</>,
    ]

    return (
      <div className="space-y-5">
        <SetupGuide steps={gatewaySteps} safety={gatewaySafety} />

        <InfoNote tone="info">
          These gateway credentials are shared site-wide — the same Razorpay / UPI / Smart Collect configuration powers
          both the {isBus ? 'Bus' : 'Fees'} and {isBus ? 'Fees' : 'Bus'} modules. Enter your own keys here; nothing is set via server env vars.
        </InfoNote>

        {/* UPI QR */}
        <SettingsCard icon={<QrCode size={15} className="text-[#B8983C]" />} title="UPI QR (no gateway fee)">
          <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
            {isBus
              ? 'Passengers scan a UPI QR and pay you directly — bypassing the Razorpay cut. They then submit their UPI transaction reference, which you verify on the Fees dashboard.'
              : 'Students scan a UPI QR and pay you directly — bypassing the Razorpay cut. Each fee carries a unique reference you verify on the Issued dashboard (or auto-confirm via Smart Collect below).'}
          </p>
          <div className="space-y-3">
            <Field label="UPI ID (VPA)">
              <TextInput value={upi.vpa} onChange={v => setUpi({ ...upi, vpa: v })} placeholder="schoolname@okhdfcbank" />
            </Field>
            <Field label="Payee name">
              <TextInput value={upi.payee_name} onChange={v => setUpi({ ...upi, payee_name: v })} placeholder={isBus ? 'ABC School Transport' : 'ABC School'} />
            </Field>
          </div>
          <SaveButton saving={gwSaving === 'upi'} saved={gwSaved === 'upi'} label="Save UPI" onClick={() => saveGateway('upi')} />
        </SettingsCard>

        {/* Smart Collect */}
        <SettingsCard icon={<ShieldCheck size={15} className="text-[#B8983C]" />} title="Auto-reconciliation (Smart Collect)">
          <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
            When enabled, your bank/PSP notifies the app the moment a UPI payment lands, and the fee is marked paid
            automatically — {payer} never self-declare. Needs the UPI ID above and a bank/PSP that posts an
            incoming-payment webhook.
          </p>
          <ToggleRow label="Auto-confirm UPI payments via webhook" checked={sc.enabled} onChange={() => setSc({ ...sc, enabled: !sc.enabled })} />
          {sc.enabled ? (
            <>
              <div className="space-y-3">
                <Field label="Matching mode">
                  <select value={sc.mode} onChange={e => setSc({ ...sc, mode: e.target.value as SmartCollectConfig['mode'] })} className={selectCls}>
                    <option value="reference">Reference — keep your one UPI ID, match by a unique reference per fee (simplest, no provider API)</option>
                    <option value="virtual_vpa">Virtual VPA — provider allots a unique VPA per fee (needs the provider API below)</option>
                  </select>
                </Field>
                <Field label="Provider name (label)">
                  <TextInput value={sc.provider_name} onChange={v => setSc({ ...sc, provider_name: v })} placeholder="e.g. ICICI Eazypay / Cashfree" />
                </Field>
                <Field label="Webhook Secret">
                  <PwInput value={scSecrets.webhook_secret} onChange={v => setScSecrets({ ...scSecrets, webhook_secret: v })} placeholder="HMAC secret for the incoming-payment webhook" />
                </Field>
                {sc.mode === 'virtual_vpa' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="API base URL (virtual-VPA)">
                      <TextInput value={scSecrets.base_url} onChange={v => setScSecrets({ ...scSecrets, base_url: v })} placeholder="https://api.provider.com" />
                    </Field>
                    <Field label="API key (virtual-VPA)">
                      <PwInput value={scSecrets.api_key} onChange={v => setScSecrets({ ...scSecrets, api_key: v })} placeholder="Provider API key" />
                    </Field>
                  </div>
                )}
                <WebhookUrlField path={upiWebhook} />
              </div>
              <InfoNote>
                Register your bank/PSP&apos;s payment-received webhook using the Webhook URL above. The base URL and API key are
                only needed for virtual-VPA mode. Secrets are stored admin-only. The webhook field mapping lives
                in <code>src/lib/smartCollect.ts</code> — adjust it to your provider&apos;s payload.
              </InfoNote>
            </>
          ) : (
            <InfoNote tone="info">
              Auto-confirm is off, so paid UPI fees are verified by hand on the dashboard. Turn it on to reveal the matching
              mode and webhook setup.
            </InfoNote>
          )}
          <SaveButton saving={gwSaving === 'sc'} saved={gwSaved === 'sc'} label="Save Smart Collect" onClick={() => saveGateway('sc')} />
        </SettingsCard>

        {/* Razorpay — listed last: card/netbanking carries a gateway commission, so the fee-free UPI routes lead. */}
        <SettingsCard icon={<CreditCard size={15} className="text-[#B8983C]" />} title="Razorpay (cards / netbanking — commission applies)">
          <ToggleRow label={`Enable Razorpay checkout for ${payer}`} checked={rzp.enabled} onChange={() => setRzp({ ...rzp, enabled: !rzp.enabled })} />
          <div className="space-y-3">
            <Field label="Key ID (public)">
              <TextInput value={rzp.key_id} onChange={v => setRzp({ ...rzp, key_id: v })} placeholder="rzp_live_xxxxxxxx or rzp_test_xxxxxxxx" />
            </Field>
            <Field label="Key Secret">
              <PwInput value={rzpSecrets.key_secret} onChange={v => setRzpSecrets({ ...rzpSecrets, key_secret: v })} placeholder="Razorpay key secret" />
            </Field>
            <Field label="Webhook Secret">
              <PwInput value={rzpSecrets.webhook_secret} onChange={v => setRzpSecrets({ ...rzpSecrets, webhook_secret: v })} placeholder="HMAC secret for the payment.captured webhook" />
            </Field>
            <WebhookUrlField path={rzpWebhook} />
          </div>
          <InfoNote>
            Unlike UPI, card &amp; netbanking via Razorpay carries a per-transaction gateway commission — add it only if you
            need those methods. Secrets are stored admin-only (never readable by {payer}). In your Razorpay dashboard, add a
            <em> payment.captured</em> webhook pointing at the Webhook URL above and set its secret to the Webhook Secret here.
          </InfoNote>
          <SaveButton saving={gwSaving === 'rzp'} saved={gwSaved === 'rzp'} label="Save Razorpay" onClick={() => saveGateway('rzp')} />
        </SettingsCard>
      </div>
    )
  }

  // ── Inline payout editor (bank-transfer provider) ──
  // ctx switches the user-facing copy & webhook endpoint between the staff Salary and Driver payroll modules.
  // Both share the same site-wide payout provider configuration.
  function renderPayoutEditor(ctx: 'salary' | 'driver') {
    const isDriver = ctx === 'driver'
    const recipients = isDriver ? 'drivers' : 'staff'
    const period = isDriver ? 'payroll period' : 'cycle'
    const webhook = isDriver ? '/api/bus/payroll/payout/webhook' : '/api/salary/payout/webhook'

    if (!payoutLoaded) {
      return <div className="py-12 text-center text-[#71717A] text-sm"><Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…</div>
    }

    const payoutSteps: SetupStep[] = [
      { title: 'Pick how you’ll disburse', body: <>There are three ways to pay an approved {period}: <strong>export a bank CSV</strong> and upload it at your bank portal, <strong>trigger an automated payout</strong> via RazorpayX, or simply <strong>mark each record paid by hand</strong>. Keep the provider on <strong>Manual</strong> for the CSV and by-hand routes — no credentials needed.</> },
      { title: 'Add staff bank details', body: <>Both the CSV export and automated transfers pull from each {recipients} member&apos;s saved bank account (holder name, account number, IFSC). Anyone without bank details on file is skipped from the file / transfer, so add those first.</> },
      { title: 'For automated payouts: authorize your account', body: <>Switch the provider to <strong>Automated (RazorpayX)</strong>, link your school&apos;s own current account, and finish their KYC. The app is only granted permission to <em>request</em> transfers — it never custodies your money.</> },
      { title: 'Paste credentials & connect the webhook', body: <>Copy the provider&apos;s <em>Key ID</em>, <em>Key Secret</em> and <em>payout account number</em> below, then register the payout-status <strong>webhook</strong> (copy its URL from the field below) and paste the provider&apos;s signing secret into <em>Webhook Secret</em>.</> },
      { title: 'Status updates itself — or mark by hand', body: <>With an automated provider, a confirmed transfer fires the webhook and the record flips to <strong>Paid</strong> on its own. With the CSV or by-hand route there is no bank callback, so you tick each record <strong>Paid</strong> yourself once the money has gone out.</> },
    ]
    const payoutSafety: React.ReactNode[] = [
      <>The app <strong>never moves money on its own</strong> — it only requests a transfer after you approve a {period}.</>,
      <>Funds always leave <strong>your own authorized account</strong>; the app holds no balance and stores no card data.</>,
      <>Keys and secrets are encrypted, <strong>admin-only</strong>, and never visible to {recipients}.</>,
      <>Automated providers <strong>fail closed</strong> until you deliberately wire them up, so nothing can pay out by accident — and Manual mode keeps you fully in control.</>,
    ]

    return (
      <div className="space-y-5">
        <SetupGuide steps={payoutSteps} safety={payoutSafety} />

        <InfoNote tone="info">
          This is the <strong>same site-wide payout provider</strong> used by {isDriver ? 'the staff Salary Manager' : 'driver payroll'} —
          the school links its payout account once and it powers both driver and staff disbursement.
        </InfoNote>

        <SettingsCard icon={<Banknote size={15} className="text-[#B8983C]" />} title="Bank transfer provider">
          <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
            The app never moves money directly. When enabled, it calls a payout provider&apos;s bulk bank-transfer API
            (which the school authorizes against its own payout account) to disburse an approved {period}. When disabled,
            admins disburse manually and mark each record as paid.
          </p>
          <ToggleRow label="Enable automated payouts" checked={payoutCfg.enabled} onChange={() => setPayoutCfg({ ...payoutCfg, enabled: !payoutCfg.enabled })} />
          <div className="space-y-3">
            <Field label="Provider">
              <select value={payoutCfg.provider} onChange={e => setPayoutCfg({ ...payoutCfg, provider: e.target.value as PayoutConfig['provider'] })} className={selectCls}>
                <option value="manual">Manual — export bank CSV / pay via portal, mark paid by hand</option>
                <option value="razorpayx">Automated — bank transfer via RazorpayX</option>
              </select>
            </Field>
            <Field label="Key ID (public)">
              <TextInput value={payoutCfg.key_id} onChange={v => setPayoutCfg({ ...payoutCfg, key_id: v })} placeholder="e.g. rzp_live_xxxxxxxx" />
            </Field>
            <Field label="Key Secret">
              <PwInput value={payoutSecrets.key_secret} onChange={v => setPayoutSecrets({ ...payoutSecrets, key_secret: v })} placeholder="Provider API key secret" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Payout account number">
                <TextInput value={payoutSecrets.account_number} onChange={v => setPayoutSecrets({ ...payoutSecrets, account_number: v })} placeholder="School payout account" />
              </Field>
              <Field label="Webhook Secret">
                <PwInput value={payoutSecrets.webhook_secret} onChange={v => setPayoutSecrets({ ...payoutSecrets, webhook_secret: v })} placeholder="HMAC secret for payout webhook" />
              </Field>
            </div>
            <WebhookUrlField path={webhook} />
          </div>
          <InfoNote>
            Only needed for the automated provider: paste the Webhook URL above into RazorpayX&apos;s payout-status
            webhook so a confirmed transfer marks the record <em>Paid</em> automatically. Secrets are stored admin-only
            (never readable by {recipients}) and shared across staff &amp; driver payouts. The automated bank-transfer
            integration is stubbed and fails closed until wired up in <code>src/lib/payoutProvider.ts</code>.
          </InfoNote>
          <SaveButton saving={payoutSaving} saved={payoutSaved} label="Save settings" onClick={savePayout} />
        </SettingsCard>
      </div>
    )
  }

  function renderPayments() {
    return (
      <div>
        <InlineTabs
          value={paymentsSub} onChange={setPaymentsSub}
          items={[
            { id: 'fees',   label: 'Fee Setting',    icon: <CreditCard size={14} /> },
            { id: 'salary', label: 'Salary Payout',  icon: <Banknote size={14} /> },
          ]}
        />
        <div className="mb-4">
          <h3 className="text-sm font-bold text-[#18181B]">{paymentsSub === 'fees' ? 'Fee Settings' : 'Salary Payout Settings'}</h3>
          <p className="text-xs text-[#71717A]">{paymentsSub === 'fees' ? 'Configure how students pay school fees.' : 'Configure how salaries are disbursed to staff bank accounts.'}</p>
        </div>
        {paymentsSub === 'fees' ? renderGatewayEditor('fees') : renderPayoutEditor('salary')}
      </div>
    )
  }

  function renderBusFinance() {
    return (
      <div>
        <InlineTabs
          value={busSub} onChange={setBusSub}
          items={[
            { id: 'busfee', label: 'Bus Fee Setting',       icon: <CreditCard size={14} /> },
            { id: 'driver', label: 'Driver Salary Payout',  icon: <Banknote size={14} /> },
          ]}
        />
        <div className="mb-4">
          <h3 className="text-sm font-bold text-[#18181B]">{busSub === 'busfee' ? 'Bus Fee Settings' : 'Driver Salary Payout Settings'}</h3>
          <p className="text-xs text-[#71717A]">{busSub === 'busfee' ? 'Configure how passengers pay bus fees.' : 'Configure how driver salaries are disbursed to bank accounts.'}</p>
        </div>
        {busSub === 'busfee' ? renderGatewayEditor('bus') : renderPayoutEditor('driver')}
      </div>
    )
  }

  // ── Tab definitions ───────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'branding',    label: 'Branding',     icon: <Type size={13} />    },
    { id: 'school-profile', label: 'School Profile', icon: <Building2 size={13} /> },
    { id: 'page-themes', label: 'Themes',       icon: <Palette size={13} /> },
    { id: 'login',       label: 'Login Page',   icon: <LogIn size={13} />   },
    { id: 'banners',     label: 'Banners',      icon: <Layout size={13} />  },
    { id: 'geofence',    label: 'Geofencing',   icon: <MapPin size={13} />  },
    { id: 'attendance',  label: 'Attendance',   icon: <Clock size={13} />   },
    { id: 'payments',    label: 'Fees & Salary', icon: <CreditCard size={13} /> },
    { id: 'bus',         label: 'Bus Finance',  icon: <Bus size={13} />     },
  ]

  return (
    <ProtectedLayout adminOnly>
      {/* Mobile restriction */}
      <div className="md:hidden flex flex-col items-center justify-center py-20 px-6 text-center gap-4 min-h-screen" style={{ backgroundColor: '#FDFCF9' }}>
        <div className="p-4 bg-zinc-100 rounded-2xl">
          <Monitor size={36} className="text-zinc-400" />
        </div>
        <div>
          <p className="text-base font-semibold text-zinc-700">Desktop required</p>
          <p className="text-sm text-zinc-500 mt-1 max-w-xs">
            App Settings is designed for desktop use. Please open this page on a larger screen to configure your school app.
          </p>
        </div>
      </div>
      <div className="hidden md:block w-full px-4 sm:px-6 lg:px-8 py-8 min-h-screen" data-page-theme="admin" style={{ backgroundColor: '#FDFCF9' }}>

        {/* Header */}
        <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
              <Settings className="text-[#B8983C]" size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#18181B]">App Settings</h1>
              <p className="text-xs text-[#71717A]">Customize your school web app</p>
            </div>
          </div>
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Changes'}
          </button>
        </div>

        {/* Layout: sidebar + content */}
        <div className="flex border border-[#D4D4D8] overflow-hidden" style={{ height: 'calc(100vh - 11rem)' }}>

          {/* Sidebar tabs */}
          <div className="w-40 sm:w-44 bg-[#27272A] flex-shrink-0 flex flex-col overflow-y-auto">
            {tabs.map(t => (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-left transition-colors border-l-2 ${
                  tab === t.id
                    ? 'border-l-[#B8983C] bg-white/10 text-[#F5F5F5]'
                    : 'border-l-transparent text-[#F5F5F5]/50 hover:text-[#F5F5F5] hover:bg-white/5'
                }`}
              >
                <span className={tab === t.id ? 'text-white' : ''}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Content pane */}
          <div className="flex-1 bg-white overflow-y-auto">
            <div className="p-5 sm:p-6">
              {tab === 'branding'    && renderBranding()}
              {tab === 'school-profile' && renderSchoolProfile()}
              {tab === 'page-themes' && renderPageThemes()}
              {tab === 'login'       && renderLogin()}
              {tab === 'banners'     && renderBanners()}
              {tab === 'geofence'    && renderGeofence()}
              {tab === 'attendance'  && renderAttendance()}
              {tab === 'payments'    && renderPayments()}
              {tab === 'bus'         && renderBusFinance()}
            </div>
          </div>
        </div>

      </div>
    </ProtectedLayout>
  )
}
