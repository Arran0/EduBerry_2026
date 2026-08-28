import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Message copy, stored rather than hard-coded.
 *
 * A school edits the wording without a deploy, and — the reason this is a table
 * and not a constant — the WhatsApp rows also carry the name Meta approved for
 * each template, which differs per school and cannot be known at build time.
 */

export interface MessageTemplate {
  key: string
  channel: string
  locale: string
  provider_template_name: string | null
  provider_template_lang: string | null
  variable_order: string[] | null
  title_template: string | null
  body_template: string | null
  url_template: string | null
}

/** `{{name}}` substitution. Unknown placeholders resolve to an empty string
 *  rather than leaking the braces into a message a parent reads. */
export function render(tpl: string | null | undefined, vars: Record<string, unknown>): string {
  if (!tpl) return ''
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k]
    return v == null ? '' : String(v)
  }).replace(/\s{2,}/g, ' ').trim()
}

export async function loadTemplates(
  client: SupabaseClient,
  locale = 'en',
): Promise<Map<string, MessageTemplate>> {
  const { data, error } = await client
    .from('message_templates')
    .select('*')
    .eq('locale', locale)
    .eq('active', true)
  if (error) { console.error('loadTemplates failed:', error); return new Map() }
  const map = new Map<string, MessageTemplate>()
  for (const t of (data || []) as MessageTemplate[]) map.set(`${t.key}|${t.channel}`, t)
  return map
}
