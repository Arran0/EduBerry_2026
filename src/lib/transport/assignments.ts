/**
 * Student -> route and stop assignments.
 *
 * `transport_student_assignments` is the renamed `trip_passengers`, so
 * `fee_amount` and the old free-text `location` label (now `location_label`)
 * carry over and the bus-fee draft importer keeps working.
 */

import { supabase } from '../supabase'
import type { AssignmentInput, TransportAssignment } from './types'

const STUDENT_COLS = 'id, full_name, avatar_url, grade, section'
const STOP_COLS = 'id, name, seq'

const ASSIGNMENT_SELECT = `*,
  student:profiles!student_id(${STUDENT_COLS}),
  pickup_stop:transport_route_stops!pickup_stop_id(${STOP_COLS}),
  drop_stop:transport_route_stops!drop_stop_id(${STOP_COLS})`

export async function fetchAssignments(routeId: string): Promise<TransportAssignment[]> {
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .select(ASSIGNMENT_SELECT)
    .eq('route_id', routeId)
    .is('ended_on', null)
  if (error) { console.error('fetchAssignments failed:', error); return [] }
  const rows = (data as unknown as TransportAssignment[]) || []
  return rows.sort((a, b) => {
    // Group by pickup stop so the list reads the way the bus drives it.
    const sa = a.pickup_stop?.seq ?? Number.MAX_SAFE_INTEGER
    const sb = b.pickup_stop?.seq ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? '')
  })
}

/** The active assignment for one student, if they ride at all. */
export async function fetchAssignmentForStudent(studentId: string): Promise<TransportAssignment | null> {
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .select(ASSIGNMENT_SELECT)
    .eq('student_id', studentId)
    .is('ended_on', null)
    .maybeSingle()
  if (error) { console.error('fetchAssignmentForStudent failed:', error); return null }
  return (data as unknown as TransportAssignment) ?? null
}

export async function createAssignment(
  input: AssignmentInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .insert(input)
    .select('id')
    .single()
  if (error) {
    console.error('createAssignment failed:', error)
    if (error.code === '23505') {
      return { success: false, error: 'That student is already assigned to this route.' }
    }
    return { success: false, error: error.message }
  }
  return { success: true, id: data.id }
}

export async function updateAssignment(
  assignmentId: string,
  input: Partial<AssignmentInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_student_assignments')
    .update(input)
    .eq('id', assignmentId)
  if (error) { console.error('updateAssignment failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * End an assignment rather than deleting it.
 *
 * A deleted row takes its billing history's context with it, and from Round 2
 * it would also orphan the boarding records that reference it. `ended_on`
 * keeps the past readable while dropping the student off tomorrow's roster.
 */
export async function endAssignment(
  assignmentId: string,
  endedOn = new Date().toLocaleDateString('en-CA'),
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_student_assignments')
    .update({ ended_on: endedOn })
    .eq('id', assignmentId)
  if (error) { console.error('endAssignment failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Assign several students to one route and stop pair in a single insert. */
export async function assignStudents(
  routeId: string,
  studentIds: string[],
  stops: { pickupStopId?: string | null; dropStopId?: string | null } = {},
): Promise<{ success: boolean; added: number; error?: string }> {
  if (studentIds.length === 0) return { success: true, added: 0 }
  const rows = studentIds.map(student_id => ({
    route_id: routeId,
    student_id,
    pickup_stop_id: stops.pickupStopId ?? null,
    drop_stop_id: stops.dropStopId ?? null,
  }))
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .upsert(rows, { onConflict: 'route_id,student_id', ignoreDuplicates: true })
    .select('id')
  if (error) { console.error('assignStudents failed:', error); return { success: false, added: 0, error: error.message } }
  return { success: true, added: data?.length ?? 0 }
}

/**
 * Students who can be put on a route.
 *
 * Only actual students: the old `fetchAssignablePassengers` returned every
 * profile that was not an admin or driver, so teachers, coordinators,
 * principals and smartboard kiosks all showed up in the picker.
 */
export async function fetchAssignableStudents(search = '') {
  let q = supabase
    .from('profiles')
    .select(STUDENT_COLS)
    .eq('role', 'student')
    .neq('is_banned', true)
    .order('full_name', { ascending: true })
    .limit(50)
  if (search.trim()) q = q.ilike('full_name', `%${search.trim()}%`)
  const { data, error } = await q
  if (error) { console.error('fetchAssignableStudents failed:', error); return [] }
  return data || []
}

/** Route ids each of the given students is already assigned to. */
export async function fetchAssignedRouteByStudent(
  studentIds: string[],
): Promise<Record<string, string>> {
  if (studentIds.length === 0) return {}
  const { data, error } = await supabase
    .from('transport_student_assignments')
    .select('student_id, route_id')
    .in('student_id', studentIds)
    .is('ended_on', null)
  if (error) { console.error('fetchAssignedRouteByStudent failed:', error); return {} }
  const out: Record<string, string> = {}
  for (const r of (data || []) as { student_id: string; route_id: string }[]) out[r.student_id] = r.route_id
  return out
}

/** How many riders each stop is expected to serve, keyed by stop id. */
export function countByStop(assignments: TransportAssignment[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of assignments) {
    if (a.pickup_stop_id) out[a.pickup_stop_id] = (out[a.pickup_stop_id] ?? 0) + 1
  }
  return out
}
