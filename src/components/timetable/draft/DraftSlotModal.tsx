'use client'

import React from 'react'
import type { PeriodSlot, Weekday } from '@/lib/timetable'
import SlotDetailsModal from '../SlotDetailsModal'
import { useTimetableDraft } from './TimetableDraftContext'

// ============================================================
// The slot box, wired to the draft.
//
// Five surfaces open a period: the master grid, the class week, the teacher
// week, and the Homeroom / Teacher / Subject time-off calendars. Each used to
// hand SlotDetailsModal its own set of props — which is how they drifted into
// offering different actions on the same cell, and how one of them ended up
// not opening a box at all.
//
// Everything the box needs is already in the draft, so the surfaces now pass
// only WHICH period was clicked. There is one wiring, so there is one box.
// ============================================================

export interface DraftSlotModalProps {
  homeroomId: string
  /** The class's display name, when the caller already has it. */
  homeroomName?: string
  day: Weekday
  slot: PeriodSlot
  onClose: () => void
}

export default function DraftSlotModal({
  homeroomId, homeroomName, day, slot, onClose,
}: DraftSlotModalProps) {
  const draft = useTimetableDraft()
  const {
    entries, subjects, teachers, rooms, homerooms, groupName, cellConflicts,
    isConstraintOn, toggleConstraintCell, setCellEntry, clearCellEntry, togglePin,
    blockSpanOf, combinedInfoFor, overridesFor, addOverride, removeOverride,
  } = draft

  const name = homeroomName ?? homerooms.find((h) => h.id === homeroomId)?.name ?? 'Class'

  const here = entries.filter(
    (e) => e.homeroomId === homeroomId && e.day === day && e.slotId === slot.id,
  )

  // Every layer of the cell can carry its own override, so the box is given all
  // of them — the whole-class lesson's and each split group's.
  const groupLayers = [null, ...new Set(here.map((e) => e.groupId).filter((g): g is string => !!g))]
  const overrides = groupLayers.flatMap((g) => overridesFor(homeroomId, day, slot.id, g))

  return (
    <SlotDetailsModal
      target={{ homeroomId, homeroomName: name, day, slot }}
      entries={here}
      subjects={subjects}
      teachers={teachers}
      rooms={rooms}
      groupName={groupName}
      conflicts={cellConflicts(homeroomId, day, slot.id)}
      timeOff={isConstraintOn('homeroom', homeroomId, 'time_off', day, slot.id)}
      onToggleTimeOff={() => toggleConstraintCell('homeroom', homeroomId, 'time_off', day, slot.id)}
      blockSpan={blockSpanOf}
      combinedInfo={combinedInfoFor}
      overrides={overrides}
      onSaveOverride={async (d) => {
        const ok = await addOverride({
          homeroomId, day, slotId: slot.id, groupId: d.groupId,
          kind: d.kind, span: d.span, date: d.date,
          subjectId: d.subjectId, teacherIds: d.teacherIds, roomId: d.roomId, note: d.note,
        })
        if (ok) onClose()
      }}
      onDeleteOverride={async (id) => { await removeOverride(id) }}
      onClose={onClose}
      onTogglePin={togglePin}
      onSave={(groupId, subjectId, teacherIds, roomId) => {
        setCellEntry(homeroomId, day, slot.id, groupId, subjectId, teacherIds, roomId)
        onClose()
      }}
      onClear={(entry) => {
        clearCellEntry(homeroomId, day, slot.id, entry.groupId ?? null)
        onClose()
      }}
    />
  )
}
