'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Loader2, QrCode, ShieldCheck, CreditCard, Landmark } from 'lucide-react'
import {
  BankCollectConfig, BANK_COLLECT_DEFAULTS, COLLECT_MODES, CollectMode,
  fetchBankCollectConfig, saveBankCollectConfig, parseFieldMap, ONBOARDING_CHECKLIST,
} from '@/lib/bankConfig'
import {
  BankConnectionSecrets, BANK_CONNECTION_SECRET_DEFAULTS, withSecretDefaults,
  RazorpaySecrets, fetchPaymentSecrets, savePaymentSecrets,
} from '@/lib/paymentSecrets'
import {
  UpiConfig, RazorpayConfig,
  fetchUpiConfig, saveUpiConfig, fetchRazorpayConfig, saveRazorpayConfig,
} from '@/lib/fees'
import BankConnectionFields from './BankConnectionFields'
import {
  Field, TextInput, SelectInput, SettingsCard, ToggleRow, SaveButton,
  InfoNote, WebhookUrlField, Advanced, PwInput, SectionLabel,
} from './primitives'

// Fee collection settings. Money arrives in the school's own bank account:
// either parents pay the school UPI ID with a per-fee reference, or the bank
// allots a per-fee virtual handle and calls back when the credit lands. School
// fees and bus fees share one bank arrangement, so `ctx` only changes the
// wording and the callback URL.
//
// Razorpay remains available at the bottom as an optional card/netbanking
// route for parents who want to pay by card, but it is no longer the path the
// screen leads with — every rupee it carries costs the school a commission.

interface Props {
  ctx: 'fees' | 'bus'
}

export default function BankCollectSettings({ ctx }: Props) {
  const isBus = ctx === 'bus'
  const payer = isBus ? 'passengers' : 'students'
  const Payer = isBus ? 'Passengers' : 'Students'
  const collectWebhook = isBus ? '/api/bus/upi/webhook' : '/api/fees/upi/webhook'
  const rzpWebhook = isBus ? '/api/bus/razorpay/webhook' : '/api/fees/razorpay/webhook'

  const [loaded, setLoaded] = useState(false)
  const [cfg, setCfg] = useState<BankCollectConfig>(BANK_COLLECT_DEFAULTS)
  const [secrets, setSecrets] = useState<BankConnectionSecrets>(BANK_CONNECTION_SECRET_DEFAULTS)
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [rzpSecrets, setRzpSecrets] = useState<RazorpaySecrets>({ key_secret: '', webhook_secret: '' })
  // Which credentials exist server-side, and which the admin asked to erase.
  // Stored secrets are never sent to the browser, so the inputs above always
  // start blank and a blank one means "leave it alone" on save.
  const [configured, setConfigured] = useState<Set<string>>(new Set())
  const [rzpConfigured, setRzpConfigured] = useState<Set<string>>(new Set())
  const [clearKeys, setClearKeys] = useState<string[]>([])
  const [rzpClearKeys, setRzpClearKeys] = useState<string[]>([])
  const [mapText, setMapText] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, s, u, r, rs] = await Promise.all([
      fetchBankCollectConfig(),
      fetchPaymentSecrets('bank_collect'),
      fetchUpiConfig(),
      fetchRazorpayConfig(),
      fetchPaymentSecrets('razorpay'),
    ])
    setCfg(c)
    setSecrets(withSecretDefaults(BANK_CONNECTION_SECRET_DEFAULTS, s.values))
    setConfigured(s.configured)
    setClearKeys([])
    setUpi(u)
    setRzp(r)
    // Razorpay's two fields are both write-only, so neither comes back.
    setRzpSecrets({ key_secret: '', webhook_secret: '' })
    setRzpConfigured(rs.configured)
    setRzpClearKeys([])
    setMapText(Object.keys(c.request_map).length ? JSON.stringify(c.request_map, null, 2) : '')
    setLoaded(true)
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (key: string) => {
    setSavedKey(key)
    setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2000)
  }

  // "Clear" only marks the credential; it is erased when the card is saved, so
  // the admin can still back out by leaving the page.
  const queueClear = (key: string) => {
    setClearKeys(ks => (ks.includes(key) ? ks : [...ks, key]))
    setConfigured(c => { const next = new Set(c); next.delete(key); return next })
  }
  const queueRzpClear = (key: string) => {
    setRzpClearKeys(ks => (ks.includes(key) ? ks : [...ks, key]))
    setRzpConfigured(c => { const next = new Set(c); next.delete(key); return next })
  }

  const saveUpi = async () => {
    setSavingKey('upi')
    const res = await saveUpiConfig(upi)
    setSavingKey(null)
    if (res.success) flash('upi'); else setError(res.error ?? 'Could not save')
  }

  const saveBank = async () => {
    const { map, error: mapError } = parseFieldMap(mapText)
    if (mapError) { setError(mapError); return }
    setError(null)
    setSavingKey('bank')
    const [res] = await Promise.all([
      saveBankCollectConfig({ ...cfg, request_map: map }),
      savePaymentSecrets('bank_collect', { ...secrets }, clearKeys),
    ])
    setSavingKey(null)
    if (res.success) { flash('bank'); await load() } else setError(res.error ?? 'Could not save')
  }

  const saveRzp = async () => {
    setSavingKey('rzp')
    const [res] = await Promise.all([
      saveRazorpayConfig(rzp),
      savePaymentSecrets('razorpay', { ...rzpSecrets }, rzpClearKeys),
    ])
    setSavingKey(null)
    if (res.success) { flash('rzp'); await load() } else setError(res.error ?? 'Could not save')
  }

  if (!loaded) {
    return (
      <div className="py-12 text-center text-[#71717A] text-sm">
        <Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…
      </div>
    )
  }

  const set = <K extends keyof BankCollectConfig>(key: K, value: BankCollectConfig[K]) => setCfg({ ...cfg, [key]: value })

  return (
    <div className="space-y-5">
      <InfoNote tone="info">
        Shared site-wide with {isBus ? 'school fees' : 'bus fees'} — these are your school&apos;s own bank details,
        not server defaults. Fees land directly in your account.
      </InfoNote>

      {/* UPI — the fee-free route, so it leads. */}
      <SettingsCard icon={<QrCode size={15} className="text-[#B8983C]" />} title="School UPI ID (no commission)">
        <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
          {Payer} scan and pay your school directly — nobody takes a cut. Verify by hand below,
          or switch on bank auto-reconciliation so payments confirm themselves.
        </p>
        <div className="space-y-3">
          <Field label="UPI ID (VPA)">
            <TextInput value={upi.vpa} onChange={v => setUpi({ ...upi, vpa: v })} placeholder="schoolname@yourbank" />
          </Field>
          <Field label="Payee name" hint="Shown to the payer when they scan.">
            <TextInput value={upi.payee_name} onChange={v => setUpi({ ...upi, payee_name: v })} placeholder={isBus ? 'ABC School Transport' : 'ABC School'} />
          </Field>
        </div>
        <SaveButton saving={savingKey === 'upi'} saved={savedKey === 'upi'} label="Save UPI ID" onClick={saveUpi} />
      </SettingsCard>

      {/* Bank auto-reconciliation. */}
      <SettingsCard icon={<ShieldCheck size={15} className="text-[#B8983C]" />} title="Bank auto-reconciliation">
        <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
          Your bank notifies the app the moment a fee is credited, so a fee marks itself paid and no
          {' '}{payer.slice(0, -1)} has to declare a payment and no clerk has to tick it off.
        </p>

        <ToggleRow
          label="Confirm fee payments automatically from bank callbacks"
          checked={cfg.enabled}
          onChange={() => set('enabled', !cfg.enabled)}
        />

        {cfg.enabled ? (
          <div className="space-y-4">
            <Field
              label="How your bank identifies each fee"
              hint={COLLECT_MODES.find(m => m.value === cfg.mode)?.hint}
            >
              <SelectInput
                value={cfg.mode}
                onChange={(v: CollectMode) => set('mode', v)}
                options={COLLECT_MODES.map(m => ({ value: m.value, label: m.label }))}
              />
            </Field>

            {cfg.mode === 'reference' ? (
              <>
                <Field label="Callback secret" hint="Verifies that a payment notification really came from your bank.">
                  <PwInput
                    value={secrets.webhook_secret}
                    onChange={v => setSecrets({ ...secrets, webhook_secret: v })}
                    placeholder="HMAC secret for incoming callbacks"
                    configured={configured.has('webhook_secret')}
                    onClear={() => queueClear('webhook_secret')}
                  />
                </Field>
                <InfoNote tone="info">
                  Reference matching needs no API access — just your UPI ID above and callback access on the
                  account. This is the quickest arrangement for a school to get running.
                </InfoNote>
              </>
            ) : (
              <>
                <BankConnectionFields
                  connection={cfg.connection}
                  onConnection={c => set('connection', c)}
                  secrets={secrets}
                  onSecrets={setSecrets}
                  configured={configured}
                  onClear={queueClear}
                />
                <Field label="Allocation path" hint="Endpoint that allots a virtual handle for one fee. Appended to the API base URL.">
                  <TextInput value={cfg.allocate_path} onChange={v => set('allocate_path', v)} placeholder="/virtual-accounts" mono />
                </Field>

                <Advanced title="Advanced — payload field names">
                  <Field
                    label="Field renames (JSON)"
                    hint="Only needed if your bank names fields differently. Left side is ours, right side is theirs."
                  >
                    <textarea
                      value={mapText} onChange={e => setMapText(e.target.value)} rows={6} spellCheck={false}
                      placeholder={'{\n  "reference": "merchantRefNo",\n  "amount": "txnAmount"\n}'}
                      className="border border-[#D4D4D8] bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#27272A] transition-colors w-full resize-y"
                    />
                  </Field>
                  <InfoNote tone="info">
                    We send <code>reference</code>, <code>amount</code>, <code>customer_name</code>,{' '}
                    <code>corporate_id</code> and <code>expires_on</code>. The allotted UPI ID or virtual account
                    number is read from the response by trying the common field names.
                  </InfoNote>
                </Advanced>
              </>
            )}

            <WebhookUrlField path={collectWebhook} label="Payment callback URL (give this to your bank)" />
            <InfoNote>
              Register this URL as your collection callback. The same URL serves{' '}
              {isBus ? 'bus' : 'school'} fees; {isBus ? 'school' : 'bus'} fees have their own and each
              ignores the other&apos;s settlements.
            </InfoNote>
          </div>
        ) : (
          <InfoNote tone="info">
            Fees are verified by hand until this is switched on — a {payer.slice(0, -1)} declares the payment
            and an admin confirms it against the bank statement.
          </InfoNote>
        )}

        <SaveButton saving={savingKey === 'bank'} saved={savedKey === 'bank'} label="Save collection settings" onClick={saveBank} />
      </SettingsCard>

      {cfg.enabled && cfg.mode !== 'reference' && (
        <SettingsCard icon={<Landmark size={15} className="text-[#B8983C]" />} title="What to ask your bank for">
          <SectionLabel>Onboarding checklist</SectionLabel>
          <ul className="space-y-2">
            {ONBOARDING_CHECKLIST.filter(i => !i.field.startsWith('Debit account')).map(item => (
              <li key={item.field} className="flex items-start gap-2 text-xs leading-relaxed">
                <span className="mt-1.5 w-1 h-1 bg-[#B8983C] flex-shrink-0" />
                <span><span className="text-[#18181B] font-medium">{item.field}</span>
                  <span className="text-[#A1A1AA]"> — {item.why}</span>
                </span>
              </li>
            ))}
          </ul>
          <InfoNote tone="info">
            Ask for the corporate <em>virtual account</em> / <em>smart collect</em> programme and their integration
            document&apos;s sample request and response.
          </InfoNote>
        </SettingsCard>
      )}

      {/* Razorpay — optional card route, listed last because it costs the school money. */}
      <SettingsCard icon={<CreditCard size={15} className="text-[#B8983C]" />} title="Card / netbanking via Razorpay (optional)">
        <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
          Only needed if you want {payer} to be able to pay by card or netbanking. It charges a
          per-transaction commission on every rupee, so leave it off unless parents have asked for it.
        </p>
        <ToggleRow label={`Enable card checkout for ${payer}`} checked={rzp.enabled} onChange={() => setRzp({ ...rzp, enabled: !rzp.enabled })} />
        {rzp.enabled && (
          <div className="space-y-3">
            <Field label="Key ID (public)">
              <TextInput value={rzp.key_id} onChange={v => setRzp({ ...rzp, key_id: v })} placeholder="rzp_live_xxxxxxxx" />
            </Field>
            <Field label="Key secret">
              <PwInput value={rzpSecrets.key_secret} onChange={v => setRzpSecrets({ ...rzpSecrets, key_secret: v })} placeholder="Razorpay key secret" configured={rzpConfigured.has('key_secret')} onClear={() => queueRzpClear('key_secret')} />
            </Field>
            <Field label="Webhook secret">
              <PwInput value={rzpSecrets.webhook_secret} onChange={v => setRzpSecrets({ ...rzpSecrets, webhook_secret: v })} placeholder="HMAC secret for the payment.captured webhook" configured={rzpConfigured.has('webhook_secret')} onClear={() => queueRzpClear('webhook_secret')} />
            </Field>
            <WebhookUrlField path={rzpWebhook} label="Razorpay webhook URL" />
          </div>
        )}
        <SaveButton saving={savingKey === 'rzp'} saved={savedKey === 'rzp'} label="Save card settings" onClick={saveRzp} />
      </SettingsCard>

      {error && (
        <div className="p-3 bg-white border border-[#E4E4E7] text-xs text-[#71717A]">{error}</div>
      )}
    </div>
  )
}
