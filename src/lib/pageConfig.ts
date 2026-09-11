import { supabase } from './supabase'
import { compressImageIfNeeded } from './imageCompression'

// ============================================
// Site-wide Configuration System
//
// Requires in Supabase:
//   1. site_settings table (key TEXT PK, value JSONB, updated_at TIMESTAMPTZ)
//   2. site_config table (key TEXT PK, value JSONB, updated_at TIMESTAMPTZ)
//   Both tables need:
//     RLS enabled, "Anyone reads" policy (USING true),
//     "Admins write" policy (role = 'admin' via profiles join)
//
//   Also requires classroom-files storage bucket (already exists).
// ============================================

// ---- Page Icons ----

export type PageId =
  | 'tasks' | 'announcements' | 'academics' | 'home'
  | 'leave' | 'fees' | 'feedback' | 'staffLeave'
  | 'classrooms' | 'teams' | 'profiles' | 'more'

export interface PageIconConfig {
  iconName: string
  gradientFrom: string
  gradientTo: string
  customImageUrl?: string   // custom uploaded image (overrides icon)
}

export type PageIconMap = Record<PageId, PageIconConfig>

export const PAGE_DEFAULTS: PageIconMap = {
  tasks:         { iconName: 'ClipboardList', gradientFrom: 'from-amber-400',  gradientTo: 'to-orange-500' },
  announcements: { iconName: 'Megaphone',     gradientFrom: 'from-blue-400',   gradientTo: 'to-purple-500' },
  academics:     { iconName: 'GraduationCap', gradientFrom: 'from-cyan-500',   gradientTo: 'to-teal-500'   },
  home:          { iconName: 'Home',          gradientFrom: 'from-green-400',  gradientTo: 'to-emerald-500'},
  leave:         { iconName: 'Calendar',      gradientFrom: 'from-sky-400',    gradientTo: 'to-blue-500'   },
  fees:          { iconName: 'CreditCard',    gradientFrom: 'from-violet-400', gradientTo: 'to-purple-500' },
  feedback:      { iconName: 'MessageSquare', gradientFrom: 'from-pink-400',   gradientTo: 'to-rose-500'   },
  staffLeave:    { iconName: 'CalendarDays',  gradientFrom: 'from-indigo-400', gradientTo: 'to-blue-500'   },
  classrooms:    { iconName: 'BookOpen',      gradientFrom: 'from-teal-400',   gradientTo: 'to-cyan-500'   },
  teams:         { iconName: 'Users',         gradientFrom: 'from-orange-400', gradientTo: 'to-amber-500'  },
  profiles:      { iconName: 'UserPlus',      gradientFrom: 'from-slate-400',  gradientTo: 'to-slate-600'  },
  more:          { iconName: 'Layers',        gradientFrom: 'from-pink-400',   gradientTo: 'to-purple-500' },
}

export const PAGE_LABELS: Record<PageId, string> = {
  tasks: 'Task Manager', announcements: 'Announcements', academics: 'Academics',
  home: 'Home', leave: 'Student OD/Leave', fees: 'Fee Manager', feedback: 'Feedback',
  staffLeave: 'Staff OD / Leave', classrooms: 'Classroom Management',
  teams: 'Teacher Teams', profiles: 'Profile Manager', more: 'More (All sub-pages)',
}

export const AVAILABLE_ICONS: string[] = [
  'ClipboardList', 'Megaphone', 'GraduationCap', 'Home', 'BookOpen',
  'Calendar', 'CalendarDays', 'Users', 'UserPlus', 'BarChart3',
  'Bell', 'Star', 'Award', 'Target', 'Layers', 'Grid',
  'FileText', 'MessageSquare', 'Settings', 'TrendingUp',
  'CheckSquare', 'Zap', 'CreditCard', 'Pencil',
  'FolderOpen', 'ListChecks', 'Lightbulb', 'Newspaper',
]

export const GRADIENT_OPTIONS = [
  { label: 'Amber → Orange',  from: 'from-amber-400',  to: 'to-orange-500'  },
  { label: 'Blue → Purple',   from: 'from-blue-400',   to: 'to-purple-500'  },
  { label: 'Cyan → Teal',     from: 'from-cyan-500',   to: 'to-teal-500'    },
  { label: 'Green → Emerald', from: 'from-green-400',  to: 'to-emerald-500' },
  { label: 'Sky → Blue',      from: 'from-sky-400',    to: 'to-blue-500'    },
  { label: 'Violet → Purple', from: 'from-violet-400', to: 'to-purple-500'  },
  { label: 'Pink → Rose',     from: 'from-pink-400',   to: 'to-rose-500'    },
  { label: 'Indigo → Blue',   from: 'from-indigo-400', to: 'to-blue-500'    },
  { label: 'Teal → Cyan',     from: 'from-teal-400',   to: 'to-cyan-500'    },
  { label: 'Orange → Amber',  from: 'from-orange-400', to: 'to-amber-500'   },
  { label: 'Red → Rose',      from: 'from-red-400',    to: 'to-rose-500'    },
  { label: 'Slate → Slate',   from: 'from-slate-400',  to: 'to-slate-600'   },
]

// ---- Branding ----

export interface SiteBranding {
  appTitle: string          // "MPS Web"
  appSubtitle: string       // "Muthamil Public School"
  schoolName: string        // "Muthamil Public School"
  tagline: string           // "Excel . Enrich . Enlighten"
  logoUrl: string           // URL or "" to use default /logo.png
  faviconUrl: string        // URL or ""
  primaryColor: string      // hex, e.g. "#0284c7"
  secondaryColor: string    // hex, e.g. "#16a34a"
}

export const BRANDING_DEFAULTS: SiteBranding = {
  appTitle:       'MPS Web',
  appSubtitle:    'Muthamil Public School',
  schoolName:     'Muthamil Public School',
  tagline:        'Excel . Enrich . Enlighten',
  logoUrl:        '',
  faviconUrl:     '',
  // Neutral placeholders shown only until the admin's real branding loads —
  // deliberately not blue/green so an unloaded state never looks "themed".
  primaryColor:   '#cbd5e1',
  secondaryColor: '#94a3b8',
}

// ---- Login Page ----

export interface LoginPageConfig {
  schoolName: string
  tagline: string
  welcomeText: string       // "Welcome to MPS Web"
  gradientFrom: string      // hex – left panel gradient top
  gradientMid: string       // hex – left panel gradient mid
  gradientTo: string        // hex – left panel gradient bottom
  pageBgFrom: string        // hex – right panel background gradient start
  pageBgMid: string         // hex – right panel background gradient mid
  pageBgTo: string          // hex – right panel background gradient end
  buttonColor: string       // hex – Sign In button background
  buttonTextColor: string   // hex – Sign In button text
  bgImageUrl: string        // URL or "" for gradient-only
  features: string[]        // bullet list on left panel
}

export const LOGIN_DEFAULTS: LoginPageConfig = {
  schoolName:      'Muthamil Public School',
  tagline:         'Excel . Enrich . Enlighten',
  welcomeText:     'Welcome to MPS Web',
  // Neutral white/grey placeholders shown only until the admin's real login
  // theme loads — deliberately not blue/green so an unloaded state never
  // looks "themed".
  gradientFrom:    '#e2e8f0',
  gradientMid:     '#cbd5e1',
  gradientTo:      '#94a3b8',
  pageBgFrom:      '#ffffff',
  pageBgMid:       '#f8fafc',
  pageBgTo:        '#f1f5f9',
  buttonColor:     '#64748b',
  buttonTextColor: '#ffffff',
  bgImageUrl:      '',
  features: [
    'Academic Progress Tracking',
    'Homework & Coursework Management',
    'Real-time Updates & Notifications',
  ],
}

// ---- Page Themes ----

export interface PageTheme {
  primary: string       // hex
  primaryLight: string  // hex
  primaryDark: string   // hex
  accent: string        // hex
  accentLight: string   // hex
  gradFrom: string      // hex
  gradTo: string        // hex
  bgFrom: string        // hex – page background gradient start
  bgMid: string         // hex – page background gradient mid
  bgTo: string          // hex – page background gradient end
}

export type PageThemeMap = Partial<Record<string, PageTheme>>

// Built-in theme palettes for the picker. The four light + four dark palettes
// share their hues with the BANNER_PRESETS swatches (Azure / Rose / Mint / Gold
// and Graphite / Navy / Pine / Plum) so any banner colour an admin picks has a
// matching app theme. EdZee Special is kept as the featured house palette.
export const THEME_PALETTES: { id: string; label: string; variant: 'light' | 'dark'; theme: PageTheme }[] = [
  // ── Featured house palette ───────────────────────────────────────────────
  // The refined Volcanic Glass / Petrified Oak / warm-stone palette used across
  // the admin space. Default look for Fees, Salary & Bus.
  {
    id: 'edzee-special', label: 'EdZee Special', variant: 'light',
    theme: { primary:'#3D3B40', primaryLight:'#F3F0EB', primaryDark:'#2B292E', accent:'#A8896B', accentLight:'#EDE9E2', gradFrom:'#3D3B40', gradTo:'#A8896B', bgFrom:'#EDE9E3', bgMid:'#EDE9E3', bgTo:'#EDE9E3' },
  },
  // ── Light palettes (pair with the bright banner swatches) ────────────────
  {
    id: 'azure', label: 'Azure', variant: 'light',
    theme: { primary:'#0ea5e9', primaryLight:'#e0f2fe', primaryDark:'#0369a1', accent:'#6366f1', accentLight:'#e0e7ff', gradFrom:'#38bdf8', gradTo:'#0ea5e9', bgFrom:'#f0f9ff', bgMid:'#f0f9ff', bgTo:'#e0f2fe' },
  },
  {
    id: 'rose', label: 'Rose', variant: 'light',
    theme: { primary:'#f43f5e', primaryLight:'#ffe4e6', primaryDark:'#be123c', accent:'#ec4899', accentLight:'#fce7f3', gradFrom:'#fb7185', gradTo:'#f43f5e', bgFrom:'#fff1f2', bgMid:'#fff1f2', bgTo:'#ffe4e6' },
  },
  {
    id: 'mint', label: 'Mint', variant: 'light',
    theme: { primary:'#10b981', primaryLight:'#d1fae5', primaryDark:'#047857', accent:'#14b8a6', accentLight:'#ccfbf1', gradFrom:'#34d399', gradTo:'#10b981', bgFrom:'#ecfdf5', bgMid:'#f0fdfa', bgTo:'#d1fae5' },
  },
  {
    id: 'gold', label: 'Gold', variant: 'light',
    theme: { primary:'#f59e0b', primaryLight:'#fef3c7', primaryDark:'#b45309', accent:'#f97316', accentLight:'#ffedd5', gradFrom:'#fbbf24', gradTo:'#f59e0b', bgFrom:'#fffbeb', bgMid:'#fff7ed', bgTo:'#fef3c7' },
  },
  // ── Dark palettes (pair with the dark banner swatches) ───────────────────
  {
    id: 'graphite', label: 'Graphite', variant: 'dark',
    theme: { primary:'#a1a1aa', primaryLight:'#27272a', primaryDark:'#d4d4d8', accent:'#a8896b', accentLight:'#3a2e1e', gradFrom:'#3f3f46', gradTo:'#18181b', bgFrom:'#27272a', bgMid:'#1c1c1f', bgTo:'#131316' },
  },
  {
    id: 'navy', label: 'Navy', variant: 'dark',
    theme: { primary:'#60a5fa', primaryLight:'#1e3a5f', primaryDark:'#93c5fd', accent:'#38bdf8', accentLight:'#0c4a6e', gradFrom:'#1e3a5f', gradTo:'#0f2440', bgFrom:'#0f2440', bgMid:'#0b1b30', bgTo:'#071324' },
  },
  {
    id: 'pine', label: 'Pine', variant: 'dark',
    theme: { primary:'#2dd4bf', primaryLight:'#134e4a', primaryDark:'#5eead4', accent:'#34d399', accentLight:'#064e3b', gradFrom:'#134e4a', gradTo:'#0e2e2c', bgFrom:'#0e2e2c', bgMid:'#0a2422', bgTo:'#061715' },
  },
  {
    id: 'plum', label: 'Plum', variant: 'dark',
    theme: { primary:'#c084fc', primaryLight:'#3e2a40', primaryDark:'#e9d5ff', accent:'#f472b6', accentLight:'#500724', gradFrom:'#3e2a40', gradTo:'#241526', bgFrom:'#2a1a2c', bgMid:'#1f1320', bgTo:'#150d17' },
  },
]

// ---- Fetch / Save helpers ----

export interface SettingFetchResult<T> {
  value: T
  // True when the request itself failed (network error, timeout, server
  // error) rather than the setting simply never having been saved. Callers
  // that cache the result (PageConfigContext) use this to avoid overwriting
  // a good cached value with the neutral fallback after a flaky connection —
  // supabase-js resolves a failed fetch as `{ data: null, error }` instead of
  // throwing, so it looks identical to "nothing configured" unless checked.
  failed: boolean
}

export async function fetchSettingResult<T>(key: string, fallback: T): Promise<SettingFetchResult<T>> {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', key).single()
    // PGRST116 = no row found for this key — genuinely unconfigured, not a failure.
    if (error && error.code !== 'PGRST116') return { value: fallback, failed: true }
    if (!data?.value) return { value: fallback, failed: false }
    return { value: { ...fallback, ...(typeof data.value === 'object' ? data.value : {}) } as T, failed: false }
  } catch {
    return { value: fallback, failed: true }
  }
}

export async function fetchSetting<T>(key: string, fallback: T): Promise<T> {
  return (await fetchSettingResult(key, fallback)).value
}

export async function saveSetting(key: string, value: unknown): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return !error
  } catch { return false }
}

export const fetchPageIconConfigResult = () => fetchSettingResult<PageIconMap>('page_icons', PAGE_DEFAULTS)
export const savePageIconConfig = (c: PageIconMap) => saveSetting('page_icons', c)

export const fetchBranding = () => fetchSetting<SiteBranding>('branding', BRANDING_DEFAULTS)
export const fetchBrandingResult = () => fetchSettingResult<SiteBranding>('branding', BRANDING_DEFAULTS)
export const saveBranding = (c: SiteBranding) => saveSetting('branding', c)

export const fetchLoginConfigResult = () => fetchSettingResult<LoginPageConfig>('login_config', LOGIN_DEFAULTS)
export const saveLoginConfig = (c: LoginPageConfig) => saveSetting('login_config', c)

export const fetchPageThemesResult = () => fetchSettingResult<PageThemeMap>('page_themes', {})
export const savePageThemes = (c: PageThemeMap) => saveSetting('page_themes', c)

// ---- Announcement Banner ----

export interface AnnouncementBannerConfig {
  gradFrom: string   // hex – gradient start (top)
  gradTo: string     // hex – gradient end (bottom)
  imageUrl?: string  // optional background image (overrides gradient)
}

export const BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#27272A',  // zinc-800 — workspace ink
  gradTo:   '#18181B',  // zinc-900
  imageUrl: '',
}

/** Banner colour presets — 4 bright + 4 dark. Each carries a `variant` so the
 *  picker can group them, and every swatch gets a mild grain texture at render
 *  time. Hues are coordinated with THEME_PALETTES so a banner colour always
 *  has a matching app theme. Text colour over each is decided dynamically by
 *  luminance, so bright presets read with dark text, dark presets with white. */
export const BANNER_PRESETS: {
  label: string
  from: string
  to: string
  variant: 'bright' | 'dark'
}[] = [
  // ── Bright (dark text) ──
  { label: 'Azure', from: '#38BDF8', to: '#0EA5E9', variant: 'bright' },
  { label: 'Rose',  from: '#FB7185', to: '#F43F5E', variant: 'bright' },
  { label: 'Mint',  from: '#34D399', to: '#10B981', variant: 'bright' },
  { label: 'Gold',  from: '#FBBF24', to: '#F59E0B', variant: 'bright' },
  // ── Dark (white text) ──
  { label: 'Graphite', from: '#3F3F46', to: '#18181B', variant: 'dark' },
  { label: 'Navy',     from: '#1E3A5F', to: '#0F2440', variant: 'dark' },
  { label: 'Pine',     from: '#134E4A', to: '#0E2E2C', variant: 'dark' },
  { label: 'Plum',     from: '#3E2A40', to: '#241526', variant: 'dark' },
]

export const fetchBannerConfig  = () => fetchSetting<AnnouncementBannerConfig>('announcement_banner', BANNER_DEFAULT)
export const saveBannerConfig   = (c: AnnouncementBannerConfig) => saveSetting('announcement_banner', c)

// Academics page banner
export const ACADEMICS_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#0891b2',  // cyan-600
  gradTo:   '#0f766e',  // teal-700
  imageUrl: '',
}
export const fetchAcademicsBannerConfig = () => fetchSetting<AnnouncementBannerConfig>('academics_banner', ACADEMICS_BANNER_DEFAULT)
export const saveAcademicsBannerConfig  = (c: AnnouncementBannerConfig) => saveSetting('academics_banner', c)

// Task Manager banner (reuses the same type)
export const TASK_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#b45309',  // amber-700
  gradTo:   '#c2410c',  // orange-700
  imageUrl: '',
}
export const fetchTaskBannerConfig = () => fetchSetting<AnnouncementBannerConfig>('task_banner', TASK_BANNER_DEFAULT)
export const saveTaskBannerConfig  = (c: AnnouncementBannerConfig) => saveSetting('task_banner', c)

// ---- File upload helper ----

// ---- Generic banner helpers (used by PageBanner component) ----

export const fetchPageBanner = (key: string, defaultCfg: AnnouncementBannerConfig) =>
  fetchSetting<AnnouncementBannerConfig>(key, defaultCfg)
export const savePageBanner = (key: string, cfg: AnnouncementBannerConfig) =>
  saveSetting(key, cfg)

// Per-page banner defaults for subpages under /more/
export const LEAVE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#e11d48', gradTo: '#be185d', imageUrl: '',
}
export const STAFF_LEAVE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#7c3aed', gradTo: '#4f46e5', imageUrl: '',
}
export const CLASSROOMS_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#0891b2', gradTo: '#0f766e', imageUrl: '',
}
export const PROFILES_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#dc2626', gradTo: '#f97316', imageUrl: '',
}
export const TEAMS_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#db2777', gradTo: '#7c3aed', imageUrl: '',
}
export const FEEDBACK_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#4f46e5', gradTo: '#7c3aed', imageUrl: '',
}
export const HOMEROOMS_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#0d9488', gradTo: '#0891b2', imageUrl: '',
}
export const ATTENDANCE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#7c3aed', gradTo: '#6d28d9', imageUrl: '',
}
export const STAFF_ATTENDANCE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#881337', gradTo: '#27272A', imageUrl: '',
}
export const TIMETABLE_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#27272A', gradTo: '#3D3B40', imageUrl: '',
}
export const FEES_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#6d28d9', gradTo: '#7c3aed', imageUrl: '',
}
export const SALARY_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#047857', gradTo: '#0f766e', imageUrl: '',
}
export const BUS_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#3D3B40', gradTo: '#8B6F47', imageUrl: '',
}
export const EXAM_BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#27272A', gradTo: '#3D3B40', imageUrl: '',
}

export async function uploadSiteAsset(file: File, pathSuffix: string): Promise<string | null> {
  const compressed = await compressImageIfNeeded(file)
  const safe = compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `site/${pathSuffix}_${Date.now()}_${safe}`
  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, compressed, { upsert: true, cacheControl: '31536000' })
  if (error || !data) return null
  const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
  return publicUrl
}
