'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Design — how the app looks.
//
//   Branding        — the app's name, logo, favicon and brand colours.
//   School profile  — the letterhead details printed on certificates.
//   Themes          — a palette per page.
//   Login page      — the sign-in screen's copy and colours.
//   Banners         — the home and profile photos, and every page's banner.
//
// Was App Settings. Geofencing and attendance rules are their own Admin Space
// pages now, and bus finance lives in the Transport module, so all that is
// left here is the look — hence the name.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import {
  PageIconMap, SiteBranding, LoginPageConfig, PageThemeMap, THEME_PALETTES,
  savePageIconConfig, saveBranding, saveLoginConfig, savePageThemes, saveSetting, uploadSiteAsset,
  AnnouncementBannerConfig, fetchPageBanner, savePageBanner, BANNER_PRESETS, BANNER_DEFAULT, TASK_BANNER_DEFAULT,
  ACADEMICS_BANNER_DEFAULT, EXAM_BANNER_DEFAULT, ATTENDANCE_BANNER_DEFAULT, STAFF_ATTENDANCE_BANNER_DEFAULT,
  LEAVE_BANNER_DEFAULT, STAFF_LEAVE_BANNER_DEFAULT, FEES_BANNER_DEFAULT, SALARY_BANNER_DEFAULT, BUS_BANNER_DEFAULT,
  TIMETABLE_BANNER_DEFAULT, FEEDBACK_BANNER_DEFAULT,
} from '@/lib/pageConfig'
import { swatchBackground, gradientLuminance, isDarkLum } from '@/lib/bannerStyle'
import { setProfileBanner } from '@/lib/profileBanner'
import {
  Check, RotateCcw, Save, Palette, Image as ImageIcon, Type, LogIn, Layout, Upload, X, Plus, Trash2, Loader2,
  Building2, Brush, ChevronLeft, Sparkles, Droplet, MapPin, Stamp, ListChecks, MousePointerClick, PanelLeft, Images,
} from 'lucide-react'
import { SchoolProfile, SCHOOL_PROFILE_DEFAULTS, fetchSchoolProfile, saveSchoolProfile } from '@/lib/schoolProfile'
import { AX, Field, Panel, PageLoading } from '@/components/admin/ui'

type Tab = 'branding' | 'school-profile' | 'page-themes' | 'login' | 'banners'

const TABS = [
  { key: 'branding' as const,       label: 'Branding',       icon: Type },
  { key: 'school-profile' as const, label: 'School profile', icon: Building2 },
  { key: 'page-themes' as const,    label: 'Themes',         icon: Palette },
  { key: 'login' as const,          label: 'Login page',     icon: LogIn },
  { key: 'banners' as const,        label: 'Banners',        icon: Layout },
]


// Per-page gradient banners — mirrors the Page Themes list (admin-space pages excluded;
// they stay on the uncustomisable Edzee theme). Home is covered by the image banner above.
const PAGE_BANNERS: { key: string; label: string; default: AnnouncementBannerConfig }[] = [
  { key: 'announcement_banner',     label: 'Announcements',      default: BANNER_DEFAULT },
  { key: 'task_banner',             label: 'Tasks',              default: TASK_BANNER_DEFAULT },
  { key: 'academics_banner',        label: 'Academics',          default: ACADEMICS_BANNER_DEFAULT },
  { key: 'exam_banner',             label: 'Exams',              default: EXAM_BANNER_DEFAULT },
  { key: 'attendance_banner',       label: 'Student attendance', default: ATTENDANCE_BANNER_DEFAULT },
  { key: 'staff_attendance_banner', label: 'Staff attendance',   default: STAFF_ATTENDANCE_BANNER_DEFAULT },
  { key: 'leave_banner',            label: 'Student OD/leave',   default: LEAVE_BANNER_DEFAULT },
  { key: 'staff_leave_banner',      label: 'Staff leave',        default: STAFF_LEAVE_BANNER_DEFAULT },
  { key: 'fees_banner',             label: 'Fees',               default: FEES_BANNER_DEFAULT },
  { key: 'salary_banner',           label: 'Salary',             default: SALARY_BANNER_DEFAULT },
  { key: 'bus_banner',              label: 'Bus & transport',    default: BUS_BANNER_DEFAULT },
  { key: 'timetable_banner',        label: 'Timetable',          default: TIMETABLE_BANNER_DEFAULT },
  { key: 'feedback_banner',         label: 'Feedback',           default: FEEDBACK_BANNER_DEFAULT },
]

const PAGE_THEME_LABELS: Record<string, string> = {
  home: 'Home', announcements: 'Announcements', tasks: 'Tasks',
  academics: 'Academics', exam: 'Exams', bus: 'Bus & transport',
  'staff-attendance': 'Staff attendance', 'student-attendance': 'Student attendance',
  'staff-leave': 'Staff leave', 'student-leave': 'Student OD/leave',
  fees: 'Fees', salary: 'Salary', timetable: 'Timetable', feedback: 'Feedback',
}
const THEME_PAGES = ['home', 'announcements', 'tasks', 'academics', 'exam', 'student-attendance', 'staff-attendance', 'student-leave', 'staff-leave', 'fees', 'salary', 'bus', 'timetable', 'feedback']

// ── Primitives ────────────────────────────────────────────────────────────────

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={AX.field} />
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative w-[38px] h-[38px] flex-shrink-0 rounded-lg overflow-hidden border border-[#D4D4D8] shadow-[inset_0_1px_2px_rgba(15,23,42,.06)] cursor-pointer" style={{ background: value }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Pick a colour" />
      </label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="#000000" className={`${AX.field} font-mono !text-[12.5px] uppercase`} />
    </div>
  )
}

/** The small labelled colour field used in grids. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><ColorInput value={value} onChange={onChange} /></Field>
}

interface UploadFieldProps {
  label: string; currentUrl: string
  onUpload: (file: File) => Promise<void>; onClear: () => void
  uploading: boolean; accept?: string; previewCircle?: boolean
}
function UploadField({ label, currentUrl, onUpload, onClear, uploading, accept = 'image/*', previewCircle }: UploadFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const shape = previewCircle ? 'rounded-full' : 'rounded-lg'
  return (
    <div>
      {label && <p className={AX.label}>{label}</p>}
      <div className="flex items-center gap-3">
        {currentUrl ? (
          <div className="relative flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentUrl} alt="" className={`w-14 h-14 object-cover border border-black/[.06] shadow-sm ${shape}`} />
            <button onClick={onClear} aria-label="Remove image" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-[#52525B] hover:text-[#B8983C] ring-1 ring-black/10 shadow flex items-center justify-center transition-colors">
              <X size={11} />
            </button>
          </div>
        ) : (
          <div className={`w-14 h-14 bg-[#F5F5F5] border border-dashed border-[#D4D4D8] flex items-center justify-center ${shape}`}>
            <ImageIcon size={18} className="text-[#D4D4D8]" />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <button onClick={() => ref.current?.click()} disabled={uploading} className={AX.ghost}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Uploading…' : currentUrl ? 'Replace' : 'Upload image'}
          </button>
          {currentUrl && <p className="text-[11px] text-[#A1A1AA] truncate max-w-[220px]">{currentUrl.split('/').pop()}</p>}
        </div>
        <input ref={ref} type="file" accept={accept} className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) await onUpload(f); e.target.value = '' }} />
      </div>
    </div>
  )
}

/** A gradient strip previewing two or three stops. */
function GradientStrip({ stops }: { stops: string[] }) {
  return <div className="mt-3 h-8 rounded-lg border border-black/[.06]" style={{ background: `linear-gradient(135deg, ${stops.join(', ')})` }} />
}

/** A list of pages to pick one from: a column beside the editor on a laptop, a scrolling row on a phone. */
function PagePicker({ items, value, onChange }: {
  items: { key: string; label: string; swatch: string; marked?: boolean }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <div className="md:w-52 flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible scrollbar-none -mx-1 px-1 pb-1 md:pb-0">
      {items.map(it => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            aria-pressed={on}
            className={`flex items-center gap-2.5 h-9 px-2.5 rounded-r-lg border-l-2 text-[13px] text-left whitespace-nowrap flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
              on ? 'border-[#B8983C] bg-[#F5F5F5] text-[#18181B] font-semibold' : 'border-transparent text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B] font-medium'
            }`}
          >
            <span className="w-4 h-4 rounded flex-shrink-0 ring-1 ring-black/10" style={{ background: it.swatch }} />
            <span className="truncate flex-1">{it.label}</span>
            {it.marked && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#B8983C]" aria-label="Customised" />}
          </button>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesignPage() {
  return (
    <ProtectedLayout adminOnly>
      {/* useSearchParams needs a Suspense boundary to stay out of the
          static-render bailout. */}
      <Suspense fallback={null}>
        <DesignInner />
      </Suspense>
    </ProtectedLayout>
  )
}

function DesignInner() {
  const { profile } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const { pageIcons, branding, loginConfig, pageThemes, brandingLoaded, reload } = usePageConfig()

  const rawTab = params.get('tab')
  const tab: Tab = TABS.some(t => t.key === rawTab) ? rawTab as Tab : 'branding'
  const setTab = (next: Tab) => router.replace(next === 'branding' ? '/admin/design' : `/admin/design?tab=${next}`, { scroll: false })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const [draftIcons, setDraftIcons] = useState<PageIconMap>(pageIcons)
  const [draftBranding, setDraftBranding] = useState<SiteBranding>(branding)
  const [draftLogin, setDraftLogin] = useState<LoginPageConfig>(loginConfig)
  const [draftThemes, setDraftThemes] = useState<PageThemeMap>(pageThemes)

  const [selectedThemePage, setSelectedThemePage] = useState<string>('home')
  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({})

  const [bannerDrafts, setBannerDrafts] = useState<Record<string, AnnouncementBannerConfig>>({})
  const [bannersLoaded, setBannersLoaded] = useState(false)
  const [bannerSaving, setBannerSaving] = useState<string | null>(null)
  const [bannerSaved, setBannerSaved] = useState<string | null>(null)
  const [selectedBannerKey, setSelectedBannerKey] = useState(PAGE_BANNERS[0].key)

  // ── School Profile (CBSE institutional info) ──
  const [schoolDraft, setSchoolDraft] = useState<SchoolProfile>(SCHOOL_PROFILE_DEFAULTS)
  const [schoolLoaded, setSchoolLoaded] = useState(false)
  const [savingSchool, setSavingSchool] = useState(false)
  const [savedSchool, setSavedSchool] = useState(false)

  // Sync the drafts from the loaded config exactly once, the first time it
  // settles (cache or network). Re-running this on every later context
  // change is what turned one flaky background refetch into data loss: a
  // failed reload used to reset `branding`/`pageThemes` to the neutral
  // defaults, this effect copied that into the drafts (silently discarding
  // whatever the admin had picked or already had saved), and the next
  // "Save" click persisted those defaults over the real, correct colours.
  // A one-time sync means nothing can overwrite the admin's in-progress
  // edits after the form has actually opened with real data.
  const draftsSyncedRef = useRef(false)
  useEffect(() => {
    if (draftsSyncedRef.current || !brandingLoaded) return
    draftsSyncedRef.current = true
    setDraftIcons(pageIcons); setDraftBranding(branding)
    setDraftLogin(loginConfig); setDraftThemes(pageThemes)
  }, [brandingLoaded, pageIcons, branding, loginConfig, pageThemes])

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

  function updateBranding(patch: Partial<SiteBranding>) { setDraftBranding(prev => ({ ...prev, ...patch })) }
  function updateLogin(patch: Partial<LoginPageConfig>) { setDraftLogin(prev => ({ ...prev, ...patch })) }
  function updateFeature(index: number, value: string) {
    setDraftLogin(prev => { const f = [...prev.features]; f[index] = value; return { ...prev, features: f } })
  }
  function addFeature() { setDraftLogin(prev => ({ ...prev, features: [...prev.features, ''] })) }
  function removeFeature(index: number) { setDraftLogin(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== index) })) }

  async function handleSave() {
    setSaving(true)
    setSaveError(false)
    const results = await Promise.all([
      savePageIconConfig(draftIcons), saveBranding(draftBranding),
      saveLoginConfig(draftLogin), savePageThemes(draftThemes),
    ])
    await reload()
    setSaving(false)
    // Each save resolves to false (never throws) on failure — e.g. an RLS
    // rejection or a dropped request — so a silently-ignored result here is
    // exactly how a rejected write could look identical to a successful one.
    if (results.some(ok => !ok)) {
      setSaveError(true)
      return
    }
    setSaved(true); setTimeout(() => setSaved(false), 2500)
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

  function updateSchool(patch: Partial<SchoolProfile>) { setSchoolDraft(prev => ({ ...prev, ...patch })) }

  async function handleSaveSchool() {
    setSavingSchool(true)
    await saveSchoolProfile(schoolDraft)
    setSavedSchool(true); setTimeout(() => setSavedSchool(false), 2500); setSavingSchool(false)
  }

  // ── Tab renderers ─────────────────────────────────────────────────────────

  function renderSchoolProfile() {
    if (!schoolLoaded) return <PageLoading>Loading school profile…</PageLoading>
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-stretch">
        <Panel icon={Building2} title="Institutional details" className="h-full"
          description="Printed on the letterhead and footer of every certificate. The school name, tagline and logo come from Branding.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="CBSE affiliation no.">
              <TextInput value={schoolDraft.affiliation_no} onChange={v => updateSchool({ affiliation_no: v })} placeholder="e.g. 1930456" />
            </Field>
            <Field label="School code">
              <TextInput value={schoolDraft.school_code} onChange={v => updateSchool({ school_code: v })} placeholder="e.g. 56789" />
            </Field>
            <Field label="Recognition / DISE no.">
              <TextInput value={schoolDraft.recognition_no} onChange={v => updateSchool({ recognition_no: v })} placeholder="State recognition number" />
            </Field>
            <Field label="Principal's name">
              <TextInput value={schoolDraft.principal_name} onChange={v => updateSchool({ principal_name: v })} placeholder="e.g. Dr. A. Sharma" />
            </Field>
          </div>
        </Panel>

        <Panel icon={Stamp} title="School seal" className="h-full" description="Printed above the principal's signature on certificates.">
          <UploadField label="" currentUrl={schoolDraft.seal_url} uploading={!!uploadingMap['school-seal']}
            onUpload={f => uploadAndSet('school-seal', f, url => updateSchool({ seal_url: url }))}
            onClear={() => updateSchool({ seal_url: '' })} />
        </Panel>

        <Panel icon={MapPin} title="Address and contact" className="xl:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Street address" className="sm:col-span-2">
              <TextInput value={schoolDraft.address} onChange={v => updateSchool({ address: v })} placeholder="Building, street, area" />
            </Field>
            <Field label="City"><TextInput value={schoolDraft.city} onChange={v => updateSchool({ city: v })} /></Field>
            <Field label="State"><TextInput value={schoolDraft.state} onChange={v => updateSchool({ state: v })} /></Field>
            <Field label="Pincode"><TextInput value={schoolDraft.pincode} onChange={v => updateSchool({ pincode: v })} /></Field>
            <Field label="Phone"><TextInput value={schoolDraft.phone} onChange={v => updateSchool({ phone: v })} /></Field>
            <Field label="Email"><TextInput value={schoolDraft.email} onChange={v => updateSchool({ email: v })} /></Field>
            <Field label="Website"><TextInput value={schoolDraft.website} onChange={v => updateSchool({ website: v })} placeholder="https://" /></Field>
          </div>
        </Panel>
      </div>
    )
  }

  function renderBranding() {
    // Two rows of two, each pair the same height, so the pane is filled edge to
    // edge: what the app is called beside how it reads, the marks beside the colours.
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-stretch">
        <Panel icon={Type} title="App identity" className="h-full" description="The name in the navigation bar and on documents.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="App title">
              <TextInput value={draftBranding.appTitle} onChange={v => updateBranding({ appTitle: v })} placeholder="MPS Web" />
            </Field>
            <Field label="App subtitle">
              <TextInput value={draftBranding.appSubtitle} onChange={v => updateBranding({ appSubtitle: v })} placeholder="School name" />
            </Field>
            <Field label="School name">
              <TextInput value={draftBranding.schoolName} onChange={v => updateBranding({ schoolName: v })} placeholder="School name" />
            </Field>
            <Field label="Tagline">
              <TextInput value={draftBranding.tagline} onChange={v => updateBranding({ tagline: v })} placeholder="Excel · Enrich · Enlighten" />
            </Field>
          </div>
        </Panel>

        <Panel icon={Sparkles} title="Preview" className="h-full" description="How the navigation bar reads with these settings.">
          <div className="p-4 sm:p-5 bg-[#F5F5F5] border border-[#E4E4E7] flex-1 flex flex-col justify-center gap-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-[#E4E4E7]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draftBranding.logoUrl || '/logo.png'} alt="" className="w-10 h-10 object-cover rounded-full ring-1 ring-black/10"
                onError={e => { (e.target as HTMLImageElement).src = '/logo.png' }} />
              <div className="min-w-0">
                <p className="text-[14px] font-bold truncate" style={{ backgroundImage: `linear-gradient(135deg, ${draftBranding.primaryColor}, ${draftBranding.secondaryColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  {draftBranding.appTitle || 'App title'}
                </p>
                <p className="text-[12px] text-[#71717A] truncate">{draftBranding.appSubtitle || 'School name'}</p>
              </div>
              <p className="ml-auto hidden sm:block text-[12px] text-[#71717A] italic truncate">{draftBranding.tagline}</p>
            </div>
            <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${draftBranding.primaryColor}, ${draftBranding.secondaryColor})` }} />
          </div>
        </Panel>

        <Panel icon={Images} title="Logo and favicon" className="h-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadField label="App logo" currentUrl={draftBranding.logoUrl} uploading={!!uploadingMap['logo']} previewCircle
              onUpload={f => uploadAndSet('logo', f, url => updateBranding({ logoUrl: url }))}
              onClear={() => updateBranding({ logoUrl: '' })} />
            <UploadField label="Favicon" currentUrl={draftBranding.faviconUrl} uploading={!!uploadingMap['favicon']}
              onUpload={f => uploadAndSet('favicon', f, url => updateBranding({ faviconUrl: url }))}
              onClear={() => updateBranding({ faviconUrl: '' })} />
          </div>
        </Panel>

        <Panel icon={Droplet} title="Brand colours" className="h-full" description="Accents, buttons and gradients across the app.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ColorField label="Primary" value={draftBranding.primaryColor} onChange={v => updateBranding({ primaryColor: v })} />
            <ColorField label="Secondary" value={draftBranding.secondaryColor} onChange={v => updateBranding({ secondaryColor: v })} />
          </div>
        </Panel>
      </div>
    )
  }

  function renderPageThemes() {
    const t = selectedThemePage
    const current = draftThemes[t]
    const setTheme = (patch: Partial<NonNullable<typeof current>>) =>
      setDraftThemes(prev => ({ ...prev, [t]: { ...prev[t]!, ...patch } }))

    return (
      <section className={`${AX.sheet} p-3 sm:p-4 flex flex-col md:flex-row gap-3 md:gap-5`}>
        <PagePicker
          value={t}
          onChange={setSelectedThemePage}
          items={THEME_PAGES.map(pageId => {
            const theme = draftThemes[pageId]
            return {
              key: pageId,
              label: PAGE_THEME_LABELS[pageId] ?? pageId,
              swatch: theme ? `linear-gradient(135deg,${theme.gradFrom},${theme.gradTo})` : '#e2e8f0',
              marked: !!theme,
            }
          })}
        />

        <div className="flex-1 min-w-0 md:border-l md:border-black/[.06] md:pl-5 py-1">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-[15px] font-semibold text-[#18181B]">{PAGE_THEME_LABELS[t] ?? t}</h2>
            {current && (
              <button onClick={() => setDraftThemes(prev => { const n = { ...prev }; delete n[t]; return n })} className={AX.ghost}>
                <RotateCcw size={12} /> Use default
              </button>
            )}
          </div>
          <p className={`${AX.hint} mb-4`}>Pick a palette for this page&apos;s background, buttons, accents and icons.</p>

          {(['light', 'dark'] as const).map(variant => (
            <div key={variant} className="mb-5">
              <p className="text-[12.5px] font-medium text-[#52525B] mb-2">{variant === 'light' ? 'Light palettes' : 'Dark palettes'}</p>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                {THEME_PALETTES.filter(p => p.variant === variant).map(({ id, label, theme }) => {
                  const isSelected = current?.primary === theme.primary
                  return (
                    <button key={id}
                      onClick={() => setDraftThemes(prev => ({ ...prev, [t]: theme }))}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
                        isSelected ? 'bg-white ring-2 ring-[#B8983C] shadow-sm' : 'bg-[#F5F5F5] ring-1 ring-black/[.04] hover:bg-white hover:ring-black/10'
                      }`}>
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <div className="w-9 h-5 rounded-t-md"
                          style={{ backgroundImage: swatchBackground(theme.gradFrom, theme.gradTo), backgroundSize: '120px, auto', backgroundBlendMode: 'soft-light' }} />
                        <div className="w-9 h-3 rounded-b-md ring-1 ring-black/[.06]"
                          style={{ background: `linear-gradient(135deg, ${theme.bgFrom}, ${theme.bgMid}, ${theme.bgTo})` }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold text-[#27272A] truncate">{label}</p>
                        <div className="flex gap-1 mt-1">
                          {[theme.primary, theme.accent, theme.bgFrom].map(c => (
                            <span key={c} className="w-3 h-3 rounded-full ring-1 ring-black/10" style={{ background: c }} />
                          ))}
                        </div>
                      </div>
                      {isSelected && <Check size={14} className="ml-auto text-[#3F3F46] flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {current && (
            <div className="pt-4 border-t border-black/[.06]">
              <p className="text-[13.5px] font-semibold text-[#18181B] mb-3">Fine-tune</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ColorField label="Primary" value={current.primary} onChange={v => setTheme({ primary: v })} />
                <ColorField label="Accent" value={current.accent} onChange={v => setTheme({ accent: v })} />
                <ColorField label="Gradient start" value={current.gradFrom} onChange={v => setTheme({ gradFrom: v })} />
                <ColorField label="Gradient end" value={current.gradTo} onChange={v => setTheme({ gradTo: v })} />
                <ColorField label="Background start" value={current.bgFrom ?? '#f8fafc'} onChange={v => setTheme({ bgFrom: v })} />
                <ColorField label="Background middle" value={current.bgMid ?? '#f1f5f9'} onChange={v => setTheme({ bgMid: v })} />
                <ColorField label="Background end" value={current.bgTo ?? '#f9fafb'} onChange={v => setTheme({ bgTo: v })} />
              </div>
              <p className="text-[12px] text-[#71717A] mt-4">Background</p>
              <GradientStrip stops={[current.bgFrom ?? '#f8fafc', current.bgMid ?? '#f1f5f9', current.bgTo ?? '#f9fafb']} />
            </div>
          )}
        </div>
      </section>
    )
  }

  function renderLogin() {
    const leftStops = [draftLogin.gradientFrom, draftLogin.gradientMid, draftLogin.gradientTo]
    const rightStops = [draftLogin.pageBgFrom ?? '#f0f9ff', draftLogin.pageBgMid ?? '#f5f3ff', draftLogin.pageBgTo ?? '#f0fdf4']
    // The sign-in screen's two halves, side by side and row for row: each row
    // pairs the left panel's setting with its right-panel counterpart, so the
    // two columns line up the way the screen they describe does.
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 items-stretch">
        {/* Row 1: the words. */}
        <Panel icon={Type} title="Left panel text" className="h-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="School name" className="sm:col-span-2"><TextInput value={draftLogin.schoolName} onChange={v => updateLogin({ schoolName: v })} /></Field>
            <Field label="Tagline" className="sm:col-span-2"><TextInput value={draftLogin.tagline} onChange={v => updateLogin({ tagline: v })} /></Field>
          </div>
        </Panel>
        <Panel icon={Type} title="Right panel text" className="h-full">
          <div className="grid grid-cols-1 gap-4">
            <Field label="Welcome text"><TextInput value={draftLogin.welcomeText} onChange={v => updateLogin({ welcomeText: v })} /></Field>
            <p className={AX.hint}>Shown above the sign-in form.</p>
          </div>
        </Panel>

        {/* Row 2: the colours. */}
        <Panel icon={PanelLeft} title="Left panel gradient" className="h-full">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorField label="Top" value={draftLogin.gradientFrom} onChange={v => updateLogin({ gradientFrom: v })} />
            <ColorField label="Middle" value={draftLogin.gradientMid} onChange={v => updateLogin({ gradientMid: v })} />
            <ColorField label="Bottom" value={draftLogin.gradientTo} onChange={v => updateLogin({ gradientTo: v })} />
          </div>
          <GradientStrip stops={leftStops} />
        </Panel>
        <Panel icon={Brush} title="Right panel background" className="h-full">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorField label="Start" value={rightStops[0]} onChange={v => updateLogin({ pageBgFrom: v })} />
            <ColorField label="Middle" value={rightStops[1]} onChange={v => updateLogin({ pageBgMid: v })} />
            <ColorField label="End" value={rightStops[2]} onChange={v => updateLogin({ pageBgTo: v })} />
          </div>
          <GradientStrip stops={rightStops} />
        </Panel>

        {/* Row 3: what sits on each half. */}
        <Panel icon={ListChecks} title="Left panel features" className="h-full" description="The bullet points under the school name."
          action={<button onClick={addFeature} className={AX.ghost}><Plus size={13} /> Add</button>}>
          <div className="space-y-2">
            {draftLogin.features.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <TextInput value={f} onChange={v => updateFeature(i, v)} placeholder={`Feature ${i + 1}`} />
                <button onClick={() => removeFeature(i)} aria-label={`Remove feature ${i + 1}`} className={AX.iconDanger}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon={MousePointerClick} title="Right panel sign-in button" className="h-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ColorField label="Button" value={draftLogin.buttonColor ?? draftLogin.gradientFrom} onChange={v => updateLogin({ buttonColor: v })} />
            <ColorField label="Button text" value={draftLogin.buttonTextColor ?? '#ffffff'} onChange={v => updateLogin({ buttonTextColor: v })} />
          </div>
          <div className="mt-3 flex items-center justify-center py-5 border border-[#E4E4E7]"
            style={{ background: `linear-gradient(135deg, ${rightStops.join(', ')})` }}>
            <div className="flex items-center justify-center px-8 py-2.5 rounded-lg text-[14px] font-semibold shadow-sm"
              style={{ background: draftLogin.buttonColor ?? draftLogin.gradientFrom, color: draftLogin.buttonTextColor ?? '#ffffff' }}>
              Sign in
            </div>
          </div>
        </Panel>

        {/* Row 4: the photo, and the whole screen as it will look. */}
        <Panel icon={ImageIcon} title="Background image" className="h-full" description="Optional. Shown as a subtle overlay on the left panel.">
          <UploadField label="" currentUrl={draftLogin.bgImageUrl} uploading={!!uploadingMap['login-bg']}
            onUpload={f => uploadAndSet('login-bg', f, url => updateLogin({ bgImageUrl: url }))}
            onClear={() => updateLogin({ bgImageUrl: '' })} />
        </Panel>
        <Panel icon={Sparkles} title="Preview" className="h-full" description="Both halves of the sign-in screen.">
          <div className="grid grid-cols-2 h-28 border border-[#E4E4E7] overflow-hidden">
            <div className="relative p-3 flex flex-col justify-end" style={{ background: `linear-gradient(160deg, ${leftStops.join(', ')})` }}>
              {draftLogin.bgImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draftLogin.bgImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />
              )}
              <p className="relative text-[12px] font-bold text-white truncate drop-shadow">{draftLogin.schoolName}</p>
              <p className="relative text-[10.5px] text-white/80 truncate">{draftLogin.tagline}</p>
            </div>
            <div className="p-3 flex flex-col items-center justify-center gap-2" style={{ background: `linear-gradient(135deg, ${rightStops.join(', ')})` }}>
              <p className="text-[11px] font-semibold text-[#27272A] truncate max-w-full">{draftLogin.welcomeText}</p>
              <span className="px-4 py-1 rounded-md text-[11px] font-semibold"
                style={{ background: draftLogin.buttonColor ?? draftLogin.gradientFrom, color: draftLogin.buttonTextColor ?? '#ffffff' }}>
                Sign in
              </span>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  function renderBanners() {
    const selected = PAGE_BANNERS.find(p => p.key === selectedBannerKey) ?? PAGE_BANNERS[0]
    const draft = bannerDrafts[selectedBannerKey] ?? selected.default
    const previewDark = draft.imageUrl ? true : isDarkLum(gradientLuminance(draft.gradFrom, draft.gradTo))
    const previewStyle: React.CSSProperties = draft.imageUrl
      ? { backgroundImage: `url(${draft.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { backgroundImage: swatchBackground(draft.gradFrom, draft.gradTo), backgroundSize: '160px, auto', backgroundBlendMode: 'soft-light' }

    return (
      <div className="space-y-4 sm:space-y-5">
        <Panel icon={Images} title="Photo banners" description="The pictures across the top of the home and profile pages.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadField label="Home page" currentUrl={''} uploading={!!uploadingMap['home-banner']}
              onUpload={async f => {
                setUploading('home-banner', true)
                const url = await uploadSiteAsset(f, 'welcome_banner')
                if (url) {
                  await saveSetting('welcome_banner', url)
                }
                setUploading('home-banner', false)
              }}
              onClear={async () => {
                await saveSetting('welcome_banner', '')
              }} />
            <UploadField label="Profile page" currentUrl={''} uploading={!!uploadingMap['profile-banner']}
              onUpload={async f => {
                setUploading('profile-banner', true)
                const url = await uploadSiteAsset(f, 'profile_banner')
                if (url) {
                  await saveSetting('profile_banner', url)
                  setProfileBanner(url)
                }
                setUploading('profile-banner', false)
              }}
              onClear={async () => {
                await saveSetting('profile_banner', '')
                setProfileBanner(null)
              }} />
          </div>
        </Panel>

        {!bannersLoaded ? (
          <PageLoading>Loading banners…</PageLoading>
        ) : (
          <section className={`${AX.sheet} p-3 sm:p-4 flex flex-col md:flex-row gap-3 md:gap-5`}>
            <PagePicker
              value={selectedBannerKey}
              onChange={setSelectedBannerKey}
              items={PAGE_BANNERS.map(p => {
                const cfg = bannerDrafts[p.key] ?? p.default
                return { key: p.key, label: p.label, swatch: `linear-gradient(135deg, ${cfg.gradFrom}, ${cfg.gradTo})` }
              })}
            />

            <div className="flex-1 min-w-0 md:border-l md:border-black/[.06] md:pl-5 py-1 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-[#18181B]">{selected.label}</h2>
                  <p className={AX.hint}>The banner across the top of this page. Saved changes show for everyone at once.</p>
                </div>
                <button onClick={() => updateBannerDraft(selectedBannerKey, selected.default)} className={AX.ghost}>
                  <RotateCcw size={12} /> Reset
                </button>
              </div>

              {/* Live preview — text colour mirrors the live banner */}
              <div className="h-20 overflow-hidden flex items-center px-5 gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,.18)]" style={previewStyle}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${previewDark ? 'bg-white/20' : 'bg-black/10'}`}>
                  <Layout size={18} className={previewDark ? 'text-white' : 'text-[#27272A]'} />
                </div>
                <div>
                  <p className={`text-[15px] font-bold leading-tight ${previewDark ? 'text-white' : 'text-[#18181B]'}`}>{selected.label}</p>
                  <p className={`text-[12px] leading-tight ${previewDark ? 'text-white/70' : 'text-[#52525B]'}`}>Banner preview</p>
                </div>
              </div>

              <div>
                <p className="text-[12.5px] font-medium text-[#52525B] mb-2">Presets</p>
                <div className="grid grid-cols-4 gap-2">
                  {BANNER_PRESETS.map(preset => {
                    const isActive = draft.gradFrom === preset.from && draft.gradTo === preset.to
                    return (
                      <button
                        key={preset.label}
                        onClick={() => updateBannerDraft(selectedBannerKey, { gradFrom: preset.from, gradTo: preset.to, imageUrl: '' })}
                        aria-pressed={isActive}
                        className={`relative flex flex-col rounded-lg overflow-hidden transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${isActive ? 'ring-2 ring-[#B8983C] shadow-sm' : 'ring-1 ring-black/[.08] hover:ring-black/20'}`}
                      >
                        <div className="h-8" style={{ backgroundImage: swatchBackground(preset.from, preset.to), backgroundSize: '120px, auto', backgroundBlendMode: 'soft-light' }} />
                        <span className="text-[11px] text-[#52525B] py-1 bg-white text-center truncate px-1">{preset.label}</span>
                        {isActive && <Check size={11} className={`absolute top-1.5 right-1.5 drop-shadow ${preset.variant === 'bright' ? 'text-[#18181B]' : 'text-white'}`} />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-[12.5px] font-medium text-[#52525B] mb-2">Custom colours</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ColorField label="Gradient start" value={draft.gradFrom} onChange={v => updateBannerDraft(selectedBannerKey, { gradFrom: v })} />
                  <ColorField label="Gradient end" value={draft.gradTo} onChange={v => updateBannerDraft(selectedBannerKey, { gradTo: v })} />
                </div>
              </div>

            </div>
          </section>
        )}
      </div>
    )
  }

  // One Save at the top of every tab. Branding, Themes and the Login page save
  // together (they are one config write); School profile and Banners save
  // their own record — the selected page's banner, for Banners.
  const selectedBanner = PAGE_BANNERS.find(p => p.key === selectedBannerKey) ?? PAGE_BANNERS[0]
  const save = tab === 'school-profile'
    ? { onClick: handleSaveSchool, saving: savingSchool, saved: savedSchool, error: false, label: 'Save school profile', disabled: !schoolLoaded }
    : tab === 'banners'
      ? { onClick: () => handleSaveBanner(selectedBannerKey), saving: bannerSaving === selectedBannerKey, saved: bannerSaved === selectedBannerKey, error: false, label: `Save ${selectedBanner.label} banner`, disabled: !bannersLoaded }
      : { onClick: handleSave, saving, saved, error: saveError, label: 'Save all changes', disabled: false }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8 min-h-screen" data-page-theme="admin" style={{ backgroundColor: '#FDFCF9' }}>

      {/* Header — the App Settings arrangement: mark, title, and the save that covers it. */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/more/admin-space')} aria-label="Back to Admin Space"
            className="w-9 h-9 rounded-lg bg-white border border-[#D4D4D8] flex items-center justify-center hover:bg-[#F5F5F5] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/70">
            <ChevronLeft size={18} className="text-[#18181B]" />
          </button>
          <div className="w-9 h-9 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
            <Brush className="text-[#B8983C]" size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#18181B]">Design</h1>
            <p className="text-xs text-[#71717A]">Branding, school profile, themes, the login page and banners</p>
          </div>
        </div>
        <button
          onClick={save.onClick} disabled={save.saving || save.disabled}
          className={`${AX.primary} !h-10 !px-5 ${save.error ? '!bg-[#18181B]' : ''}`}
          title={save.error ? 'Could not save — check your connection and try again' : undefined}
        >
          {save.saving ? <Loader2 size={14} className="animate-spin" /> : save.error ? <X size={14} /> : save.saved ? <Check size={14} /> : <Save size={14} />}
          {save.saving ? 'Saving…' : save.error ? 'Save failed — retry' : save.saved ? 'Saved' : save.label}
        </button>
      </div>

      {/* Layout: dark sidebar of sections + content pane. On a phone the
          sidebar becomes a strip across the top. */}
      <div className="flex flex-col md:flex-row border border-[#D4D4D8] bg-white md:min-h-[calc(100vh-11rem)]">
        <nav className="md:w-48 bg-[#27272A] flex-shrink-0 flex md:flex-col overflow-x-auto scrollbar-none" aria-label="Design sections">
          {TABS.map(t => {
            const Icon = t.icon
            const on = tab === t.key
            return (
              <button
                key={t.key} onClick={() => setTab(t.key)} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2.5 px-4 py-3 text-sm text-left whitespace-nowrap flex-shrink-0 transition-colors border-b-2 md:border-b-0 md:border-l-2 focus-visible:outline-none focus-visible:bg-white/10 ${
                  on ? 'border-[#B8983C] bg-white/10 text-[#F5F5F5] font-semibold' : 'border-transparent text-[#F5F5F5]/55 hover:text-[#F5F5F5] hover:bg-white/5'
                }`}
              >
                <Icon size={14} className={on ? 'text-[#B8983C]' : ''} />
                {t.label}
              </button>
            )
          })}
        </nav>

        <div className="flex-1 min-w-0 bg-[#F5F5F5] p-3 sm:p-5">
          {tab === 'branding'       && renderBranding()}
          {tab === 'school-profile' && renderSchoolProfile()}
          {tab === 'page-themes'    && renderPageThemes()}
          {tab === 'login'          && renderLogin()}
          {tab === 'banners'        && renderBanners()}
        </div>
      </div>
    </div>
  )
}
