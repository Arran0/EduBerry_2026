'use client'

import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import type { ClassroomWithDetails } from '@/lib/classrooms'
import { pickClassroomPalette, classroomLogoGradient } from '@/lib/classroomPalette'
import { safeSrc } from '@/lib/safeUrl'

/**
 * One classroom in the Academics list: its colour disc, the full title and the
 * subject. A compact row rather than a big pill — the title wraps onto as many
 * lines as it needs instead of being cut, and twice as many fit on a screen.
 */
export default function ClassroomTile({ classroom, navigating, onNavigate }: {
  classroom: ClassroomWithDetails
  navigating: boolean
  onNavigate: () => void
}) {
  const palette = pickClassroomPalette(classroom.id)
  const logo = safeSrc(classroom.logo_url)
  const subject = classroom.subject && classroom.subject !== classroom.title ? classroom.subject : null

  return (
    <Link
      href={`/classrooms/${classroom.id}`}
      onClick={onNavigate}
      className="ac-tile group relative flex items-center gap-2 sm:gap-2.5 min-h-[3.25rem] pl-1.5 sm:pl-2 pr-2 sm:pr-2.5 py-2 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--page-primary)]/60"
    >
      <span
        className="keep-round relative w-7 h-7 sm:w-9 sm:h-9 flex-shrink-0 rounded-full overflow-hidden grid place-items-center text-white text-[12px] sm:text-[14px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,.35)]"
        style={{ background: classroomLogoGradient(palette) }}
        aria-hidden
      >
        {logo
          ? <img src={logo} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : classroom.title.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="min-w-0 block text-[13px] sm:text-[13.5px] font-semibold leading-snug text-slate-900 break-words">{classroom.title}</span>
        {subject && <span className="min-w-0 block text-[11.5px] leading-snug text-slate-500 break-words">{subject}</span>}
      </span>
      {navigating && <Loader2 size={14} className="animate-spin text-slate-400 flex-shrink-0" />}
    </Link>
  )
}

/** Placeholder with the tile's exact height, so the list does not jump on load. */
export function ClassroomTileSkeleton() {
  return (
    <div className="ac-tile flex items-center gap-2 sm:gap-2.5 min-h-[3.25rem] pl-1.5 sm:pl-2 pr-2 sm:pr-2.5 py-2" aria-hidden>
      <span className="keep-round w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-slate-200/80 animate-pulse flex-shrink-0" />
      <span className="flex-1 space-y-1.5">
        <span className="block h-3 w-3/4 rounded bg-slate-200/80 animate-pulse" />
        <span className="block h-2.5 w-1/3 rounded bg-slate-200/60 animate-pulse" />
      </span>
    </div>
  )
}
