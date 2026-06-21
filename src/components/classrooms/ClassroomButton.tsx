'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ClassroomWithDetails } from '@/lib/classrooms'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'
import { isDarkLum } from '@/lib/bannerStyle'

// Soft pastel palettes for classrooms without a custom banner. Stored as hex
// stops so the label colour can be derived from the fill's luminance.
const PASTEL_PALETTES = [
  { from: '#a5f3fc', to: '#bae6fd' }, // cyan → sky
  { from: '#ddd6fe', to: '#e9d5ff' }, // violet → purple
  { from: '#fecdd3', to: '#fbcfe8' }, // rose → pink
  { from: '#fde68a', to: '#fed7aa' }, // amber → orange
  { from: '#a7f3d0', to: '#99f6e4' }, // emerald → teal
  { from: '#bfdbfe', to: '#c7d2fe' }, // blue → indigo
]

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

interface ClassroomButtonProps {
  classroom: ClassroomWithDetails
  /** Stable index into the pastel palette (keeps colours consistent per card). */
  index: number
  /** Tailwind height class, e.g. `h-[42px]`. */
  heightClass: string
  /** Show the coordinator/creator name on a second line. */
  showTeacher?: boolean
  /** True while this card's route is loading — shows a spinner overlay. */
  navigating: boolean
  onNavigate: () => void
}

export default function ClassroomButton({
  classroom, index, heightClass, showTeacher = false, navigating, onNavigate,
}: ClassroomButtonProps) {
  const palette = PASTEL_PALETTES[index % PASTEL_PALETTES.length]
  const banner = classroom.banner_url
  const teacherName = classroom.coordinator?.full_name ?? classroom.creator?.full_name ?? null

  // Whether the label needs to be white. Pastel fills are light → dark text.
  // For banner photos we sample luminance and bias for the lightening veil.
  const [onDark, setOnDark] = useState(false)
  useEffect(() => {
    if (!banner) {
      setOnDark(isDarkLum((hexToLuminance(palette.from) + hexToLuminance(palette.to)) / 2))
      return
    }
    let active = true
    sampleImageLuminance(banner, 0.6).then(lum => {
      if (!active) return
      const eff = lum * (1 - VEIL_ALPHA) + VEIL_ALPHA // veil lightens the photo
      setOnDark(isDarkLum(eff))
    })
    return () => { active = false }
  }, [banner, palette.from, palette.to])

  const translucentGrad =
    `linear-gradient(135deg, ${hexA(palette.from, 0.6)} 0%, ${hexA(palette.to, 0.6)} 100%)`

  return (
    <Link href={`/classrooms/${classroom.id}`} onClick={onNavigate}>
      <div
        className={`relative ${heightClass} rounded-full overflow-hidden group cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:brightness-105 active:scale-[0.96] active:brightness-95 shadow-md border border-white/40 backdrop-blur-md`}
        style={banner ? undefined : { backgroundImage: translucentGrad }}
      >
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

        <div className="absolute inset-0 px-3 flex flex-col items-center justify-center text-center">
          <p
            className={`text-[14px] tracking-tight leading-tight line-clamp-1 ${onDark ? 'text-white' : 'text-slate-800'}`}
            style={{
              fontFamily: "'Franie', sans-serif",
              WebkitTextStroke: onDark ? '0.6px rgba(0,0,0,0.6)' : '0.6px rgba(255,255,255,0.85)',
              textShadow: onDark
                ? '0 1px 4px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.9)'
                : '0 1px 3px rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.95)',
            }}
          >{classroom.title}</p>
          {showTeacher && teacherName && (
            <p
              className={`text-[10px] font-semibold mt-0.5 truncate ${onDark ? 'text-white/90' : 'text-slate-700'}`}
              style={{
                fontFamily: "'Franie', sans-serif",
                WebkitTextStroke: onDark ? '0.4px rgba(0,0,0,0.45)' : '0.4px rgba(255,255,255,0.75)',
                textShadow: onDark
                  ? '0 1px 3px rgba(0,0,0,0.5)'
                  : '0 1px 2px rgba(255,255,255,0.9)',
              }}
            >{teacherName}</p>
          )}
        </div>

        {navigating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
            <Loader2 size={15} className={`animate-spin ${onDark ? 'text-white' : 'text-slate-700'}`} />
          </div>
        )}
      </div>
    </Link>
  )
}
