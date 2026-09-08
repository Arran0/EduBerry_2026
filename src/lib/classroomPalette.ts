// The one pastel set every classroom surface draws from, so a classroom reads
// as the same colour wherever it appears — its button in the grid and the
// banner of the classroom it opens. Stored as hex stops (the buttons tint and
// fade them at will) alongside the Tailwind classes the banner needs.
//
// Tailwind class names below are written out in full (never built from
// interpolated variables) so the JIT scanner picks them up from this file.

export interface ClassroomBannerPalette {
  name: string
  /** Pastel stops — the button's fill, and the banner's gradient ends. */
  hexFrom: string
  hexTo: string
  /** `bg-gradient-to-br ${bannerGradient}` for the immersive hero. */
  bannerGradient: string
  /** `bg-gradient-to-br ${avatarGradient}` for the logo bubble. Saturated, not
   *  pastel: it carries white initials, and it accents the pastel banner. */
  avatarGradient: string
  /** Decorative blurred glow orbs shown behind the banner content. */
  orbA: string
  orbB: string
}

export const CLASSROOM_BANNER_PALETTES: ClassroomBannerPalette[] = [
  {
    name: 'Sky Breeze',
    hexFrom: '#a5f3fc', hexTo: '#bae6fd',
    bannerGradient: 'from-cyan-200 via-sky-200 to-blue-200',
    avatarGradient: 'from-cyan-500 to-sky-600',
    orbA: 'bg-white/45',
    orbB: 'bg-sky-300/35',
  },
  {
    name: 'Lilac',
    hexFrom: '#ddd6fe', hexTo: '#e9d5ff',
    bannerGradient: 'from-violet-200 via-purple-200 to-fuchsia-200',
    avatarGradient: 'from-violet-500 to-purple-600',
    orbA: 'bg-white/45',
    orbB: 'bg-purple-300/35',
  },
  {
    name: 'Blossom',
    hexFrom: '#fecdd3', hexTo: '#fbcfe8',
    bannerGradient: 'from-rose-200 via-pink-200 to-fuchsia-200',
    avatarGradient: 'from-rose-500 to-pink-600',
    orbA: 'bg-white/45',
    orbB: 'bg-pink-300/35',
  },
  {
    name: 'Apricot',
    hexFrom: '#fde68a', hexTo: '#fed7aa',
    bannerGradient: 'from-amber-200 via-orange-200 to-rose-200',
    avatarGradient: 'from-amber-500 to-orange-600',
    orbA: 'bg-white/45',
    orbB: 'bg-orange-300/35',
  },
  {
    name: 'Mint',
    hexFrom: '#a7f3d0', hexTo: '#99f6e4',
    bannerGradient: 'from-emerald-200 via-teal-200 to-cyan-200',
    avatarGradient: 'from-emerald-500 to-teal-600',
    orbA: 'bg-white/45',
    orbB: 'bg-teal-300/35',
  },
  {
    name: 'Periwinkle',
    hexFrom: '#bfdbfe', hexTo: '#c7d2fe',
    bannerGradient: 'from-blue-200 via-indigo-200 to-violet-200',
    avatarGradient: 'from-blue-500 to-indigo-600',
    orbA: 'bg-white/45',
    orbB: 'bg-indigo-300/35',
  },
]

/** Deterministic palette pick so a given classroom always renders the same
 *  colours — the same one for its button and its banner, stable across
 *  reloads, viewers, and however the grid happens to be sorted. */
export function pickClassroomBannerPalette(classroomId: string): ClassroomBannerPalette {
  let hash = 0
  for (let i = 0; i < classroomId.length; i++) {
    hash = (hash * 31 + classroomId.charCodeAt(i)) >>> 0
  }
  return CLASSROOM_BANNER_PALETTES[hash % CLASSROOM_BANNER_PALETTES.length]
}
