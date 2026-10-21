import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPaymentSecrets } from '@/lib/serverSecrets'

/**
 * The school's Razorpay keys: the public key id from env or the stored config,
 * the secret from the admin-configured store. `enabled` is the switch in
 * Settings, so turning online payment off there stops new orders at once.
 */
export async function razorpayKeys(admin: SupabaseClient): Promise<{
  enabled: boolean
  keyId?: string
  keySecret?: string
}> {
  const [{ data: cfg }, secrets] = await Promise.all([
    admin.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle(),
    getPaymentSecrets(admin, 'razorpay'),
  ])
  const value = (cfg?.value ?? {}) as { key_id?: string; enabled?: boolean }
  return {
    enabled: value.enabled ?? false,
    keyId: process.env.RAZORPAY_KEY_ID || value.key_id,
    keySecret: secrets.key_secret,
  }
}
