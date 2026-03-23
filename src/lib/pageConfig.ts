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
  | 'classrooms' | 'teams' | 'profiles'

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
}

export const PAGE_LABELS: Record<PageId, string> = {
  tasks: 'Task Manager', announcements: 'Announcements', academics: 'Academics',
  home: 'Home', leave: 'Student Leave', fees: 'Fee Manager', feedback: 'Feedback',
  staffLeave: 'Staff Leave', classrooms: 'Classroom Management',
  teams: 'Teacher Teams', profiles: 'Profile Manager',
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
  gradientFrom: string      // hex e.g. "#0ea5e9"
  gradientMid: string       // hex e.g. "#0284c7"
  gradientTo: string        // hex e.g. "#22c55e"
  bgImageUrl: string        // URL or "" for gradient-only
  features: string[]        // bullet list on left panel
}

export const LOGIN_DEFAULTS: LoginPageConfig = {
  schoolName:   'Muthamil Public School',
  tagline:      'Excel . Enrich . Enlighten',
  welcomeText:  'Welcome to MPS Web',
  gradientFrom: '#0ea5e9',
  gradientMid:  '#0284c7',
  gradientTo:   '#22c55e',
  bgImageUrl:   '',
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
  bg: string            // hex – page background colour
}

export type PageThemeMap = Partial<Record<string, PageTheme>>

// Built-in theme palettes for picker
export const THEME_PALETTES: { id: string; label: string; theme: PageTheme }[] = [
  { id: 'blue-green',   label: 'Blue & Green',    theme: { primary:'#0ea5e9', primaryLight:'#e0f2fe', primaryDark:'#0284c7', accent:'#22c55e', accentLight:'#dcfce7', gradFrom:'#0ea5e9', gradTo:'#22c55e', bg:'#f0f9ff' } },
  { id: 'purple-violet',label: 'Purple & Violet',  theme: { primary:'#8b5cf6', primaryLight:'#ede9fe', primaryDark:'#7c3aed', accent:'#6366f1', accentLight:'#e0e7ff', gradFrom:'#8b5cf6', gradTo:'#6366f1', bg:'#faf5ff' } },
  { id: 'amber-orange', label: 'Amber & Orange',   theme: { primary:'#f59e0b', primaryLight:'#fef3c7', primaryDark:'#d97706', accent:'#f97316', accentLight:'#fff7ed', gradFrom:'#f59e0b', gradTo:'#f97316', bg:'#fffbeb' } },
  { id: 'cyan-teal',    label: 'Cyan & Teal',      theme: { primary:'#06b6d4', primaryLight:'#cffafe', primaryDark:'#0891b2', accent:'#14b8a6', accentLight:'#ccfbf1', gradFrom:'#06b6d4', gradTo:'#14b8a6', bg:'#ecfeff' } },
  { id: 'pink-purple',  label: 'Pink & Purple',    theme: { primary:'#ec4899', primaryLight:'#fce7f3', primaryDark:'#db2777', accent:'#a855f7', accentLight:'#f3e8ff', gradFrom:'#ec4899', gradTo:'#a855f7', bg:'#fdf4ff' } },
  { id: 'rose-pink',    label: 'Rose & Pink',      theme: { primary:'#f43f5e', primaryLight:'#ffe4e6', primaryDark:'#e11d48', accent:'#ec4899', accentLight:'#fce7f3', gradFrom:'#f43f5e', gradTo:'#ec4899', bg:'#fff1f2' } },
  { id: 'green-teal',   label: 'Green & Teal',     theme: { primary:'#22c55e', primaryLight:'#dcfce7', primaryDark:'#16a34a', accent:'#14b8a6', accentLight:'#ccfbf1', gradFrom:'#22c55e', gradTo:'#14b8a6', bg:'#f0fdf4' } },
  { id: 'indigo-blue',  label: 'Indigo & Blue',    theme: { primary:'#6366f1', primaryLight:'#e0e7ff', primaryDark:'#4f46e5', accent:'#3b82f6', accentLight:'#dbeafe', gradFrom:'#6366f1', gradTo:'#3b82f6', bg:'#eef2ff' } },
  { id: 'orange-red',   label: 'Orange & Red',     theme: { primary:'#f97316', primaryLight:'#fff7ed', primaryDark:'#ea580c', accent:'#ef4444', accentLight:'#fee2e2', gradFrom:'#f97316', gradTo:'#ef4444', bg:'#fff7ed' } },
  { id: 'slate-gray',   label: 'Slate & Gray',     theme: { primary:'#64748b', primaryLight:'#f1f5f9', primaryDark:'#475569', accent:'#6b7280', accentLight:'#f9fafb', gradFrom:'#64748b', gradTo:'#374151', bg:'#f8fafc' } },
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

// ---- File upload helper ----

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
