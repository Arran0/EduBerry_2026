import { useEffect, useState } from 'react'

// Mirrors the Tailwind breakpoints used by the `grid-cols-2 sm:grid-cols-3
// lg:grid-cols-4` classroom grids, so JS can know how many columns are
// actually laid out right now.
const SM = 640
const LG = 1024
const XL = 1280
const XXL = 1536

function computeColumns(width: number, wide: boolean): number {
  if (wide && width >= XXL) return 6
  if (wide && width >= XL) return 5
  if (width >= LG) return 4
  if (width >= SM) return 3
  return 2
}

/**
 * Current column count for the classroom grids, updated on resize.
 *
 * @param wide a grid that owns the full page width (Academics) rather than
 *   sitting inside a card (the home strip). Four columns across a 1536px page
 *   stretches each pill past 350px for a one-line title; the extra steps keep
 *   the tiles at a sane width and show more of them, instead of growing them.
 */
export function useGridColumns(wide = false): number {
  // Starts at 2 (the narrowest case) so the server-rendered and first client
  // render match — corrected to the real width right after mount.
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const update = () => setColumns(computeColumns(window.innerWidth, wide))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [wide])

  return columns
}
