import { supabase } from './supabase'

// ============================================
// Page Icon Configuration System
// Requires a Supabase table:
//   CREATE TABLE site_config (
//     key TEXT PRIMARY KEY,
//     value JSONB NOT NULL,
//     updated_at TIMESTAMPTZ DEFAULT NOW()
//   );
//   ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Anyone can read" ON site_config FOR SELECT USING (true);
//   CREATE POLICY "Admins can write" ON site_config FOR ALL
//     USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
// ============================================

export type PageId =
  | 'tasks'
  | 'announcements'
  | 'academics'
  | 'home'
  | 'leave'
  | 'fees'
  | 'feedback'
  | 'staffLeave'
  | 'classrooms'
  | 'teams'
  | 'profiles'

export interface PageIconConfig {
  iconName: string
  gradientFrom: string
  gradientTo: string
}

export type PageIconMap = Record<PageId, PageIconConfig>

export const PAGE_DEFAULTS: PageIconMap = {
  tasks:         { iconName: 'ClipboardList',  gradientFrom: 'from-amber-400',    gradientTo: 'to-orange-500' },
  announcements: { iconName: 'Megaphone',      gradientFrom: 'from-blue-400',     gradientTo: 'to-purple-500' },
  academics:     { iconName: 'GraduationCap',  gradientFrom: 'from-cyan-500',     gradientTo: 'to-teal-500'   },
  home:          { iconName: 'Home',           gradientFrom: 'from-green-400',    gradientTo: 'to-emerald-500'},
  leave:         { iconName: 'Calendar',       gradientFrom: 'from-sky-400',      gradientTo: 'to-blue-500'   },
  fees:          { iconName: 'CreditCard',     gradientFrom: 'from-violet-400',   gradientTo: 'to-purple-500' },
  feedback:      { iconName: 'MessageSquare',  gradientFrom: 'from-pink-400',     gradientTo: 'to-rose-500'   },
  staffLeave:    { iconName: 'CalendarDays',   gradientFrom: 'from-indigo-400',   gradientTo: 'to-blue-500'   },
  classrooms:    { iconName: 'BookOpen',       gradientFrom: 'from-teal-400',     gradientTo: 'to-cyan-500'   },
  teams:         { iconName: 'Users',          gradientFrom: 'from-orange-400',   gradientTo: 'to-amber-500'  },
  profiles:      { iconName: 'UserPlus',       gradientFrom: 'from-slate-400',    gradientTo: 'to-slate-600'  },
}

export const PAGE_LABELS: Record<PageId, string> = {
  tasks:         'Task Manager',
  announcements: 'Announcements',
  academics:     'Academics',
  home:          'Home',
  leave:         'Student Leave',
  fees:          'Fee Manager',
  feedback:      'Feedback',
  staffLeave:    'Staff Leave',
  classrooms:    'Classroom Management',
  teams:         'Teacher Teams',
  profiles:      'Profile Manager',
}

export const AVAILABLE_ICONS: string[] = [
  'ClipboardList', 'Megaphone', 'GraduationCap', 'Home', 'BookOpen',
  'Calendar', 'CalendarDays', 'Users', 'UserPlus', 'BarChart3',
  'Bell', 'Star', 'Award', 'Target', 'Layers', 'Grid',
  'FileText', 'MessageSquare', 'Settings', 'TrendingUp',
  'CheckSquare', 'Zap', 'CreditCard', 'School', 'Pencil',
  'FolderOpen', 'ListChecks', 'BrainCircuit', 'Lightbulb', 'Newspaper',
]

export const GRADIENT_OPTIONS = [
  { label: 'Amber → Orange',    from: 'from-amber-400',   to: 'to-orange-500'   },
  { label: 'Blue → Purple',     from: 'from-blue-400',    to: 'to-purple-500'   },
  { label: 'Cyan → Teal',       from: 'from-cyan-500',    to: 'to-teal-500'     },
  { label: 'Green → Emerald',   from: 'from-green-400',   to: 'to-emerald-500'  },
  { label: 'Sky → Blue',        from: 'from-sky-400',     to: 'to-blue-500'     },
  { label: 'Violet → Purple',   from: 'from-violet-400',  to: 'to-purple-500'   },
  { label: 'Pink → Rose',       from: 'from-pink-400',    to: 'to-rose-500'     },
  { label: 'Indigo → Blue',     from: 'from-indigo-400',  to: 'to-blue-500'     },
  { label: 'Teal → Cyan',       from: 'from-teal-400',    to: 'to-cyan-500'     },
  { label: 'Orange → Amber',    from: 'from-orange-400',  to: 'to-amber-500'    },
  { label: 'Red → Rose',        from: 'from-red-400',     to: 'to-rose-500'     },
  { label: 'Slate → Slate',     from: 'from-slate-400',   to: 'to-slate-600'    },
]

const CONFIG_KEY = 'page_icons'

export async function fetchPageIconConfig(): Promise<PageIconMap> {
  try {
    const { data, error } = await supabase
      .from('site_config')
      .select('value')
      .eq('key', CONFIG_KEY)
      .single()

    if (error || !data) return PAGE_DEFAULTS
    return { ...PAGE_DEFAULTS, ...(data.value as Partial<PageIconMap>) }
  } catch {
    return PAGE_DEFAULTS
  }
}

export async function savePageIconConfig(config: PageIconMap): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('site_config')
      .upsert({ key: CONFIG_KEY, value: config, updated_at: new Date().toISOString() })
    return !error
  } catch {
    return false
  }
}
