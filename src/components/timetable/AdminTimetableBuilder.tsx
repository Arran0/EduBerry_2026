'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Settings, BookOpen, Loader2, CalendarRange, Users, GraduationCap, LayoutGrid,
} from 'lucide-react'
import { fetchConfigs } from '@/lib/timetable'
import type { TimetableConfig } from '@/lib/timetable'
import SetupTab from './admin/SetupTab'
import GenerateTab from './admin/GenerateTab'
import { TimetableDraftProvider } from './draft/TimetableDraftContext'
import HomeroomModal from './admin/homeroom/HomeroomModal'
import TeacherModal from './admin/teacher/TeacherModal'
import SubjectModal from './admin/subject/SubjectModal'
import Modal from '../workspace/Modal'
import { SmartSelect, TAP, FOCUS, BTN_PRIMARY } from './ui'
import type { SmartOption } from './ui'

type EntityModal = 'config' | 'homeroom' | 'teacher' | 'subjects' | null

// Toolbar buttons that open the entity editors as modal overlays on top of the
// always-visible master grid. Each button carries the icon + label used on the
// modal header, plus a short label so all four fit one line on a phone.
const TOOLBAR: { key: Exclude<EntityModal, null>; label: string; shortLabel: string; icon: typeof Settings }[] = [
  { key: 'config', label: 'Configuration', shortLabel: 'Setup', icon: Settings },
  { key: 'homeroom', label: 'Homeroom', shortLabel: 'Homeroom', icon: Users },
  { key: 'teacher', label: 'Teacher', shortLabel: 'Teacher', icon: GraduationCap },
  { key: 'subjects', label: 'Subjects', shortLabel: 'Subjects', icon: BookOpen },
]

export default function AdminTimetableBuilder() {
  const [configs, setConfigs] = useState<TimetableConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openModal, setOpenModal] = useState<EntityModal>(null)

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    const list = await fetchConfigs()
    setConfigs(list)
    // Default selection: active config, else most recent.
    setSelectedConfigId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev
      const active = list.find((c) => c.is_active)
      return active?.id ?? list[0]?.id ?? null
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  const selectedConfig = configs.find((c) => c.id === selectedConfigId) ?? null

  const configOptions: SmartOption[] = useMemo(
    () =>
      configs.map((c) => ({
        value: c.id,
        label: c.name,
        sublabel: c.academic_year || undefined,
        badge: c.is_active ? 'Active' : undefined,
      })),
    [configs],
  )

  const closeModal = () => setOpenModal(null)
  const currentBtn = TOOLBAR.find((b) => b.key === openModal)

  // The master grid and the entity editors share one in-memory draft: the
  // Homeroom / Teacher / Subject calendars show the same lessons and move the
  // same pins, so the draft is owned above all of them rather than by the grid.
  return (
    <div className="border border-[#D4D4D8] bg-white">
      {/* Toolbar — above the grid at all times. Left: which timetable is being
          worked on. Right: the four editors, which open as modal overlays so
          the grid is never replaced by a settings page. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-1.5 border-b border-[#E4E4E7] bg-[#FAFAF9] px-2 py-1.5">
        <div className="flex items-center gap-2 lg:w-[22rem] lg:flex-shrink-0">
          <CalendarRange size={15} className="text-[#71717A] flex-shrink-0" />
          <SmartSelect
            options={configOptions}
            value={selectedConfigId ?? ''}
            onChange={(v) => setSelectedConfigId(v || null)}
            placeholder={configs.length === 0 ? 'No timetable — create one' : 'Select timetable…'}
            searchPlaceholder="Search timetables…"
          />
        </div>
        {/* Four buttons on one line at every width — equal columns on a phone
            with the icon over a short label so the row never wraps, a tighter
            inline row from sm up where the pointer is precise. */}
        <div className="grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-1 lg:flex-1 lg:justify-end">
          {TOOLBAR.map((b) => {
            const Icon = b.icon
            const active = openModal === b.key
            return (
              <button
                key={b.key}
                onClick={() => setOpenModal(b.key)}
                aria-pressed={active}
                className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-2.5 py-1.5 min-h-[2.75rem] sm:min-h-0 text-[10px] sm:text-[13px] font-medium border ${TAP} ${FOCUS} ${
                  active
                    ? 'bg-[#27272A] text-white border-[#27272A]'
                    : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5] hover:text-[#18181B]'
                }`}
              >
                <Icon size={14} className={active ? 'text-[#B8983C]' : 'text-[#71717A]'} />
                <span className="sm:hidden truncate max-w-full">{b.shortLabel}</span>
                <span className="hidden sm:inline">{b.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Master grid canvas — always visible. */}
      <div className="p-1.5 sm:p-3">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#A1A1AA]">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : selectedConfig ? (
          <TimetableDraftProvider config={selectedConfig} key={selectedConfig.id}>
            <GenerateTab />
            <Modal
              open={openModal !== null}
              onClose={closeModal}
              title={currentBtn?.label ?? ''}
              icon={currentBtn?.icon}
              size="2xl"
              fullHeight
            >
              {openModal === 'config' && (
                <SetupTab
                  configs={configs}
                  selectedConfig={selectedConfig}
                  onSelectConfig={setSelectedConfigId}
                  onChanged={loadConfigs}
                />
              )}
              {openModal === 'homeroom' && <HomeroomModal config={selectedConfig} />}
              {openModal === 'teacher' && <TeacherModal config={selectedConfig} />}
              {openModal === 'subjects' && <SubjectModal config={selectedConfig} />}
            </Modal>
          </TimetableDraftProvider>
        ) : (
          <div className="py-16 text-center">
            <LayoutGrid size={30} className="mx-auto text-[#D4D4D8]" />
            <p className="mt-3 text-sm text-[#71717A]">No timetable configuration yet.</p>
            <button onClick={() => setOpenModal('config')} className={`${BTN_PRIMARY} mt-4`}>
              <Settings size={14} className="text-[#B8983C]" />
              Open Configuration
            </button>
          </div>
        )}
      </div>

      {/* With no config there is no draft to provide, so the editors render on
          their own — only Configuration has anything to show at that point. */}
      {!selectedConfig && (
        <Modal
          open={openModal !== null}
          onClose={closeModal}
          title={currentBtn?.label ?? ''}
          icon={currentBtn?.icon}
          size="2xl"
          fullHeight
        >
          {openModal === 'config' && (
            <SetupTab
              configs={configs}
              selectedConfig={null}
              onSelectConfig={setSelectedConfigId}
              onChanged={loadConfigs}
            />
          )}
          {openModal === 'homeroom' && <HomeroomModal config={null} />}
          {openModal === 'teacher' && <TeacherModal config={null} />}
          {openModal === 'subjects' && <SubjectModal config={null} />}
        </Modal>
      )}
    </div>
  )
}
