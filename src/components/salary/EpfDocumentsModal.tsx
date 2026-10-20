'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft, Download, Loader2, Landmark, FileText, FileSpreadsheet,
  Table2, HeartPulse, SlidersHorizontal, AlertTriangle, Check,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, SALARY_ICON, SX } from '@/components/salary/ui'
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

interface Props {
  cycle: SalaryCycle
  /** One row per pay-cycle record, already flattened by the pay cycle page. */
  sourceRows: StatutorySourceRow[]
  /** Calendar length of the cycle's month — the NCP figure for an unpaid member. */
  daysInMonth: number
  onClose: () => void
  /**
   * Hands a built PDF spec up to the pay cycle page, which renders the shared
   * StatementPreviewModal as a sibling of this modal (not nested inside it).
   * Framer Motion's AnimatePresence only coordinates an exit animation
   * cleanly for direct children — a preview modal nested inside this one, and
   * unmounted at the same time this modal is (e.g. closing straight after
   * opening the remittance summary), could leave its full-screen backdrop
   * behind, silently blocking clicks on the rest of the page.
   */
  onPreview: (spec: StatementSpec, title: string) => void
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
export default function EpfDocumentsModal({ cycle, sourceRows, daysInMonth, onClose, onPreview }: Props) {
  const [config, setConfig] = useState<StatutoryConfig>(DEFAULT_STATUTORY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [zeroDayReason, setZeroDayReason] = useState('1')
  const [viewing, setViewing] = useState<DocKey | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatutoryConfig().then(c => { if (!cancelled) { setConfig(c); setLoading(false) } })
    return () => { cancelled = true }
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
      onPreview(spec, `EPF & ESI Remittance Summary — ${period}`)
    } catch (e) { console.error('remittance summary failed:', e) }
    setBusy(null)
  }

  const DOCS: { key: DocKey | 'summary'; label: string; sub: string; icon: React.ReactNode; count: number }[] = [
    { key: 'ecr-txt', label: 'EPF ECR', sub: 'Text · upload', icon: <FileText size={15} />, count: filableEcr.length },
    { key: 'ecr-csv', label: 'EPF ECR', sub: 'CSV', icon: <Table2 size={15} />, count: filableEcr.length },
    { key: 'epf-xlsx', label: 'Wage sheet', sub: 'Excel', icon: <FileSpreadsheet size={20} />, count: filableEcr.length },
    { key: 'esi-xls', label: 'ESI monthly', sub: 'Excel 97-2003', icon: <HeartPulse size={20} />, count: filableEsi.length },
    { key: 'summary', label: 'Remittance', sub: 'Summary PDF', icon: <Landmark size={20} />, count: filableEcr.length + filableEsi.length },
  ]

  /** Row count for whichever document is open in the preview — feeds the footer below. */
  const viewingRowCount = useMemo(() => {
    if (!viewing) return 0
    if (viewing === 'ecr-txt') { const t = ecrTextContent(ecrRows); return t ? t.split(/\r?\n/).length : 0 }
    if (viewing === 'ecr-csv') { const t = ecrCsvContent(ecrRows); return t ? t.split(/\r?\n/).length : 0 }
    return viewing === 'esi-xls' ? esiSheetPreviewRows(esiRows).length : epfSheetPreviewRows(ecrRows).length
  }, [viewing, ecrRows, esiRows])

  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      sharp
      title={viewing ? DOC_TITLES[viewing] : 'EPF and ESI returns'}
      subtitle={`${period} · ${filableEcr.length} EPF member${filableEcr.length === 1 ? '' : 's'} · ${filableEsi.length} insured person${filableEsi.length === 1 ? '' : 's'}`}
      icon={<Landmark size={16} />}
      iconClassName={SALARY_ICON}
      headerActions={!viewing && (
        <button onClick={() => setShowSettings(s => !s)} title="Establishment details and rates"
          aria-label="Establishment details and rates" aria-pressed={showSettings}
          className={showSettings ? `${SX.icon} !bg-[#27272A] !text-white` : `lg-control w-9 h-9 flex-shrink-0`}>
          <SlidersHorizontal size={15} />
        </button>
      )}
      footer={viewing && !loading ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Btn tone="ghost" onClick={() => setViewing(null)} className="!pl-2.5">
            <ChevronLeft size={14} /> All returns
          </Btn>
          <span className="flex items-center gap-2">
            <span className="text-[12px] text-slate-500 tabular-nums">{viewingRowCount} row{viewingRowCount === 1 ? '' : 's'}</span>
            <Btn tone="dark" onClick={() => download(viewing)} disabled={busy === viewing}>
              <Download size={13} /> {busy === viewing ? 'Saving…' : 'Download'}
            </Btn>
          </span>
        </div>
      ) : undefined}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-slate-400">
          <Loader2 size={18} className="animate-spin" /><span className="text-[13px]">Loading…</span>
        </div>
      ) : viewing ? (
        <DocumentPreviewBody docKey={viewing} ecrRows={ecrRows} esiRows={esiRows} />
      ) : (
        <>
          {showSettings && (
            <ConfigPanel config={config} saving={saving} saved={saved} onChange={saveConfig} />
          )}

          <p className={`${SX.heading} mb-2`}>Files for the portals</p>
          <div className="grid grid-cols-2 min-[460px]:grid-cols-3 md:grid-cols-5 gap-2">
            {DOCS.map(doc => {
              const empty = doc.count === 0
              return (
                <button
                  key={doc.key}
                  onClick={() => doc.key === 'summary' ? openSummary() : setViewing(doc.key)}
                  disabled={empty || busy === doc.key}
                  className={SX.tile}
                >
                  <span className="text-[#8B6F47]">{busy === doc.key ? <Loader2 size={20} className="animate-spin" /> : doc.icon}</span>
                  <span className="text-[13px] font-semibold text-slate-900 leading-snug">
                    {busy === doc.key ? 'Building…' : doc.label}
                  </span>
                  <span className="text-[11.5px] text-slate-500 leading-snug">
                    {doc.sub}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Contribution totals — the figures the challans are raised for. */}
          <p className={`${SX.heading} mt-5 mb-2`}>To pay for {period}</p>
          <div className="grid grid-cols-1 min-[460px]:grid-cols-2 gap-2">
            <div className="fx-card p-3.5">
              <p className="text-[13px] font-semibold text-slate-900 mb-2">EPF</p>
              <Line label="A/c 1 — EPF" value={epf.accountOne} />
              <Line label="A/c 10 — EPS" value={epf.accountTen} />
              <Line label="A/c 21 — EDLI" value={epf.accountTwentyOne} />
              <Line label="A/c 2 — Admin" value={epf.accountTwo} />
              <Line label="Total" value={epf.grandTotal} strong />
            </div>
            <div className="fx-card p-3.5">
              <p className="text-[13px] font-semibold text-slate-900 mb-2">ESI</p>
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
              note="Add the missing number in Salary → Base salaries, then open this again."
              items={blockers}
            />
          )}
          {warnings.length > 0 && (
            <IssueList
              tone="amber"
              title={`${warnings.length} to reconcile`}
              note="These people are in the return, but it shows a different figure from what the cycle took off. Check their PF Basic wage, or any figure typed in on the cycle."
              items={warnings}
            />
          )}

          <div className="mt-4 pt-3 border-t border-[#EEEAE1]">
            <label className={`${SX.heading} block mb-1.5`}>
              ESI reason for people with no paid days
            </label>
            <select value={zeroDayReason} onChange={e => setZeroDayReason(e.target.value)}
              className={`${SX.field} cursor-pointer`}>
              {Object.entries(ESI_REASON_CODES).filter(([c]) => c !== '0').map(([code, label]) => (
                <option key={code} value={code}>{code} — {label}</option>
              ))}
            </select>
            <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
              Only reasons that keep the person on the school&apos;s roll are listed. Taking someone off
              (left, retired, died) needs a last working day and is done on the ESIC portal.
            </p>
          </div>

          <p className="text-[12px] text-slate-500 mt-4 leading-relaxed">
            Names go in capitals with letters and spaces only, as both portals need. Wages are cut in
            proportion to days lost to leave and late marks in this cycle. Check against the portals before paying.
          </p>
        </>
      )}
    </ModalShell>
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

function DocumentPreviewBody({ docKey, ecrRows, esiRows }: {
  docKey: DocKey
  ecrRows: EcrRow[]
  esiRows: EsiRow[]
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

  return (
    <>
      {raw !== null ? (
        <pre className="fx-card text-[11px] leading-relaxed font-mono text-slate-800 p-3 whitespace-pre overflow-x-auto">
          {raw || 'No members to file.'}
        </pre>
      ) : tableRows.length === 0 ? (
        <p className="text-[13px] text-slate-500 text-center py-10">Nobody to file.</p>
      ) : (
        <div className="fx-card overflow-x-auto">
          <table className="w-full text-[11.5px] tabular-nums">
            <thead>
              <tr className="bg-[#F7F5F0] border-b border-[#EEEAE1]">
                {headers.map(h => (
                  <th key={h} className="text-left text-[11.5px] font-medium text-slate-500 px-2.5 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i} className="border-b border-[#F0ECE3] last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className={`px-2.5 py-1.5 whitespace-nowrap ${c === 1 ? 'text-slate-900 font-semibold' : 'text-slate-600'}`}>
                      {cell === '' ? '—' : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[12px] text-slate-500 mt-3 leading-relaxed">
        {docKey === 'ecr-txt' && 'Fields are separated by #~# in EPFO’s own order: UAN, name, gross / EPF / EPS / EDLI wages, EPF and EPS contributions remitted, their difference, NCP days, refund of advances. Upload this file as-is.'}
        {docKey === 'ecr-csv' && 'The same eleven fields, comma separated, for checking in a spreadsheet. The portal takes the text file, not this one.'}
        {docKey === 'epf-xlsx' && 'The office working copy. Wage columns are typed values; EPS and EDLI wages, both contributions and their difference stay live formulas, so correcting a wage re-adds the rest.'}
        {docKey === 'esi-xls' && 'Saved as Excel 97-2003 with every cell stored as text, which is what the ESIC upload requires. Column headings are reproduced from the ESIC template unchanged.'}
      </p>
    </>
  )
}

// ============================================
// Establishment details & rates
// ============================================

const fieldCls = SX.field

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
    <div className="fx-card p-3.5 mb-4">
      <p className={`${SX.heading} mb-2.5`}>Establishment details and rates</p>
      <div className="grid grid-cols-1 min-[460px]:grid-cols-2 gap-2.5 mb-2.5">
        <Field label="EPF establishment ID">
          <input value={draft.epf_establishment_id} onChange={e => set({ epf_establishment_id: e.target.value.toUpperCase() })}
            placeholder="TNMAS0012345000" className={fieldCls} />
        </Field>
        <Field label="ESI employer code">
          <input value={draft.esi_employer_code} onChange={e => set({ esi_employer_code: e.target.value.replace(/\D+/g, '') })}
            inputMode="numeric" maxLength={17} placeholder="17 digits" className={fieldCls} />
        </Field>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
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
          className={`${SX.check} mt-0.5`} />
        <span className="text-[12.5px] text-slate-700 leading-snug">
          Stop EPF wages at the pension ceiling. Leave off to pay on each person&apos;s full PF Basic wage.
        </span>
      </label>

      <Btn tone="dark" onClick={() => onChange(draft)} disabled={saving}>
        {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save rates'}
      </Btn>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="text-[11.5px] font-medium text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  )
}

// ============================================
// Small pieces
// ============================================

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-2 ${strong ? 'mt-1.5 pt-1.5 border-t border-[#EEEAE1]' : 'mb-1'}`}>
      <span className={`text-[12px] ${strong ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[13px] font-bold text-slate-900' : 'text-[12.5px] text-slate-700'}`}>
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
    ? 'border-[#C24141] bg-[#FCEDED] text-[#962C2C]'
    : 'border-[#B8983C] bg-[#FBF4E2] text-[#6E5513]'
  return (
    <div className={`mt-3 border-l-[3px] px-3.5 py-2.5 ${cls}`}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold mb-1.5">
        <AlertTriangle size={13} className="flex-shrink-0" /> {title}
      </p>
      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
        {items.map((it, i) => (
          <li key={i} className="text-[12px] leading-snug break-words">
            <span className="font-semibold">{it.name}</span> — {it.reason}
          </li>
        ))}
      </ul>
      <p className="text-[12px] mt-1.5 opacity-80 leading-relaxed">{note}</p>
    </div>
  )
}
