// ============================================================================
// How a punch with no position gets labelled.
//
// This is the decision that, on the morning of 2026-09-21, told ten staff
// members that their location access was switched off and put them at the top
// of the day's report in red. None of them had touched a location setting: the
// REST API was shedding requests, the fence read came back 504, and the app
// asked for no position at all — which the old rule read as a confession.
//
// The rules under test are small, and their whole value is in which way they
// fall when they are unsure. So the cases here are mostly about silence and
// about POSITION_UNAVAILABLE, not about the paths that were always right.
//
// `classifyFailure` mirrors attendance_failure_class() in
// supabase-migrations/fix_gps_location_off_misclassification.sql. The server
// makes the binding call; if these two disagree, the server wins and the UI
// lies, so they are meant to be changed together.
// ============================================================================

import { describe, it, expect } from 'vitest'
import {
  FAILURE_CLASS,
  FENCE_UNREADABLE,
  classifyFailure,
  isDeviceProblem,
} from './gpsAcquisition'

describe('classifyFailure', () => {
  it('treats a refused permission as access being off', () => {
    // The one case where the staff member could have produced a location and
    // did not. It is supposed to be strict, and it stays strict.
    expect(classifyFailure('permission_denied')).toBe('access_off')
  })

  it('treats a browser with no geolocation as access being off', () => {
    expect(classifyFailure('unsupported')).toBe('access_off')
  })

  it('treats POSITION_UNAVAILABLE as a device problem, not as access being off', () => {
    // The spec gives this code when the positioning fails, not when permission
    // is refused — a phone indoors with a cold receiver emits it routinely.
    // Classing it strictly accused people of a setting they had not changed.
    expect(classifyFailure('unavailable')).toBe('device_problem')
    expect(isDeviceProblem('unavailable')).toBe(true)
  })

  it('treats a timeout as a device problem', () => {
    expect(classifyFailure('timeout')).toBe('device_problem')
  })

  it('treats an unreadable fence as a device problem', () => {
    // The app could not read the fence, so it never asked for a position. That
    // is the app's failure and is named as one.
    expect(classifyFailure(FENCE_UNREADABLE)).toBe('device_problem')
  })

  it('still treats an unrecognised code as access being off', () => {
    // Deliberately unchanged: a client that can invent a code must not be able
    // to pick its own severity by inventing one.
    expect(classifyFailure('made_up_code')).toBe('access_off')
  })

  it('has an entry for every code it can be handed', () => {
    // A missing entry falls through to access_off, which is the strict side —
    // so a forgotten code is a silent accusation rather than a visible bug.
    for (const [code, klass] of Object.entries(FAILURE_CLASS)) {
      expect(classifyFailure(code)).toBe(klass)
    }
  })
})

describe('classifyFailure, on silence', () => {
  // The 2026-09-21 case. The client sent no code because it never ran an
  // acquisition; the server had no position and no reason, and picked the
  // accusation. The client half of that rule is here.
  //
  // classifyFailure keeps returning 'access_off' for null — it is the UI's
  // fallback for a code it does not recognise, and the strict default there is
  // right. What changed is that the *server* no longer turns this into
  // location_off (attendance_no_position_verdict treats 'no_code' as a device
  // problem), and that the client no longer produces a null code in the first
  // place: the fence-read failure now travels as FENCE_UNREADABLE.
  it('falls back to the strict class for a code it does not recognise', () => {
    expect(classifyFailure(null)).toBe('access_off')
    expect(classifyFailure(undefined)).toBe('access_off')
  })

  it('gives the fence-read failure a code of its own rather than sending null', () => {
    // The point of the constant: this case now has a name, so neither the
    // server nor the report has to guess what an absent code meant.
    expect(FENCE_UNREADABLE).toBe('fence_unreadable')
    expect(FAILURE_CLASS[FENCE_UNREADABLE]).toBe('device_problem')
  })
})
