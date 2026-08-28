/**
 * Transport module types.
 *
 * These mirror the tables created by
 * `supabase-migrations/transport_r1_foundation.sql`. Field names match the
 * database columns exactly — the data-layer modules in this folder do no
 * renaming, so a row you read here is the row that is stored.
 */

import type { UserProfile } from '../supabase'

/**
 * Named by destination, not by "pickup"/"drop", because a single stop is a
 * pickup in the morning and a drop in the afternoon. `inbound` = towards
 * school.
 */
export type TransportDirection = 'inbound' | 'outbound'

export type TransportVehicleStatus = 'active' | 'maintenance' | 'retired'
export type TransportStopKind = 'stop' | 'school' | 'depot'
export type TransportStaffKind = 'driver' | 'attendant'

export const DIRECTION_LABELS: Record<TransportDirection, string> = {
  inbound: 'To school',
  outbound: 'From school',
}

export const VEHICLE_STATUS_LABELS: Record<TransportVehicleStatus, string> = {
  active: 'Active',
  maintenance: 'In maintenance',
  retired: 'Retired',
}

export const STAFF_KIND_LABELS: Record<TransportStaffKind, string> = {
  driver: 'Driver',
  attendant: 'Attendant',
}

/** ISO-ish weekday numbering as Postgres `EXTRACT(DOW)` returns it: 0 = Sunday. */
export const WEEKDAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 0, short: 'Sun', label: 'Sunday' },
]

export interface LatLng {
  lat: number
  lng: number
}

// ── Vehicles ────────────────────────────────────────────────────────────────

export interface TransportVehicle {
  id: string
  registration_no: string
  display_name: string | null
  make_model: string | null
  capacity: number
  fuel_type: string | null
  status: TransportVehicleStatus
  insurance_expiry: string | null
  fitness_expiry: string | null
  permit_expiry: string | null
  puc_expiry: string | null
  photo_url: string | null
  notes: string | null
  settings: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface VehicleInput {
  registration_no: string
  display_name?: string | null
  make_model?: string | null
  capacity?: number
  fuel_type?: string | null
  status?: TransportVehicleStatus
  insurance_expiry?: string | null
  fitness_expiry?: string | null
  permit_expiry?: string | null
  puc_expiry?: string | null
  notes?: string | null
}

/** The four documents Indian school transport is audited on. */
export const VEHICLE_COMPLIANCE_FIELDS: {
  key: keyof Pick<TransportVehicle, 'insurance_expiry' | 'fitness_expiry' | 'permit_expiry' | 'puc_expiry'>
  label: string
}[] = [
  { key: 'insurance_expiry', label: 'Insurance' },
  { key: 'fitness_expiry', label: 'Fitness' },
  { key: 'permit_expiry', label: 'Permit' },
  { key: 'puc_expiry', label: 'PUC' },
]

// ── Crew ────────────────────────────────────────────────────────────────────

export interface TransportStaff {
  id: string
  profile_id: string
  kind: TransportStaffKind
  employee_code: string | null
  phone: string | null
  licence_no: string | null
  licence_expiry: string | null
  badge_no: string | null
  blood_group: string | null
  photo_url: string | null
  address: string | null
  emergency_contact: string | null
  verified_at: string | null
  active: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  profile?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url' | 'role'> | null
}

export interface StaffInput {
  profile_id: string
  kind: TransportStaffKind
  employee_code?: string | null
  phone?: string | null
  licence_no?: string | null
  licence_expiry?: string | null
  badge_no?: string | null
  blood_group?: string | null
  address?: string | null
  emergency_contact?: string | null
  verified_at?: string | null
  active?: boolean
  notes?: string | null
}

// ── Routes ──────────────────────────────────────────────────────────────────

export interface TransportRoute {
  id: string
  name: string
  code: string | null
  description: string | null
  color: string
  default_vehicle_id: string | null
  default_driver_id: string | null
  default_attendant_id: string | null
  school_stop_id: string | null
  settings: Record<string, unknown>
  active: boolean
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /**
   * Deprecated: superseded by `transport_route_schedules`. Still written by the
   * legacy driver screen until Round 2 replaces it.
   */
  pickup_time: string | null
  drop_time: string | null
  default_vehicle?: Pick<TransportVehicle, 'id' | 'registration_no' | 'display_name' | 'capacity'> | null
  default_driver?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url' | 'role'> | null
  default_attendant?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url' | 'role'> | null
}

export interface RouteInput {
  name: string
  code?: string | null
  description?: string | null
  color?: string
  default_vehicle_id?: string | null
  default_driver_id?: string | null
  default_attendant_id?: string | null
  active?: boolean
}

// ── Stops ───────────────────────────────────────────────────────────────────

export interface TransportStop {
  id: string
  route_id: string
  seq: number
  name: string
  landmark: string | null
  lat: number
  lng: number
  /** Geofence, shaped exactly like `attendance_geofence_zones`. */
  radius_m: number
  shape: 'circle' | 'polygon'
  polygon: LatLng[] | null
  trusted_accuracy_m: number | null
  /** Minutes from the schedule's anchor time, not a clock time. */
  inbound_offset_min: number | null
  outbound_offset_min: number | null
  dwell_seconds: number
  kind: TransportStopKind
  active: boolean
  created_at: string
  updated_at: string
}

export interface StopInput {
  route_id: string
  seq: number
  name: string
  landmark?: string | null
  lat: number
  lng: number
  radius_m?: number
  shape?: 'circle' | 'polygon'
  polygon?: LatLng[] | null
  trusted_accuracy_m?: number | null
  inbound_offset_min?: number | null
  outbound_offset_min?: number | null
  dwell_seconds?: number
  kind?: TransportStopKind
  active?: boolean
}

// ── Path ────────────────────────────────────────────────────────────────────

export interface TransportRoutePath {
  route_id: string
  direction: TransportDirection
  polyline: LatLng[]
  corridor_m: number
  length_m: number | null
  /** Prefix sums of segment lengths, cached so progress-along-route is one scan. */
  cumulative: number[] | null
  source: 'manual' | 'stops' | 'recorded'
  updated_by: string | null
  updated_at: string
}

// ── Schedules ───────────────────────────────────────────────────────────────

export interface TransportSchedule {
  id: string
  route_id: string
  direction: TransportDirection
  label: string | null
  days_of_week: number[]
  start_time: string
  end_time: string | null
  vehicle_id: string | null
  driver_id: string | null
  attendant_id: string | null
  auto_start: boolean
  active_from: string | null
  active_to: string | null
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  vehicle?: Pick<TransportVehicle, 'id' | 'registration_no' | 'display_name'> | null
  driver?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url'> | null
  attendant?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url'> | null
}

export interface ScheduleInput {
  route_id: string
  direction: TransportDirection
  label?: string | null
  days_of_week?: number[]
  start_time: string
  end_time?: string | null
  vehicle_id?: string | null
  driver_id?: string | null
  attendant_id?: string | null
  auto_start?: boolean
  active?: boolean
}

// ── Assignments ─────────────────────────────────────────────────────────────

export interface TransportAssignment {
  id: string
  route_id: string
  student_id: string
  pickup_stop_id: string | null
  drop_stop_id: string | null
  rides_inbound: boolean
  rides_outbound: boolean
  fee_amount: number | null
  /** The old free-text pickup label, kept as a display fallback. */
  location_label: string | null
  guardian_phone: string | null
  notes: string | null
  started_on: string
  ended_on: string | null
  created_at: string
  updated_at: string
  student?: Pick<UserProfile, 'id' | 'full_name' | 'avatar_url' | 'grade' | 'section'> | null
  pickup_stop?: Pick<TransportStop, 'id' | 'name' | 'seq'> | null
  drop_stop?: Pick<TransportStop, 'id' | 'name' | 'seq'> | null
}

export interface AssignmentInput {
  route_id: string
  student_id: string
  pickup_stop_id?: string | null
  drop_stop_id?: string | null
  rides_inbound?: boolean
  rides_outbound?: boolean
  fee_amount?: number | null
  guardian_phone?: string | null
  notes?: string | null
}
