// Shared sizing math for the scrollable classroom-button grids on the home
// and Academics pages. Centralised so the "N full rows" height is computed
// from named constants instead of a hand-calculated magic pixel value that
// can silently drift out of sync with the actual row height / gap used.
//
// By design: the container's top edge leaves half a row-gap's worth of
// space above the first row, and its bottom edge leaves a full row-gap's
// worth of space after the last row — both expressed as a fraction of the
// same spacing already used between rows, not separately chosen buffers.

// Matches ClassroomButton's heightClass="h-[64px]".
export const CLASSROOM_ROW_HEIGHT = 64

/** Padding above the first row, as a fraction of the row gap. */
export const CLASSROOM_PAD_TOP_RATIO = 0.5
/** Padding below the last row, as a fraction of the row gap. */
export const CLASSROOM_PAD_BOTTOM_RATIO = 1

/**
 * Height (px) of a scrollable classroom grid that shows exactly `rows` full
 * rows before scrolling, given the vertical gap between rows.
 */
export function classroomGridMaxHeight(rows: number, rowGapPx: number): number {
  const padTop = rowGapPx * CLASSROOM_PAD_TOP_RATIO
  const padBottom = rowGapPx * CLASSROOM_PAD_BOTTOM_RATIO
  return rows * CLASSROOM_ROW_HEIGHT + (rows - 1) * rowGapPx + padTop + padBottom
}

/**
 * Fixed per-button width (as a CSS `calc()` string) for a `columns`-wide row
 * with `columnGapPx` between buttons. Used on a `flex flex-wrap
 * justify-center` grid (instead of CSS Grid's `grid-cols-N`) so that a
 * trailing, less-than-full row of buttons is centred rather than left-
 * pinned with empty cells trailing it — the same fixed width holds whether
 * a row is full or not, so full rows look identical to today's grid.
 */
export function classroomItemWidth(columns: number, columnGapPx: number): string {
  return `calc((100% - ${columnGapPx * (columns - 1)}px) / ${columns})`
}
