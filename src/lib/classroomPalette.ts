// Friendly, vivid gradient palettes for the classroom detail banner. Replaces
// the single fixed purple → blue → cyan gradient every classroom used to
// share with a small set of Pantone-ish, student-friendly combinations,
// picked deterministically per classroom (stable across reloads, no two
// adjacent classrooms fighting for attention).
//
// Tailwind class names below are written out in full (never built from
// interpolated variables) so the JIT scanner picks them up from this file.

export interface ClassroomBannerPalette {
  name: string
  /** `bg-gradient-to-br ${bannerGradient}` for the immersive hero. */
  bannerGradient: string
  /** `bg-gradient-to-br ${avatarGradient}` for the logo bubble. */
  avatarGradient: string
  /** Decorative blurred glow orbs shown behind the banner content. */
  orbA: string
  orbB: string
  /** Stops sampled for the luminance check that decides banner text color. */
  hexFrom: string
  hexVia: string
  hexTo: string
}

export const CLASSROOM_BANNER_PALETTES: ClassroomBannerPalette[] = [
  {
    name: 'Tangerine',
    bannerGradient: 'from-orange-400 via-amber-400 to-yellow-400',
    avatarGradient: 'from-orange-500 to-amber-500',
    orbA: 'bg-yellow-200/35',
    orbB: 'bg-rose-300/25',
    hexFrom: '#fb923c', hexVia: '#fbbf24', hexTo: '#facc15',
  },
  {
    name: 'Ocean Breeze',
    bannerGradient: 'from-sky-400 via-cyan-400 to-teal-400',
    avatarGradient: 'from-sky-500 to-teal-500',
    orbA: 'bg-cyan-200/35',
    orbB: 'bg-blue-300/25',
    hexFrom: '#38bdf8', hexVia: '#22d3ee', hexTo: '#2dd4bf',
  },
  {
    name: 'Grape Fizz',
    bannerGradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    avatarGradient: 'from-violet-500 to-fuchsia-500',
    orbA: 'bg-fuchsia-300/30',
    orbB: 'bg-violet-300/25',
    hexFrom: '#8b5cf6', hexVia: '#a855f7', hexTo: '#d946ef',
  },
  {
    name: 'Watermelon',
    bannerGradient: 'from-rose-400 via-pink-500 to-fuchsia-500',
    avatarGradient: 'from-rose-500 to-pink-500',
    orbA: 'bg-pink-200/35',
    orbB: 'bg-rose-300/25',
    hexFrom: '#fb7185', hexVia: '#ec4899', hexTo: '#d946ef',
  },
  {
    name: 'Mint Lush',
    bannerGradient: 'from-emerald-400 via-teal-400 to-cyan-500',
    avatarGradient: 'from-emerald-500 to-cyan-500',
    orbA: 'bg-emerald-200/35',
    orbB: 'bg-cyan-300/25',
    hexFrom: '#34d399', hexVia: '#2dd4bf', hexTo: '#06b6d4',
  },
  {
    name: 'Berry Blast',
    bannerGradient: 'from-indigo-400 via-violet-500 to-purple-500',
    avatarGradient: 'from-indigo-500 to-purple-500',
    orbA: 'bg-indigo-200/30',
    orbB: 'bg-purple-300/25',
    hexFrom: '#818cf8', hexVia: '#8b5cf6', hexTo: '#a855f7',
  },
]

/** Deterministic palette pick so a given classroom always renders the same
 *  banner colours (stable across reloads / different viewers). */
export function pickClassroomBannerPalette(classroomId: string): ClassroomBannerPalette {
  let hash = 0
  for (let i = 0; i < classroomId.length; i++) {
    hash = (hash * 31 + classroomId.charCodeAt(i)) >>> 0
  }
  return CLASSROOM_BANNER_PALETTES[hash % CLASSROOM_BANNER_PALETTES.length]
}
