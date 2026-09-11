'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  X, ChevronLeft, Download, Loader2, Landmark, FileText, FileSpreadsheet,
  Table2, HeartPulse, SlidersHorizontal, AlertTriangle, Check,
} from 'lucide-react'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { SalaryCycle, formatPeriod } from '@/lib/salary'
import {
  StatutoryConfig, StatutorySourceRow, EcrRow, EsiRow,
  DEFAULT_STATUTORY_CONFIG, fetchStatutoryConfig, saveStatutoryConfig,
  buildEcrRows, buildEsiRows, ecrRowIsFilable, esiRowIsFilable,
  epfTotals, esiTotals,
  ECR_COLUMN_LABELS, ESI_REASON_CODES,
} from '@/lib/statutory'
import {
  ecrTextContent, ecrCsvContent, downloadTextFile,
  downloadEpfWageSheet, downloadEsiContributionSheet,
  epfSheetPreviewRows, esiSheetPreviewRows,
  filableEcrRows, filableEsiRows, statutoryPeriodSlug,
} from '@/components/salary/statements/statutoryFiles'
import { StatementSpec, buildStatutoryRemittanceSummary } from '@/components/salary/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

interface Props {
  cycle: SalaryCycle
  /** One row per pay-cycle record, already flattened by the pay cycle page. */
  sourceRows: StatutorySourceRow[]
  /** Calendar length of the cycle's month — the NCP figure for an unpaid member. */
  daysInMonth: number
  onClose: () => void
}

type DocKey = 'ecr-txt' | 'ecr-csv' | 'epf-xlsx' | 'esi-xls'

/**
 * EPF / ESI filing popup for a pay cycle.
 *
 * Everything the EPFO and the ESIC want for the month, generated from the
 * locked cycle: the ECR in both the delimited form the portal ingests and the
 * CSV the office reads, the working spreadsheet, the ESIC Monthly Contribution
 * workbook, and a remittance summary to raise the challans against.
 *
 * Each document can be looked at before it is saved — the preview shows the
 * exact rows that will be written, not a rendering of them — and every member
 * the returns cannot carry is listed with the reason, because a return that is
 * quietly two people short is worse than one that fails to upload.
 *
 * Mirrors SalaryStatementsModal so the two document surfaces feel like one.
 */
export default function EpfDocumentsModal({ cycle, sourceRows, daysInMonth, onClose }: Props) {
  const [config, setConfig] = useState<StatutoryConfig>(DEFAULT_STATUTORY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [zeroDayReason, setZeroDayReason] = useState('1')
  const [viewing, setViewing] = useState<DocKey | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  useEffect(() => {
    fetchStatutoryConfig().then(c => { setConfig(c); setLoading(false) })
  }, [])

  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const slug = statutoryPeriodSlug(cycle.period_month, cycle.period_year)

  const ecrRows = useMemo(
    () => buildEcrRows(sourceRows, config, daysInMonth),
    [sourceRows, config, daysInMonth],
  )
  const esiRows = useMemo(
    () => buildEsiRows(sourceRows, config, zeroDayReason),
    [sourceRows, config, zeroDayReason],
  )

  const filableEcr = useMemo(() => filableEcrRows(ecrRows), [ecrRows])
  const filableEsi = useMemo(() => filableEsiRows(esiRows), [esiRows])
  const epf = useMemo(() => epfTotals(filableEcr, config), [filableEcr, config])
  const esi = useMemo(() => esiTotals(filableEsi), [filableEsi])

  /** Members a return cannot carry, plus every figure that disagrees with the cycle. */
  const { blockers, warnings } = useMemo(() => {
    const blockers: { name: string; reason: string }[] = []
    const warnings: { name: string; reason: string }[] = []
    for (const r of ecrRows) {
      const label = r.name || 'Unnamed member'
      for (const issue of r.issues) {
        (ecrRowIsFilable(r) ? warnings : blockers).push({ name: `${label} (EPF)`, reason: issue })
      }
    }
    for (const r of esiRows) {
      const label = r.ipName || 'Unnamed person'
      for (const issue of r.issues) {
        (esiRowIsFilable(r) ? warnings : blockers).push({ name: `${label} (ESI)`, reason: issue })
      }
    }
    return { blockers, warnings }
  }, [ecrRows, esiRows])

  const saveConfig = async (next: StatutoryConfig) => {
    setConfig(next)
    setSaving(true)
    const ok = await saveStatutoryConfig(next)
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 1800) }
  }

  const download = async (key: DocKey) => {
    setBusy(key)
    try {
      if (key === 'ecr-txt') {
        downloadTextFile(`epf-ecr-${slug}.txt`, ecrTextContent(ecrRows))
      } else if (key === 'ecr-csv') {
        downloadTextFile(`epf-ecr-${slug}.csv`, ecrCsvContent(ecrRows), 'text/csv;charset=utf-8')
      } else if (key === 'epf-xlsx') {
        await downloadEpfWageSheet(`epf-wage-sheet-${slug}.xlsx`, ecrRows, config, period)
      } else {
        await downloadEsiContributionSheet(`esi-monthly-contribution-${slug}.xls`, esiRows)
      }
    } catch (e) { console.error('statutory file generation failed:', e) }
    setBusy(null)
  }

  const openSummary = async () => {
    setBusy('summary')
    try {
      const spec = await buildStatutoryRemittanceSummary(cycle, config, epf, esi, blockers)
      setPreview({ spec, title: `EPF & ESI Remittance Summary — ${period}` })
    } catch (e) { console.error('remittance summary failed:', e) }
    setBusy(null)
  }

  const DOCS: { key: DocKey | 'summary'; label: string; sub: string; icon: React.ReactNode; count: number }[] = [
    { key: 'ecr-txt', label: 'EPF ECR', sub: 'Text · upload', icon: <FileText size={15} />, count: filableEcr.length },
    { key: 'ecr-csv', label: 'EPF ECR', sub: 'CSV', icon: <Table2 size={15} />, count: filableEcr.length },
    { key: 'epf-xlsx', label: 'Wage Sheet', sub: 'Excel', icon: <FileSpreadsheet size={15} />, count: filableEcr.length },
    { key: 'esi-xls', label: 'ESI Monthly', sub: 'Excel 97-2003', icon: <HeartPulse size={15} />, count: filableEsi.length },
    { key: 'summary', label: 'Remittance', sub: 'Summary PDF', icon: <Landmark size={15} />, count: filableEcr.length + filableEsi.length },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-lg sm:rounded-none shadow-2xl w-full sm:max-w-3xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {viewing && (
              <button onClick={() => setViewing(null)} title="Back"
                className="p-1.5 -ml-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] flex-shrink-0">
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
              <Landmark size={16} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-[#18181B] text-sm truncate">
                {viewing ? DOC_TITLES[viewing] : 'EPF / ESI Filing'}
              </p>
              <p className="text-[11px] text-[#71717A] truncate">
                {period} · {filableEcr.length} EPF member{filableEcr.length === 1 ? '' : 's'} · {filableEsi.length} insured person{filableEsi.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!viewing && (
              <button onClick={() => setShowSettings(s => !s)} title="Establishment details & rates"
                className={`p-1.5 transition-colors ${showSettings ? 'bg-[#27272A] text-white' : 'text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5]'}`}>
                <SlidersHorizontal size={16} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5]">
              <X size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-[#A1A1AA]">
            <Loader2 size={18} className="animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : viewing ? (
          <DocumentPreview
            docKey={viewing}
            ecrRows={ecrRows}
            esiRows={esiRows}
            busy={busy === viewing}
            onDownload={() => download(viewing)}
          />
        ) : (
          <div className="p-4 overflow-y-auto">
            {/* Download Centre opens on any cycle, but PF and ESI are only
                fixed when it is locked — until then these figures are a
                preview and will move if attendance or a wage changes. */}
            {cycle.status !== 'closed' && (
              <div className="flex items-start gap-2 border border-[#EFE3C4] bg-[#FBF6E9] p-3 mb-4 text-[#8A6D1F]">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  This cycle is still unlocked, so PF, ESI and loss of pay can change. Generate now to check
                  identifiers and totals, but lock the cycle before filing anything.
                </p>
              </div>
            )}

            {showSettings && (
              <ConfigPanel config={config} saving={saving} saved={saved} onChange={saveConfig} />
            )}

            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Filing documents</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DOCS.map(doc => {
                const empty = doc.count === 0
                return (
                  <button
                    key={doc.key}
                    onClick={() => doc.key === 'summary' ? openSummary() : setViewing(doc.key)}
                    disabled={empty || busy === doc.key}
                    className={`flex flex-col items-center justify-center gap-1 py-3 border transition-all ${
                      empty
                        ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
                        : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                    }`}
                  >
                    <span className={empty ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                    <span className="text-[11px] font-semibold leading-tight text-center">
                      {busy === doc.key ? '…' : doc.label}
                    </span>
                    <span className={`text-[9px] font-normal leading-none ${empty ? 'text-[#D4D4D8]' : 'text-[#A1A1AA]'}`}>
                      {doc.sub}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Contribution totals — the figures the challans are raised for. */}
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mt-5 mb-2">Remittance for {period}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="border border-[#E4E4E7] p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-2">EPF</p>
                <Line label="A/c 1 — EPF" value={epf.accountOne} />
                <Line label="A/c 10 — EPS" value={epf.accountTen} />
                <Line label="A/c 21 — EDLI" value={epf.accountTwentyOne} />
                <Line label="A/c 2 — Admin" value={epf.accountTwo} />
                <Line label="Total" value={epf.grandTotal} strong />
              </div>
              <div className="border border-[#E4E4E7] p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-2">ESI</p>
                <Line label="Wages" value={esi.totalWages} />
                <Line label="Employee 0.75%" value={esi.employeeShare} />
                <Line label="Employer 3.25%" value={esi.employerShare} />
                <Line label="Total" value={esi.grandTotal} strong />
              </div>
            </div>

            {/* Anyone the returns cannot carry, and anything they disagree with. */}
            {blockers.length > 0 && (
              <IssueList
                tone="rose"
                title={`${blockers.length} left out of the returns`}
                note="Add the missing identifier in Salary Manager → Base salaries, then generate again."
                items={blockers}
              />
            )}
            {warnings.length > 0 && (
              <IssueList
                tone="amber"
                title={`${warnings.length} to reconcile`}
                note="These members are filed, but the return claims a different figure from what the cycle deducted. Check the PF Basic wage or the override on the cycle."
                items={warnings}
              />
            )}

            <div className="mt-4 pt-3 border-t border-[#F4F4F5]">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] block mb-1.5">
                ESI reason code for members with no paid days
              </label>
              <select value={zeroDayReason} onChange={e => setZeroDayReason(e.target.value)}
                className="w-full bg-white border border-[#E4E4E7] px-3 py-2 text-xs text-[#27272A] focus:outline-none focus:border-[#27272A]">
                {Object.entries(ESI_REASON_CODES).filter(([c]) => c !== '0').map(([code, label]) => (
                  <option key={code} value={code}>{code} — {label}</option>
                ))}
              </select>
              <p className="text-[10px] text-[#A1A1AA] mt-1.5 leading-relaxed">
                Only codes that keep the person on the employer&apos;s roll are offered. Removing someone
                (left service, retired, expired) needs a last working day and is done on the ESIC portal itself.
              </p>
            </div>

            <p className="text-[10px] text-[#A1A1AA] mt-4 leading-relaxed">
              Names are filed in capitals with only letters and spaces, as both portals require. Wages fall in
              proportion to the days lost to leave and late marks on this cycle. Check the figures against the
              portals before remitting.
            </p>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} sharp />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const DOC_TITLES: Record<DocKey, string> = {
  'ecr-txt': 'EPF ECR — text file',
  'ecr-csv': 'EPF ECR — CSV',
  'epf-xlsx': 'EPF wage sheet',
  'esi-xls': 'ESI monthly contribution',
}

// ============================================
// Preview — the file's own contents, not a rendering of them
// ============================================

function DocumentPreview({ docKey, ecrRows, esiRows, busy, onDownload }: {
  docKey: DocKey
  ecrRows: EcrRow[]
  esiRows: EsiRow[]
  busy: boolean
  onDownload: () => void
}) {
  const isEsi = docKey === 'esi-xls'
  // The two text formats *are* their preview — showing the raw lines is the
  // only way to see what the portal will actually parse.
  const raw = docKey === 'ecr-txt'
    ? ecrTextContent(ecrRows)
    : docKey === 'ecr-csv' ? ecrCsvContent(ecrRows) : null

  const tableRows: (string | number)[][] = isEsi
    ? esiSheetPreviewRows(esiRows)
    : epfSheetPreviewRows(ecrRows)
  const headers: readonly string[] = isEsi
    ? ['IP Number', 'IP Name', 'Days Paid', 'Total Wages', 'Reason Code', 'Last Working Day']
    : ECR_COLUMN_LABELS
  const rowCount = raw !== null
    ? (raw ? raw.split(/\r?\n/).length : 0)
    : tableRows.length

  return (
    <>
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {raw !== null ? (
          <pre className="text-[10px] leading-relaxed font-mono text-[#27272A] bg-[#FAFAFA] border border-[#E4E4E7] p-3 whitespace-pre overflow-x-auto">
            {raw || 'No members to file.'}
          </pre>
        ) : tableRows.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] text-center py-10">No members to file.</p>
        ) : (
          <div className="overflow-x-auto border border-[#E4E4E7]">
            <table className="w-full text-[10px] tabular-nums">
              <thead>
                <tr className="bg-[#27272A] text-white">
                  {headers.map(h => (
                    <th key={h} className="text-left font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i} className="border-b border-[#F4F4F5] last:border-0">
                    {row.map((cell, c) => (
                      <td key={c} className={`px-2 py-1.5 whitespace-nowrap ${c === 1 ? 'text-[#18181B] font-semibold' : 'text-[#52525B]'}`}>
                        {cell === '' ? '—' : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[10px] text-[#A1A1AA] mt-3 leading-relaxed">
          {docKey === 'ecr-txt' && 'Fields are separated by #~# in EPFO’s own order: UAN, name, gross / EPF / EPS / EDLI wages, EPF and EPS contributions remitted, their difference, NCP days, refund of advances. Upload this file as-is.'}
          {docKey === 'ecr-csv' && 'The same eleven fields, comma separated, for checking in a spreadsheet. The portal takes the text file, not this one.'}
          {docKey === 'epf-xlsx' && 'The office working copy. Wage columns are typed values; EPS and EDLI wages, both contributions and their difference stay live formulas, so correcting a wage re-adds the rest.'}
          {docKey === 'esi-xls' && 'Saved as Excel 97-2003 with every cell stored as text, which is what the ESIC upload requires. Column headings are reproduced from the ESIC template unchanged.'}
        </p>
      </div>

      <div className="px-4 py-3 border-t border-[#E4E4E7] flex-shrink-0 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[#71717A]">{rowCount} row{rowCount === 1 ? '' : 's'}</p>
        <button onClick={onDownload} disabled={busy}
          className="flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-50">
          <Download size={15} /> {busy ? 'Saving…' : 'Download'}
        </button>
      </div>
    </>
  )
}

// ============================================
// Establishment details & rates
// ============================================

const fieldCls = 'w-full bg-white border border-[#E4E4E7] px-2.5 py-1.5 text-xs text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'

function ConfigPanel({ config, saving, saved, onChange }: {
  config: StatutoryConfig
  saving: boolean
  saved: boolean
  onChange: (next: StatutoryConfig) => void
}) {
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])

  const set = (patch: Partial<StatutoryConfig>) => setDraft({ ...draft, ...patch })
  const pct = (v: number) => String(Number((v * 100).toFixed(4)))
  const fromPct = (s: string) => (parseFloat(s) || 0) / 100

  return (
    <div className="border border-[#E4E4E7] bg-[#FAFAFA] p-3 mb-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-2.5">Establishment &amp; rates</p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Field label="EPF establishment ID">
          <input value={draft.epf_establishment_id} onChange={e => set({ epf_establishment_id: e.target.value.toUpperCase() })}
            placeholder="TNMAS0012345000" className={fieldCls} />
        </Field>
        <Field label="ESI employer code">
          <input value={draft.esi_employer_code} onChange={e => set({ esi_employer_code: e.target.value.replace(/\D+/g, '') })}
            inputMode="numeric" maxLength={17} placeholder="17 digits" className={fieldCls} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Field label="EPF %">
          <input type="number" step="0.01" value={pct(draft.epf_rate)} onChange={e => set({ epf_rate: fromPct(e.target.value) })} className={fieldCls} />
        </Field>
        <Field label="EPS %">
          <input type="number" step="0.01" value={pct(draft.eps_rate)} onChange={e => set({ eps_rate: fromPct(e.target.value) })} className={fieldCls} />
        </Field>
        <Field label="EPS ceiling">
          <input type="number" step="1" value={draft.eps_wage_ceiling} onChange={e => set({ eps_wage_ceiling: parseFloat(e.target.value) || 0 })} className={fieldCls} />
        </Field>
        <Field label="EDLI %">
          <input type="number" step="0.01" value={pct(draft.edli_rate)} onChange={e => set({ edli_rate: fromPct(e.target.value) })} className={fieldCls} />
        </Field>
        <Field label="EDLI ceiling">
          <input type="number" step="1" value={draft.edli_wage_ceiling} onChange={e => set({ edli_wage_ceiling: parseFloat(e.target.value) || 0 })} className={fieldCls} />
        </Field>
        <Field label="Admin % / min">
          <div className="flex gap-1">
            <input type="number" step="0.01" value={pct(draft.epf_admin_rate)} onChange={e => set({ epf_admin_rate: fromPct(e.target.value) })} className={fieldCls} />
            <input type="number" step="1" value={draft.epf_admin_minimum} onChange={e => set({ epf_admin_minimum: parseFloat(e.target.value) || 0 })} className={fieldCls} />
          </div>
        </Field>
        <Field label="ESI employee %">
          <input type="number" step="0.01" value={pct(draft.esi_employee_rate)} onChange={e => set({ esi_employee_rate: fromPct(e.target.value) })} className={fieldCls} />
        </Field>
        <Field label="ESI employer %">
          <input type="number" step="0.01" value={pct(draft.esi_employer_rate)} onChange={e => set({ esi_employer_rate: fromPct(e.target.value) })} className={fieldCls} />
        </Field>
      </div>

      <label className="flex items-start gap-2 cursor-pointer mb-3" title="Contribute only up to the pension ceiling, even where the PF Basic wage is higher">
        <input type="checkbox" checked={draft.cap_epf_wages} onChange={e => set({ cap_epf_wages: e.target.checked })}
          className="w-3.5 h-3.5 accent-[#27272A] mt-0.5" />
        <span className="text-[11px] text-[#52525B] leading-snug">
          Cap EPF wages at the pension ceiling — leave off to contribute on each member&apos;s full PF Basic wage.
        </span>
      </label>

      <button onClick={() => onChange(draft)} disabled={saving}
        className="flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50">
        {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save rates'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="text-[9px] font-bold uppercase tracking-widest text-[#A1A1AA] block mb-1">{label}</label>
      {children}
    </div>
  )
}

// ============================================
// Small pieces
// ============================================

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${strong ? 'mt-1.5 pt-1.5 border-t border-[#F4F4F5]' : 'mb-0.5'}`}>
      <span className={`text-[10px] ${strong ? 'font-bold text-[#18181B]' : 'text-[#71717A]'}`}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-xs font-bold text-[#18181B]' : 'text-[11px] text-[#52525B]'}`}>
        {formatINR(value)}
      </span>
    </div>
  )
}

function IssueList({ tone, title, note, items }: {
  tone: 'rose' | 'amber'
  title: string
  note: string
  items: { name: string; reason: string }[]
}) {
  const cls = tone === 'rose'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-[#EFE3C4] bg-[#FBF6E9] text-[#8A6D1F]'
  return (
    <div className={`mt-3 border p-3 ${cls}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold mb-1.5">
        <AlertTriangle size={13} className="flex-shrink-0" /> {title}
      </p>
      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
        {items.map((it, i) => (
          <li key={i} className="text-[10px] leading-snug opacity-90">
            <span className="font-semibold">{it.name}</span> — {it.reason}
          </li>
        ))}
      </ul>
      <p className="text-[10px] mt-1.5 opacity-75 leading-relaxed">{note}</p>
    </div>
  )
}
