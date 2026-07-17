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
