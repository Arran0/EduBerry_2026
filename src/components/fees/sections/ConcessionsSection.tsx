'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Concessions — discounts, scholarships and waivers.
//
// Three shapes of the same thing, kept apart because the money comes from
// different places: a discount is revenue the school gives up, a scholarship is
// somebody else's money against a budget, and a waiver is a one-off decision by
// a person who has to own it.
//
// The queue matters more than the form. A clerk with `discount.apply` can ask
// for anything; whether it lands or waits is the server's decision, taken from
// the type's approval threshold — the sheet says which will happen before the
// button is pressed, so nobody promises a family something that then sits in a
// queue for a week.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Award, BadgePercent, Check, Inbox, Loader2, Plus, X,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr, FEE_ICON } from '@/components/fees/ui'
import { CELL, Row } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import ApplyConcessionSheet from '@/components/fees/concessions/ApplyConcessionSheet'
import { gradeLabel } from '@/lib/grades'
import {
  fetchUnpaidInvoices, fetchProfileList,
  type InvoiceRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  decideConcession, fetchConcessions, fetchDiscountTypes, fetchScholarships,
  removeConcession, saveDiscountType, saveScholarship,
  type ConcessionRow, type DiscountTypeRow, type ScholarshipRow,
} from '@/lib/fees/charges'

/** The two reference lists behind a concession, each opened as a popup. */
type Sheet = 'types' | 'scholarships'

/** The three lists' columns on a laptop; a phone folds each row into a card. */
const PENDING_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)_104px_212px]'
const GRANTED_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)_104px_88px]'
const TYPE_COLS = 'sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_84px_64px]'

export default function ConcessionsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [sheet, setSheet] = useState<Sheet | null>(null)

  const [types, setTypes] = useState<DiscountTypeRow[]>([])
  const [scholarships, setScholarships] = useState<ScholarshipRow[]>([])
  const [concessions, setConcessions] = useState<ConcessionRow[]>([])
  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingType, setEditingType] = useState<DiscountTypeRow | null | 'new'>(null)
  const [editingScholarship, setEditingScholarship] = useState<ScholarshipRow | null | 'new'>(null)
  const [applying, setApplying] = useState(false)
  const [removing, setRemoving] = useState<ConcessionRow | null>(null)

  const showAmounts = !perms.amountsHidden
  const canApply = perms.can('fees.discount.apply')
  const canApprove = perms.canAny('fees.discount.approve', 'fees.waiver.approve')
  const canScholarship = perms.can('fees.scholarship.manage')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [ts, ss, cs, list, inv] = await Promise.all([
        fetchDiscountTypes(year.id),
        fetchScholarships(year.id),
        fetchConcessions({ yearId: year.id }),
        fetchProfileList(year.id),
        fetchUnpaidInvoices(year.id),
      ])
      setTypes(ts); setScholarships(ss); setConcessions(cs); setPeople(list); setInvoices(inv)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load concessions.')
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

  const pending = concessions.filter(c => c.status === 'pending')
  const granted = concessions.filter(c => c.status === 'applied' || c.status === 'approved')

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
  }
  if (!canApply && !canApprove && !canScholarship) {
    return <NoAccess what="work with concessions" />
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <div className="flex-1" />
        <button onClick={() => setSheet('types')} className={ADMIN.ghostBtn}>
          <BadgePercent size={13} /> Discount types
        </button>
        {canScholarship && (
          <button onClick={() => setSheet('scholarships')} className={ADMIN.ghostBtn}>
            <Award size={13} /> Scholarships
          </button>
        )}
        {canApply && (
          <button onClick={() => setApplying(true)} className={ADMIN.darkBtn}>
            <Plus size={13} /> Apply one
          </button>
        )}
      </div>

      {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-[11px] text-[#A93232]">{error}</div>}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      ) : (
        <div className="space-y-4">
          {/* Waiting first, and only when something is: an approval queue that
              is empty is a heading over nothing, and it used to be the tab the
              screen always opened on. */}
          {pending.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Inbox size={14} className="text-[#B8983C]" />
                <h2 className="text-[12px] font-semibold text-slate-600">
                  Waiting for a decision · {pending.length}
                </h2>
              </div>
              <Queue rows={pending} names={names} types={types} scholarships={scholarships}
                     showAmounts={showAmounts} canApprove={canApprove} onDecided={load} />
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Check size={14} className="text-[#B8983C]" />
              <h2 className="text-[12px] font-semibold text-slate-600">Granted</h2>
            </div>
            <Granted rows={granted} names={names} types={types} scholarships={scholarships}
                     showAmounts={showAmounts} canRemove={canApprove}
                     onRemove={setRemoving} />
          </div>
        </div>
      )}

      {sheet && (
        <ModalShell
          onClose={() => setSheet(null)}
          sharp size="xl"
          title={sheet === 'types' ? 'Discount types' : 'Scholarships'}
          subtitle={sheet === 'types'
            ? 'What may be given, and above what amount it needs approving'
            : 'Somebody else’s money, against a budget'}
          icon={sheet === 'types' ? <BadgePercent size={15} /> : <Award size={15} />}
          iconClassName={FEE_ICON}
          bodyClassName="!px-3 sm:!px-4 !py-3"
        >
          {sheet === 'types' ? (
            <Types rows={types} showAmounts={showAmounts} canEdit={canScholarship || canApprove}
                   onEdit={setEditingType} />
          ) : (
            <Scholarships rows={scholarships} showAmounts={showAmounts} canEdit={canScholarship}
                          onEdit={setEditingScholarship} />
          )}
        </ModalShell>
      )}

      {applying && year && (
        <ApplyConcessionSheet
          yearId={year.id}
          people={people}
          invoices={invoices}
          types={types}
          scholarships={scholarships}
          showAmounts={showAmounts}
          canApprove={canApprove}
          onClose={() => setApplying(false)}
          onDone={() => { setApplying(false); void load() }}
        />
      )}

      {editingType !== null && year && (
        <TypeEditor
          yearId={year.id}
          row={editingType === 'new' ? null : editingType}
          onClose={() => setEditingType(null)}
          onSaved={() => { setEditingType(null); void load() }}
        />
      )}

      {editingScholarship !== null && year && (
        <ScholarshipEditor
          yearId={year.id}
          row={editingScholarship === 'new' ? null : editingScholarship}
          onClose={() => setEditingScholarship(null)}
          onSaved={() => { setEditingScholarship(null); void load() }}
        />
      )}

      {removing && (
        <RemoveDialog
          row={removing}
          showAmounts={showAmounts}
          onClose={() => setRemoving(null)}
          onDone={() => { setRemoving(null); void load() }}
        />
      )}
    </>
  )
}


function label(
  row: ConcessionRow, types: DiscountTypeRow[], scholarships: ScholarshipRow[],
): string {
  if (row.type_id) return types.find(t => t.id === row.type_id)?.name ?? 'Discount'
  if (row.scholarship_id) return scholarships.find(s => s.id === row.scholarship_id)?.name ?? 'Scholarship'
  return row.kind === 'waiver' ? 'Waiver' : 'Concession'
}

// ── The approval queue ────────────────────────────────────────────────────
function Queue({
  rows, names, types, scholarships, showAmounts, canApprove, onDecided,
}: {
  rows: ConcessionRow[]
  names: Map<string, ProfileListRow>
  types: DiscountTypeRow[]
  scholarships: ScholarshipRow[]
  showAmounts: boolean
  canApprove: boolean
  onDecided: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (row: ConcessionRow, approve: boolean) => {
    setBusy(row.id)
    setError(null)
    try {
      await decideConcession(row.id, approve, approve ? undefined : 'Declined from the queue')
      await onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That decision did not go through.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
        <h3 className={ADMIN.label}>Waiting for a decision</h3>
      </div>
      {error && <p className="px-4 py-2 text-[11px] text-[#A93232] bg-[#FCECEC]">{error}</p>}
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[13px] text-slate-500">
          Nothing waiting. Concessions under their type&rsquo;s threshold apply straight away and
          never reach this list.
        </p>
      ) : rows.map(r => (
        <Row key={r.id} cols={PENDING_COLS}>
          <span className={`${CELL.A1} block text-[13px] font-semibold text-slate-900 break-words`}>
            {names.get(r.student_id)?.full_name ?? 'Student'}
            <span className="font-normal text-slate-500">
              {' · '}{gradeLabel(names.get(r.student_id)?.grade ?? null)}
              {names.get(r.student_id)?.section ?? ''}
            </span>
          </span>
          <span className={`${CELL.A2} block text-[12px] text-slate-500 break-words`}>
            {label(r, types, scholarships)}
            {r.reason ? ` · ${r.reason}` : ''}
            {' · asked '}{fmtDate(r.created_at.slice(0, 10))}
          </span>
          <span className={`${CELL.B1} text-[11.5px] font-semibold text-slate-900 text-right tabular-nums`}>
            {inr(r.amount, showAmounts)}
          </span>
          {/* Approving or declining is the decision this list exists for, so on
              a phone the pair gets a line across the card. */}
          <span className={`${CELL.A3} max-sm:col-span-2 max-sm:mt-1.5 flex items-center justify-end gap-1.5`}>
            {canApprove ? (
              <>
                <button onClick={() => void decide(r, false)} disabled={busy === r.id}
                        className={ADMIN.ghostBtn}><X size={13} /> Decline</button>
                <button onClick={() => void decide(r, true)} disabled={busy === r.id}
                        className={ADMIN.darkBtn}>
                  {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Approve
                </button>
              </>
            ) : (
              <span className="text-[12px] text-slate-500">Waiting on an approver</span>
            )}
          </span>
        </Row>
      ))}
      {canApprove && rows.length > 0 && (
        <p className="px-4 py-2.5 text-[12px] text-slate-500 border-t border-[#F0ECE2]">
          You cannot approve a request you made yourself — the server refuses it, so a second
          person always signs off.
        </p>
      )}
    </div>
  )
}

// ── What has been granted ─────────────────────────────────────────────────
function Granted({
  rows, names, types, scholarships, showAmounts, canRemove, onRemove,
}: {
  rows: ConcessionRow[]
  names: Map<string, ProfileListRow>
  types: DiscountTypeRow[]
  scholarships: ScholarshipRow[]
  showAmounts: boolean
  canRemove: boolean
  onRemove: (row: ConcessionRow) => void
}) {
  const total = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0)
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Granted this session</h3>
        <span className="text-[12px] text-slate-600">
          {rows.length} · {inr(total, showAmounts)} given up
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[13px] text-slate-500">No concessions granted yet.</p>
      ) : rows.map(r => (
        <Row key={r.id} cols={GRANTED_COLS}>
          <span className={`${CELL.A1} block text-[13px] text-slate-900 break-words`}>
            {names.get(r.student_id)?.full_name ?? 'Student'}
          </span>
          <span className={`${CELL.A2} block text-[12px] text-slate-500 break-words`}>
            {label(r, types, scholarships)}
            {r.approved_at ? ` · approved ${fmtDate(r.approved_at.slice(0, 10))}` : ''}
          </span>
          <span className={`${CELL.B1} text-[11.5px] font-semibold text-slate-900 text-right tabular-nums`}>
            {inr(r.amount, showAmounts)}
          </span>
          <span className={`${CELL.B2} flex justify-end`}>
            {canRemove && (
              <button onClick={() => onRemove(r)} className={ADMIN.ghostBtn}>Remove</button>
            )}
          </span>
        </Row>
      ))}
    </div>
  )
}

// ── Discount types ────────────────────────────────────────────────────────
function Types({
  rows, showAmounts, canEdit, onEdit,
}: {
  rows: DiscountTypeRow[]
  showAmounts: boolean
  canEdit: boolean
  onEdit: (row: DiscountTypeRow | 'new') => void
}) {
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Discount types</h3>
        {canEdit && (
          <button onClick={() => onEdit('new')} className={ADMIN.ghostBtn}><Plus size={13} /> New type</button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[13px] text-slate-500">
          No discount types. Staff can still grant a one-off waiver, which always needs approval.
        </p>
      ) : rows.map(t => (
        <Row key={t.id} cols={TYPE_COLS}>
          <span className={`${CELL.A1} block text-[13px] font-semibold text-slate-900 break-words`}>
            {t.name}
          </span>
          <span className={`${CELL.A2} block text-[12px] text-slate-500`}>
            {t.mode === 'percent' ? `${t.value}% off` : `${inr(t.value, showAmounts)} off`}
            {t.scope === 'heads' ? ` · ${t.head_ids.length} head${t.head_ids.length === 1 ? '' : 's'} only` : ' · the whole bill'}
            {t.approval_threshold !== null
              ? ` · over ${inr(t.approval_threshold, showAmounts)} needs approval`
              : ' · always needs approval'}
            {t.stackable ? ' · stacks' : ''}
          </span>
          <span className={CELL.B1}>
            <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap ${
              t.active
                ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                : 'bg-[#F4F1E7] text-slate-600 border border-[#E3DFD3]'}`}>
              {t.active ? 'Active' : 'Off'}
            </span>
          </span>
          <span className={`${CELL.B2} flex justify-end`}>
            {canEdit && (
              <button onClick={() => onEdit(t)} className={ADMIN.ghostBtn}>Edit</button>
            )}
          </span>
        </Row>
      ))}
    </div>
  )
}

// ── Scholarships and their budgets ────────────────────────────────────────
function Scholarships({
  rows, showAmounts, canEdit, onEdit,
}: {
  rows: ScholarshipRow[]
  showAmounts: boolean
  canEdit: boolean
  onEdit: (row: ScholarshipRow | 'new') => void
}) {
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Scholarships</h3>
        {canEdit && (
          <button onClick={() => onEdit('new')} className={ADMIN.ghostBtn}><Plus size={13} /> New scholarship</button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[13px] text-slate-500">No scholarships this session.</p>
      ) : rows.map(s => {
        const used = Number(s.awarded ?? 0)
        const budget = s.annual_budget === null ? null : Number(s.annual_budget)
        const pct = budget && budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : null
        const over = budget !== null && used > budget
        return (
          <div key={s.id} className="px-4 py-3 border-b border-[#F0ECE2] last:border-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-[13px] font-semibold text-slate-900">{s.name}</div>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  {s.funder ?? 'Funded by the school'}
                  {s.seats !== null ? ` · ${s.recipients ?? 0} of ${s.seats} seats` : ''}
                </p>
              </div>
              <span className={`text-[13px] font-semibold w-40 text-right ${over ? 'text-[#A93232]' : 'text-slate-900'}`}>
                {inr(used, showAmounts)}
                {budget !== null && (
                  <span className="text-slate-500 font-normal"> of {inr(budget, showAmounts)}</span>
                )}
              </span>
              {canEdit && <button onClick={() => onEdit(s)} className={ADMIN.ghostBtn}>Edit</button>}
            </div>
            {pct !== null && (
              <div className="mt-2 h-1.5 bg-[#F4F1E7] overflow-hidden">
                <div className={`h-full ${over ? 'bg-[#FCECEC]0' : 'bg-[#B8983C]'}`}
                     style={{ width: `${pct}%` }} />
              </div>
            )}
            {over && (
              <p className="mt-1.5 text-[11px] text-[#A93232]">
                Awarded past the budget. Nothing stops this, but somebody has to fund it.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Editors ───────────────────────────────────────────────────────────────
function TypeEditor({
  yearId, row, onClose, onSaved,
}: {
  yearId: string
  row: DiscountTypeRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<DiscountTypeRow>>(() => row ?? {
    name: '', code: '', mode: 'percent', value: 10, scope: 'all', head_ids: [],
    stackable: false, auto_rule: 'none', approval_threshold: 5000, active: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof DiscountTypeRow>(k: K, v: DiscountTypeRow[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <ModalShell onClose={onClose} sharp size="md" title={row ? 'Edit discount type' : 'New discount type'}
                icon={<BadgePercent size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
                footer={
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
                    <button
                      onClick={async () => {
                        if (!form.name?.trim()) { setError('Give it a name.'); return }
                        setBusy(true); setError(null)
                        try {
                          await saveDiscountType({
                            ...(form as DiscountTypeRow),
                            academic_year_id: yearId,
                            name: form.name.trim(),
                            code: (form.code?.trim() || form.name.trim().toUpperCase().replace(/\s+/g, '_')).slice(0, 40),
                          })
                          onSaved()
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not save.')
                        } finally { setBusy(false) }
                      }}
                      disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
                      {busy && <Loader2 size={13} className="animate-spin" />} Save
                    </button>
                  </div>
                }>
      <div className="space-y-3">
        <label className="block">
          <span className={ADMIN.label}>Name</span>
          <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                 placeholder="Sibling discount" className={`${ADMIN.inputPlain} mt-1`} autoFocus />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={ADMIN.label}>Off by</span>
            <select value={form.mode ?? 'percent'}
                    onChange={e => set('mode', e.target.value as DiscountTypeRow['mode'])}
                    className={`${ADMIN.inputPlain} mt-1`}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed ₹</option>
            </select>
          </label>
          <label className="block">
            <span className={ADMIN.label}>{form.mode === 'fixed' ? 'Amount ₹' : 'Percent'}</span>
            <input type="number" min={0} step="0.01" value={form.value ?? 0}
                   onChange={e => set('value', Number(e.target.value))}
                   className={`${ADMIN.inputPlain} mt-1`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>Auto rule</span>
            <select value={form.auto_rule ?? 'none'}
                    onChange={e => set('auto_rule', e.target.value as DiscountTypeRow['auto_rule'])}
                    className={`${ADMIN.inputPlain} mt-1`}>
              <option value="none">Applied by hand</option>
              <option value="sibling">Siblings</option>
              <option value="staff_ward">Staff wards</option>
              <option value="early_payment">Paying early</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className={ADMIN.label}>Needs approval over ₹</span>
          <input type="number" min={0} value={form.approval_threshold ?? ''}
                 onChange={e => set('approval_threshold', e.target.value === '' ? null : Number(e.target.value))}
                 placeholder="Blank means every one needs approval"
                 className={`${ADMIN.inputPlain} mt-1`} />
          <p className="mt-1 text-[12px] text-slate-500 leading-snug">
            Below this a clerk&rsquo;s concession applies straight away. Above it, it waits in the
            queue. Set it to 0 to send everything to the queue.
          </p>
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-[11px] text-slate-900">
            <input type="checkbox" checked={form.stackable ?? false}
                   onChange={e => set('stackable', e.target.checked)} />
            Can stack with another discount
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-900">
            <input type="checkbox" checked={form.active ?? true}
                   onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-[11px] text-[#A93232]">{error}</div>}
      </div>
    </ModalShell>
  )
}

function ScholarshipEditor({
  yearId, row, onClose, onSaved,
}: {
  yearId: string
  row: ScholarshipRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<ScholarshipRow>>(() => row ?? {
    name: '', code: '', funder: '', annual_budget: null, seats: null, active: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ScholarshipRow>(k: K, v: ScholarshipRow[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <ModalShell onClose={onClose} sharp size="sm" title={row ? 'Edit scholarship' : 'New scholarship'}
                icon={<Award size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]"
                footer={
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
                    <button
                      onClick={async () => {
                        if (!form.name?.trim()) { setError('Give it a name.'); return }
                        setBusy(true); setError(null)
                        try {
                          await saveScholarship({
                            id: form.id,
                            academic_year_id: yearId,
                            name: form.name.trim(),
                            code: (form.code?.trim() || form.name.trim().toUpperCase().replace(/\s+/g, '_')).slice(0, 40),
                            funder: form.funder?.trim() || null,
                            annual_budget: form.annual_budget ?? null,
                            seats: form.seats ?? null,
                            active: form.active ?? true,
                          })
                          onSaved()
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not save.')
                        } finally { setBusy(false) }
                      }}
                      disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
                      {busy && <Loader2 size={13} className="animate-spin" />} Save
                    </button>
                  </div>
                }>
      <div className="space-y-3">
        <label className="block">
          <span className={ADMIN.label}>Name</span>
          <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                 className={`${ADMIN.inputPlain} mt-1`} autoFocus />
        </label>
        <label className="block">
          <span className={ADMIN.label}>Funded by</span>
          <input value={form.funder ?? ''} onChange={e => set('funder', e.target.value)}
                 placeholder="A trust, an alumnus, the school itself"
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={ADMIN.label}>Budget ₹ a year</span>
            <input type="number" min={0} value={form.annual_budget ?? ''}
                   onChange={e => set('annual_budget', e.target.value === '' ? null : Number(e.target.value))}
                   placeholder="No limit" className={`${ADMIN.inputPlain} mt-1`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>Seats</span>
            <input type="number" min={0} value={form.seats ?? ''}
                   onChange={e => set('seats', e.target.value === '' ? null : Number(e.target.value))}
                   placeholder="No limit" className={`${ADMIN.inputPlain} mt-1`} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-900">
          <input type="checkbox" checked={form.active ?? true}
                 onChange={e => set('active', e.target.checked)} />
          Active
        </label>
        {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-[11px] text-[#A93232]">{error}</div>}
      </div>
    </ModalShell>
  )
}

function RemoveDialog({
  row, showAmounts, onClose, onDone,
}: {
  row: ConcessionRow
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Remove this concession"
                icon={<X size={15} />} iconClassName="bg-[#FCECEC] text-[#A93232]">
      <p className="text-[13px] text-slate-600 leading-relaxed">
        {inr(row.amount, showAmounts)} comes off the discount and back onto the bill. The family
        will owe that much more, so make sure somebody has told them.
      </p>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Why — this goes on the audit trail."
                className={`${ADMIN.inputPlain} mt-3 resize-none`} autoFocus />
      {error && <p className="mt-2 text-[11px] text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-1.5 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            if (!reason.trim()) { setError('A reason is required.'); return }
            setBusy(true); setError(null)
            try { await removeConcession(row.id, reason.trim()); onDone() }
            catch (e) { setError(e instanceof Error ? e.message : 'That did not go through.') }
            finally { setBusy(false) }
          }}
          disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Remove
        </button>
      </div>
    </ModalShell>
  )
}

