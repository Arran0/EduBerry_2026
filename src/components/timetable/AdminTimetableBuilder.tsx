'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Settings, BookOpen, ListChecks, CalendarOff, Sparkles, Loader2, CalendarRange,
} from 'lucide-react'
import { fetchConfigs } from '@/lib/timetable'
import type { TimetableConfig } from '@/lib/timetable'
import SetupTab from './admin/SetupTab'
import SubjectsRoomsTab from './admin/SubjectsRoomsTab'
import RequirementsTab from './admin/RequirementsTab'
import AvailabilityTab from './admin/AvailabilityTab'
import GenerateTab from './admin/GenerateTab'
import { SegmentedNav, SmartSelect } from './ui'
import type { SegItem, SmartOption } from './ui'

type TabKey = 'setup' | 'subjects' | 'requirements' | 'availability' | 'generate'

const TABS: SegItem<TabKey>[] = [
  { key: 'setup', label: 'Setup', icon: Settings },
  { key: 'subjects', label: 'Subjects & Rooms', icon: BookOpen },
  { key: 'requirements', label: 'Requirements', icon: ListChecks },
  { key: 'availability', label: 'Availability', icon: CalendarOff },
  { key: 'generate', label: 'Generate & Publish', icon: Sparkles },
]

export default function AdminTimetableBuilder() {
  const [tab, setTab] = useState<TabKey>('setup')
  const [configs, setConfigs] = useState<TimetableConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  const needsConfig = tab !== 'setup'

  return (
    <div className="border border-[#D4D4D8] bg-white">
      {/* Toolbar — the working-timetable picker and tab strip share one row so
          no horizontal space is wasted; they stack only on small screens. */}
      <div className="flex flex-col lg:flex-row lg:items-stretch border-b border-[#E4E4E7] bg-[#FAFAF9]">
        <div className="flex items-center gap-2.5 px-3 py-2.5 lg:border-r lg:border-[#E4E4E7] lg:w-[28rem] lg:flex-shrink-0">
          <CalendarRange size={16} className="text-[#71717A] flex-shrink-0" />
          <SmartSelect
            options={configOptions}
            value={selectedConfigId ?? ''}
            onChange={(v) => setSelectedConfigId(v || null)}
            placeholder={configs.length === 0 ? 'No timetable — create one' : 'Select timetable…'}
            searchPlaceholder="Search timetables…"
          />
        </div>
        <div className="px-3 pb-2.5 lg:px-3 lg:py-2.5 lg:flex-1 lg:min-w-0 flex items-center">
          <SegmentedNav items={TABS} value={tab} onChange={setTab} />
        </div>
      </div>

      {/* Content pane */}
      <div className="p-4 sm:p-5">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#A1A1AA]">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : tab === 'setup' ? (
          <SetupTab
            configs={configs}
            selectedConfig={selectedConfig}
            onSelectConfig={setSelectedConfigId}
            onChanged={loadConfigs}
          />
        ) : needsConfig && !selectedConfig ? (
          <div className="py-12 text-center text-sm text-[#71717A]">
            Create a timetable configuration in the <strong>Setup</strong> tab first.
          </div>
        ) : tab === 'subjects' ? (
          <SubjectsRoomsTab />
        ) : tab === 'requirements' && selectedConfig ? (
          <RequirementsTab config={selectedConfig} />
        ) : tab === 'availability' && selectedConfig ? (
          <AvailabilityTab config={selectedConfig} />
        ) : tab === 'generate' && selectedConfig ? (
          <GenerateTab config={selectedConfig} />
        ) : null}
      </div>
    </div>
  )
}
