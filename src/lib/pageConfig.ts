import { supabase } from './supabase'

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
  staffLeave: 'Staff Leave', classrooms: 'Classroom Management',
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
  primaryColor:   '#0284c7',
  secondaryColor: '#16a34a',
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
  gradientFrom:    '#0ea5e9',
  gradientMid:     '#0284c7',
  gradientTo:      '#22c55e',
  pageBgFrom:      '#f0f9ff',
  pageBgMid:       '#f5f3ff',
  pageBgTo:        '#f0fdf4',
  buttonColor:     '#0ea5e9',
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

// Built-in theme palettes for picker — 4 light + 4 dark
export const THEME_PALETTES: { id: string; label: string; variant: 'light' | 'dark'; theme: PageTheme }[] = [
  // ── Light Palettes ───────────────────────────────────────────────────────
  {
    id: 'sky-mint', label: 'Sky & Mint', variant: 'light',
    theme: { primary:'#0ea5e9', primaryLight:'#e0f2fe', primaryDark:'#0369a1', accent:'#10b981', accentLight:'#d1fae5', gradFrom:'#0ea5e9', gradTo:'#10b981', bgFrom:'#f0f9ff', bgMid:'#ecfdf5', bgTo:'#d1fae5' },
  },
  {
    id: 'lavender-rose', label: 'Lavender & Rose', variant: 'light',
    theme: { primary:'#8b5cf6', primaryLight:'#ede9fe', primaryDark:'#7c3aed', accent:'#f43f5e', accentLight:'#ffe4e6', gradFrom:'#8b5cf6', gradTo:'#f43f5e', bgFrom:'#faf5ff', bgMid:'#fdf4ff', bgTo:'#fff1f2' },
  },
  {
    id: 'amber-honey', label: 'Amber & Honey', variant: 'light',
    theme: { primary:'#f59e0b', primaryLight:'#fef3c7', primaryDark:'#b45309', accent:'#f97316', accentLight:'#ffedd5', gradFrom:'#f59e0b', gradTo:'#f97316', bgFrom:'#fffbeb', bgMid:'#fff7ed', bgTo:'#fef3c7' },
  },
  {
    id: 'teal-sage', label: 'Teal & Sage', variant: 'light',
    theme: { primary:'#0d9488', primaryLight:'#ccfbf1', primaryDark:'#0f766e', accent:'#22c55e', accentLight:'#dcfce7', gradFrom:'#0d9488', gradTo:'#22c55e', bgFrom:'#f0fdfa', bgMid:'#f0fdf4', bgTo:'#dcfce7' },
  },
  // ── Dark Palettes ────────────────────────────────────────────────────────
  {
    id: 'midnight', label: 'Midnight', variant: 'dark',
    theme: { primary:'#60a5fa', primaryLight:'#1e3a5f', primaryDark:'#93c5fd', accent:'#34d399', accentLight:'#064e3b', gradFrom:'#1e40af', gradTo:'#1e3a5f', bgFrom:'#0f172a', bgMid:'#0c1a2e', bgTo:'#071428' },
  },
  {
    id: 'obsidian', label: 'Obsidian', variant: 'dark',
    theme: { primary:'#94a3b8', primaryLight:'#1e293b', primaryDark:'#cbd5e1', accent:'#7c3aed', accentLight:'#2e1065', gradFrom:'#334155', gradTo:'#1e293b', bgFrom:'#1e293b', bgMid:'#0f172a', bgTo:'#020617' },
  },
  {
    id: 'forest-night', label: 'Forest Night', variant: 'dark',
    theme: { primary:'#4ade80', primaryLight:'#052e16', primaryDark:'#86efac', accent:'#2dd4bf', accentLight:'#042f2e', gradFrom:'#166534', gradTo:'#134e4a', bgFrom:'#052e16', bgMid:'#064e3b', bgTo:'#042f2e' },
  },
  {
    id: 'twilight', label: 'Twilight', variant: 'dark',
    theme: { primary:'#c084fc', primaryLight:'#2e1065', primaryDark:'#e879f9', accent:'#818cf8', accentLight:'#1e1b4b', gradFrom:'#6b21a8', gradTo:'#3730a3', bgFrom:'#2e1065', bgMid:'#1e1b4b', bgTo:'#0f0a1e' },
  },
]

// ---- Fetch / Save helpers ----

async function fetchSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', key).single()
    if (!data?.value) return fallback
    return { ...fallback, ...(typeof data.value === 'object' ? data.value : {}) } as T
  } catch { return fallback }
}

async function saveSetting(key: string, value: unknown): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return !error
  } catch { return false }
}

export async function fetchPageIconConfig(): Promise<PageIconMap> {
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'page_icons').single()
    if (!data?.value) return PAGE_DEFAULTS
    return { ...PAGE_DEFAULTS, ...(data.value as Partial<PageIconMap>) }
  } catch { return PAGE_DEFAULTS }
}
export const savePageIconConfig = (c: PageIconMap) => saveSetting('page_icons', c)

export const fetchBranding = () => fetchSetting<SiteBranding>('branding', BRANDING_DEFAULTS)
export const saveBranding = (c: SiteBranding) => saveSetting('branding', c)

export const fetchLoginConfig = () => fetchSetting<LoginPageConfig>('login_config', LOGIN_DEFAULTS)
export const saveLoginConfig = (c: LoginPageConfig) => saveSetting('login_config', c)

export const fetchPageThemes = () => fetchSetting<PageThemeMap>('page_themes', {})
export const savePageThemes = (c: PageThemeMap) => saveSetting('page_themes', c)

// ---- Announcement Banner ----

export interface AnnouncementBannerConfig {
  gradFrom: string   // hex – gradient start (top)
  gradTo: string     // hex – gradient end (bottom)
  imageUrl?: string  // optional background image (overrides gradient)
}

export const BANNER_DEFAULT: AnnouncementBannerConfig = {
  gradFrom: '#374151',  // gray-700
  gradTo:   '#1e293b',  // slate-900
  imageUrl: '',
}

/** School-safe banner presets – all dark/saturated so white text is readable */
export const BANNER_PRESETS: { label: string; from: string; to: string }[] = [
  { label: 'Slate',    from: '#374151', to: '#1e293b' },
  { label: 'Midnight', from: '#1e1b4b', to: '#1e3a8a' },
  { label: 'Ocean',    from: '#0369a1', to: '#0891b2' },
  { label: 'Forest',   from: '#166534', to: '#0f766e' },
  { label: 'Berry',    from: '#9d174d', to: '#7e22ce' },
  { label: 'Rose',     from: '#be185d', to: '#9d174d' },
  { label: 'Violet',   from: '#6d28d9', to: '#4f46e5' },
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
  gradFrom: '#e11d48', gradTo: '#be185d', imageUrl: '',
}

export async function uploadSiteAsset(file: File, pathSuffix: string): Promise<string | null> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `site/${pathSuffix}_${Date.now()}_${safe}`
  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, file, { upsert: true })
  if (error || !data) return null
  const { data: { publicUrl } } = supabase.storage.from('classroom-files').getPublicUrl(data.path)
  return publicUrl
}
