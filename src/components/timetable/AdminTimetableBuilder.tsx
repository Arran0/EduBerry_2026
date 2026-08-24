'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Settings, BookOpen, Loader2, CalendarRange, Users, GraduationCap, LayoutGrid,
} from 'lucide-react'
import { fetchConfigs } from '@/lib/timetable'
import type { TimetableConfig } from '@/lib/timetable'
import SetupTab from './admin/SetupTab'
import GenerateTab from './admin/GenerateTab'
import HomeroomModal from './admin/homeroom/HomeroomModal'
import TeacherModal from './admin/teacher/TeacherModal'
import SubjectModal from './admin/subject/SubjectModal'
import Modal from '../workspace/Modal'
import { SmartSelect } from './ui'
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

  return (
    <div className="border border-[#D4D4D8] bg-white">
      {/* Toolbar — sits on top of the master grid at all times. Left: the working-
          timetable picker + view lives in the canvas below. Right: entity buttons
          that open editors as modal overlays. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 border-b border-[#E4E4E7] bg-[#FAFAF9] px-3 py-2.5">
        <div className="flex items-center gap-2.5 lg:w-[24rem] lg:flex-shrink-0">
          <CalendarRange size={16} className="text-[#71717A] flex-shrink-0" />
          <SmartSelect
            options={configOptions}
            value={selectedConfigId ?? ''}
            onChange={(v) => setSelectedConfigId(v || null)}
            placeholder={configs.length === 0 ? 'No timetable — create one' : 'Select timetable…'}
            searchPlaceholder="Search timetables…"
          />
        </div>
        {/* Four buttons on one line at every width — a grid on mobile
            (equal-width columns, icon over a short label) so the row never
            wraps, a normal inline row from sm up with the full label. */}
        <div className="grid grid-cols-4 gap-1 sm:flex sm:items-center sm:gap-1.5 lg:flex-1 lg:justify-end">
          {TOOLBAR.map((b) => {
            const Icon = b.icon
            const active = openModal === b.key
            return (
              <button
                key={b.key}
                onClick={() => setOpenModal(b.key)}
                className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 text-[10px] sm:text-sm font-medium border transition-colors ${
                  active
                    ? 'bg-[#27272A] text-white border-[#27272A]'
                    : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5] hover:text-[#18181B]'
                }`}
              >
                <Icon size={15} className={active ? 'text-[#B8983C]' : 'text-[#71717A]'} />
                <span className="sm:hidden truncate max-w-full">{b.shortLabel}</span>
                <span className="hidden sm:inline">{b.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Master grid canvas — always visible. */}
      <div className="p-4 sm:p-5">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#A1A1AA]">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : selectedConfig ? (
          <GenerateTab config={selectedConfig} />
        ) : (
          <div className="py-16 text-center">
            <LayoutGrid size={30} className="mx-auto text-[#D4D4D8]" />
            <p className="mt-3 text-sm text-[#71717A]">
              No timetable configuration yet.
            </p>
            <button
              onClick={() => setOpenModal('config')}
              className="mt-4 inline-flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white px-4 py-2 text-sm font-medium transition-colors"
            >
              <Settings size={15} className="text-[#B8983C]" />
              Open Configuration
            </button>
          </div>
        )}
      </div>

      {/* Entity editors — modal overlays. In this round they host the existing
          editing surfaces; Rounds 2–3 restructure them into the column layouts. */}
      <Modal
        open={openModal !== null}
        onClose={closeModal}
        title={currentBtn?.label ?? ''}
        icon={currentBtn?.icon}
        size="xl"
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
    </div>
  )
}
