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
import { FormGroup, FormRow, Loading, Notice } from '@/components/fees/shell'
import {
  DEFAULT_FEE_SETTINGS, fetchFeeSettings, formatSeriesNumber, saveFeeSetting,
  type NumberingSettings as Numbering, type SeriesSettings,
} from '@/lib/fees/settings'

const FIELD = `${ADMIN.inputPlain} !w-[176px]`

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

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
      <FormGroup title="Every number starts with">
        <FormRow label="School code">
          <input value={value.school_code} maxLength={8}
                 onChange={e => setValue({ ...value, school_code: e.target.value.toUpperCase() })}
                 className={FIELD} />
        </FormRow>
        <FormRow label="Separator">
          <select value={value.separator} onChange={e => setValue({ ...value, separator: e.target.value })} className={FIELD}>
            <option value="/">/  slash</option>
            <option value="-">-  hyphen</option>
            <option value="">none</option>
          </select>
        </FormRow>
      </FormGroup>

      <SeriesEditor
        title="Receipts"
        note="Printed the moment money is taken. This series never repeats a number, which is what makes a receipt provable."
        series={value.receipt}
        onChange={receipt => setValue({ ...value, receipt })}
        preview={formatSeriesNumber(value.receipt, value.school_code, value.separator, yearCode, 1)}
        previewLater={formatSeriesNumber(value.receipt, value.school_code, value.separator, yearCode, 1247)}
      />

      <SeriesEditor
        title="Bills"
        note="On the bill sent to the guardian, and on its verification QR."
        series={value.invoice}
        onChange={invoice => setValue({ ...value, invoice })}
        preview={formatSeriesNumber(value.invoice, value.school_code, value.separator, yearCode, 1)}
        previewLater={formatSeriesNumber(value.invoice, value.school_code, value.separator, yearCode, 1247)}
      />

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button onClick={() => void save()} disabled={saving} className={`${ADMIN.darkBtn} h-9`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save
        </button>
        {saved
          ? <span className="text-[12.5px] text-[#1F6B42] font-medium">Saved as a new version</span>
          : <span className="text-[12px] text-slate-500 leading-snug">Numbers already issued keep the format they were issued under.</span>}
      </div>
    </div>
  )
}

function SeriesEditor({
  title, note, series, onChange, preview, previewLater,
}: {
  title: string
  note: string
  series: SeriesSettings
  onChange: (next: SeriesSettings) => void
  preview: string
  previewLater: string
}) {
  return (
    <FormGroup title={title} note={note}>
      <FormRow label="Prefix">
        <input value={series.prefix} maxLength={8}
               onChange={e => onChange({ ...series, prefix: e.target.value.toUpperCase() })}
               className={FIELD} />
      </FormRow>
      <FormRow label="Digits" hint={series.width < 4
        ? `${series.width} digit${series.width === 1 ? '' : 's'} run out at ${Math.pow(10, series.width) - 1}, and the numbers grow longer mid-series.`
        : undefined}>
        <input type="number" min={1} max={10} value={series.width}
               onChange={e => onChange({ ...series, width: Number(e.target.value) || 1 })}
               className={`${FIELD} text-right tabular-nums`} />
      </FormRow>
      <FormRow label="Include the session">
        <select value={series.include_year ? 'yes' : 'no'}
                onChange={e => onChange({ ...series, include_year: e.target.value === 'yes' })}
                className={FIELD}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </FormRow>
      <FormRow label="Start again from 1">
        <select value={series.reset}
                onChange={e => onChange({ ...series, reset: e.target.value as SeriesSettings['reset'] })}
                className={FIELD}>
          <option value="year">Each session</option>
          <option value="never">Never</option>
        </select>
      </FormRow>
      <div className="px-3.5 py-3 bg-[#FBFAF6] flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
        <span className="text-[12px] text-slate-500">What prints</span>
        <span className="min-w-0">
          <span className="text-[12px] text-slate-500 mr-2">first</span>
          <span className="font-mono text-[13.5px] font-semibold text-slate-900 break-all">{preview}</span>
        </span>
        <span className="min-w-0">
          <span className="text-[12px] text-slate-500 mr-2">1,247th</span>
          <span className="font-mono text-[13.5px] text-slate-600 break-all">{previewLater}</span>
        </span>
      </div>
    </FormGroup>
  )
}
