// Shared sizing math for the scrollable classroom-button grids on the home
// and Academics pages. Centralised so the "N full rows, no clipped shadow"
// height is computed from named constants instead of a hand-calculated
// magic pixel value that can silently drift out of sync with the actual
// row height / gap / padding used.

// Matches ClassroomButton's heightClass="h-[64px]".
export const CLASSROOM_ROW_HEIGHT = 64
// Shadow-bleed room reserved above the first row / below the last row (the
// shadow itself — see ClassroomButton's outlineStyle — leans downward, hence
// the larger bottom value).
export const CLASSROOM_PAD_TOP = 16
export const CLASSROOM_PAD_BOTTOM = 24

/**
 * Height (px) of a scrollable classroom grid that shows exactly `rows` full
 * rows before scrolling, given the vertical gap between rows.
 */
export function classroomGridMaxHeight(rows: number, rowGapPx: number): number {
  return rows * CLASSROOM_ROW_HEIGHT + (rows - 1) * rowGapPx + CLASSROOM_PAD_TOP + CLASSROOM_PAD_BOTTOM
}
