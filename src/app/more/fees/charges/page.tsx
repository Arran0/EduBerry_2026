'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Charges — late fees and fines.
//
// Two things that add money to a bill after it has been issued, kept on one
// screen because the office thinks of them together and because both need the
// same guard rail: you can see exactly what a change will cost before it costs
// anybody anything.
//
// Late fees run on a rule and a nightly sweep. The sweep here always previews
// first — the same function, with commit off — so the number on screen is the
// number that will be charged, not an estimate of it.
//
// Fines are manual, and the one question that matters is whether the fine
// raises its own slip or joins a bill the guardian is already about to pay.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Ban, CheckCircle2, Gavel, Loader2, Play, Plus,
  Power, ShieldOff, Timer,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import ModalShell from '@/components/ui/ModalShell'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { FeeScreen, StatStrip, TabBar } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import LateFeeRuleBuilder, { type ScopeOption } from '@/components/fees/charges/LateFeeRuleBuilder'
import { gradeLabel } from '@/lib/grades'
import { fetchFeeConfig, type FeeConfigBundle } from '@/lib/fees/config'
import {
  fetchUnpaidInvoices, fetchProfileList,
  type InvoiceRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  addFine, fetchFineCategories, fetchFines, fetchLateFeeCharges, fetchLateFeeRules,
  runLateFeeSweep, setLateFeeExemption, setLateFeeRuleEnabled, waiveFine, waiveLateFee,
  type FineCategoryRow, type FineRow, type LateFeeChargeRow, type LateFeeRuleRow,
  type SweepResult,
} from '@/lib/fees/charges'

type Tab = 'rules' | 'charged' | 'fines'

function ChargesInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [tab, setTab] = useState<Tab>('rules')

  const [config, setConfig] = useState<FeeConfigBundle | null>(null)
  const [rules, setRules] = useState<LateFeeRuleRow[]>([])
  const [charges, setCharges] = useState<LateFeeChargeRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [fines, setFines] = useState<FineRow[]>([])
  const [categories, setCategories] = useState<FineCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<LateFeeRuleRow | null | 'new'>(null)
  const [sweep, setSweep] = useState<SweepResult | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [fining, setFining] = useState(false)

  const showAmounts = !perms.amountsHidden
  const canManage = perms.can('fees.latefee.manage')
  const canFine = perms.can('fees.fine.apply')

  // Per tab. The rules tab needs the price list (for a rule's scope) and the
  // bills (for a realistic sample); the fines tab needs the roster, which is
  // every student in the school. Fetching all of it on mount meant opening
  // this screen to switch one rule off pulled ~930 profile rows down first.
  const fetched = useRef<Set<Tab>>(new Set())

  const load = useCallback(async (which: Tab, force = false) => {
    if (!year) return
    if (!force && fetched.current.has(which)) return
    setLoading(true)
    try {
      if (which === 'rules' || which === 'charged') {
        const [cfg, rs, inv] = await Promise.all([
          fetchFeeConfig(year.id),
          fetchLateFeeRules(year.id),
          fetchUnpaidInvoices(year.id),
        ])
        setConfig(cfg); setRules(rs); setInvoices(inv)
        if (which === 'charged') {
          const [chg, list] = await Promise.all([
            fetchLateFeeCharges(inv.map(i => i.id)),
            fetchProfileList(year.id),
          ])
          setCharges(chg); setPeople(list)
        }
      } else {
        const [fs, cats, list, inv] = await Promise.all([
          fetchFines(year.id),
          fetchFineCategories(),
          fetchProfileList(year.id),
          fetchUnpaidInvoices(year.id),
        ])
        setFines(fs); setCategories(cats); setPeople(list); setInvoices(inv)
      }
      fetched.current.add(which)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load charges.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { fetched.current = new Set() }, [year])
  useEffect(() => { void load(tab) }, [load, tab])

  /** After a write, refresh the tab that is open. */
  const reload = useCallback(() => load(tab, true), [load, tab])

  const names = useMemo(() => {
    const m = new Map<string, ProfileListRow>()
    people.forEach(p => m.set(p.student_id, p))
    return m
  }, [people])

  const byInvoice = useMemo(() => {
    const m = new Map<string, InvoiceRow>()
    invoices.forEach(i => m.set(i.id, i))
    return m
  }, [invoices])

  const scopes: ScopeOption[] = useMemo(() => {
    if (!config) return []
    const structureName = (id: string) => {
      const s = config.structures.find(x => x.id === id)
      return s ? `${s.name}${s.grade !== null ? ` · ${gradeLabel(s.grade)}` : ''}` : 'Structure'
    }
    return [
      ...config.groups.map(g => ({ id: g.id, label: g.name, kind: 'group' as const })),
      ...config.structures.map(s => ({ id: s.id, label: structureName(s.id), kind: 'structure' as const })),
      ...config.installments.map(i => ({
        id: i.id, label: `${structureName(i.structure_id)} — ${i.name}`, kind: 'installment' as const,
      })),
    ]
  }, [config])

  // A real bill, so the builder's sample is this school's own number rather
  // than a round figure that flatters the rule.
  const sampleBill = useMemo(() => {
    const nets = invoices.map(i => Number(i.net ?? 0)).filter(n => n > 0).sort((a, b) => a - b)
    if (nets.length === 0) return 10000
    return Math.round(nets[Math.floor(nets.length / 2)])
  }, [invoices])

  const runSweep = async (commit: boolean) => {
    if (!year) return
    setSweeping(true)
    setError(null)
    try {
      const result = await runLateFeeSweep(year.id, commit)
      setSweep(result)
      if (commit) await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sweep could not run.')
    } finally {
      setSweeping(false)
    }
  }

  const toggleRule = async (rule: LateFeeRuleRow) => {
    try {
      await setLateFeeRuleEnabled(rule.id, !rule.enabled)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rule.')
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!canManage && !canFine) return <NoAccess what="manage late fees or fines" />

  const liveRules = rules.filter(r => r.enabled)

  return (
    <FeeScreen
      title="Charges"
      subtitle={<>Late fees and fines · {liveRules.length} rule{liveRules.length === 1 ? '' : 's'} live</>}
      icon={<Timer size={17} style={{ color: '#B8983C' }} />}
      back={{ href: '/more/fees', label: 'Fees' }}
      actions={<YearScope />}
    >
      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'rules', label: 'Late-fee rules', icon: Timer },
          { key: 'charged', label: 'Charged', icon: AlertTriangle },
          { key: 'fines', label: 'Fines', icon: Gavel },
        ]}
      />

      {error && (
        <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>
      )}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : tab === 'rules' ? (
        <>
          <div className={`${ADMIN.card} p-4 flex flex-wrap items-start gap-3`}>
            <div className="flex-1 min-w-[240px]">
              <h2 className="text-sm font-bold text-[#18181B]">The nightly sweep</h2>
              <p className="text-xs text-[#8C8878] mt-1 leading-relaxed">
                Runs on its own every night. Preview it here first — the preview is the same
                calculation with committing switched off, so what it shows is what it will charge.
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <button onClick={() => void runSweep(false)} disabled={sweeping}
                        className={ADMIN.ghostBtn}>
                  {sweeping ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Preview
                </button>
                <button onClick={() => void runSweep(true)}
                        disabled={sweeping || !sweep || sweep.bills === 0}
                        title={!sweep ? 'Preview it first' : undefined}
                        className={ADMIN.darkBtn}>
                  Charge now
                </button>
              </div>
            )}
          </div>

          {sweep && (
            <div className={`${ADMIN.card} p-4`}>
              <div className="flex items-center gap-2">
                {sweep.committed
                  ? <CheckCircle2 size={14} className="text-[#1F6B42]" />
                  : <Play size={14} className="text-[#8C8878]" />}
                <span className="text-sm font-semibold text-[#18181B]">
                  {sweep.committed ? 'Charged' : 'Preview'} as at {fmtDate(sweep.as_of)}
                </span>
              </div>
              <div className="mt-3">
                <StatStrip stats={[
                  { label: 'Bills', value: String(sweep.bills) },
                  { label: 'Total', value: inr(sweep.total, showAmounts), tone: '#7A6220', strong: true },
                  { label: 'Exempt', value: String(sweep.exempt) },
                ]} />
              </div>
              {Object.keys(sweep.by_class ?? {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#F0ECE2]">
                  <span className={ADMIN.label}>By class</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(sweep.by_class).map(([klass, amount]) => (
                      <span key={klass}
                            className="text-[11px] px-2 py-1 bg-[#F4F1E7] border border-[#E3DFD3] text-[#52525B]">
                        {klass} · {inr(amount, showAmounts)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!sweep.committed && sweep.bills > 0 && (
                <p className="mt-3 text-[11px] text-[#7A6220]">
                  Nothing has been charged yet. Press Charge now to write these to the bills.
                </p>
              )}
            </div>
          )}

          <div className={ADMIN.card}>
            <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
              <h3 className={ADMIN.label}>Rules</h3>
              {canManage && (
                <button onClick={() => setEditing('new')} className={ADMIN.ghostBtn}>
                  <Plus size={13} /> New rule
                </button>
              )}
            </div>
            {rules.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[#8C8878]">
                No late-fee rules. Bills fall overdue but nothing is charged.
              </p>
            ) : rules.map(r => (
              <div key={r.id}
                   className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F0ECE2] last:border-0">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-semibold text-[#18181B]">{r.name}</div>
                  <p className="text-[11px] text-[#8C8878] mt-0.5">
                    {describeRule(r)}
                    {r.enabled && r.enabled_from ? ` · on since ${fmtDate(r.enabled_from)}` : ''}
                  </p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                  r.enabled
                    ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                    : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
                  {r.enabled ? 'Live' : 'Off'}
                </span>
                {canManage && (
                  <>
                    <button onClick={() => setEditing(r)} className={ADMIN.ghostBtn}>Edit</button>
                    <button onClick={() => void toggleRule(r)}
                            title={r.enabled ? 'Switch off' : 'Switch on from today'}
                            className={r.enabled ? ADMIN.ghostBtn : ADMIN.darkBtn}>
                      <Power size={13} /> {r.enabled ? 'Switch off' : 'Switch on'}
                    </button>
                  </>
                )}
              </div>
            ))}
            <p className="px-4 py-2.5 text-[11px] text-[#8C8878] border-t border-[#F0ECE2]">
              Switching a rule on always starts it from today. Days before that are never charged,
              so turning one on in October cannot back-charge a term.
            </p>
          </div>
        </>
      ) : tab === 'charged' ? (
        <ChargedList
          charges={charges} invoices={byInvoice} names={names}
          showAmounts={showAmounts} canManage={canManage}
          onChanged={reload}
        />
      ) : (
        <FinesList
          fines={fines} categories={categories} names={names}
          showAmounts={showAmounts} canFine={canFine}
          onAdd={() => setFining(true)} onChanged={reload}
        />
      )}


      {editing && year && (
        <LateFeeRuleBuilder
          yearId={year.id}
          rule={editing === 'new' ? null : editing}
          scopes={scopes}
          sampleBillRupees={sampleBill}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }}
        />
      )}

      {fining && year && (
        <AddFineSheet
          yearId={year.id}
          categories={categories}
          people={people}
          invoices={invoices}
          showAmounts={showAmounts}
          onClose={() => setFining(false)}
          onDone={() => { setFining(false); void reload() }}
        />
      )}
    </FeeScreen>
  )
}


function describeRule(r: LateFeeRuleRow): string {
  const amount = r.charge_type === 'flat' ? `₹${r.rate}` : `${r.rate}%`
  const when = r.frequency === 'once' ? 'once' : `every ${r.frequency.replace('ly', '')}`
  const cap = r.cap_amount !== null ? `, capped at ₹${r.cap_amount}`
    : r.cap_percent !== null ? `, capped at ${r.cap_percent}% of the bill` : ''
  const scope = r.scope === 'all' ? 'every bill' : `one ${r.scope}`
  return `${amount} ${when} after ${r.grace_days} grace day${r.grace_days === 1 ? '' : 's'}, on ${scope}${cap}`
}

function ChargedList({
  charges, invoices, names, showAmounts, canManage, onChanged,
}: {
  charges: LateFeeChargeRow[]
  invoices: Map<string, InvoiceRow>
  names: Map<string, ProfileListRow>
  showAmounts: boolean
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const [waiving, setWaiving] = useState<LateFeeChargeRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const live = charges.filter(c => c.status === 'charged')
  const total = live.reduce((a, c) => a + Number(c.amount ?? 0), 0)

  const exempt = async (invoiceId: string) => {
    setBusy(invoiceId)
    try {
      await setLateFeeExemption(invoiceId, true, 'Exempted from the charges screen')
      await onChanged()
    } finally { setBusy(null) }
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Late fees charged</h3>
        <span className="text-xs text-[#6B675A]">
          {live.length} charge{live.length === 1 ? '' : 's'} · {inr(total, showAmounts)}
        </span>
      </div>
      {charges.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing has been charged.</p>
      ) : charges.map(c => {
        const inv = invoices.get(c.invoice_id)
        const who = inv ? names.get(inv.student_id) : undefined
        return (
          <div key={c.id}
               className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
            <div className="flex-1 min-w-[190px]">
              <div className="text-sm text-[#18181B]">{who?.full_name ?? 'Student'}</div>
              <div className="text-[11px] text-[#8C8878] font-mono">
                {inv?.number ?? '—'} · {c.days_late} days late at {fmtDate(c.as_of)}
              </div>
            </div>
            {c.status !== 'charged' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                               bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                {c.status === 'waived' ? 'Waived' : 'Recalculated'}
              </span>
            )}
            <span className={`text-sm font-semibold w-24 text-right ${
              c.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
              {inr(c.amount, showAmounts)}
            </span>
            {canManage && c.status === 'charged' && (
              <>
                <button onClick={() => setWaiving(c)} className={ADMIN.ghostBtn}>Waive</button>
                <button onClick={() => void exempt(c.invoice_id)} disabled={busy === c.invoice_id}
                        title="Never charge this bill a late fee again"
                        className={ADMIN.ghostBtn}>
                  <ShieldOff size={13} /> Exempt bill
                </button>
              </>
            )}
          </div>
        )
      })}

      {waiving && (
        <ReasonDialog
          title="Waive this late fee"
          verb="Waive"
          body={`${inr(waiving.amount, showAmounts)} charged on ${fmtDate(waiving.as_of)}. Waiving credits it back to the bill; the charge itself stays on record.`}
          onClose={() => setWaiving(null)}
          onSubmit={async reason => {
            await waiveLateFee(waiving.id, reason)
            setWaiving(null)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

// ── Fines ─────────────────────────────────────────────────────────────────
function FinesList({
  fines, categories, names, showAmounts, canFine, onAdd, onChanged,
}: {
  fines: FineRow[]
  categories: FineCategoryRow[]
  names: Map<string, ProfileListRow>
  showAmounts: boolean
  canFine: boolean
  onAdd: () => void
  onChanged: () => Promise<void> | void
}) {
  const [waiving, setWaiving] = useState<FineRow | null>(null)
  const cat = (id: string | null) => categories.find(c => c.id === id)?.name ?? 'Fine'

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Fines</h3>
        {canFine && (
          <button onClick={onAdd} className={ADMIN.ghostBtn}><Plus size={13} /> Add a fine</button>
        )}
      </div>
      {fines.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">No fines this session.</p>
      ) : fines.map(f => (
        <div key={f.id}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
          <div className="flex-1 min-w-[190px]">
            <div className="text-sm text-[#18181B]">{names.get(f.student_id)?.full_name ?? 'Student'}</div>
            <div className="text-[11px] text-[#8C8878]">
              {cat(f.category_id)}{f.reason ? ` · ${f.reason}` : ''}
            </div>
          </div>
          {f.status === 'waived' && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                             bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
              Waived {f.waived_amount ? inr(f.waived_amount, showAmounts) : ''}
            </span>
          )}
          <span className={`text-sm font-semibold w-24 text-right ${
            f.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
            {inr(f.amount, showAmounts)}
          </span>
          {canFine && f.status === 'applied' && (
            <button onClick={() => setWaiving(f)} className={ADMIN.ghostBtn}>
              <Ban size={13} /> Waive
            </button>
          )}
        </div>
      ))}

      {waiving && (
        <ReasonDialog
          title="Waive this fine"
          verb="Waive"
          body={`${inr(waiving.amount, showAmounts)} against ${names.get(waiving.student_id)?.full_name ?? 'this student'}.`}
          onClose={() => setWaiving(null)}
          onSubmit={async reason => {
            await waiveFine(waiving.id, reason)
            setWaiving(null)
            await onChanged()
          }}
        />
      )}
    </div>
  )
}

// ── Add a fine ────────────────────────────────────────────────────────────
function AddFineSheet({
  yearId, categories, people, invoices, showAmounts, onClose, onDone,
}: {
  yearId: string
  categories: FineCategoryRow[]
  people: ProfileListRow[]
  invoices: InvoiceRow[]
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [query, setQuery] = useState('')
  const [student, setStudent] = useState<ProfileListRow | null>(null)
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '')
  const [amount, setAmount] = useState<number>(Number(categories[0]?.default_amount ?? 0))
  const [reason, setReason] = useState('')
  const [attachTo, setAttachTo] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter(p => p.full_name.toLowerCase().includes(q) ||
      (p.admission_no ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [people, query])

  // Only bills this student still owes on can absorb a fine — adding one to a
  // settled bill would reopen a receipt the family already has.
  const openBills = useMemo(
    () => (student ? invoices.filter(i => i.student_id === student.student_id && (i.balance ?? 0) > 0) : []),
    [invoices, student])

  const submit = async () => {
    if (!student || !amount) return
    setBusy(true)
    setError(null)
    try {
      await addFine({
        student_id: student.student_id,
        academic_year_id: yearId,
        amount,
        category_id: categoryId || null,
        reason: reason.trim() || undefined,
        invoice_id: attachTo || null,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the fine.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="md" title="Add a fine"
      icon={<Gavel size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !student || !amount}
                  className={`${ADMIN.darkBtn} px-4`}>
            {busy && <Loader2 size={13} className="animate-spin" />} Add fine
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className={ADMIN.label}>Student</span>
          {student ? (
            <div className="mt-1 flex items-center justify-between gap-2 bg-[#FAF8F2] border border-[#E3DFD3] px-3 py-2">
              <span className="text-sm text-[#18181B]">
                {student.full_name}
                <span className="text-[#8C8878]"> · {gradeLabel(student.grade)}{student.section ?? ''}</span>
              </span>
              <button onClick={() => { setStudent(null); setAttachTo('') }}
                      className="text-xs text-[#6B675A] hover:text-[#18181B]">Change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)}
                     placeholder="Type a name or admission number"
                     className={`${ADMIN.inputPlain} mt-1`} autoFocus />
              {matches.length > 0 && (
                <div className="mt-1 border border-[#E3DFD3] divide-y divide-[#F0ECE2]">
                  {matches.map(p => (
                    <button key={p.student_id} onClick={() => { setStudent(p); setQuery('') }}
                            className="w-full text-left px-3 py-2 text-sm text-[#18181B] hover:bg-[#FAF8F2]">
                      {p.full_name}
                      <span className="text-[#8C8878]"> · {gradeLabel(p.grade)}{p.section ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>What for</span>
            <select value={categoryId}
                    onChange={e => {
                      setCategoryId(e.target.value)
                      const c = categories.find(x => x.id === e.target.value)
                      if (c && Number(c.default_amount) > 0) setAmount(Number(c.default_amount))
                    }}
                    className={`${ADMIN.inputPlain} mt-1`}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={ADMIN.label}>Amount ₹</span>
            <input type="number" min={1} value={amount}
                   onChange={e => setAmount(Number(e.target.value))}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>

        <label className="block">
          <span className={ADMIN.label}>Note</span>
          <input value={reason} onChange={e => setReason(e.target.value)}
                 placeholder="Library book returned three weeks late"
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>

        <div>
          <span className={ADMIN.label}>Bill it how</span>
          <div className="mt-1 space-y-1.5">
            <label className="flex items-start gap-2 p-2.5 border border-[#E3DFD3] cursor-pointer hover:bg-[#FAF8F2]">
              <input type="radio" checked={attachTo === ''} onChange={() => setAttachTo('')}
                     className="mt-0.5" />
              <span className="text-xs text-[#18181B]">
                Its own slip
                <span className="block text-[11px] text-[#8C8878] mt-0.5">
                  A separate bill the family can pay on its own.
                </span>
              </span>
            </label>
            {openBills.map(i => (
              <label key={i.id}
                     className="flex items-start gap-2 p-2.5 border border-[#E3DFD3] cursor-pointer hover:bg-[#FAF8F2]">
                <input type="radio" checked={attachTo === i.id} onChange={() => setAttachTo(i.id)}
                       className="mt-0.5" />
                <span className="text-xs text-[#18181B]">
                  Add to {i.number}
                  <span className="block text-[11px] text-[#8C8878] mt-0.5">
                    Due {fmtDate(i.due_date)} · {inr(i.balance, showAmounts)} still owing. The family
                    pays it with the fees they were already about to pay.
                  </span>
                </span>
              </label>
            ))}
            {student && openBills.length === 0 && (
              <p className="text-[11px] text-[#8C8878]">
                Nothing outstanding to add it to, so this fine will raise its own slip.
              </p>
            )}
          </div>
        </div>

        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>}
      </div>
    </ModalShell>
  )
}

// ── A reason, required ────────────────────────────────────────────────────
function ReasonDialog({
  title, verb, body, onClose, onSubmit,
}: {
  title: string
  verb: string
  body: string
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title={title}
                icon={<Ban size={15} />} iconClassName="bg-[#FCECEC] text-[#A93232]">
      <p className="text-sm text-[#6B675A] leading-relaxed">{body}</p>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Why — this goes on the audit trail."
                className={`${ADMIN.inputPlain} mt-3 resize-none`} autoFocus />
      {error && <p className="mt-2 text-xs text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            if (!reason.trim()) { setError('A reason is required.'); return }
            setBusy(true)
            setError(null)
            try { await onSubmit(reason.trim()) }
            catch (e) { setError(e instanceof Error ? e.message : 'That did not go through.') }
            finally { setBusy(false) }
          }}
          disabled={busy}
          className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} {verb}
        </button>
      </div>
    </ModalShell>
  )
}

export default function ChargesPage() {
  return (
    <ProtectedLayout>
      <AcademicYearProvider>
        <ChargesInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
