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

// ---------- Reusable sub-components ----------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold text-slate-700 mb-2">{children}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
    />
  )
}

function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5 bg-white" />
      <TextInput value={value} onChange={onChange} placeholder="#000000" />
    </div>
  )
}

interface UploadFieldProps {
  label: string
  currentUrl: string
  onUpload: (file: File) => Promise<void>
  onClear: () => void
  uploading: boolean
  accept?: string
  previewCircle?: boolean
}
function UploadField({ label, currentUrl, onUpload, onClear, uploading, accept = 'image/*', previewCircle }: UploadFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="flex items-center gap-3">
        {currentUrl ? (
          <div className="relative flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="" className={`w-14 h-14 object-cover border border-slate-200 ${previewCircle ? 'rounded-full' : 'rounded-xl'}`} />
            <button onClick={onClear}
              className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center shadow">
              <X size={10} />
            </button>
          </div>
        ) : (
          <div className={`w-14 h-14 bg-slate-100 border-2 border-dashed border-slate-200 flex items-center justify-center ${previewCircle ? 'rounded-full' : 'rounded-xl'}`}>
            <ImageIcon size={18} className="text-slate-300" />
          </div>
        )}
        <div className="flex-1 space-y-1">
          <button onClick={() => ref.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50">
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {uploading ? 'Uploading…' : 'Upload Image'}
          </button>
          {currentUrl && (
            <p className="text-[10px] text-slate-400 truncate max-w-[180px]">{currentUrl.split('/').pop()}</p>
          )}
        </div>
        <input ref={ref} type="file" accept={accept} className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) await onUpload(f); e.target.value = '' }} />
      </div>
    </div>
  )
}

// ---------- Main Component ----------

export default function AdminSettingsPage() {
  const { profile } = useAuth()
  const { pageIcons, branding, loginConfig, pageThemes, reload } = usePageConfig()

  const [tab, setTab] = useState<Tab>('branding')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Geofence state (loaded separately, saved separately)
  const [geofenceDraft, setGeofenceDraft] = useState<GeofenceConfig>({ enabled: false, lat: null, lng: null, radius_m: 200 })
  const [geofenceLoaded, setGeofenceLoaded] = useState(false)
  const [savingGeofence, setSavingGeofence] = useState(false)
  const [savedGeofence, setSavedGeofence] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)

  // Attendance config / holidays / exemptions state
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

  // Draft states
  const [draftIcons, setDraftIcons] = useState<PageIconMap>(pageIcons)
  const [draftBranding, setDraftBranding] = useState<SiteBranding>(branding)
  const [draftLogin, setDraftLogin] = useState<LoginPageConfig>(loginConfig)
  const [draftThemes, setDraftThemes] = useState<PageThemeMap>(pageThemes)

  // Sub-state
  const [selectedPage, setSelectedPage] = useState<PageId>('tasks')
  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setDraftIcons(pageIcons)
    setDraftBranding(branding)
    setDraftLogin(loginConfig)
    setDraftThemes(pageThemes)
  }, [pageIcons, branding, loginConfig, pageThemes])

  useEffect(() => {
    if (!geofenceLoaded) {
      fetchGeofenceConfig().then(cfg => {
        if (cfg) setGeofenceDraft(cfg)
        setGeofenceLoaded(true)
      })
    }
  }, [geofenceLoaded])

  useEffect(() => {
    if (tab === 'attendance' && !attendanceLoaded) {
      Promise.all([fetchAttendanceConfig(), fetchHolidays(), fetchAllStaff()]).then(([cfg, hols, staff]) => {
        setAttendanceDraft(cfg)
        setHolidays(hols)
        setStaffList(staff)
        setAttendanceLoaded(true)
      })
    }
  }, [tab, attendanceLoaded])

  // Redirect if not admin (ProtectedLayout also handles this)
  if (profile && profile.role !== 'admin') return null

  // ---- Helpers ----

  const setUploading = (key: string, val: boolean) =>
    setUploadingMap(prev => ({ ...prev, [key]: val }))

  async function uploadAndSet(key: string, file: File, onSuccess: (url: string) => void) {
    setUploading(key, true)
    const url = await uploadSiteAsset(file, key)
    if (url) onSuccess(url)
    setUploading(key, false)
  }

  function updateIcon(pageId: PageId, patch: Partial<PageIconMap[PageId]>) {
    setDraftIcons(prev => ({ ...prev, [pageId]: { ...prev[pageId], ...patch } }))
  }

  function updateBranding(patch: Partial<SiteBranding>) {
    setDraftBranding(prev => ({ ...prev, ...patch }))
  }

  function updateLogin(patch: Partial<LoginPageConfig>) {
    setDraftLogin(prev => ({ ...prev, ...patch }))
  }

  function updateFeature(index: number, value: string) {
    setDraftLogin(prev => {
      const f = [...prev.features]
      f[index] = value
      return { ...prev, features: f }
    })
  }

  function addFeature() {
    setDraftLogin(prev => ({ ...prev, features: [...prev.features, ''] }))
  }

  function removeFeature(index: number) {
    setDraftLogin(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== index) }))
  }

  async function handleSave() {
    setSaving(true)
    await Promise.all([
      savePageIconConfig(draftIcons),
      saveBranding(draftBranding),
      saveLoginConfig(draftLogin),
      savePageThemes(draftThemes),
    ])
    await reload()
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  const currentIcon = draftIcons[selectedPage]

  async function handleSaveGeofence() {
    setSavingGeofence(true)
    await saveGeofenceConfig(geofenceDraft)
    setSavedGeofence(true)
    setTimeout(() => setSavedGeofence(false), 2500)
    setSavingGeofence(false)
  }

  async function handleSaveAttendance() {
    setSavingAttendance(true)
    await saveAttendanceConfig(attendanceDraft)
    setSavedAttendance(true)
    setTimeout(() => setSavedAttendance(false), 2500)
    setSavingAttendance(false)
  }

  async function handleAddHoliday() {
    if (!newHolidayDate || !newHolidayName.trim() || !profile) return
    const ok = await addHoliday(newHolidayDate, newHolidayName.trim(), profile.id)
    if (ok) {
      setNewHolidayDate('')
      setNewHolidayName('')
      setHolidays(await fetchHolidays())
    }
  }

  async function handleDeleteHoliday(id: string) {
    const ok = await deleteHoliday(id)
    if (ok) setHolidays(prev => prev.filter(h => h.id !== id))
  }

  async function handleToggleExempt(staff: UserProfile) {
    setExemptSaving(staff.id)
    const next = !staff.geofence_exempt
    const ok = await setStaffExemption(staff.id, next)
    if (ok) {
      setStaffList(prev => prev.map(s => s.id === staff.id ? { ...s, geofence_exempt: next } : s))
    }
    setExemptSaving(null)
  }

  function getCurrentLocation() {
    setGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeofenceDraft(prev => ({ ...prev, lat: pos.coords.latitude, lng: pos.coords.longitude }))
        setGettingLocation(false)
      },
      () => setGettingLocation(false),
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  // ---- Tab content renderers ----

  function renderBranding() {
    return (
      <div className="space-y-5">
        <SectionLabel>App Identity</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="App Title (navbar)">
            <TextInput value={draftBranding.appTitle} onChange={v => updateBranding({ appTitle: v })} placeholder="MPS Web" />
          </Field>
          <Field label="App Subtitle (navbar)">
            <TextInput value={draftBranding.appSubtitle} onChange={v => updateBranding({ appSubtitle: v })} placeholder="Muthamil Public School" />
          </Field>
          <Field label="School Name">
            <TextInput value={draftBranding.schoolName} onChange={v => updateBranding({ schoolName: v })} placeholder="School name" />
          </Field>
          <Field label="Tagline">
            <TextInput value={draftBranding.tagline} onChange={v => updateBranding({ tagline: v })} placeholder="Excel . Enrich . Enlighten" />
          </Field>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Logo & Favicon</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadField
              label="App Logo (shown in navbar & login)"
              currentUrl={draftBranding.logoUrl}
              uploading={!!uploadingMap['logo']}
              previewCircle
              onUpload={f => uploadAndSet('logo', f, url => updateBranding({ logoUrl: url }))}
              onClear={() => updateBranding({ logoUrl: '' })}
            />
            <UploadField
              label="Favicon"
              currentUrl={draftBranding.faviconUrl}
              uploading={!!uploadingMap['favicon']}
              onUpload={f => uploadAndSet('favicon', f, url => updateBranding({ faviconUrl: url }))}
              onClear={() => updateBranding({ faviconUrl: '' })}
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Brand Colors</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">Used for primary UI accents, buttons, and gradients across the app.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Primary Color">
              <ColorInput value={draftBranding.primaryColor} onChange={v => updateBranding({ primaryColor: v })} label="Primary" />
            </Field>
            <Field label="Secondary Color">
              <ColorInput value={draftBranding.secondaryColor} onChange={v => updateBranding({ secondaryColor: v })} label="Secondary" />
            </Field>
          </div>
        </div>

        {/* Live preview */}
        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Preview</SectionLabel>
          <div className="flex items-center gap-3 p-3 bg-white/80 border border-slate-100 rounded-xl shadow-sm w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draftBranding.logoUrl || '/logo.png'}
              alt=""
              className="w-10 h-10 rounded-full object-cover shadow-sm border border-slate-100"
              onError={e => { (e.target as HTMLImageElement).src = '/logo.png' }}
            />
            <div>
              <p className="text-sm font-bold text-slate-800" style={{ backgroundImage: `linear-gradient(135deg, ${draftBranding.primaryColor}, ${draftBranding.secondaryColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {draftBranding.appTitle || 'App Title'}
              </p>
              <p className="text-xs text-slate-500">{draftBranding.appSubtitle || 'School name'}</p>
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
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-slate-100 p-2 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible flex-shrink-0">
          {PAGE_IDS.map(pageId => {
            const cfg = draftIcons[pageId]
            const Icon = ICON_MAP[cfg.iconName]
            return (
              <button key={pageId} onClick={() => setSelectedPage(pageId)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium transition-all flex-shrink-0 w-full text-left ${selectedPage === pageId ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                <div className={`p-1 rounded-lg bg-gradient-to-br ${cfg.gradientFrom} ${cfg.gradientTo} flex-shrink-0 overflow-hidden`} style={{ width: 20, height: 20 }}>
                  {cfg.customImageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cfg.customImageUrl} alt="" className="w-full h-full object-cover rounded" />
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
            <h3 className="font-semibold text-slate-800 text-sm">{PAGE_LABELS[selectedPage]}</h3>
            <button onClick={() => setDraftIcons(prev => ({ ...prev, [selectedPage]: PAGE_DEFAULTS[selectedPage] }))}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <RotateCcw size={11} /> Reset
            </button>
          </div>

          {/* Live preview */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-4">
            <div className={`p-2.5 bg-gradient-to-br ${currentIcon.gradientFrom} ${currentIcon.gradientTo} rounded-xl shadow-md overflow-hidden`}>
              {currentIcon.customImageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={currentIcon.customImageUrl} alt="" className="w-6 h-6 object-cover rounded" />
                : (() => { const I = ICON_MAP[currentIcon.iconName]; return I ? <I className="text-white" size={24} /> : null })()
              }
            </div>
            <div>
              <p className="font-display text-base font-bold text-slate-800">{PAGE_LABELS[selectedPage]}</p>
              <p className="text-[10px] text-slate-400">Live preview</p>
            </div>
          </div>

          {/* Custom image upload */}
          <div className="mb-4">
            <SectionLabel>Custom Image (overrides icon)</SectionLabel>
            <UploadField
              label=""
              currentUrl={currentIcon.customImageUrl ?? ''}
              uploading={!!uploadingMap[`icon-${selectedPage}`]}
              onUpload={f => uploadAndSet(`icon-${selectedPage}`, f, url => updateIcon(selectedPage, { customImageUrl: url }))}
              onClear={() => updateIcon(selectedPage, { customImageUrl: undefined })}
            />
          </div>

          {/* Preset icon picker */}
          <div className="mb-4">
            <SectionLabel>Preset Icon</SectionLabel>
            <div className="grid grid-cols-7 gap-1.5">
              {AVAILABLE_ICONS.map(name => {
                const Icon = ICON_MAP[name]
                if (!Icon) return null
                const isSelected = currentIcon.iconName === name && !currentIcon.customImageUrl
                return (
                  <button key={name} title={name}
                    onClick={() => updateIcon(selectedPage, { iconName: name, customImageUrl: undefined })}
                    className={`p-2 rounded-lg flex items-center justify-center transition-all ${isSelected ? 'bg-slate-200 ring-2 ring-slate-400' : 'bg-slate-100 hover:bg-slate-200'}`}>
                    <Icon size={15} className="text-slate-700" />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Gradient picker */}
          <div>
            <SectionLabel>Icon Background Color</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {GRADIENT_OPTIONS.map(opt => {
                const isSelected = currentIcon.gradientFrom === opt.from && currentIcon.gradientTo === opt.to
                return (
                  <button key={opt.label}
                    onClick={() => updateIcon(selectedPage, { gradientFrom: opt.from, gradientTo: opt.to })}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs border transition-all ${isSelected ? 'border-slate-400 bg-white shadow-sm' : 'border-transparent bg-slate-50 hover:bg-white hover:border-slate-200'}`}>
                    <div className={`w-4 h-4 rounded-md bg-gradient-to-br ${opt.from} ${opt.to} flex-shrink-0`} />
                    <span className="text-slate-600 truncate">{opt.label}</span>
                    {isSelected && <Check size={9} className="ml-auto text-slate-500 flex-shrink-0" />}
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
    return (
      <div className="flex flex-col sm:flex-row gap-0 min-h-[480px]">
        {/* Page list */}
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-slate-100 p-2 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible flex-shrink-0">
          {['home', 'announcements', 'tasks', 'academics', 'more'].map(pageId => {
            const theme = draftThemes[pageId]
            return (
              <button key={pageId} onClick={() => setSelectedPage(pageId as PageId)}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium transition-all flex-shrink-0 w-full text-left ${selectedPage === pageId ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                <div className="w-4 h-4 rounded-md flex-shrink-0 border border-slate-200"
                  style={{ background: theme ? `linear-gradient(135deg,${theme.gradFrom},${theme.gradTo})` : '#e2e8f0' }} />
                <span className="truncate capitalize">{pageId === 'staffLeave' ? 'Staff Leave' : pageId}</span>
                {theme && <span className="ml-auto text-[9px] bg-blue-100 text-blue-600 px-1 rounded">Custom</span>}
              </button>
            )
          })}
        </div>

        {/* Editor */}
        <div className="flex-1 p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 text-sm capitalize">{selectedPage} Page Theme</h3>
            {draftThemes[selectedPage] && (
              <button onClick={() => setDraftThemes(prev => { const n = { ...prev }; delete n[selectedPage]; return n })}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                <RotateCcw size={11} /> Reset to default
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500 mb-4">Choose a preset palette to override this page&apos;s default color theme. These colors affect the page background, active states, tabs, and accent elements.</p>

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
                  const current = draftThemes[selectedPage]
                  const isSelected = current?.primary === theme.primary
                  return (
                    <button key={id}
                      onClick={() => setDraftThemes(prev => ({ ...prev, [selectedPage]: theme }))}
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

          {/* Custom hex override */}
          {draftThemes[selectedPage] && (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <SectionLabel>Fine-tune Colors</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary">
                  <ColorInput value={draftThemes[selectedPage]!.primary}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, primary: v } }))}
                    label="Primary" />
                </Field>
                <Field label="Accent">
                  <ColorInput value={draftThemes[selectedPage]!.accent}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, accent: v } }))}
                    label="Accent" />
                </Field>
                <Field label="Gradient Start">
                  <ColorInput value={draftThemes[selectedPage]!.gradFrom}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, gradFrom: v } }))}
                    label="Gradient Start" />
                </Field>
                <Field label="Gradient End">
                  <ColorInput value={draftThemes[selectedPage]!.gradTo}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, gradTo: v } }))}
                    label="Gradient End" />
                </Field>
                <Field label="Background Start">
                  <ColorInput value={draftThemes[selectedPage]!.bgFrom ?? '#f8fafc'}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgFrom: v } }))}
                    label="Background Start" />
                </Field>
                <Field label="Background Mid">
                  <ColorInput value={draftThemes[selectedPage]!.bgMid ?? '#f1f5f9'}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgMid: v } }))}
                    label="Background Mid" />
                </Field>
                <Field label="Background End">
                  <ColorInput value={draftThemes[selectedPage]!.bgTo ?? '#f9fafb'}
                    onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgTo: v } }))}
                    label="Background End" />
                </Field>
                {/* Background gradient preview */}
                <div className="col-span-2">
                  <p className="text-[10px] text-slate-400 mb-1">Background preview</p>
                  <div className="h-6 rounded-lg border border-slate-100" style={{
                    background: `linear-gradient(135deg, ${draftThemes[selectedPage]!.bgFrom ?? '#f8fafc'}, ${draftThemes[selectedPage]!.bgMid ?? '#f1f5f9'}, ${draftThemes[selectedPage]!.bgTo ?? '#f9fafb'})`
                  }} />
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
      <div className="space-y-5">
        <SectionLabel>Text Content</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="School Name (left panel)">
            <TextInput value={draftLogin.schoolName} onChange={v => updateLogin({ schoolName: v })} />
          </Field>
          <Field label="Tagline">
            <TextInput value={draftLogin.tagline} onChange={v => updateLogin({ tagline: v })} />
          </Field>
          <Field label="Welcome Text">
            <TextInput value={draftLogin.welcomeText} onChange={v => updateLogin({ welcomeText: v })} />
          </Field>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Panel Gradient</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1 (top)">
              <ColorInput value={draftLogin.gradientFrom} onChange={v => updateLogin({ gradientFrom: v })} label="From" />
            </Field>
            <Field label="Color 2 (mid)">
              <ColorInput value={draftLogin.gradientMid} onChange={v => updateLogin({ gradientMid: v })} label="Mid" />
            </Field>
            <Field label="Color 3 (bottom)">
              <ColorInput value={draftLogin.gradientTo} onChange={v => updateLogin({ gradientTo: v })} label="To" />
            </Field>
          </div>
          {/* Preview swatch */}
          <div className="mt-2 h-8 rounded-xl" style={{
            background: `linear-gradient(135deg, ${draftLogin.gradientFrom}, ${draftLogin.gradientMid}, ${draftLogin.gradientTo})`
          }} />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Page Background Gradient</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1 (top-left)">
              <ColorInput value={draftLogin.pageBgFrom ?? '#bfdbfe'} onChange={v => updateLogin({ pageBgFrom: v })} label="From" />
            </Field>
            <Field label="Color 2 (mid)">
              <ColorInput value={draftLogin.pageBgMid ?? '#f0f9ff'} onChange={v => updateLogin({ pageBgMid: v })} label="Mid" />
            </Field>
            <Field label="Color 3 (bottom-right)">
              <ColorInput value={draftLogin.pageBgTo ?? '#bbf7d0'} onChange={v => updateLogin({ pageBgTo: v })} label="To" />
            </Field>
          </div>
          <div className="mt-2 h-8 rounded-xl" style={{
            background: `linear-gradient(135deg, ${draftLogin.pageBgFrom ?? '#bfdbfe'}, ${draftLogin.pageBgMid ?? '#f0f9ff'}, ${draftLogin.pageBgTo ?? '#bbf7d0'})`
          }} />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SectionLabel>Background Image (optional)</SectionLabel>
          <UploadField
            label="Displayed as a subtle overlay on the left panel"
            currentUrl={draftLogin.bgImageUrl}
            uploading={!!uploadingMap['login-bg']}
            onUpload={f => uploadAndSet('login-bg', f, url => updateLogin({ bgImageUrl: url }))}
            onClear={() => updateLogin({ bgImageUrl: '' })}
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel>Feature List (bullet points)</SectionLabel>
            <button onClick={addFeature}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
              <Plus size={12} /> Add
            </button>
          </div>
          <div className="space-y-2">
            {draftLogin.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput value={f} onChange={v => updateFeature(i, v)} placeholder={`Feature ${i + 1}`} />
                <button onClick={() => removeFeature(i)} className="text-slate-300 hover:text-rose-400 transition-colors flex-shrink-0">
                  <Trash2 size={14} />
                </button>
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
          <p className="text-xs text-slate-400 mb-4">
            When enabled, staff must be within the set radius of school coordinates to pass the geofence check during self check-in. They can still override and check in from outside.
          </p>

          {/* Enable toggle */}
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
            <button
              role="switch"
              aria-checked={geofenceDraft.enabled}
              onClick={() => setGeofenceDraft(prev => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                geofenceDraft.enabled ? 'bg-rose-500' : 'bg-slate-300'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                geofenceDraft.enabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
            <div>
              <p className="text-sm font-medium text-slate-800">Enable Geofencing</p>
              <p className="text-xs text-slate-400">{geofenceDraft.enabled ? 'Active — GPS checked on check-in' : 'Disabled — no GPS required'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="School Latitude">
              <input
                type="number"
                step="0.000001"
                value={geofenceDraft.lat ?? ''}
                onChange={e => setGeofenceDraft(prev => ({ ...prev, lat: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="e.g. 12.971599"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
            <Field label="School Longitude">
              <input
                type="number"
                step="0.000001"
                value={geofenceDraft.lng ?? ''}
                onChange={e => setGeofenceDraft(prev => ({ ...prev, lng: e.target.value ? parseFloat(e.target.value) : null }))}
                placeholder="e.g. 77.594566"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
            <Field label="Radius (metres)">
              <input
                type="number"
                min={10}
                max={5000}
                step={10}
                value={geofenceDraft.radius_m}
                onChange={e => setGeofenceDraft(prev => ({ ...prev, radius_m: parseInt(e.target.value, 10) || 200 }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
          </div>

          {/* Get current location button */}
          <button
            onClick={getCurrentLocation}
            disabled={gettingLocation}
            className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-100 disabled:opacity-50 transition-colors"
          >
            {gettingLocation
              ? <><Loader2 size={14} className="animate-spin" /> Getting location…</>
              : <><Navigation size={14} /> Get Current Location</>
            }
          </button>
          <p className="text-[11px] text-slate-400 mt-1 ml-1">Auto-fills latitude and longitude from your browser&apos;s GPS.</p>

          {/* Map pin preview */}
          {geofenceDraft.lat != null && geofenceDraft.lng != null && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700">
              <MapPin size={14} className="flex-shrink-0" />
              <span>
                {geofenceDraft.lat.toFixed(6)}, {geofenceDraft.lng.toFixed(6)} — {geofenceDraft.radius_m}m radius
              </span>
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="pt-2 border-t border-slate-100">
          <button
            onClick={handleSaveGeofence}
            disabled={savingGeofence}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-xl hover:from-rose-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-sm"
          >
            {savingGeofence ? <Loader2 size={14} className="animate-spin" /> : savedGeofence ? <Check size={14} /> : <Save size={14} />}
            {savingGeofence ? 'Saving…' : savedGeofence ? 'Saved!' : 'Save Geofence Settings'}
          </button>
        </div>
      </div>
    )
  }

  function renderAttendance() {
    const filteredStaff = exemptQuery.trim()
      ? staffList.filter(s =>
          s.full_name.toLowerCase().includes(exemptQuery.trim().toLowerCase()) ||
          s.email.toLowerCase().includes(exemptQuery.trim().toLowerCase()))
      : staffList
    const exemptCount = staffList.filter(s => s.geofence_exempt).length

    if (!attendanceLoaded) {
      return <div className="py-12 text-center text-slate-400 text-sm"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</div>
    }

    return (
      <div className="space-y-6">
        {/* Late cutoff */}
        <div>
          <SectionLabel>Late Timing</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">
            Staff who check in after this time are automatically marked <strong>Late</strong> instead of Present.
            Staff who never check in on a working day appear as <strong>Absent</strong> — they can still check in later to flip to Late.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Late cutoff (local time)">
              <input
                type="time"
                value={attendanceDraft.late_cutoff ?? ''}
                onChange={e => setAttendanceDraft({ late_cutoff: e.target.value || null })}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
            {attendanceDraft.late_cutoff && (
              <button
                onClick={() => setAttendanceDraft({ late_cutoff: null })}
                className="text-xs text-slate-400 hover:text-slate-600 pb-2"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleSaveAttendance}
              disabled={savingAttendance}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-xl hover:from-rose-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-sm"
            >
              {savingAttendance ? <Loader2 size={14} className="animate-spin" /> : savedAttendance ? <Check size={14} /> : <Save size={14} />}
              {savingAttendance ? 'Saving…' : savedAttendance ? 'Saved!' : 'Save Late Timing'}
            </button>
          </div>
        </div>

        {/* Holidays */}
        <div className="border-t border-slate-100 pt-5">
          <SectionLabel>Holidays</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">
            Declare non-working days. Staff are not auto-marked absent on these days, and they appear as holidays on attendance calendars.
          </p>
          <div className="flex items-end gap-2 flex-wrap mb-3">
            <Field label="Date">
              <input
                type="date"
                value={newHolidayDate}
                onChange={e => setNewHolidayDate(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
            <Field label="Name">
              <input
                type="text"
                value={newHolidayName}
                onChange={e => setNewHolidayName(e.target.value)}
                placeholder="e.g. Independence Day"
                className="px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
            </Field>
            <button
              onClick={handleAddHoliday}
              disabled={!newHolidayDate || !newHolidayName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-violet-100 text-violet-700 rounded-xl hover:bg-violet-200 disabled:opacity-50 transition-colors"
            >
              <Plus size={14} /> Add
            </button>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-slate-400 flex items-center gap-1.5"><CalendarOff size={13} /> No holidays declared yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl">
                  <CalendarOff size={14} className="text-violet-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-700 flex-shrink-0">
                    {new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-sm text-slate-500 flex-1 truncate">{h.name}</span>
                  <button onClick={() => handleDeleteHoliday(h.id)} className="text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Geofence exemptions */}
        <div className="border-t border-slate-100 pt-5">
          <SectionLabel>Geofence Exemptions</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">
            Exempted staff can check in even when located outside the school geofence ({exemptCount} exempted).
          </p>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={exemptQuery}
              onChange={e => setExemptQuery(e.target.value)}
              placeholder="Search staff by name or email…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {filteredStaff.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{s.full_name}</p>
                  <p className="text-[11px] text-slate-400 truncate capitalize">{s.role} · {s.email}</p>
                </div>
                {s.geofence_exempt && <ShieldCheck size={15} className="text-emerald-500 flex-shrink-0" />}
                <button
                  role="switch"
                  aria-checked={!!s.geofence_exempt}
                  disabled={exemptSaving === s.id}
                  onClick={() => handleToggleExempt(s)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    s.geofence_exempt ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                    s.geofence_exempt ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            ))}
            {filteredStaff.length === 0 && (
              <p className="text-xs text-slate-400 py-3 text-center">No staff match your search.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  function renderBanners() {
    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Home Page Banner</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">Displayed at the top of the home page. Admins can also upload directly from the home page.</p>
          <UploadField
            label="Home Banner Image"
            currentUrl={draftBranding.logoUrl ? '' : ''}   // placeholder — banner is managed via site_settings separately
            uploading={!!uploadingMap['home-banner']}
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
            }}
          />
        </div>

        <div className="border-t border-slate-100 pt-5">
          <SectionLabel>Profile Page Banner</SectionLabel>
          <p className="text-xs text-slate-400 mb-3">Displayed at the top of every user&apos;s profile page. Admins can also manage it from the profile page.</p>
          <UploadField
            label="Profile Banner Image"
            currentUrl={''}
            uploading={!!uploadingMap['profile-banner']}
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
            }}
          />
        </div>
      </div>
    )
  }

  // ---- Render ----

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'branding',    label: 'Branding',    icon: <Type size={14} />     },
    { id: 'page-themes', label: 'Themes',      icon: <Palette size={14} />  },
    { id: 'login',       label: 'Login Page',  icon: <LogIn size={14} />    },
    { id: 'banners',     label: 'Banners',     icon: <Layout size={14} />   },
    { id: 'geofence',    label: 'Geofencing',  icon: <MapPin size={14} />   },
    { id: 'attendance',  label: 'Attendance',  icon: <Clock size={14} />    },
  ]

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="more">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-slate-500 to-slate-700 rounded-xl shadow-lg">
              <Settings className="text-white" size={24} />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold text-slate-800">App Settings</h1>
              <p className="text-slate-500 text-sm">Customize your school web app</p>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="btn-primary flex items-center gap-2 text-sm !py-2 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Changes'}
          </button>
        </div>

        {/* Tabs */}
        <div className="glass rounded-2xl overflow-hidden">
          <div className="flex border-b border-slate-100 overflow-x-auto scrollbar-none">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
                  tab === t.id
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                }`}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'branding'    && renderBranding()}
            {tab === 'page-themes' && renderPageThemes()}
            {tab === 'login'       && renderLogin()}
            {tab === 'banners'     && renderBanners()}
            {tab === 'geofence'    && renderGeofence()}
            {tab === 'attendance'  && renderAttendance()}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
