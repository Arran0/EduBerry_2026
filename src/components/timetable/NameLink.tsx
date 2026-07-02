'use client'

import React, { useState } from 'react'
import PersonTimetableModal from './PersonTimetableModal'
import type { PersonKind } from './PersonTimetableModal'

interface Props {
  kind: PersonKind
  id: string | null | undefined
  name: string
  className?: string
}

// Renders a name as a button that opens that person's / class's weekly
// timetable in a modal. Self-contained (holds its own open state), so any
// name anywhere in the admin builder becomes clickable with no parent wiring.
// Falls back to plain text when there's no id to look up.
export default function NameLink({ kind, id, name, className = '' }: Props) {
  const [open, setOpen] = useState(false)

  if (!id) return <span className={className}>{name}</span>

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={`text-left hover:text-[#B8983C] hover:underline underline-offset-2 transition-colors ${className}`}
        title={`View ${name}'s timetable`}
      >
        {name}
      </button>
      {open && (
        <PersonTimetableModal kind={kind} id={id} name={name} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
