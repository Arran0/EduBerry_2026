'use client'

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Business, via Meta's Cloud API.
//
// Built before the credentials exist, on purpose. Meta's business verification
// takes one to five working days and nothing else can start until it clears,
// so this screen ships now with the setup laid out step by step and each step
// showing whether it is done. Paste the five values when Meta is finished and
// sending starts; nothing else has to be built.
//
// The adapter, the outbox worker and the templates arrive in Round 3. Until
// then this panel stores configuration and says plainly that it does — it does
// not pretend a message would go anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, Circle, Copy, ExternalLink, Info, Loader2, MessageCircle,
} from 'lucide-react'
import { ADMIN, GOLD } from '@/components/fees/ui'
import {
  DEFAULT_FEE_SETTINGS, fetchFeeSettings, saveFeeSetting, type WhatsAppSettings as WaSettings,
} from '@/lib/fees/settings'
import {
  saveWhatsAppSecrets, whatsAppCredentialStatus,
} from '@/lib/whatsapp/secrets'

interface Step {
  n: number
  title: string
  detail: React.ReactNode
  /** Something the app can actually check. Undefined = only you know. */
  done?: boolean
  link?: { href: string; label: string }
}

export default function WhatsAppSettingsPanel() {
  const [settings, setSettings] = useState<WaSettings>(DEFAULT_FEE_SETTINGS.whatsapp)
  const [creds, setCreds] = useState({ access_token: '', app_secret: '', verify_token: '' })
  const [status, setStatus] = useState({ access_token: false, app_secret: false, verify_token: false, complete: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/whatsapp/webhook`
    : '/api/whatsapp/webhook'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, st] = await Promise.all([fetchFeeSettings(), whatsAppCredentialStatus()])
      setSettings(s.whatsapp)
      setStatus(st)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      if (creds.access_token || creds.app_secret || creds.verify_token) {
        await saveWhatsAppSecrets(creds)
      }
      const st = await whatsAppCredentialStatus()
      await saveFeeSetting('whatsapp', { ...settings, credentials_saved: st.complete })
      setCreds({ access_token: '', app_secret: '', verify_token: '' })
      setStatus(st)
      setSettings(s => ({ ...s, credentials_saved: st.complete }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2400)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the WhatsApp settings.')
    } finally {
      setSaving(false)
    }
  }

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked; the URL is on screen to copy by hand */ }
  }

  if (loading) {
    return (
      <div className={`${ADMIN.card} p-8 flex items-center justify-center gap-2 text-sm text-slate-500`}>
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  const steps: Step[] = [
    { n: 1, title: 'Create a Meta Business Account',
      detail: 'A Business Portfolio for the school. Skip if you already have one.',
      link: { href: 'https://business.facebook.com', label: 'business.facebook.com' } },
    { n: 2, title: 'Start business verification',
      detail: <>Business Settings → Security Centre → Start Verification. You need the school&rsquo;s
        registration or GST certificate, a document showing the legal name and address, a business
        phone number and a website. <strong>This takes one to five working days and everything else
        waits on it, so start here.</strong></>,
      link: { href: 'https://business.facebook.com/settings/security', label: 'Security Centre' } },
    { n: 3, title: 'Create a Meta app',
      detail: 'My Apps → Create App → type Business → link it to the portfolio from step 1. Note the App ID, and the App Secret under Settings → Basic.',
      link: { href: 'https://developers.facebook.com/apps', label: 'developers.facebook.com' } },
    { n: 4, title: 'Add the WhatsApp product to the app',
      detail: 'Meta gives you a test number. Ignore it — it only reaches five whitelisted contacts.' },
    { n: 5, title: 'Add the school’s real number',
      detail: <>WhatsApp → API Setup → Add phone number. <strong>The number must not already be
        registered on WhatsApp or WhatsApp Business</strong> — if it is, delete that account in the
        WhatsApp app first and wait about 30 minutes. Set the Display Name to the school&rsquo;s
        actual name; Meta reviews it and rejects anything else.</> },
    { n: 6, title: 'Copy the Phone Number ID and WABA ID',
      detail: 'Both are on the API Setup screen. Neither is the phone number itself. Paste them below.',
      done: !!settings.phone_number_id && !!settings.waba_id },
    { n: 7, title: 'Create a permanent token',
      detail: <>Business Settings → Users → System Users → Add, role <strong>Admin</strong> →
        Generate New Token → pick your app → tick <code>whatsapp_business_messaging</code> and
        <code> whatsapp_business_management</code> → expiry <strong>Never</strong>. Copy it now;
        Meta never shows it again. The token on the API Setup screen expires in 24 hours — do not
        use that one.</>,
      done: status.access_token },
    { n: 8, title: 'Assign the WABA to that system user',
      detail: <>Business Settings → Accounts → WhatsApp Accounts → your WABA → Add People → the
        system user → <strong>Full control</strong>. Skipping this is the single most common reason
        a valid token still answers &ldquo;object does not exist&rdquo;.</> },
    { n: 9, title: 'Add a payment method to the WABA',
      detail: 'Business Settings → WhatsApp Accounts → Payment Settings. Without it, sending stops once the free tier is used. Utility conversations in India cost a fraction of a rupee each.' },
    { n: 10, title: 'Create the six message templates',
      detail: <>WhatsApp Manager → Message Templates. Category <strong>Utility</strong> on every one,
        not Marketing — utility is cheaper and is not subject to marketing opt-outs. The exact names
        and body text come with Round 3, which also seeds the matching rows so the placeholder order
        cannot drift.</> },
    { n: 11, title: 'Point the webhook at this app',
      detail: <>App → WhatsApp → Configuration. Callback URL is below; Verify Token is any random
        string you invent — put the same one in the box below. Subscribe to the
        <strong> messages</strong> field. The route answers Meta&rsquo;s challenge, so it verifies
        first try.</>,
      done: status.verify_token },
    { n: 12, title: 'Paste the five values below and save',
      detail: 'Phone Number ID, WABA ID, permanent token, verify token, app secret. The three secrets go to the admin-only credential store, never to the world-readable settings table.',
      done: status.complete && !!settings.phone_number_id },
    { n: 13, title: 'Send yourself a test',
      detail: 'Arrives with Round 3, along with the send worker. You will see it go sent → delivered → read here.' },
  ]

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <div className="flex items-start gap-3">
          <MessageCircle size={18} className="mt-0.5 flex-shrink-0" style={{ color: GOLD }} />
          <div className="text-sm text-slate-600 leading-relaxed">
            <p className="font-semibold text-slate-900 mb-1">
              Configure this now; sending arrives with Round 3
            </p>
            <p>
              Meta&rsquo;s business verification is the long pole at one to five working days, so
              step 2 is worth starting today even though nothing needs it yet. Everything you save
              here is picked up the moment the send worker lands — no re-entry.
            </p>
          </div>
        </div>
      </div>

      <div className={`${ADMIN.card} p-5`}>
        <h3 className="text-sm font-bold text-slate-900 mb-1">Setup</h3>
        <p className="text-xs text-slate-400 mb-4">
          A tick means the app can see it is done. The rest only you can confirm.
        </p>
        <ol className="space-y-3">
          {steps.map(step => (
            <li key={step.n} className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0">
                {step.done === true ? (
                  <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </span>
                ) : step.done === false ? (
                  <span className="w-5 h-5 rounded-full border-2 border-amber-300 flex items-center justify-center text-[10px] font-bold text-amber-600">
                    {step.n}
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full border border-[#E4E4E7] flex items-center justify-center text-[10px] font-bold text-slate-400">
                    {step.n}
                  </span>
                )}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">{step.title}</div>
                <div className="text-xs text-slate-500 mt-0.5 leading-relaxed [&_code]:bg-[#F4F4F5] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px]">
                  {step.detail}
                </div>
                {step.link && (
                  <a href={step.link.href} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 text-xs text-slate-900 hover:underline mt-1">
                    {step.link.label} <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className={`${ADMIN.card} p-5 space-y-4`}>
        <h3 className="text-sm font-bold text-slate-900">Webhook</h3>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Callback URL — paste into Meta</label>
          <div className="flex gap-2">
            <input readOnly value={webhookUrl} className={`${ADMIN.inputPlain} font-mono text-xs`} />
            <button onClick={() => void copyWebhook()} className={ADMIN.ghostBtn}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Subscribe to the <strong>messages</strong> field so delivery and read receipts, and
            inbound STOP, reach the app.
          </p>
        </div>
      </div>

      <div className={`${ADMIN.card} p-5 space-y-4`}>
        <h3 className="text-sm font-bold text-slate-900">Credentials</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Phone Number ID</label>
            <input
              value={settings.phone_number_id}
              onChange={e => setSettings({ ...settings, phone_number_id: e.target.value.trim() })}
              placeholder="e.g. 123456789012345"
              className={`${ADMIN.inputPlain} font-mono text-xs`}
            />
          </div>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>WhatsApp Business Account ID</label>
            <input
              value={settings.waba_id}
              onChange={e => setSettings({ ...settings, waba_id: e.target.value.trim() })}
              placeholder="e.g. 987654321098765"
              className={`${ADMIN.inputPlain} font-mono text-xs`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={`${ADMIN.label} block mb-1.5`}>
              Display number <span className="font-normal normal-case tracking-normal text-slate-400">(what parents will see)</span>
            </label>
            <input
              value={settings.display_number}
              onChange={e => setSettings({ ...settings, display_number: e.target.value })}
              placeholder="+91 98765 43210"
              className={`${ADMIN.inputPlain} max-w-xs`}
            />
          </div>
        </div>

        <div className="pt-3 border-t border-[#F4F4F5] space-y-4">
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            These three are stored in the admin-only credential table, never in the
            world-readable settings. Leave a box empty to keep what is already saved.
          </p>

          <SecretField
            label="Permanent access token"
            saved={status.access_token}
            value={creds.access_token}
            onChange={v => setCreds({ ...creds, access_token: v })}
            help="From the system user in step 7, with expiry set to Never."
          />
          <SecretField
            label="Webhook verify token"
            saved={status.verify_token}
            value={creds.verify_token}
            onChange={v => setCreds({ ...creds, verify_token: v })}
            help="Any random string. Type the same one into Meta's Verify Token box."
          />
          <SecretField
            label="App secret"
            saved={status.app_secret}
            value={creds.app_secret}
            onChange={v => setCreds({ ...creds, app_secret: v })}
            help="Settings → Basic on the Meta app. Used to verify that an inbound webhook really came from Meta."
          />
        </div>

        {!status.app_secret && status.access_token && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Without the app secret, inbound webhooks cannot be signature-checked, so delivery
              receipts and STOP replies would have to be trusted on the word of whoever sent them.
              Add it before going live.
            </span>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={() => void save()} disabled={saving} className={ADMIN.darkBtn}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save
          </button>
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved</span>}
          <StatusPill complete={status.complete && !!settings.phone_number_id} />
        </div>
      </div>
    </div>
  )
}

function SecretField({
  label, saved, value, onChange, help,
}: {
  label: string; saved: boolean; value: string
  onChange: (v: string) => void; help: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className={ADMIN.label}>{label}</label>
        {saved && (
          <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
            Saved
          </span>
        )}
      </div>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={saved ? 'Stored — leave blank to keep it' : 'Paste here'}
        className={`${ADMIN.inputPlain} font-mono text-xs`}
      />
      <p className="text-xs text-slate-400 mt-1">{help}</p>
    </div>
  )
}

function StatusPill({ complete }: { complete: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
      complete
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        : 'bg-[#F4F4F5] text-slate-500 border border-[#E4E4E7]'
    }`}>
      {complete ? <Check size={12} /> : <Circle size={10} />}
      {complete ? 'Ready for Round 3' : 'Not connected yet'}
    </span>
  )
}
