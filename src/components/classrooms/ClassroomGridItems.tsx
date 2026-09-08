'use client'

import { AnimatePresence, motion } from 'framer-motion'
import ClassroomButton, { ClassroomButtonSkeleton } from './ClassroomButton'
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
 */
export default function ClassroomGridItems({
  items, skeletonCount, heightClass, itemWidth, showTeacher, navigatingId, onNavigate,
}: ClassroomGridItemsProps) {
  const count = items ? items.length : skeletonCount

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {Array.from({ length: count }, (_, i) => (
        <motion.div
          key={`slot-${i}`}
          layout
          style={{ width: itemWidth, flexGrow: 0, flexShrink: 0 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
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
      ))}
    </AnimatePresence>
  )
}
