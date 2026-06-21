'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Loader2, Save, RotateCcw } from 'lucide-react'
import { SmartboardBanner, updateSmartboardBanner } from '@/lib/homerooms'

interface SmartboardBannerEditorProps {
  homeroomId: string
  homeroomName: string
  banner: SmartboardBanner | null
  onClose: () => void
  onSaved: (banner: SmartboardBanner) => void
}

const PRESETS: { from: string; to: string }[] = [
  { from: '#6366F1', to: '#7C3AED' },
  { from: '#0EA5E9', to: '#2563EB' },
  { from: '#059669', to: '#0D9488' },
  { from: '#F59E0B', to: '#EF4444' },
  { from: '#EC4899', to: '#8B5CF6' },
  { from: '#1E293B', to: '#475569' },
]

export default function SmartboardBannerEditor({
  homeroomId, homeroomName, banner, onClose, onSaved,
}: SmartboardBannerEditorProps) {
  const [title, setTitle] = useState(banner?.title ?? '')
  const [imageUrl, setImageUrl] = useState(banner?.image_url ?? '')
  const [colorFrom, setColorFrom] = useState(banner?.color_from ?? '#6366F1')
  const [colorTo, setColorTo] = useState(banner?.color_to ?? '#7C3AED')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const next: SmartboardBanner = {
      title: title.trim() || null,
      image_url: imageUrl.trim() || null,
      color_from: colorFrom,
      color_to: colorTo,
    }
    const ok = await updateSmartboardBanner(homeroomId, next)
    setSaving(false)
    if (ok) onSaved(next)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]"
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <h2 className="flex-1 text-sm font-bold text-slate-800">Customise banner</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {/* Live preview */}
          <div
            className="relative overflow-hidden rounded-2xl h-24 flex items-center px-5"
            style={{ background: `linear-gradient(135deg, ${colorFrom}, ${colorTo})` }}
          >
            {imageUrl && <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />}
            <span className="relative text-white font-display text-xl font-bold" style={{ textShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
              {title.trim() || homeroomName}
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Title</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder={homeroomName}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
            />
            <p className="text-[11px] text-slate-400 mt-1">Defaults to the homeroom name.</p>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Background image URL <span className="font-normal normal-case">(optional)</span></label>
            <div className="flex gap-1.5">
              <input
                value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400"
              />
              {imageUrl && (
                <button onClick={() => setImageUrl('')} className="px-2 text-slate-400 hover:text-rose-600" title="Clear image">
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Gradient</label>
            <div className="flex flex-wrap gap-2 mb-2.5">
              {PRESETS.map(p => (
                <button
                  key={`${p.from}-${p.to}`}
                  onClick={() => { setColorFrom(p.from); setColorTo(p.to) }}
                  className={`w-9 h-9 rounded-lg border-2 transition-transform hover:scale-105 ${colorFrom === p.from && colorTo === p.to ? 'border-slate-800' : 'border-white shadow'}`}
                  style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                  aria-label="Preset gradient"
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                From <input type="color" value={colorFrom} onChange={e => setColorFrom(e.target.value)} className="w-8 h-8 rounded border border-slate-200" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                To <input type="color" value={colorTo} onChange={e => setColorTo(e.target.value)} className="w-8 h-8 rounded border border-slate-200" />
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <button
            onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
