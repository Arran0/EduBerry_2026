'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
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
  ATTENDANCE_BANNER_DEFAULT, STAFF_ATTENDANCE_BANNER_DEFAULT,
  LEAVE_BANNER_DEFAULT, STAFF_LEAVE_BANNER_DEFAULT,
  CLASSROOMS_BANNER_DEFAULT, PROFILES_BANNER_DEFAULT,
  TEAMS_BANNER_DEFAULT, FEEDBACK_BANNER_DEFAULT, HOMEROOMS_BANNER_DEFAULT,
} from '@/lib/pageConfig'
import {
  Check, RotateCcw, Save, Settings, Palette, Image as ImageIcon,
  Type, LogIn, Layout, Upload, X, Plus, Trash2, Loader2, MapPin, Navigation,
  Clock, CalendarOff, ShieldCheck, Search,
} from 'lucide-react'
import {
  fetchGeofenceConfig, saveGeofenceConfig, GeofenceConfig,
  fetchAttendanceConfig, saveAttendanceConfig, AttendanceConfig,
  fetchHolidays, addHoliday, deleteHoliday, Holiday,
  fetchAllStaff, setStaffExemption,
} from '@/lib/attendance'
import { UserProfile } from '@/lib/supabase'

type Tab = 'branding' | 'page-themes' | 'login' | 'banners' | 'geofence' | 'attendance'

const PAGE_IDS = Object.keys(PAGE_DEFAULTS) as PageId[]

const PAGE_BANNERS: { key: string; label: string; default: AnnouncementBannerConfig }[] = [
  { key: 'staff_attendance_banner', label: 'Staff Attendance',  default: STAFF_ATTENDANCE_BANNER_DEFAULT },
  { key: 'attendance_banner',       label: 'Student Attendance', default: ATTENDANCE_BANNER_DEFAULT },
  { key: 'staff_leave_banner',      label: 'Staff Leave',        default: STAFF_LEAVE_BANNER_DEFAULT },
  { key: 'leave_banner',            label: 'Student OD/Leave',   default: LEAVE_BANNER_DEFAULT },
  { key: 'classrooms_banner',       label: 'Classrooms',         default: CLASSROOMS_BANNER_DEFAULT },
  { key: 'homerooms_banner',        label: 'Homerooms',          default: HOMEROOMS_BANNER_DEFAULT },
  { key: 'teams_banner',            label: 'Teacher Teams',      default: TEAMS_BANNER_DEFAULT },
  { key: 'profiles_banner',         label: 'Profiles',           default: PROFILES_BANNER_DEFAULT },
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

  const [attendanceDraft, setAttendanceDraft] = useState<AttendanceConfig>({ late_cutoff: null })
  const [attendanceLoaded, setAttendanceLoaded] = useState(false)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [savedAttendance, setSavedAttendance] = useState(false)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newHolidayDate, setNewHolidayDate] = useState('')
  const [newHolidayName, setNewHolidayName] = useState('')
  const [staffList, setStaffList] = useState<UserProfile[]>([])
  const [exemptQuery, setExemptQuery] = useState('')
  const [exemptSaving, setExemptSaving] = useState<string | null>(null)

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
      Promise.all([fetchAttendanceConfig(), fetchHolidays(), fetchAllStaff()]).then(([cfg, hols, staff]) => {
        setAttendanceDraft(cfg); setHolidays(hols); setStaffList(staff); setAttendanceLoaded(true)
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

  async function handleAddHoliday() {
    if (!newHolidayDate || !newHolidayName.trim() || !profile) return
    const ok = await addHoliday(newHolidayDate, newHolidayName.trim(), profile.id)
    if (ok) { setNewHolidayDate(''); setNewHolidayName(''); setHolidays(await fetchHolidays()) }
  }

  async function handleDeleteHoliday(id: string) {
    const ok = await deleteHoliday(id)
    if (ok) setHolidays(prev => prev.filter(h => h.id !== id))
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
      academics: 'Academics', more: 'More (other)',
      'staff-attendance': 'Staff Attendance', 'student-attendance': 'Student Attendance',
      'staff-leave': 'Staff Leave', 'student-leave': 'Student OD/Leave',
    }
    const themePages = ['home', 'announcements', 'tasks', 'academics', 'staff-attendance', 'student-attendance', 'staff-leave', 'student-leave', 'more']
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
                          style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }} />
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

    if (!attendanceLoaded) {
      return <div className="py-12 text-center text-[#71717A] text-sm"><Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…</div>
    }

    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Late Timing</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">Staff who check in after this time are automatically marked <strong>Late</strong>.</p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Late cutoff (local time)">
              <input type="time" value={attendanceDraft.late_cutoff ?? ''} onChange={e => setAttendanceDraft({ late_cutoff: e.target.value || null })}
                className="px-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
            </Field>
            {attendanceDraft.late_cutoff && (
              <button onClick={() => setAttendanceDraft({ late_cutoff: null })} className="text-xs text-[#71717A] hover:text-[#18181B] pb-2 transition-colors">Clear</button>
            )}
            <button onClick={handleSaveAttendance} disabled={savingAttendance}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors">
              {savingAttendance ? <Loader2 size={13} className="animate-spin" /> : savedAttendance ? <Check size={13} /> : <Save size={13} />}
              {savingAttendance ? 'Saving…' : savedAttendance ? 'Saved!' : 'Save Late Timing'}
            </button>
          </div>
        </div>

        <div className="border-t border-[#E4E4E7] pt-5">
          <SectionLabel>Holidays</SectionLabel>
          <p className="text-xs text-[#71717A] mb-3">Staff are not auto-marked absent on declared holidays.</p>
          <div className="flex items-end gap-2 flex-wrap mb-3">
            <Field label="Date">
              <input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)}
                className="px-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
            </Field>
            <Field label="Name">
              <input type="text" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} placeholder="e.g. Independence Day"
                className="px-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
            </Field>
            <button onClick={handleAddHoliday} disabled={!newHolidayDate || !newHolidayName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] disabled:opacity-50 transition-colors">
              <Plus size={13} /> Add
            </button>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] flex items-center gap-1.5"><CalendarOff size={12} className="text-[#71717A]" /> No holidays declared yet.</p>
          ) : (
            <div className="space-y-px max-h-64 overflow-y-auto">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]">
                  <CalendarOff size={13} className="text-[#71717A] flex-shrink-0" />
                  <span className="text-sm font-medium text-[#18181B] flex-shrink-0">
                    {new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-sm text-[#71717A] flex-1 truncate">{h.name}</span>
                  <button onClick={() => handleDeleteHoliday(h.id)} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={13} /></button>
                </div>
              ))}
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

                {/* Live preview strip */}
                <div
                  className="h-12 border border-[#D4D4D8] flex items-center px-4 gap-3"
                  style={{ background: `linear-gradient(135deg, ${draft.gradFrom}, ${draft.gradTo})` }}
                >
                  <div className="w-7 h-7 bg-white/20 flex items-center justify-center">
                    <Layout size={14} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white text-xs font-bold leading-tight">{selected.label}</p>
                    <p className="text-white/70 text-[10px] leading-tight">Banner preview</p>
                  </div>
                </div>

                {/* Preset swatches */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-2">Presets</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {BANNER_PRESETS.map(preset => {
                      const isActive = draft.gradFrom === preset.from && draft.gradTo === preset.to
                      return (
                        <button
                          key={preset.label}
                          onClick={() => updateBannerDraft(selectedBannerKey, { gradFrom: preset.from, gradTo: preset.to })}
                          className={`relative flex flex-col overflow-hidden border transition-all ${isActive ? 'border-[#27272A] shadow-sm' : 'border-[#D4D4D8] hover:border-[#71717A]'}`}
                        >
                          <div className="h-6" style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }} />
                          <span className="text-[10px] text-[#71717A] py-1 bg-white text-center">{preset.label}</span>
                          {isActive && <Check size={9} className="absolute top-1 right-1 text-white drop-shadow" />}
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

  // ── Tab definitions ───────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'branding',    label: 'Branding',    icon: <Type size={13} />    },
    { id: 'page-themes', label: 'Themes',      icon: <Palette size={13} /> },
    { id: 'login',       label: 'Login Page',  icon: <LogIn size={13} />   },
    { id: 'banners',     label: 'Banners',     icon: <Layout size={13} />  },
    { id: 'geofence',    label: 'Geofencing',  icon: <MapPin size={13} />  },
    { id: 'attendance',  label: 'Attendance',  icon: <Clock size={13} />   },
  ]

  return (
    <ProtectedLayout adminOnly>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 min-h-screen" data-page-theme="admin" style={{ backgroundColor: '#FDFCF9' }}>

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
              {tab === 'page-themes' && renderPageThemes()}
              {tab === 'login'       && renderLogin()}
              {tab === 'banners'     && renderBanners()}
              {tab === 'geofence'    && renderGeofence()}
              {tab === 'attendance'  && renderAttendance()}
            </div>
          </div>
        </div>

      </div>
    </ProtectedLayout>
  )
}
