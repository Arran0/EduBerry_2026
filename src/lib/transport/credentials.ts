/**
 * Boarding credentials — RFID fobs, NFC cards, printed QR.
 *
 * The token never comes back from the server after it is issued: only a
 * SHA-256 is stored, for the same reason a password is not stored. An admin who
 * loses a QR reprints it by issuing a new credential and revoking the old one,
 * which is also what they would have to do if the card were lost — so the
 * recovery path and the loss path are the same path, and there is only one to
 * get right.
 *
 * A scan is not identification. It resolves a token to a student and then goes
 * through transport_mark_boarding like every other boarding, so a card cannot
 * do anything a tap could not. The attendant still sees the name that came
 * back, which is what catches the child carrying a friend's card.
 */

import { supabase } from '../supabase'
import type { TransportScanMethod } from './types'

export type CredentialMethod = Extract<TransportScanMethod, 'rfid' | 'nfc' | 'qr'>

export const CREDENTIAL_LABELS: Record<CredentialMethod, string> = {
  qr: 'Printed QR',
  rfid: 'RFID fob',
  nfc: 'NFC card',
}

export interface StudentCredential {
  id: string
  student_id: string
  method: CredentialMethod
  label: string | null
  active: boolean
  issued_at: string
  revoked_at: string | null
  last_used_at: string | null
  student?: { id: string; full_name: string; avatar_url: string | null; grade: string | null; section: string | null } | null
}

export async function fetchCredentials(studentId?: string): Promise<StudentCredential[]> {
  let q = supabase
    .from('transport_student_credentials')
    .select('id, student_id, method, label, active, issued_at, revoked_at, last_used_at, student:profiles!student_id(id, full_name, avatar_url, grade, section)')
    .order('issued_at', { ascending: false })
  if (studentId) q = q.eq('student_id', studentId)
  const { data, error } = await q
  if (error) { console.error('fetchCredentials failed:', error); return [] }
  return (data as unknown as StudentCredential[]) || []
}

/**
 * Mint a QR credential. The token is returned exactly once, here.
 *
 * The caller's job is to render it and hand it over; nothing keeps it.
 */
export async function issueCredential(
  studentId: string,
  method: CredentialMethod = 'qr',
  label?: string,
): Promise<{ success: boolean; id?: string; token?: string; error?: string }> {
  const { data, error } = await supabase.rpc('transport_issue_credential', {
    p_student: studentId, p_method: method, p_label: label ?? null,
  })
  if (error) { console.error('issueCredential failed:', error); return { success: false, error: error.message } }
  const res = data as { ok: boolean; id?: string; token?: string; error?: string }
  return res?.ok
    ? { success: true, id: res.id, token: res.token }
    : { success: false, error: res?.error ?? 'Could not issue the card' }
}

/** Register a fob whose number is burned into the hardware and cannot be minted. */
export async function registerCard(
  studentId: string,
  uid: string,
  method: Exclude<CredentialMethod, 'qr'> = 'rfid',
  label?: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.rpc('transport_register_card', {
    p_student: studentId, p_uid: uid, p_method: method, p_label: label ?? null,
  })
  if (error) { console.error('registerCard failed:', error); return { success: false, error: error.message } }
  const res = data as { ok: boolean; id?: string; error?: string }
  return res?.ok ? { success: true, id: res.id } : { success: false, error: res?.error ?? 'Could not register the card' }
}

/** Revoked rather than deleted: a card that boarded a child last term is history. */
export async function revokeCredential(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('transport_student_credentials')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) { console.error('revokeCredential failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export interface ScanResult {
  ok: boolean
  error?: string
  studentId?: string
  studentName?: string
  event?: 'board' | 'alight'
  state?: string
  /** The card is valid but its owner is not on this bus — the loud case. */
  wrongBus?: boolean
}

/**
 * Scan a card or QR onto a run.
 *
 * Refusals come back as `ok: false` with a sentence, never as a thrown error:
 * a reader loop that throws on an unknown card is a reader loop that stops
 * reading, and the attendant is holding a queue of children.
 */
export async function scanBoarding(
  runId: string,
  token: string,
  method: CredentialMethod = 'qr',
  stopId?: string | null,
): Promise<ScanResult> {
  const { data, error } = await supabase.rpc('transport_scan_boarding', {
    p_run: runId, p_token: token, p_method: method, p_stop: stopId ?? null,
  })
  if (error) { console.error('scanBoarding failed:', error); return { ok: false, error: error.message } }
  const res = data as {
    ok: boolean; error?: string; state?: string
    student_id?: string; student_name?: string; event?: 'board' | 'alight'; wrong_bus?: boolean
  }
  return {
    ok: !!res?.ok,
    error: res?.error,
    state: res?.state,
    studentId: res?.student_id,
    studentName: res?.student_name,
    event: res?.event,
    wrongBus: res?.wrong_bus,
  }
}

/**
 * Does this device have a camera QR decoder?
 *
 * BarcodeDetector is present on Android Chrome, which is what a school bus
 * attendant is holding. Everywhere else the scan field still works, because an
 * RFID reader is a keyboard and a QR can be typed.
 */
export function hasCameraScanner(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}
