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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Ban, CheckCircle2, Gavel, Loader2, Play, Plus,
  Power, ShieldOff, Timer,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import ModalShell from '@/components/ui/ModalShell'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
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

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [cfg, rs, inv, list, fs, cats] = await Promise.all([
        fetchFeeConfig(year.id),
        fetchLateFeeRules(year.id),
        fetchUnpaidInvoices(year.id),
        fetchProfileList(year.id),
        fetchFines(year.id),
        fetchFineCategories(),
      ])
      setConfig(cfg); setRules(rs); setInvoices(inv); setPeople(list)
      setFines(fs); setCategories(cats)
      setCharges(await fetchLateFeeCharges(inv.map(i => i.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load charges.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

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
      if (commit) await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sweep could not run.')
    } finally {
      setSweeping(false)
    }
  }

  const toggleRule = async (rule: LateFeeRuleRow) => {
    try {
      await setLateFeeRuleEnabled(rule.id, !rule.enabled)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rule.')
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
  }
  if (!canManage && !canFine) return <NoAccess what="manage late fees or fines" />

  const liveRules = rules.filter(r => r.enabled)

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <div className="bg-[#27272A] border-b border-[#3F3F46]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
          <Link href="/more/fees" className="text-zinc-500 hover:text-white"><ArrowLeft size={16} /></Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-white tracking-tight">Charges</h1>
            <p className="text-xs text-zinc-500">
              Late fees and fines · {liveRules.length} rule{liveRules.length === 1 ? '' : 's'} live
            </p>
          </div>
          <YearScope tone="dark" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['rules', 'Late-fee rules', Timer],
            ['charged', 'What has been charged', AlertTriangle],
            ['fines', 'Fines', Gavel],
          ] as [Tab, string, React.ElementType][]).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
                    className={tab === key ? tabOn : tabOff}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>
        )}

        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
        ) : tab === 'rules' ? (
          <>
            <div className={`${ADMIN.card} p-4 flex flex-wrap items-start gap-3`}>
              <div className="flex-1 min-w-[240px]">
                <h2 className="text-sm font-bold text-[#27272A]">The nightly sweep</h2>
                <p className="text-xs text-[#A1A1AA] mt-1 leading-relaxed">
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
                    ? <CheckCircle2 size={14} className="text-emerald-600" />
                    : <Play size={14} className="text-[#A1A1AA]" />}
                  <span className="text-sm font-semibold text-[#27272A]">
                    {sweep.committed ? 'Charged' : 'Preview'} as at {fmtDate(sweep.as_of)}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                  <Stat label="Bills" value={String(sweep.bills)} />
                  <Stat label="Total" value={inr(sweep.total, showAmounts)} tone="amber" />
                  <Stat label="Exempt" value={String(sweep.exempt)} />
                </div>
                {Object.keys(sweep.by_class ?? {}).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#F4F4F5]">
                    <span className={ADMIN.label}>By class</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {Object.entries(sweep.by_class).map(([klass, amount]) => (
                        <span key={klass}
                              className="text-[11px] px-2 py-1 bg-[#F4F4F5] border border-[#E4E4E7] text-[#52525B]">
                          {klass} · {inr(amount, showAmounts)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {!sweep.committed && sweep.bills > 0 && (
                  <p className="mt-3 text-[11px] text-[#8A6D1F]">
                    Nothing has been charged yet. Press Charge now to write these to the bills.
                  </p>
                )}
              </div>
            )}

            <div className={ADMIN.card}>
              <div className="px-4 py-2.5 border-b border-[#F4F4F5] flex items-center justify-between">
                <h3 className={ADMIN.label}>Rules</h3>
                {canManage && (
                  <button onClick={() => setEditing('new')} className={ADMIN.ghostBtn}>
                    <Plus size={13} /> New rule
                  </button>
                )}
              </div>
              {rules.length === 0 ? (
                <p className="px-4 py-8 text-sm text-[#A1A1AA]">
                  No late-fee rules. Bills fall overdue but nothing is charged.
                </p>
              ) : rules.map(r => (
                <div key={r.id}
                     className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F4F4F5] last:border-0">
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-semibold text-[#27272A]">{r.name}</div>
                    <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                      {describeRule(r)}
                      {r.enabled && r.enabled_from ? ` · on since ${fmtDate(r.enabled_from)}` : ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                    r.enabled
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'}`}>
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
              <p className="px-4 py-2.5 text-[11px] text-[#A1A1AA] border-t border-[#F4F4F5]">
                Switching a rule on always starts it from today. Days before that are never charged,
                so turning one on in October cannot back-charge a term.
              </p>
            </div>
          </>
        ) : tab === 'charged' ? (
          <ChargedList
            charges={charges} invoices={byInvoice} names={names}
            showAmounts={showAmounts} canManage={canManage}
            onChanged={load}
          />
        ) : (
          <FinesList
            fines={fines} categories={categories} names={names}
            showAmounts={showAmounts} canFine={canFine}
            onAdd={() => setFining(true)} onChanged={load}
          />
        )}
      </div>

      {editing && year && (
        <LateFeeRuleBuilder
          yearId={year.id}
          rule={editing === 'new' ? null : editing}
          scopes={scopes}
          sampleBillRupees={sampleBill}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
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
          onDone={() => { setFining(false); void load() }}
        />
      )}
    </div>
  )
}

const tabOn = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#27272A] text-white'
const tabOff = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A]'

function describeRule(r: LateFeeRuleRow): string {
  const amount = r.charge_type === 'flat' ? `₹${r.rate}` : `${r.rate}%`
  const when = r.frequency === 'once' ? 'once' : `every ${r.frequency.replace('ly', '')}`
  const cap = r.cap_amount !== null ? `, capped at ₹${r.cap_amount}`
    : r.cap_percent !== null ? `, capped at ${r.cap_percent}% of the bill` : ''
  const scope = r.scope === 'all' ? 'every bill' : `one ${r.scope}`
  return `${amount} ${when} after ${r.grace_days} grace day${r.grace_days === 1 ? '' : 's'}, on ${scope}${cap}`
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className="bg-[#FAFAFA] border border-[#E4E4E7] p-3">
      <div className={ADMIN.label}>{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tone === 'amber' ? 'text-amber-700' : 'text-[#27272A]'}`}>
        {value}
      </div>
    </div>
  )
}

// ── What has been charged ─────────────────────────────────────────────────
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
      <div className="px-4 py-2.5 border-b border-[#F4F4F5] flex items-center justify-between">
        <h3 className={ADMIN.label}>Late fees charged</h3>
        <span className="text-xs text-[#71717A]">
          {live.length} charge{live.length === 1 ? '' : 's'} · {inr(total, showAmounts)}
        </span>
      </div>
      {charges.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#A1A1AA]">Nothing has been charged.</p>
      ) : charges.map(c => {
        const inv = invoices.get(c.invoice_id)
        const who = inv ? names.get(inv.student_id) : undefined
        return (
          <div key={c.id}
               className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F4F4F5] last:border-0">
            <div className="flex-1 min-w-[190px]">
              <div className="text-sm text-[#27272A]">{who?.full_name ?? 'Student'}</div>
              <div className="text-[11px] text-[#A1A1AA] font-mono">
                {inv?.number ?? '—'} · {c.days_late} days late at {fmtDate(c.as_of)}
              </div>
            </div>
            {c.status !== 'charged' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                               bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]">
                {c.status === 'waived' ? 'Waived' : 'Recalculated'}
              </span>
            )}
            <span className={`text-sm font-semibold w-24 text-right ${
              c.status === 'waived' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
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
      <div className="px-4 py-2.5 border-b border-[#F4F4F5] flex items-center justify-between">
        <h3 className={ADMIN.label}>Fines</h3>
        {canFine && (
          <button onClick={onAdd} className={ADMIN.ghostBtn}><Plus size={13} /> Add a fine</button>
        )}
      </div>
      {fines.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#A1A1AA]">No fines this session.</p>
      ) : fines.map(f => (
        <div key={f.id}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F4F4F5] last:border-0">
          <div className="flex-1 min-w-[190px]">
            <div className="text-sm text-[#27272A]">{names.get(f.student_id)?.full_name ?? 'Student'}</div>
            <div className="text-[11px] text-[#A1A1AA]">
              {cat(f.category_id)}{f.reason ? ` · ${f.reason}` : ''}
            </div>
          </div>
          {f.status === 'waived' && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                             bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]">
              Waived {f.waived_amount ? inr(f.waived_amount, showAmounts) : ''}
            </span>
          )}
          <span className={`text-sm font-semibold w-24 text-right ${
            f.status === 'waived' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
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
      icon={<Gavel size={15} />} iconClassName="bg-[#FBF6E9] text-[#8A6D1F]"
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
            <div className="mt-1 flex items-center justify-between gap-2 bg-[#FAFAFA] border border-[#E4E4E7] px-3 py-2">
              <span className="text-sm text-[#27272A]">
                {student.full_name}
                <span className="text-[#A1A1AA]"> · {gradeLabel(student.grade)}{student.section ?? ''}</span>
              </span>
              <button onClick={() => { setStudent(null); setAttachTo('') }}
                      className="text-xs text-[#71717A] hover:text-[#27272A]">Change</button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)}
                     placeholder="Type a name or admission number"
                     className={`${ADMIN.inputPlain} mt-1`} autoFocus />
              {matches.length > 0 && (
                <div className="mt-1 border border-[#E4E4E7] divide-y divide-[#F4F4F5]">
                  {matches.map(p => (
                    <button key={p.student_id} onClick={() => { setStudent(p); setQuery('') }}
                            className="w-full text-left px-3 py-2 text-sm text-[#27272A] hover:bg-[#FAFAFA]">
                      {p.full_name}
                      <span className="text-[#A1A1AA]"> · {gradeLabel(p.grade)}{p.section ?? ''}</span>
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
            <label className="flex items-start gap-2 p-2.5 border border-[#E4E4E7] cursor-pointer hover:bg-[#FAFAFA]">
              <input type="radio" checked={attachTo === ''} onChange={() => setAttachTo('')}
                     className="mt-0.5" />
              <span className="text-xs text-[#27272A]">
                Its own slip
                <span className="block text-[11px] text-[#A1A1AA] mt-0.5">
                  A separate bill the family can pay on its own.
                </span>
              </span>
            </label>
            {openBills.map(i => (
              <label key={i.id}
                     className="flex items-start gap-2 p-2.5 border border-[#E4E4E7] cursor-pointer hover:bg-[#FAFAFA]">
                <input type="radio" checked={attachTo === i.id} onChange={() => setAttachTo(i.id)}
                       className="mt-0.5" />
                <span className="text-xs text-[#27272A]">
                  Add to {i.number}
                  <span className="block text-[11px] text-[#A1A1AA] mt-0.5">
                    Due {fmtDate(i.due_date)} · {inr(i.balance, showAmounts)} still owing. The family
                    pays it with the fees they were already about to pay.
                  </span>
                </span>
              </label>
            ))}
            {student && openBills.length === 0 && (
              <p className="text-[11px] text-[#A1A1AA]">
                Nothing outstanding to add it to, so this fine will raise its own slip.
              </p>
            )}
          </div>
        </div>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>}
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
                icon={<Ban size={15} />} iconClassName="bg-rose-50 text-rose-600">
      <p className="text-sm text-[#71717A] leading-relaxed">{body}</p>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Why — this goes on the audit trail."
                className={`${ADMIN.inputPlain} mt-3 resize-none`} autoFocus />
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
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
