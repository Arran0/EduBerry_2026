// Shared password rules for admin-created accounts.
//
// Auto-confirmed accounts used to default to one hard-coded password for every
// student and staff member, which anyone who had seen it once could use against
// any account an admin had not changed. Each form now starts from a fresh
// random password instead; the admin still sees it and can hand it out.

/** NIST SP 800-63B minimum for user-chosen secrets. */
export const MIN_PASSWORD_LENGTH = 8

// No 0/O, 1/l/I: these get read aloud or copied off a slip.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A random, easy-to-transcribe temporary password. */
export function generateTempPassword(length = 10): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}
