'use client'

import React from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Whether a class's report cards have reached its students.
 *
 * Shown beside an individual card, where it is status and nothing more: a
 * single student's card is never published or withdrawn on its own. That
 * happens for a whole class at once, on the Class Marks tab (see PublishPanel).
 */
export default function PublishedPill({
  published, size = 'sm',
}: {
  published: boolean
  size?: 'sm' | 'xs'
}) {
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'
  const icon = size === 'xs' ? 9 : 11
  return (
    <span
      className={`keep-round inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wide ${pad} ${
        published ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      }`}
      title={published
        ? 'Students in this class can see this report card'
        : 'Held back — this class’s report cards have not been published yet'}
    >
      {published ? <Eye size={icon} /> : <EyeOff size={icon} />}
      {published ? 'Published' : 'Not published'}
    </span>
  )
}
