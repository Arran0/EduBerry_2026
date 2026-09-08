'use client'

import { AnimatePresence, motion } from 'framer-motion'
import ClassroomButton, { ClassroomButtonSkeleton } from './ClassroomButton'
import { CLASSROOM_ROW_HEIGHT } from '@/lib/classroomGridLayout'
import type { ClassroomWithDetails } from '@/lib/classrooms'

interface ClassroomGridItem {
  classroom: ClassroomWithDetails
}

interface ClassroomGridItemsProps {
  /** null while loading (renders `skeletonCount` placeholders instead). */
  items: ClassroomGridItem[] | null
  /** Placeholders to show while loading — one row's worth, so a school with
   *  three classrooms doesn't flash four rows of them and then collapse. */
  skeletonCount: number
  heightClass: string
  /** CSS width (e.g. from `classroomItemWidth`) applied to every slot — the
   *  parent grid is a `flex flex-wrap justify-center` row, not CSS Grid, so
   *  a trailing partial row centres instead of hugging the left edge. */
  itemWidth: string
  /** Columns per row, so a slot knows which row it lands on. */
  columns: number
  /** Vertical gap between rows, for the same reason. */
  rowGap: number
  showTeacher?: boolean
  navigatingId: string | null
  onNavigate: (id: string) => void
}

/**
 * Renders the classroom grid's cells as position-keyed slots (`slot-0`,
 * `slot-1`, …), so the slot showing a skeleton and, once `items` arrives,
 * the same slot showing its real ClassroomButton are the SAME element to
 * React/Framer Motion — no unmount, the skeleton's content just swaps in
 * place with no animation of its own. Slots beyond the final item count
 * (there were more skeleton placeholders than actual classrooms) fall out
 * of the slot list instead and get an exit animation rather than just
 * disappearing: `mode="popLayout"` pulls an exiting slot out of grid flow
 * as it shrinks, while `layout` animates the remaining slots sliding in to
 * close the gap at the same time — the excess placeholders fold into
 * themselves as the real grid closes in around them.
 *
 * Loading shows a single row, so every row below the first is a slot that
 * did not exist a moment ago. Each starts stacked on the skeleton row and
 * slides down to its own, a row at a time — the grid unfolds out of the
 * placeholder rather than appearing around it. (The caller animates the
 * container's height to match, which is what carries the rest of the page
 * down with it.)
 */
export default function ClassroomGridItems({
  items, skeletonCount, heightClass, itemWidth, columns, rowGap,
  showTeacher, navigatingId, onNavigate,
}: ClassroomGridItemsProps) {
  const count = items ? items.length : skeletonCount
  const rowStride = CLASSROOM_ROW_HEIGHT + rowGap

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {Array.from({ length: count }, (_, i) => {
        const row = Math.floor(i / Math.max(1, columns))
        return (
        <motion.div
          key={`slot-${i}`}
          layout
          style={{ width: itemWidth, flexGrow: 0, flexShrink: 0 }}
          // Row 0 is the slot the skeleton already occupied — it stays put and
          // just swaps its content. Lower rows rise from it and settle.
          initial={row > 0 ? { opacity: 0, y: -row * rowStride, scale: 0.96 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: row * 0.05 }}
        >
          {items ? (
            <ClassroomButton
              classroom={items[i].classroom}
              heightClass={heightClass}
              showTeacher={showTeacher}
              navigating={navigatingId === items[i].classroom.id}
              onNavigate={() => onNavigate(items[i].classroom.id)}
            />
          ) : (
            <ClassroomButtonSkeleton heightClass={heightClass} />
          )}
        </motion.div>
        )
      })}
    </AnimatePresence>
  )
}
