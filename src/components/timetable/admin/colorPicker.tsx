'use client'

import React from 'react'

/**
 * A vibrant, Pantone-inspired palette (Classic Blue, Turquoise, Greenery,
 * Illuminating, Tangerine Tango, Viva Magenta, Radiant Orchid, Very Peri,
 * Emerald, Living Coral) — punchier than a flat brand palette so subjects stay
 * easy to tell apart at a glance on a dense grid. Shared, so a subject made
 * from the requirement form gets the same choices as one made in the Subjects
 * hub.
 */
export const SUBJECT_COLORS = [
  '#0F4C81', '#45B5AA', '#88B04B', '#F2C94C', '#DD4124',
  '#BE3455', '#B565A7', '#6667AB', '#009B77', '#FF6F61',
]

interface ColorPickerProps {
  colors: string[]
  value: string
  onChange: (color: string) => void
  ariaLabel: string
}

/**
 * The one colour picker for the whole timetable app (subjects, groups, …) —
 * an always-visible strip of round swatches instead of a trigger + popover,
 * so there's no hidden target to open or dismiss and every swatch is a
 * direct, thumb-sized tap target.
 *
 * The swatches wrap rather than scroll, so a narrow column (the subject list
 * on a tablet) never hides one off its edge. The row's own padding keeps the
 * selection ring — drawn outside the swatch — clear of whatever sits next to it.
 */
export function ColorPicker({ colors, value, onChange, ariaLabel }: ColorPickerProps) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2 py-1.5 px-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={`flex-shrink-0 w-7 h-7 sm:w-[22px] sm:h-[22px] rounded-full transition-transform ${
            value === c
              ? 'ring-2 ring-offset-2 ring-[#27272A] scale-105'
              : 'ring-1 ring-inset ring-black/10 hover:scale-105'
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
