// ─────────────────────────────────────────────────────────────────────────────
// The fee grid, client side.
//
// Terms, heads (term-wise or monthly, optionally split by gender), groups that
// carve sections out of a grade, the rates that fill the grid, "other" fees and
// fines for hand-picked students, and the issues that turn a slice of all that
// into bills. See supabase-migrations/fee_v2_grid.sql for the rules the
// database enforces — locking, undo, and what counts as money held.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'
import { inChunks } from './chunk'
import { GRADE_OPTIONS, gradeLabel } from '@/lib/grades'

export type Frequency = 'term' | 'monthly'
export type Gender = 'any' | 'male' | 'female'

export interface TermRow {
  id: string; academic_year_id: string; name: string; seq: number; due_date: string
}

export interface HeadRow {
  id: string; academic_year_id: string; name: string; code: string
  frequency: Frequency; gender_split: boolean; sort: number; active: boolean
  description: string | null
}

export interface GroupRow {
  id: string; academic_year_id: string; grade: number; name: string
  sections: string[]; sort: number
}

export interface RateRow {
  id: string; grade: number | null; group_id: string | null; head_id: string
  term_id: string | null; gender: Gender; amount: number
}

export interface ChargeRow {
  id: string; academic_year_id: string; kind: 'other' | 'fine'; title: string
  description: string | null; amount: number; due_date: string
  fine_category_id: string | null; filters: ChargeFilters; created_at: string
  students: { student_id: string; grade: number | null; section: string | null }[]
}

export interface ChargeFilters {
  grades?: (number | null)[]
  sections?: string[]
  gender?: 'male' | 'female' | null
  /** Ids picked one by one, as opposed to by filter. */
  picked?: string[]
}

export interface IssueRow {
  id: string; kind: 'grid' | 'charge'; charge_id: string | null
  term_id: string | null; bill_month: string | null; due_date: string
  title: string; status: 'issued' | 'undone'; student_count: number
  invoice_count: number; total: number; issued_at: string
  undone_at: string | null; undo_reason: string | null
  filters: { head_ids?: string[] | null; rows?: { grade: number | null; group_id: string | null }[] | null }
}

export interface IssueCellRow {
  issue_id: string; grade: number | null; group_id: string | null; head_id: string
  term_id: string | null; bill_month: string | null
}

export interface FineCategory { id: string; name: string; default_amount: number }

export interface GridBundle {
  terms: TermRow[]
  heads: HeadRow[]
  groups: GroupRow[]
  rates: RateRow[]
  charges: ChargeRow[]
  issues: IssueRow[]
  /** Active (locked) cells only. */
  cells: IssueCellRow[]
  fineCategories: FineCategory[]
}

export interface StudentLite {
  id: string; full_name: string; grade: number | null; section: string | null
  gender: 'male' | 'female' | null; admission_no: string | null
}

/** A grid row: a grade's own row, a group inside it, or the "No particular grade" row. */
export interface GridRowKey { grade: number | null; group_id: string | null }

export const NO_GRADE_LABEL = 'No particular grade'

export function rowLabel(row: GridRowKey, groups: GroupRow[]): string {
  if (row.grade === null) return NO_GRADE_LABEL
  if (!row.group_id) return gradeLabel(row.grade)
  const g = groups.find(x => x.id === row.group_id)
  return `${gradeLabel(row.grade)} · ${g?.name ?? 'Group'}`
}

export function rowId(row: GridRowKey): string {
  return `${row.grade ?? 'none'}/${row.group_id ?? 'base'}`
}

/** Every row of the grid in display order: each grade, its groups under it, then no-grade. */
export function gridRows(groups: GroupRow[]): GridRowKey[] {
  const out: GridRowKey[] = []
  for (const g of GRADE_OPTIONS) {
    out.push({ grade: g.value, group_id: null })
    for (const grp of groups.filter(x => x.grade === g.value).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) {
      out.push({ grade: g.value, group_id: grp.id })
    }
  }
  out.push({ grade: null, group_id: null })
  return out
}

export function normGender(raw: string | null | undefined): 'male' | 'female' | null {
  const s = (raw ?? '').trim().toLowerCase()
  if (['m', 'male', 'boy', 'b'].includes(s)) return 'male'
  if (['f', 'female', 'girl', 'g'].includes(s)) return 'female'
  return null
}

/** The months a session spans, as first-of-month ISO dates. */
export function sessionMonths(startsOn: string, endsOn: string): string[] {
  const [sy, sm] = startsOn.split('-').map(Number)
  const [ey, em] = endsOn.split('-').map(Number)
  const out: string[] = []
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
    if (out.length > 24) break
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthLabel(iso: string, withYear = true): string {
  const [y, m] = iso.split('-').map(Number)
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1]
}

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message ?? 'Something went wrong')
}

// ── Reads ───────────────────────────────────────────────────────────────
export async function fetchGrid(yearId: string): Promise<GridBundle> {
  const [terms, heads, groups, rates, charges, chargeStudents, issues, cells, fines] = await Promise.all([
    supabase.from('fee_terms').select('id, academic_year_id, name, seq, due_date')
      .eq('academic_year_id', yearId).order('seq'),
    supabase.from('fee_heads').select('id, academic_year_id, name, code, frequency, gender_split, sort, active, description')
      .eq('academic_year_id', yearId).order('sort').order('name'),
    supabase.from('fee_grade_groups').select('id, academic_year_id, grade, name, sections, sort')
      .eq('academic_year_id', yearId).order('grade').order('sort'),
    supabase.from('fee_rates').select('id, grade, group_id, head_id, term_id, gender, amount')
      .eq('academic_year_id', yearId),
    supabase.from('fee_other_charges')
      .select('id, academic_year_id, kind, title, description, amount, due_date, fine_category_id, filters, created_at')
      .eq('academic_year_id', yearId).order('created_at'),
    supabase.from('fee_other_charge_students')
      .select('charge_id, student_id, grade, section, fee_other_charges!inner(academic_year_id)')
      .eq('fee_other_charges.academic_year_id', yearId),
    supabase.from('fee_issues')
      .select('id, kind, charge_id, term_id, bill_month, due_date, title, status, student_count, invoice_count, total, issued_at, undone_at, undo_reason, filters')
      .eq('academic_year_id', yearId).order('issued_at', { ascending: false }),
    supabase.from('fee_issue_cells').select('issue_id, grade, group_id, head_id, term_id, bill_month')
      .eq('academic_year_id', yearId).eq('active', true),
    supabase.from('fee_fine_categories').select('id, name, default_amount').eq('active', true).order('sort'),
  ])

  for (const r of [terms, heads, groups, rates, charges, chargeStudents, issues, cells]) {
    if (r.error && !isMissingRelation(r.error)) fail(r.error)
  }

  const byCharge = new Map<string, ChargeRow['students']>()
  for (const s of (chargeStudents.data ?? []) as unknown as
    { charge_id: string; student_id: string; grade: number | null; section: string | null }[]) {
    const list = byCharge.get(s.charge_id) ?? []
    list.push({ student_id: s.student_id, grade: s.grade, section: s.section })
    byCharge.set(s.charge_id, list)
  }

  return {
    terms: (terms.data ?? []) as TermRow[],
    heads: (heads.data ?? []) as HeadRow[],
    groups: (groups.data ?? []) as GroupRow[],
    rates: ((rates.data ?? []) as RateRow[]).map(r => ({ ...r, amount: Number(r.amount) })),
    charges: ((charges.data ?? []) as Omit<ChargeRow, 'students'>[]).map(c => ({
      ...c, amount: Number(c.amount), filters: (c.filters ?? {}) as ChargeFilters,
      students: byCharge.get(c.id) ?? [],
    })),
    issues: ((issues.data ?? []) as IssueRow[]).map(i => ({ ...i, total: Number(i.total) })),
    cells: (cells.data ?? []) as IssueCellRow[],
    fineCategories: ((fines.data ?? []) as FineCategory[]).map(f => ({ ...f, default_amount: Number(f.default_amount) })),
  }
}

let studentCache: Promise<StudentLite[]> | null = null

/** Every enrolled student with grade, section and gender — for the pickers. */
export function fetchStudents(force = false): Promise<StudentLite[]> {
  if (studentCache && !force) return studentCache
  studentCache = (async () => {
    const { data, error } = await supabase.from('profiles')
      .select('id, full_name, grade, section')
      .eq('role', 'student').eq('is_banned', false)
      .order('grade').order('section').order('full_name')
    if (error) fail(error)
    const rows = (data ?? []) as { id: string; full_name: string; grade: number | null; section: string | null }[]
    type D = { student_id: string; gender: string | null; admission_no: string | null }
    const details = await inChunks(rows.map(r => r.id), async batch => {
      const { data: d, error: e } = await supabase.from('student_details')
        .select('student_id, gender, admission_no').in('student_id', batch)
      if (e) { if (isMissingRelation(e)) return [] as D[]; throw e }
      return (d ?? []) as D[]
    })
    const byId = new Map(details.map(d => [d.student_id, d]))
    return rows.map(r => ({
      id: r.id, full_name: r.full_name, grade: r.grade, section: r.section,
      gender: normGender(byId.get(r.id)?.gender), admission_no: byId.get(r.id)?.admission_no ?? null,
    }))
  })()
  studentCache.catch(() => { studentCache = null })
  return studentCache
}

// ── Terms ───────────────────────────────────────────────────────────────
export async function saveTerm(yearId: string, t: { id?: string; name: string; seq: number; due_date: string }) {
  const row = { academic_year_id: yearId, name: t.name.trim(), seq: t.seq, due_date: t.due_date }
  const { error } = t.id
    ? await supabase.from('fee_terms').update(row).eq('id', t.id)
    : await supabase.from('fee_terms').insert(row)
  if (error) fail(error)
}

export async function deleteTerm(id: string) {
  const { error } = await supabase.from('fee_terms').delete().eq('id', id)
  if (error) fail(error)
}

// ── Heads ───────────────────────────────────────────────────────────────
function codeFor(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'HEAD'
}

export async function saveHead(yearId: string, h: {
  id?: string; name: string; frequency: Frequency; gender_split: boolean; sort?: number
}) {
  const base = { name: h.name.trim(), frequency: h.frequency, gender_split: h.gender_split }
  if (h.id) {
    const { error } = await supabase.from('fee_heads').update(base).eq('id', h.id)
    if (error) fail(error)
    return
  }
  const { error } = await supabase.from('fee_heads').insert({
    ...base, academic_year_id: yearId, code: `${codeFor(h.name)}_${Date.now().toString(36).toUpperCase()}`,
    sort: h.sort ?? 0, active: true, default_amount: 0,
  })
  if (error) fail(error)
}

export async function deleteHead(id: string) {
  const { error } = await supabase.from('fee_heads').delete().eq('id', id)
  if (error) {
    if (/foreign key|violates/i.test(error.message)) {
      throw new Error('This head is printed on bills already issued. Undo those issues first, or leave it in place.')
    }
    fail(error)
  }
}

// ── Groups ──────────────────────────────────────────────────────────────
export async function saveGroup(yearId: string, g: { id?: string; grade: number; name: string; sections: string[]; sort?: number }) {
  const row = { academic_year_id: yearId, grade: g.grade, name: g.name.trim(), sections: g.sections, sort: g.sort ?? 0 }
  const { error } = g.id
    ? await supabase.from('fee_grade_groups').update(row).eq('id', g.id)
    : await supabase.from('fee_grade_groups').insert(row)
  if (error) fail(error)
}

export async function deleteGroup(id: string) {
  const { error } = await supabase.from('fee_grade_groups').delete().eq('id', id)
  if (error) fail(error)
}

// ── Rates ───────────────────────────────────────────────────────────────
export interface RateEdit extends GridRowKey {
  head_id: string; term_id: string | null; gender: Gender; amount: number | null
}

export async function setRates(yearId: string, edits: RateEdit[]) {
  if (edits.length === 0) return
  const { error } = await supabase.rpc('fee_set_rates', {
    p_year: yearId,
    p_cells: edits.map(e => ({
      grade: e.grade, group_id: e.group_id, head_id: e.head_id, term_id: e.term_id,
      gender: e.gender, amount: e.amount === null ? null : e.amount,
    })),
  })
  if (error) fail(error)
}

// ── Issuing ─────────────────────────────────────────────────────────────
export interface IssueRequest {
  term_id?: string | null
  month?: string | null
  due_date?: string | null
  head_ids?: string[] | null
  rows?: GridRowKey[] | null
}

export interface IssueSummary {
  committed: boolean; issue_id?: string; title: string; due_date: string
  cells: number; already_issued_cells: number; students: number; invoices: number
  total: number; no_gender: number
  by_row: { grade: number | null; group_id: string | null; students: number; total: number }[]
}

export async function issueGrid(yearId: string, req: IssueRequest, commit: boolean): Promise<IssueSummary> {
  const { data, error } = await supabase.rpc('fee_issue_grid', {
    p_year: yearId,
    p_term: req.term_id ?? null,
    p_month: req.month ?? null,
    p_due: req.due_date || null,
    p_head_ids: req.head_ids && req.head_ids.length ? req.head_ids : null,
    p_rows: req.rows && req.rows.length ? req.rows : null,
    p_commit: commit,
  })
  if (error) fail(error)
  const s = data as IssueSummary
  return { ...s, total: Number(s.total) }
}

export interface Blocker {
  payment_id: string; student_id: string; student_name: string; receipt_no: string | null
  status: string; allocated: number; refunded: number
}

export async function issueBlockers(issueId: string): Promise<Blocker[]> {
  const { data, error } = await supabase.rpc('fee_issue_blockers', { p_issue: issueId })
  if (error) fail(error)
  return ((data ?? []) as Blocker[]).map(b => ({ ...b, allocated: Number(b.allocated), refunded: Number(b.refunded) }))
}

export async function undoIssue(issueId: string, reason: string) {
  const { error } = await supabase.rpc('fee_undo_issue', { p_issue: issueId, p_reason: reason })
  if (error) fail(error)
}

// ── Other fees and fines ────────────────────────────────────────────────
export interface ChargeInput {
  id?: string
  kind: 'other' | 'fine'
  title: string
  description?: string
  amount: number
  due_date: string
  student_ids: string[]
  filters: ChargeFilters
  fine_category_id?: string | null
  issue: boolean
}

export async function saveCharge(yearId: string, c: ChargeInput): Promise<string> {
  const { data, error } = await supabase.rpc('fee_save_charge', {
    p_year: yearId, p_kind: c.kind, p_title: c.title, p_amount: c.amount, p_due: c.due_date,
    p_student_ids: c.student_ids, p_filters: c.filters, p_description: c.description ?? null,
    p_category: c.fine_category_id ?? null, p_id: c.id ?? null, p_issue: c.issue,
  })
  if (error) fail(error)
  return (data as { id: string }).id
}

export async function issueCharge(chargeId: string) {
  const { error } = await supabase.rpc('fee_issue_charge', { p_charge: chargeId, p_commit: true })
  if (error) fail(error)
}

export async function deleteCharge(chargeId: string) {
  const { error } = await supabase.rpc('fee_delete_charge', { p_id: chargeId })
  if (error) fail(error)
}

// ── Clone ───────────────────────────────────────────────────────────────
export async function cloneGrid(fromYear: string, toYear: string) {
  const { data, error } = await supabase.rpc('fee_clone_grid', { p_from: fromYear, p_to: toYear })
  if (error) fail(error)
  return data as { terms: number; heads: number; groups: number; rates: number }
}

// ── Lookups the grid needs ──────────────────────────────────────────────
export function rateKey(row: GridRowKey, headId: string, termId: string | null, gender: Gender): string {
  return `${rowId(row)}|${headId}|${termId ?? 'm'}|${gender}`
}

export function indexRates(rates: RateRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rates) m.set(rateKey(r, r.head_id, r.term_id, r.gender), r.amount)
  return m
}

/** Which issue locks a cell, keyed like `rateKey` without the gender. */
export function indexLocks(cells: IssueCellRow[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of cells) {
    m.set(`${rowId(c)}|${c.head_id}|${c.term_id ?? 'm'}`, c.issue_id)
  }
  return m
}

export function lockKey(row: GridRowKey, headId: string, termId: string | null): string {
  return `${rowId(row)}|${headId}|${termId ?? 'm'}`
}
