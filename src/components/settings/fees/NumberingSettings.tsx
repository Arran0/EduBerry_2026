'use client'

// Receipt and invoice numbering, with the number shown before it starts printing.
//
// A school will not adopt a receipt series they cannot see first — the number
// goes on a legal document and into their books. The preview here calls the same
// formatSeriesNumber() that Round 2's fee_next_number() formatting uses, so what
// is shown cannot drift from what prints.

import React, { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import {
  DEFAULT_FEE_SETTINGS, fetchFeeSettings, formatSeriesNumber, saveFeeSetting,
  type NumberingSettings as Numbering, type SeriesSettings,
} from '@/lib/fees/settings'

export default function NumberingSettingsPanel({
  academicYearId, yearCode,
}: { academicYearId: string | null; yearCode: string }) {
  const [value, setValue] = useState<Numbering>(DEFAULT_FEE_SETTINGS.numbering)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setValue((await fetchFeeSettings(academicYearId)).numbering)
      } finally {
        setLoading(false)
      }
    })()
  }, [academicYearId])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await saveFeeSetting('numbering', value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save numbering.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${ADMIN.card} p-8 flex items-center justify-center gap-2 text-sm text-[#71717A]`}>
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-5 space-y-4`}>
        <div>
          <h3 className="text-sm font-bold text-[#27272A]">School code and separator</h3>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            The part every number starts with.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>School code</label>
            <input
              value={value.school_code}
              onChange={e => setValue({ ...value, school_code: e.target.value.toUpperCase() })}
              maxLength={8}
              className={ADMIN.inputPlain}
            />
          </div>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Separator</label>
            <select
              value={value.separator}
              onChange={e => setValue({ ...value, separator: e.target.value })}
              className={ADMIN.inputPlain}
            >
              <option value="/">/ &nbsp; slash</option>
              <option value="-">- &nbsp; hyphen</option>
              <option value="">none</option>
            </select>
          </div>
        </div>
      </div>

      <SeriesEditor
        title="Receipts"
        subtitle="Printed the moment money is taken. This series must never repeat a number — that is what makes a receipt provable."
        series={value.receipt}
        onChange={receipt => setValue({ ...value, receipt })}
        preview={formatSeriesNumber(value.receipt, value.school_code, value.separator, yearCode, 1)}
        previewLater={formatSeriesNumber(value.receipt, value.school_code, value.separator, yearCode, 1247)}
      />

      <SeriesEditor
        title="Invoices"
        subtitle="On the bill sent to the guardian, and on its verification QR."
        series={value.invoice}
        onChange={invoice => setValue({ ...value, invoice })}
        preview={formatSeriesNumber(value.invoice, value.school_code, value.separator, yearCode, 1)}
        previewLater={formatSeriesNumber(value.invoice, value.school_code, value.separator, yearCode, 1247)}
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={saving} className={ADMIN.darkBtn}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save numbering
        </button>
        {saved && <span className="text-xs text-emerald-600 font-medium">Saved as a new version</span>}
        <span className="text-xs text-[#A1A1AA]">
          Numbers already issued keep the format they were issued under.
        </span>
      </div>
    </div>
  )
}

function SeriesEditor({
  title, subtitle, series, onChange, preview, previewLater,
}: {
  title: string
  subtitle: string
  series: SeriesSettings
  onChange: (next: SeriesSettings) => void
  preview: string
  previewLater: string
}) {
  return (
    <div className={`${ADMIN.card} p-5 space-y-4`}>
      <div>
        <h3 className="text-sm font-bold text-[#27272A]">{title}</h3>
        <p className="text-xs text-[#A1A1AA] mt-0.5 max-w-2xl">{subtitle}</p>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Prefix</label>
          <input
            value={series.prefix}
            onChange={e => onChange({ ...series, prefix: e.target.value.toUpperCase() })}
            maxLength={8}
            className={ADMIN.inputPlain}
          />
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Digits</label>
          <input
            type="number" min={1} max={10}
            value={series.width}
            onChange={e => onChange({ ...series, width: Number(e.target.value) || 1 })}
            className={ADMIN.inputPlain}
          />
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Include year</label>
          <select
            value={series.include_year ? 'yes' : 'no'}
            onChange={e => onChange({ ...series, include_year: e.target.value === 'yes' })}
            className={ADMIN.inputPlain}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Restart</label>
          <select
            value={series.reset}
            onChange={e => onChange({ ...series, reset: e.target.value as SeriesSettings['reset'] })}
            className={ADMIN.inputPlain}
          >
            <option value="year">Each academic year</option>
            <option value="never">Never — keep counting</option>
          </select>
        </div>
      </div>

      <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg px-4 py-3">
        <div className={`${ADMIN.label} mb-1.5`}>What will print</div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <span className="text-xs text-[#A1A1AA] mr-2">First:</span>
            <span className="font-mono text-sm font-semibold text-[#27272A]">{preview}</span>
          </div>
          <div>
            <span className="text-xs text-[#A1A1AA] mr-2">The 1,247th:</span>
            <span className="font-mono text-sm text-[#52525B]">{previewLater}</span>
          </div>
        </div>
        {series.width < 4 && (
          <p className="text-xs text-amber-700 mt-2">
            {series.width} digit{series.width === 1 ? '' : 's'} runs out
            at {Math.pow(10, series.width) - 1}. A school of this size issues more
            than that in a year, and the numbers will get longer mid-series.
          </p>
        )}
      </div>
    </div>
  )
}
