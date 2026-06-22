import { fetchSetting, saveSetting } from './pageConfig'

// ============================================
// School Profile — CBSE institutional info
// --------------------------------------------
// Stored as a single site_settings row under the 'school_profile' key (same
// pattern as branding / login config), NOT a dedicated table. Branding already
// holds the school name, tagline and logo; this carries the formal details that
// certificates need (affiliation no, address, principal, seal).
// ============================================

export interface SchoolProfile {
  affiliation_no: string    // CBSE affiliation number
  school_code: string       // CBSE school code
  recognition_no: string    // state recognition / DISE code
  address: string           // street address
  city: string
  state: string
  pincode: string
  phone: string
  email: string
  website: string
  principal_name: string
  seal_url: string          // uploaded school seal / stamp image
}

export const SCHOOL_PROFILE_DEFAULTS: SchoolProfile = {
  affiliation_no: '',
  school_code: '',
  recognition_no: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  website: '',
  principal_name: '',
  seal_url: '',
}

export const fetchSchoolProfile = () =>
  fetchSetting<SchoolProfile>('school_profile', SCHOOL_PROFILE_DEFAULTS)

export const saveSchoolProfile = (profile: SchoolProfile) =>
  saveSetting('school_profile', profile)

/** Single-line postal address built from the parts that are filled in. */
export function formatSchoolAddress(p: SchoolProfile): string {
  return [p.address, p.city, p.state, p.pincode].filter(Boolean).join(', ')
}
