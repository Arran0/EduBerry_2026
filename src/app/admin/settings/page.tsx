'use client'

import React, { useState, useEffect } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'
import { useRouter } from 'next/navigation'
import {
  PageId, PageIconMap, PAGE_DEFAULTS, PAGE_LABELS,
  AVAILABLE_ICONS, GRADIENT_OPTIONS, savePageIconConfig,
} from '@/lib/pageConfig'
import { ICON_MAP } from '@/components/PageIcon'
import { Check, RotateCcw, Save, Settings } from 'lucide-react'

const PAGE_IDS = Object.keys(PAGE_DEFAULTS) as PageId[]

export default function AdminSettingsPage() {
  const { profile } = useAuth()
  const router = useRouter()
  const { config, reload } = usePageConfig()

  const [draft, setDraft] = useState<PageIconMap>(config)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedPage, setSelectedPage] = useState<PageId>('tasks')

  useEffect(() => { setDraft(config) }, [config])

  if (profile && profile.role !== 'admin') {
    router.replace('/home')
    return null
  }

  function updateIcon(pageId: PageId, field: 'iconName' | 'gradientFrom' | 'gradientTo', value: string) {
    setDraft(prev => ({
      ...prev,
      [pageId]: { ...prev[pageId], [field]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    const ok = await savePageIconConfig(draft)
    if (ok) {
      await reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  function handleReset(pageId: PageId) {
    setDraft(prev => ({ ...prev, [pageId]: PAGE_DEFAULTS[pageId] }))
  }

  const current = draft[selectedPage]
  const CurrentIcon = ICON_MAP[current.iconName]

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-slate-500 to-slate-700 rounded-xl shadow-lg">
              <Settings className="text-white" size={24} />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold text-slate-800">App Settings</h1>
              <p className="text-slate-500 text-sm">Customize page icons and colors</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2 text-sm !py-2"
          >
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div className="glass rounded-2xl overflow-hidden">
          <div className="flex flex-col sm:flex-row min-h-[500px]">
            {/* Page list sidebar */}
            <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-slate-100 p-2 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible">
              {PAGE_IDS.map(pageId => {
                const cfg = draft[pageId]
                const Icon = ICON_MAP[cfg.iconName]
                return (
                  <button
                    key={pageId}
                    onClick={() => setSelectedPage(pageId)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 w-full text-left ${
                      selectedPage === pageId
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`p-1 rounded-lg bg-gradient-to-br ${cfg.gradientFrom} ${cfg.gradientTo} flex-shrink-0`}>
                      {Icon && <Icon size={12} className="text-white" />}
                    </div>
                    <span className="truncate">{PAGE_LABELS[pageId]}</span>
                  </button>
                )
              })}
            </div>

            {/* Editor panel */}
            <div className="flex-1 p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-slate-800">{PAGE_LABELS[selectedPage]}</h2>
                <button
                  onClick={() => handleReset(selectedPage)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <RotateCcw size={12} /> Reset to default
                </button>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 mb-6 p-4 bg-slate-50 rounded-xl">
                <div className={`p-2.5 bg-gradient-to-br ${current.gradientFrom} ${current.gradientTo} rounded-xl shadow-lg`}>
                  {CurrentIcon && <CurrentIcon className="text-white" size={24} />}
                </div>
                <div>
                  <p className="font-display text-xl font-bold text-slate-800">{PAGE_LABELS[selectedPage]}</p>
                  <p className="text-slate-400 text-xs">Live preview</p>
                </div>
              </div>

              {/* Icon picker */}
              <div className="mb-5">
                <p className="text-sm font-medium text-slate-700 mb-2">Icon</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {AVAILABLE_ICONS.map(name => {
                    const Icon = ICON_MAP[name]
                    if (!Icon) return null
                    const isSelected = current.iconName === name
                    return (
                      <button
                        key={name}
                        onClick={() => updateIcon(selectedPage, 'iconName', name)}
                        title={name}
                        className={`p-2 rounded-lg flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-slate-200 ring-2 ring-slate-400'
                            : 'bg-slate-100 hover:bg-slate-200'
                        }`}
                      >
                        <Icon size={16} className="text-slate-700" />
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Gradient picker */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Color</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {GRADIENT_OPTIONS.map(opt => {
                    const isSelected = current.gradientFrom === opt.from && current.gradientTo === opt.to
                    return (
                      <button
                        key={opt.label}
                        onClick={() => {
                          updateIcon(selectedPage, 'gradientFrom', opt.from)
                          updateIcon(selectedPage, 'gradientTo', opt.to)
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                          isSelected
                            ? 'border-slate-400 bg-white shadow-sm'
                            : 'border-transparent bg-slate-50 hover:bg-white hover:border-slate-200'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${opt.from} ${opt.to} flex-shrink-0`} />
                        <span className="text-slate-600 truncate">{opt.label}</span>
                        {isSelected && <Check size={10} className="ml-auto text-slate-500 flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-400 text-center">
          Requires a <code className="bg-slate-100 px-1 rounded">site_config</code> table in Supabase — see <code>src/lib/pageConfig.ts</code> for the SQL.
        </p>
      </div>
    </ProtectedLayout>
  )
}
