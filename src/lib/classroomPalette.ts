// The one pastel set every classroom surface draws from, so a classroom reads
// as the same colour wherever it appears — its button in the grid and the
// banner of the classroom it opens.
//
// Hex only, deliberately: Tailwind's JIT scans `src/components` and `src/app`,
// so class names living in a lib module are only generated when some component
// happens to use the same ones. A pastel that no component uses would compile
// to nothing and the banner would render as a transparent band. Inline
// gradients built from these stops can't miss.

export interface ClassroomPalette {
  name: string
  /** Pastel stops — the button's fill and the banner's gradient. */
  from: string
  to: string
  /** Saturated stops for the logo bubble, which carries white initials and
   *  needs the contrast the pastels can't give. Same hue family. */
  deepFrom: string
  deepTo: string
  /** Decorative blurred glow orbs behind the banner content. */
  orbA: string
  orbB: string
}

export const CLASSROOM_PALETTES: ClassroomPalette[] = [
  {
    name: 'Sky Breeze',
    from: '#a5f3fc', to: '#bae6fd',
    deepFrom: '#06b6d4', deepTo: '#0284c7',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(125,211,252,0.45)',
  },
  {
    name: 'Lilac',
    from: '#ddd6fe', to: '#e9d5ff',
    deepFrom: '#8b5cf6', deepTo: '#9333ea',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(216,180,254,0.45)',
  },
  {
    name: 'Blossom',
    from: '#fecdd3', to: '#fbcfe8',
    deepFrom: '#f43f5e', deepTo: '#db2777',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(249,168,212,0.45)',
  },
  {
    name: 'Apricot',
    from: '#fde68a', to: '#fed7aa',
    deepFrom: '#f59e0b', deepTo: '#ea580c',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(253,186,116,0.45)',
  },
  {
    name: 'Mint',
    from: '#a7f3d0', to: '#99f6e4',
    deepFrom: '#10b981', deepTo: '#0d9488',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(94,234,212,0.45)',
  },
  {
    name: 'Periwinkle',
    from: '#bfdbfe', to: '#c7d2fe',
    deepFrom: '#3b82f6', deepTo: '#4f46e5',
    orbA: 'rgba(255,255,255,0.55)', orbB: 'rgba(165,180,252,0.45)',
  },
]

/** Deterministic palette pick so a given classroom always renders the same
 *  colours — the same one for its button and its banner, stable across
 *  reloads, viewers, and however the grid happens to be sorted. */
export function pickClassroomPalette(classroomId: string): ClassroomPalette {
  let hash = 0
  for (let i = 0; i < classroomId.length; i++) {
    hash = (hash * 31 + classroomId.charCodeAt(i)) >>> 0
  }
  return CLASSROOM_PALETTES[hash % CLASSROOM_PALETTES.length]
}

/** `background` for a classroom's banner / button fill. */
export function classroomGradient(p: ClassroomPalette, angle = '135deg'): string {
  return `linear-gradient(${angle}, ${p.from} 0%, ${p.to} 100%)`
}

/** `background` for the saturated logo bubble. */
export function classroomLogoGradient(p: ClassroomPalette): string {
  return `linear-gradient(135deg, ${p.deepFrom} 0%, ${p.deepTo} 100%)`
}
