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
import { SegmentedNav, SmartSelect, SECTION_LABEL } from './ui'
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

  // The non-setup tabs all operate on a chosen config.
  const needsConfig = tab !== 'setup'

  return (
    <div className="space-y-4">
      {/* Workspace toolbar: working-timetable picker + full-width tab nav */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-3 sm:px-4 py-3 border-b border-slate-100 bg-slate-50/70 rounded-t-xl">
          <span className={`${SECTION_LABEL} flex-shrink-0`}>Working timetable</span>
          <div className="sm:w-72">
            <SmartSelect
              options={configOptions}
              value={selectedConfigId ?? ''}
              onChange={(v) => setSelectedConfigId(v || null)}
              placeholder={configs.length === 0 ? 'No timetable yet — create one in Setup' : 'Select a timetable…'}
              searchPlaceholder="Search timetables…"
              leadingIcon={<CalendarRange size={15} className="text-slate-400 flex-shrink-0" />}
            />
          </div>
        </div>

        <div className="p-2 sm:p-3">
          <SegmentedNav items={TABS} value={tab} onChange={setTab} />
        </div>
      </div>

      {/* Panel */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
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
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-10 text-center text-slate-500">
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
  )
}
