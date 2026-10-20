'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ClassroomWithDetails } from '@/lib/classrooms'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'
import { isDarkLum } from '@/lib/bannerStyle'
import { pickClassroomPalette } from '@/lib/classroomPalette'

// Alpha of the pastel veil laid over banner photos — softens the image and
// also biases the luminance test toward dark (readable) text.
const VEIL_ALPHA = 0.38

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// Blur/offset trimmed ~40% from the original (0 4px 18px / 0 1px 4px) — still
// soft, but needs a lot less clip-free room around a scrollable row. Shared
// with ClassroomButtonSkeleton so the placeholder sits under the exact same
// outline as the real button — nothing to nudge into place once the real
// content swaps in.
const OUTLINE_STYLE = {
  boxShadow: '0 0 0 1px rgba(255,255,255,0.60), inset 0 1px 0 rgba(255,255,255,0.50), 0 2px 11px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
}

/**
 * Placeholder matching ClassroomButton's outer size/shape exactly (same
 * `heightClass`, same pill outline), so a loading grid occupies the same
 * space as the real one and swapping in data causes no layout shift.
 */
export function ClassroomButtonSkeleton({ heightClass }: { heightClass: string }) {
  return (
    <div
      className={`keep-round relative ${heightClass} rounded-full overflow-hidden snap-start`}
      style={OUTLINE_STYLE}
    >
      <div className="keep-round absolute inset-0 rounded-full bg-slate-200/70 animate-pulse" />
    </div>
  )
}

interface ClassroomButtonProps {
  classroom: ClassroomWithDetails
  /** Tailwind height class, e.g. `h-[42px]`. */
  heightClass: string
  /** Show the coordinator/creator name on a second line. */
  showTeacher?: boolean
  /** True while this card's route is loading — shows a spinner overlay. */
  navigating: boolean
  onNavigate: () => void
}

export default function ClassroomButton({
  classroom, heightClass, showTeacher = false, navigating, onNavigate,
}: ClassroomButtonProps) {
  // Keyed off the classroom itself, not its place in the grid: the tile keeps
  // its colour however the list is sorted, and the classroom's own banner
  // opens in the same pastel.
  const { from: fillFrom, to: fillTo } = pickClassroomPalette(classroom.id)
  const banner = classroom.banner_url
  const teacherName = classroom.coordinator?.full_name ?? classroom.creator?.full_name ?? null

  // Whether the label needs to be white. Pastel fills are light → dark text.
  // For banner photos we sample luminance and bias for the lightening veil.
  const [onDark, setOnDark] = useState(false)
  useEffect(() => {
    if (!banner) {
      setOnDark(isDarkLum((hexToLuminance(fillFrom) + hexToLuminance(fillTo)) / 2))
      return
    }
    let active = true
    sampleImageLuminance(banner, 0.6).then(lum => {
      if (!active) return
      const eff = lum * (1 - VEIL_ALPHA) + VEIL_ALPHA // veil lightens the photo
      setOnDark(isDarkLum(eff))
    })
    return () => { active = false }
  }, [banner, fillFrom, fillTo])

  const translucentGrad =
    `linear-gradient(135deg, ${hexA(fillFrom, 0.6)} 0%, ${hexA(fillTo, 0.6)} 100%)`

  return (
    <Link href={`/classrooms/${classroom.id}`} onClick={onNavigate}>
      {/* Shadow lives on this outer box — kept free of `overflow-hidden` since
          that would clip the box's own outer box-shadow at its own edge.
          `snap-start` is a no-op outside a scroll-snap container, and lets
          any scrollable classroom grid snap to whole rows (see the grids in
          home/page.tsx and academics/page.tsx) instead of resting mid-row
          with a shadow cut off at the viewport edge. */}
      <div
        className={`keep-round relative ${heightClass} rounded-full group cursor-pointer snap-start transition-[transform,box-shadow,filter] duration-200 ease-out hover:scale-[1.025] hover:-translate-y-px active:scale-[0.97] active:translate-y-0 active:brightness-95`}
        style={banner ? OUTLINE_STYLE : { backgroundImage: translucentGrad, ...OUTLINE_STYLE }}
      >
        {/* Everything that needs clipping to the pill shape (banner image,
            gloss, text) lives in this inner layer instead. */}
        <div className="keep-round absolute inset-0 rounded-full overflow-hidden backdrop-blur-md">
          {banner && (
            <>
              <img
                src={banner}
                alt=""
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-[2px] saturate-[.9] transition-[filter,transform] duration-300 group-hover:blur-0 group-hover:scale-100 group-active:blur-0"
              />
              {/* Pastel fade veil — keeps banners soft instead of loud. */}
              <div
                className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-40 group-active:opacity-40"
                style={{ background: `linear-gradient(135deg, rgba(255,255,255,${VEIL_ALPHA + 0.1}) 0%, rgba(255,255,255,${VEIL_ALPHA - 0.06}) 100%)` }}
              />
            </>
          )}

          {/* Apple-style gloss highlight — top-half inner shine */}
          <div
            className="absolute inset-x-0 top-0 h-1/2 pointer-events-none z-[1]"
            style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 100%)' }}
          />

          <div className="absolute inset-0 z-[2] px-3.5 flex flex-col items-center justify-center text-center">
            {/* Two lines at a size that fits the pill, rather than one line
                cut short — a long title stays readable. */}
            <p
              title={classroom.title}
              className={`min-w-0 font-bold text-[15px] sm:text-[17px] tracking-[-0.01em] leading-[1.15] line-clamp-2 break-words ${onDark ? 'text-white drop-shadow-sm' : 'text-slate-800'}`}
            >{classroom.title}</p>
            {showTeacher && teacherName && (
              <p
                className={`min-w-0 font-medium text-[12.5px] mt-0.5 line-clamp-1 break-words ${onDark ? 'text-white/80' : 'text-slate-500'}`}
              >{teacherName}</p>
            )}
          </div>

          {navigating && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
              <Loader2 size={14} className={`animate-spin ${onDark ? 'text-white' : 'text-slate-700'}`} />
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
