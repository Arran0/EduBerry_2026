'use client'

import React from 'react'

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
 * The row's own padding (not the caller's) is what keeps the selection ring
 * from clipping: a selected swatch draws `ring-offset-2` + `ring-2` outside
 * its own box, and `overflow-x-auto` clips both axes once either is set to
 * `auto` — so this needs real space on every side, not just horizontally.
 * Do not tighten `py-2`/`px-1.5` to save space.
 */
export function ColorPicker({ colors, value, onChange, ariaLabel }: ColorPickerProps) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-2 overflow-x-auto py-2 px-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          onClick={() => onChange(c)}
          className={`flex-shrink-0 w-8 h-8 rounded-full transition-transform ${
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
