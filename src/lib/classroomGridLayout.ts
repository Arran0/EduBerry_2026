// Shared sizing math for the scrollable classroom-button grids on the home
// and Academics pages. Centralised so the "N full rows" height is computed
// from named constants instead of a hand-calculated magic pixel value that
// can silently drift out of sync with the actual row height / gap used.
//
// By design: the container's top edge sits flush against the first row
// (zero top padding), and its bottom edge leaves exactly one row-gap's
// worth of space after the last row — the same spacing already used
// between rows, not a separately chosen buffer.

// Matches ClassroomButton's heightClass="h-[64px]".
export const CLASSROOM_ROW_HEIGHT = 64

/**
 * Height (px) of a scrollable classroom grid that shows exactly `rows` full
 * rows before scrolling, given the vertical gap between rows.
 */
export function classroomGridMaxHeight(rows: number, rowGapPx: number): number {
  // (rows - 1) gaps between rows, plus one more trailing gap reused as the
  // bottom padding — i.e. rows * (itemHeight + gap).
  return rows * CLASSROOM_ROW_HEIGHT + rows * rowGapPx
}
