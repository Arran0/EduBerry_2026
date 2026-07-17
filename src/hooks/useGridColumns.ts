import { useEffect, useState } from 'react'

// Mirrors the Tailwind breakpoints used by the `grid-cols-2 sm:grid-cols-3
// lg:grid-cols-4` classroom grids, so JS can know how many columns are
// actually laid out right now.
const SM = 640
const LG = 1024

function computeColumns(width: number): number {
  if (width >= LG) return 4
  if (width >= SM) return 3
  return 2
}

/** Current column count for the classroom grids (2/3/4), updated on resize. */
export function useGridColumns(): number {
  // Starts at 2 (the narrowest case) so the server-rendered and first client
  // render match — corrected to the real width right after mount.
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const update = () => setColumns(computeColumns(window.innerWidth))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return columns
}
