import { useEffect, useState } from 'react'

// Mirrors the Tailwind breakpoints used by the `grid-cols-2 sm:grid-cols-3
// lg:grid-cols-4` classroom grids, so JS can know how many columns are
// actually laid out right now.
const SM = 640
const LG = 1024

function computeColumns(width: number, lgColumns: number): number {
  if (width >= LG) return lgColumns
  if (width >= SM) return 3
  return 2
}

/**
 * Current column count for the classroom grids, updated on resize.
 *
 * `lgColumns` is what a grid gets at lg and above, where a full-width grid
 * fits four buttons per row (the default). Academics drops to 2 there because
 * its grid shares that row with the report-card digest, so it only has half
 * the width to fill — below lg both pages are full-width and identical.
 */
export function useGridColumns(lgColumns = 4): number {
  // Starts at 2 (the narrowest case) so the server-rendered and first client
  // render match — corrected to the real width right after mount.
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const update = () => setColumns(computeColumns(window.innerWidth, lgColumns))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [lgColumns])

  return columns
}
