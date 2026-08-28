import 'server-only'
import { metaCloud } from './metaCloud'
import type { WhatsAppProvider } from './provider'

export type { SendResult, WhatsAppMessage, WhatsAppProvider } from './provider'

/**
 * Provider registry.
 *
 * Adding a BSP is a new file and one line here — no call site changes, which is
 * the point of the adapter. `meta_cloud` is the default because it is the only
 * option that needs no reseller relationship to get started.
 */
const PROVIDERS: Record<string, WhatsAppProvider> = {
  [metaCloud.slug]: metaCloud,
}

export function resolveProvider(slug?: string | null): WhatsAppProvider {
  return PROVIDERS[slug ?? ''] ?? metaCloud
}

/**
 * Normalise a phone number to the bare international digits Meta expects.
 *
 * The ERP stores numbers however they were typed, and the only normalisation
 * anywhere in the codebase is an inline `replace(/\D/g, '')` in ProfileCard.
 * A ten-digit Indian mobile with no country code is the common case, so a
 * default country code is applied rather than sending something that will bounce.
 */
export function toE164Digits(raw: string | null | undefined, defaultCountryCode = '91'): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // A leading 00 is the international prefix written the old way.
  if (digits.startsWith('00')) digits = digits.slice(2)
  // A bare national number: prepend the school's country code.
  if (digits.length === 10) digits = defaultCountryCode + digits
  // Indian numbers are sometimes stored with a trunk 0.
  if (digits.length === 11 && digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1)
  return digits.length >= 10 ? digits : null
}
