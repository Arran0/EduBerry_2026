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

// ── Admin palette ──────────────────────────────
const ai = 'border border-[#C9C3BB] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#3D3B40] transition-colors w-full'

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-3">{children}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">{label}</label>
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
        className="w-9 h-9 border border-[#C9C3BB] cursor-pointer p-0.5 bg-white"
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
      {label && <label className="block text-[10px] font-bold uppercase tracking-widest text-[#A8896B] mb-1.5">{label}</label>}
      <div className="flex items-center gap-3">
        {currentUrl ? (
          <div className="relative flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="" className={`w-14 h-14 object-cover border border-[#C9C3BB] ${previewCircle ? 'rounded-full' : ''}`} />
            <button onClick={onClear} className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white flex items-center justify-center shadow">
              <X size={10} />
            </button>
          </div>
        ) : (
          <div className={`w-14 h-14 bg-[#F3F0EB] border-2 border-dashed border-[#C9C3BB] flex items-center justify-center ${previewCircle ? 'rounded-full' : ''}`}>
            <ImageIcon size={18} className="text-[#C9C3BB]" />
          </div>
        )}
        <div className="flex-1 space-y-1">
          <button onClick={() => ref.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#F3F0EB] border border-[#C9C3BB] hover:bg-[#EAE6E0] transition-colors disabled:opacity-50">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : 'Upload Image'}
          </button>
          {currentUrl && <p className="text-[10px] text-[#9A9290] truncate max-w-[180px]">{currentUrl.split('/').pop()}</p>}
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
  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({})

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

        <div className="border-t border-[#E0DCD6] pt-5">
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

        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Brand Colors</SectionLabel>
          <p className="text-xs text-[#7A7572] mb-3">Used for primary UI accents, buttons, and gradients across the app.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Primary Color">
              <ColorInput value={draftBranding.primaryColor} onChange={v => updateBranding({ primaryColor: v })} label="Primary" />
            </Field>
            <Field label="Secondary Color">
              <ColorInput value={draftBranding.secondaryColor} onChange={v => updateBranding({ secondaryColor: v })} label="Secondary" />
            </Field>
          </div>
        </div>

        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Preview</SectionLabel>
          <div className="flex items-center gap-3 p-3 bg-white border border-[#C9C3BB] w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draftBranding.logoUrl || '/logo.png'} alt="" className="w-10 h-10 object-cover border border-[#C9C3BB]" style={{ borderRadius: '50%' }}
              onError={e => { (e.target as HTMLImageElement).src = '/logo.png' }} />
            <div>
              <p className="text-sm font-bold" style={{ backgroundImage: `linear-gradient(135deg, ${draftBranding.primaryColor}, ${draftBranding.secondaryColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {draftBranding.appTitle || 'App Title'}
              </p>
              <p className="text-xs text-[#7A7572]">{draftBranding.appSubtitle || 'School name'}</p>
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
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-[#E0DCD6] p-1 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-visible flex-shrink-0">
          {PAGE_IDS.map(pageId => {
            const cfg = draftIcons[pageId]
            const Icon = ICON_MAP[cfg.iconName]
            return (
              <button key={pageId} onClick={() => setSelectedPage(pageId)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all flex-shrink-0 w-full text-left border-l-2 ${selectedPage === pageId ? 'border-l-[#A8896B] bg-[#A8896B]/8 text-[#2B292E]' : 'border-l-transparent text-[#7A7572] hover:bg-[#EAE6E0] hover:text-[#2B292E]'}`}>
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
            <h3 className="text-sm font-bold text-[#2B292E]">{PAGE_LABELS[selectedPage]}</h3>
            <button onClick={() => setDraftIcons(prev => ({ ...prev, [selectedPage]: PAGE_DEFAULTS[selectedPage] }))}
              className="flex items-center gap-1 text-xs text-[#7A7572] hover:text-[#2B292E] transition-colors">
              <RotateCcw size={10} /> Reset
            </button>
          </div>

          <div className="flex items-center gap-3 p-3 bg-[#F3F0EB] border border-[#E0DCD6] mb-4">
            <div className={`p-2 bg-gradient-to-br ${currentIcon.gradientFrom} ${currentIcon.gradientTo} overflow-hidden`}>
              {currentIcon.customImageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={currentIcon.customImageUrl} alt="" className="w-6 h-6 object-cover" />
                : (() => { const I = ICON_MAP[currentIcon.iconName]; return I ? <I className="text-white" size={22} /> : null })()
              }
            </div>
            <div>
              <p className="text-sm font-bold text-[#2B292E]">{PAGE_LABELS[selectedPage]}</p>
              <p className="text-[10px] text-[#9A9290] uppercase tracking-widest">Live preview</p>
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
                    className={`p-2 flex items-center justify-center transition-all border ${isSelected ? 'border-[#3D3B40] bg-[#3D3B40] text-[#A8896B]' : 'border-[#E0DCD6] bg-[#F3F0EB] hover:border-[#A8896B] text-[#7A7572]'}`}>
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
                    className={`flex items-center gap-2 px-2.5 py-2 text-xs border transition-all ${isSelected ? 'border-[#3D3B40] bg-white shadow-sm' : 'border-[#E0DCD6] bg-[#F3F0EB] hover:bg-white hover:border-[#C9C3BB]'}`}>
                    <div className={`w-4 h-4 bg-gradient-to-br ${opt.from} ${opt.to} flex-shrink-0`} />
                    <span className="text-[#7A7572] truncate">{opt.label}</span>
                    {isSelected && <Check size={9} className="ml-auto text-[#A8896B] flex-shrink-0" />}
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
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r border-[#E0DCD6] p-1 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-visible flex-shrink-0">
          {['home', 'announcements', 'tasks', 'academics', 'more'].map(pageId => {
            const theme = draftThemes[pageId]
            return (
              <button key={pageId} onClick={() => setSelectedPage(pageId as PageId)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium transition-all flex-shrink-0 w-full text-left border-l-2 ${selectedPage === pageId ? 'border-l-[#A8896B] bg-[#A8896B]/8 text-[#2B292E]' : 'border-l-transparent text-[#7A7572] hover:bg-[#EAE6E0] hover:text-[#2B292E]'}`}>
                <div className="w-3.5 h-3.5 flex-shrink-0 border border-[#C9C3BB]"
                  style={{ background: theme ? `linear-gradient(135deg,${theme.gradFrom},${theme.gradTo})` : '#e2e8f0' }} />
                <span className="truncate capitalize">{pageId === 'staffLeave' ? 'Staff Leave' : pageId}</span>
                {theme && <span className="ml-auto text-[9px] bg-[#A8896B]/15 text-[#A8896B] px-1">●</span>}
              </button>
            )
          })}
        </div>

        <div className="flex-1 p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#2B292E] capitalize">{selectedPage} Page Theme</h3>
            {draftThemes[selectedPage] && (
              <button onClick={() => setDraftThemes(prev => { const n = { ...prev }; delete n[selectedPage]; return n })}
                className="flex items-center gap-1 text-xs text-[#7A7572] hover:text-[#2B292E] transition-colors">
                <RotateCcw size={10} /> Reset to default
              </button>
            )}
          </div>
          <p className="text-xs text-[#7A7572] mb-4">Choose a preset palette to override this page&apos;s default color theme.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {THEME_PALETTES.map(({ id, label, theme }) => {
              const current = draftThemes[selectedPage]
              const isSelected = current?.primary === theme.primary
              return (
                <button key={id} onClick={() => setDraftThemes(prev => ({ ...prev, [selectedPage]: theme }))}
                  className={`flex items-center gap-3 px-3 py-2.5 border text-left transition-all ${isSelected ? 'border-[#3D3B40] bg-white' : 'border-[#E0DCD6] bg-[#F3F0EB] hover:bg-white hover:border-[#C9C3BB]'}`}>
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <div className="w-8 h-4" style={{ background: `linear-gradient(135deg, ${theme.gradFrom}, ${theme.gradTo})` }} />
                    <div className="w-8 h-2 border border-[#E0DCD6]" style={{ background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgMid}, ${theme.bgTo})` }} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#2B292E]">{label}</p>
                    <div className="flex gap-0.5 mt-0.5">
                      {[theme.primary, theme.accent, theme.bgFrom].map(c => (
                        <span key={c} className="w-2.5 h-2.5 border border-white shadow-sm" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  {isSelected && <Check size={12} className="ml-auto text-[#A8896B] flex-shrink-0" />}
                </button>
              )
            })}
          </div>

          {draftThemes[selectedPage] && (
            <div className="mt-5 pt-4 border-t border-[#E0DCD6]">
              <SectionLabel>Fine-tune Colors</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary"><ColorInput value={draftThemes[selectedPage]!.primary} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, primary: v } }))} label="Primary" /></Field>
                <Field label="Accent"><ColorInput value={draftThemes[selectedPage]!.accent} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, accent: v } }))} label="Accent" /></Field>
                <Field label="Gradient Start"><ColorInput value={draftThemes[selectedPage]!.gradFrom} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, gradFrom: v } }))} label="Grad Start" /></Field>
                <Field label="Gradient End"><ColorInput value={draftThemes[selectedPage]!.gradTo} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, gradTo: v } }))} label="Grad End" /></Field>
                <Field label="Background Start"><ColorInput value={draftThemes[selectedPage]!.bgFrom ?? '#f8fafc'} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgFrom: v } }))} label="Bg Start" /></Field>
                <Field label="Background Mid"><ColorInput value={draftThemes[selectedPage]!.bgMid ?? '#f1f5f9'} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgMid: v } }))} label="Bg Mid" /></Field>
                <Field label="Background End"><ColorInput value={draftThemes[selectedPage]!.bgTo ?? '#f9fafb'} onChange={v => setDraftThemes(prev => ({ ...prev, [selectedPage]: { ...prev[selectedPage]!, bgTo: v } }))} label="Bg End" /></Field>
                <div className="col-span-2">
                  <p className="text-[10px] text-[#9A9290] mb-1 uppercase tracking-widest">Background preview</p>
                  <div className="h-5 border border-[#E0DCD6]" style={{ background: `linear-gradient(135deg, ${draftThemes[selectedPage]!.bgFrom ?? '#f8fafc'}, ${draftThemes[selectedPage]!.bgMid ?? '#f1f5f9'}, ${draftThemes[selectedPage]!.bgTo ?? '#f9fafb'})` }} />
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
        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Panel Gradient</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1 (top)"><ColorInput value={draftLogin.gradientFrom} onChange={v => updateLogin({ gradientFrom: v })} label="From" /></Field>
            <Field label="Color 2 (mid)"><ColorInput value={draftLogin.gradientMid} onChange={v => updateLogin({ gradientMid: v })} label="Mid" /></Field>
            <Field label="Color 3 (bottom)"><ColorInput value={draftLogin.gradientTo} onChange={v => updateLogin({ gradientTo: v })} label="To" /></Field>
          </div>
          <div className="mt-2 h-7 border border-[#E0DCD6]" style={{ background: `linear-gradient(135deg, ${draftLogin.gradientFrom}, ${draftLogin.gradientMid}, ${draftLogin.gradientTo})` }} />
        </div>
        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Page Background Gradient</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Color 1"><ColorInput value={draftLogin.pageBgFrom ?? '#bfdbfe'} onChange={v => updateLogin({ pageBgFrom: v })} label="From" /></Field>
            <Field label="Color 2"><ColorInput value={draftLogin.pageBgMid ?? '#f0f9ff'} onChange={v => updateLogin({ pageBgMid: v })} label="Mid" /></Field>
            <Field label="Color 3"><ColorInput value={draftLogin.pageBgTo ?? '#bbf7d0'} onChange={v => updateLogin({ pageBgTo: v })} label="To" /></Field>
          </div>
          <div className="mt-2 h-7 border border-[#E0DCD6]" style={{ background: `linear-gradient(135deg, ${draftLogin.pageBgFrom ?? '#bfdbfe'}, ${draftLogin.pageBgMid ?? '#f0f9ff'}, ${draftLogin.pageBgTo ?? '#bbf7d0'})` }} />
        </div>
        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Background Image (optional)</SectionLabel>
          <UploadField label="Displayed as a subtle overlay on the left panel" currentUrl={draftLogin.bgImageUrl} uploading={!!uploadingMap['login-bg']}
            onUpload={f => uploadAndSet('login-bg', f, url => updateLogin({ bgImageUrl: url }))}
            onClear={() => updateLogin({ bgImageUrl: '' })} />
        </div>
        <div className="border-t border-[#E0DCD6] pt-5">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Feature List (bullet points)</SectionLabel>
            <button onClick={addFeature} className="flex items-center gap-1 text-xs text-[#A8896B] hover:text-[#8B7257] font-medium transition-colors">
              <Plus size={11} /> Add
            </button>
          </div>
          <div className="space-y-2">
            {draftLogin.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextInput value={f} onChange={v => updateFeature(i, v)} placeholder={`Feature ${i + 1}`} />
                <button onClick={() => removeFeature(i)} className="text-[#C9C3BB] hover:text-rose-400 transition-colors flex-shrink-0"><Trash2 size={13} /></button>
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
          <p className="text-xs text-[#7A7572] mb-4">When enabled, staff must be within the set radius of school coordinates during self check-in.</p>

          <div className="flex items-center gap-3 p-3 bg-[#F3F0EB] border border-[#E0DCD6] mb-4">
            <button
              role="switch" aria-checked={geofenceDraft.enabled}
              onClick={() => setGeofenceDraft(prev => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none ${geofenceDraft.enabled ? 'bg-[#A8896B]' : 'bg-[#C9C3BB]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${geofenceDraft.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <div>
              <p className="text-sm font-medium text-[#2B292E]">Enable Geofencing</p>
              <p className="text-xs text-[#7A7572]">{geofenceDraft.enabled ? 'Active — GPS checked on check-in' : 'Disabled — no GPS required'}</p>
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
            className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#F3F0EB] text-[#2B292E] border border-[#C9C3BB] hover:bg-[#EAE6E0] disabled:opacity-50 transition-colors">
            {gettingLocation ? <><Loader2 size={13} className="animate-spin" /> Getting location…</> : <><Navigation size={13} /> Get Current Location</>}
          </button>
          <p className="text-[11px] text-[#9A9290] mt-1">Auto-fills latitude and longitude from your browser&apos;s GPS.</p>

          {geofenceDraft.lat != null && geofenceDraft.lng != null && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-[#F3F0EB] border border-[#C9C3BB] text-sm text-[#2B292E]">
              <MapPin size={13} className="text-[#A8896B] flex-shrink-0" />
              <span>{geofenceDraft.lat.toFixed(6)}, {geofenceDraft.lng.toFixed(6)} — {geofenceDraft.radius_m}m radius</span>
            </div>
          )}
        </div>
        <div className="pt-3 border-t border-[#E0DCD6]">
          <button onClick={handleSaveGeofence} disabled={savingGeofence}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] disabled:opacity-50 transition-colors">
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
      return <div className="py-12 text-center text-[#7A7572] text-sm"><Loader2 size={16} className="animate-spin inline mr-2 text-[#A8896B]" /> Loading…</div>
    }

    return (
      <div className="space-y-6">
        <div>
          <SectionLabel>Late Timing</SectionLabel>
          <p className="text-xs text-[#7A7572] mb-3">Staff who check in after this time are automatically marked <strong>Late</strong>.</p>
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="Late cutoff (local time)">
              <input type="time" value={attendanceDraft.late_cutoff ?? ''} onChange={e => setAttendanceDraft({ late_cutoff: e.target.value || null })}
                className="px-3 py-2 text-sm border border-[#C9C3BB] focus:outline-none focus:border-[#3D3B40] bg-white transition-colors" />
            </Field>
            {attendanceDraft.late_cutoff && (
              <button onClick={() => setAttendanceDraft({ late_cutoff: null })} className="text-xs text-[#7A7572] hover:text-[#2B292E] pb-2 transition-colors">Clear</button>
            )}
            <button onClick={handleSaveAttendance} disabled={savingAttendance}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] disabled:opacity-50 transition-colors">
              {savingAttendance ? <Loader2 size={13} className="animate-spin" /> : savedAttendance ? <Check size={13} /> : <Save size={13} />}
              {savingAttendance ? 'Saving…' : savedAttendance ? 'Saved!' : 'Save Late Timing'}
            </button>
          </div>
        </div>

        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Holidays</SectionLabel>
          <p className="text-xs text-[#7A7572] mb-3">Staff are not auto-marked absent on declared holidays.</p>
          <div className="flex items-end gap-2 flex-wrap mb-3">
            <Field label="Date">
              <input type="date" value={newHolidayDate} onChange={e => setNewHolidayDate(e.target.value)}
                className="px-3 py-2 text-sm border border-[#C9C3BB] focus:outline-none focus:border-[#3D3B40] bg-white transition-colors" />
            </Field>
            <Field label="Name">
              <input type="text" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} placeholder="e.g. Independence Day"
                className="px-3 py-2 text-sm border border-[#C9C3BB] focus:outline-none focus:border-[#3D3B40] bg-white transition-colors" />
            </Field>
            <button onClick={handleAddHoliday} disabled={!newHolidayDate || !newHolidayName.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[#F3F0EB] border border-[#C9C3BB] text-[#2B292E] hover:bg-[#EAE6E0] disabled:opacity-50 transition-colors">
              <Plus size={13} /> Add
            </button>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-[#9A9290] flex items-center gap-1.5"><CalendarOff size={12} className="text-[#A8896B]" /> No holidays declared yet.</p>
          ) : (
            <div className="space-y-px max-h-64 overflow-y-auto">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F3F0EB] border border-[#E0DCD6]">
                  <CalendarOff size={13} className="text-[#A8896B] flex-shrink-0" />
                  <span className="text-sm font-medium text-[#2B292E] flex-shrink-0">
                    {new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-sm text-[#7A7572] flex-1 truncate">{h.name}</span>
                  <button onClick={() => handleDeleteHoliday(h.id)} className="text-[#C9C3BB] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Geofence Exemptions</SectionLabel>
          <p className="text-xs text-[#7A7572] mb-3">Exempted staff can check in outside the school geofence ({exemptCount} exempted).</p>
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7572]" />
            <input type="text" value={exemptQuery} onChange={e => setExemptQuery(e.target.value)} placeholder="Search staff…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#C9C3BB] focus:outline-none focus:border-[#3D3B40] bg-white transition-colors" />
          </div>
          <div className="space-y-px max-h-80 overflow-y-auto">
            {filteredStaff.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F3F0EB] border border-[#E0DCD6]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#2B292E] truncate">{s.full_name}</p>
                  <p className="text-[11px] text-[#7A7572] truncate capitalize">{s.role} · {s.email}</p>
                </div>
                {s.geofence_exempt && <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0" />}
                <button
                  role="switch" aria-checked={!!s.geofence_exempt} disabled={exemptSaving === s.id}
                  onClick={() => handleToggleExempt(s)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${s.geofence_exempt ? 'bg-[#A8896B]' : 'bg-[#C9C3BB]'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${s.geofence_exempt ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
            {filteredStaff.length === 0 && <p className="text-xs text-[#9A9290] py-3 text-center">No staff match your search.</p>}
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
          <p className="text-xs text-[#7A7572] mb-3">Displayed at the top of the home page. Admins can also upload directly from the home page.</p>
          <UploadField label="Home Banner Image" currentUrl={draftBranding.logoUrl ? '' : ''} uploading={!!uploadingMap['home-banner']}
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
        </div>
        <div className="border-t border-[#E0DCD6] pt-5">
          <SectionLabel>Profile Page Banner</SectionLabel>
          <p className="text-xs text-[#7A7572] mb-3">Displayed at the top of every user&apos;s profile page.</p>
          <UploadField label="Profile Banner Image" currentUrl={''} uploading={!!uploadingMap['profile-banner']}
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="admin">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#3D3B40] flex items-center justify-center flex-shrink-0">
              <Settings className="text-[#A8896B]" size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#2B292E]">App Settings</h1>
              <p className="text-xs text-[#7A7572]">Customize your school web app</p>
            </div>
          </div>
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#3D3B40] hover:bg-[#2B292E] text-[#F3F0EB] text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save All Changes'}
          </button>
        </div>

        {/* Layout: sidebar + content */}
        <div className="flex border border-[#C9C3BB] overflow-hidden">

          {/* Sidebar tabs */}
          <div className="w-40 sm:w-44 bg-[#3D3B40] flex-shrink-0 flex flex-col">
            {tabs.map(t => (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-left transition-colors border-l-2 ${
                  tab === t.id
                    ? 'border-l-[#A8896B] bg-[#A8896B]/12 text-[#F3F0EB]'
                    : 'border-l-transparent text-[#F3F0EB]/50 hover:text-[#F3F0EB] hover:bg-white/5'
                }`}
              >
                <span className={tab === t.id ? 'text-[#A8896B]' : ''}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Content pane */}
          <div className="flex-1 bg-[#F3F0EB] overflow-y-auto" style={{ maxHeight: '80vh' }}>
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
