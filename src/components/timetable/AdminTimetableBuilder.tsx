'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Settings, BookOpen, ListChecks, CalendarOff, Sparkles, Loader2, ChevronDown,
} from 'lucide-react'
import { fetchConfigs, fetchActiveConfig } from '@/lib/timetable'
import type { TimetableConfig } from '@/lib/timetable'
import SetupTab from './admin/SetupTab'
import SubjectsRoomsTab from './admin/SubjectsRoomsTab'
import RequirementsTab from './admin/RequirementsTab'
import AvailabilityTab from './admin/AvailabilityTab'
import GenerateTab from './admin/GenerateTab'

type TabKey = 'setup' | 'subjects' | 'requirements' | 'availability' | 'generate'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
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

  // The non-setup tabs all operate on a chosen config.
  const needsConfig = tab !== 'setup'

  return (
    <div className="space-y-4">
      {/* Config selector + tab bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Working timetable
          </span>
          <div className="relative flex-1 max-w-xs">
            <select
              value={selectedConfigId ?? ''}
              onChange={(e) => setSelectedConfigId(e.target.value || null)}
              className="appearance-none w-full border border-slate-300 rounded-lg bg-white px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-slate-800"
            >
              {configs.length === 0 && <option value="">No config yet — create one in Setup</option>}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? '  • active' : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              size={15}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            )
          })}
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
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-slate-500">
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
