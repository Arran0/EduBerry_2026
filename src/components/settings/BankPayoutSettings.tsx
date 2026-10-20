'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Banknote, FileSpreadsheet, Landmark, Loader2 } from 'lucide-react'
import {
  PayoutConfig, PayoutProviderId, PAYOUT_PROVIDERS, PAYOUT_CONFIG_DEFAULTS,
  TRANSFER_MODES, TransferMode, PAYOUT_FILE_TOKENS,
  fetchPayoutConfig, savePayoutConfig, parseFieldMap,
  ONBOARDING_CHECKLIST,
} from '@/lib/bankConfig'
import {
  PayoutSecrets, PAYOUT_SECRET_DEFAULTS, withSecretDefaults,
  fetchPaymentSecrets, savePaymentSecrets,
} from '@/lib/paymentSecrets'
import BankConnectionFields from './BankConnectionFields'
import {
  Field, TextInput, NumberInput, SelectInput, SettingsCard, ToggleRow,
  SaveButton, InfoNote, WebhookUrlField, Advanced, SectionLabel, useSettingsSkin,
} from './primitives'

// Salary payout settings — the school's own bank moves the money, with no
// aggregator in between. Staff salary and driver payroll share one connection
// because both credit staff from the same corporate account, so this component
// is mounted from App Settings, Salary Payout Settings and Driver Payroll
// Settings alike and `ctx` only changes the wording and the callback URL shown.

interface Props {
  ctx: 'salary' | 'driver'
}

export default function BankPayoutSettings({ ctx }: Props) {
  const isDriver = ctx === 'driver'
  const period = isDriver ? 'payroll period' : 'pay cycle'
  const webhookPath = isDriver ? '/api/bus/payroll/payout/webhook' : '/api/salary/payout/webhook'

  const [loaded, setLoaded] = useState(false)
  const [cfg, setCfg] = useState<PayoutConfig>(PAYOUT_CONFIG_DEFAULTS)
  const [secrets, setSecrets] = useState<PayoutSecrets>(PAYOUT_SECRET_DEFAULTS)
  // Which credentials exist server-side, and which the admin asked to erase.
  // Stored secrets are never sent to the browser, so those inputs always start
  // blank and a blank one means "leave it alone" on save.
  const [configured, setConfigured] = useState<Set<string>>(new Set())
  const [clearKeys, setClearKeys] = useState<string[]>([])
  const [mapText, setMapText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const k = useSettingsSkin()

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([fetchPayoutConfig(), fetchPaymentSecrets('payout')])
    setCfg(c)
    setSecrets(withSecretDefaults(PAYOUT_SECRET_DEFAULTS, s.values))
    setConfigured(s.configured)
    setClearKeys([])
    setMapText(Object.keys(c.request_map).length ? JSON.stringify(c.request_map, null, 2) : '')
    setLoaded(true)
  }, [])

  useEffect(() => { load() }, [load])

  // "Clear" only marks the credential; it is erased when the form is saved, so
  // the admin can still back out by leaving the page.
  const queueClear = (key: string) => {
    setClearKeys(ks => (ks.includes(key) ? ks : [...ks, key]))
    setConfigured(c => { const next = new Set(c); next.delete(key); return next })
  }

  const save = async () => {
    const { map, error: mapError } = parseFieldMap(mapText)
    if (mapError) { setError(mapError); return }

    const unknown = cfg.file.columns.filter(c => !(PAYOUT_FILE_TOKENS as readonly string[]).includes(c))
    setError(null)
    setSaving(true)
    const [res] = await Promise.all([
      savePayoutConfig({ ...cfg, request_map: map }),
      savePaymentSecrets('payout', { ...secrets }, clearKeys),
    ])
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save'); return }
    await load()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // Unknown column tokens are emitted verbatim, which is legitimate for
    // constant columns — so this is a note after saving, not a blocker.
    if (unknown.length) setError(`Saved. Columns emitted as literal text: ${unknown.join(', ')}`)
  }

  if (!loaded) {
    return (
      <div className={k.loading}>
        <Loader2 size={16} className="animate-spin inline mr-2 text-[#A1A1AA]" /> Loading…
      </div>
    )
  }

  const set = <K extends keyof PayoutConfig>(key: K, value: PayoutConfig[K]) => setCfg({ ...cfg, [key]: value })

  return (
    <div className={k.stack}>
      <InfoNote tone="info">
        Staff salary and driver payroll share this connection. Money goes straight from the school&apos;s own
        bank, with no payment company in between.
      </InfoNote>

      <SettingsCard icon={<Banknote size={15} className="text-[#B8983C]" />} title="Salary disbursement">
        <p className={k.para}>
          When enabled, an approved {period} is sent to your bank for credit to each staff member&apos;s account.
          When disabled, admins pay from the bank portal and mark records as paid here.
        </p>

        <ToggleRow
          label="Enable bank disbursement"
          checked={cfg.enabled}
          onChange={() => setCfg({
            ...cfg,
            enabled: !cfg.enabled,
            // Turning it on lands on the file hand-off, which needs no API
            // access and is what most schools can use on day one.
            provider: !cfg.enabled ? (cfg.provider === 'manual' ? 'bank_file' : cfg.provider) : 'manual',
          })}
        />

        {cfg.enabled && (
          <div className="space-y-4">
            <Field
              label="How transfers reach the bank"
              hint={PAYOUT_PROVIDERS.find(p => p.value === cfg.provider)?.hint}
            >
              <SelectInput
                value={cfg.provider as PayoutProviderId}
                onChange={(v: PayoutProviderId) => set('provider', v)}
                options={PAYOUT_PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Transfer mode" hint={TRANSFER_MODES.find(m => m.value === cfg.transfer_mode)?.hint}>
                <SelectInput
                  value={cfg.transfer_mode}
                  onChange={(v: TransferMode) => set('transfer_mode', v)}
                  options={TRANSFER_MODES.map(m => ({ value: m.value, label: m.label }))}
                />
              </Field>
              {cfg.transfer_mode === 'RTGS' && (
                <Field label="RTGS minimum (₹)" hint="Anything below this is sent over NEFT instead, which is what a bank portal would do for you.">
                  <NumberInput value={cfg.rtgs_min_amount} onChange={v => set('rtgs_min_amount', v)} min={0} step={10000} />
                </Field>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Debit account — needed by both the API and the file. */}
      {cfg.enabled && cfg.provider !== 'manual' && (
        <SettingsCard icon={<Landmark size={15} className="text-[#B8983C]" />} title="Debit account">
          <p className={k.para}>
            The school current account salaries are paid from. Stored admin-only and never readable by staff.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Account number">
              <TextInput
                value={secrets.account_number}
                onChange={v => setSecrets({ ...secrets, account_number: v })}
                placeholder="School current account"
              />
            </Field>
            <Field label="IFSC">
              <TextInput
                value={secrets.account_ifsc}
                onChange={v => setSecrets({ ...secrets, account_ifsc: v })}
                placeholder="e.g. IDIB000X123"
                mono
              />
            </Field>
          </div>
        </SettingsCard>
      )}

      {/* Bank API connection. */}
      {cfg.enabled && cfg.provider === 'bank_api' && (
        <SettingsCard icon={<Banknote size={15} className="text-[#B8983C]" />} title="Bank API">
          <BankConnectionFields
            connection={cfg.connection}
            onConnection={c => set('connection', c)}
            secrets={secrets}
            onSecrets={s => setSecrets({ ...secrets, ...s })}
            configured={configured}
            onClear={queueClear}
          />

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bulk transfer path" hint="Appended to the API base URL.">
                <TextInput value={cfg.transfer_path} onChange={v => set('transfer_path', v)} placeholder="/payments/bulk" mono />
              </Field>
              <Field label="Credits per request" hint="Your bank caps how many credits one call may carry.">
                <NumberInput value={cfg.batch_size} onChange={v => set('batch_size', v)} min={1} step={10} />
              </Field>
            </div>

            <WebhookUrlField path={webhookPath} label="Payout callback URL (give this to your bank)" />

            <Advanced title="Advanced — payload field names">
              <Field
                label="Field renames (JSON)"
                hint="Only needed if your bank names fields differently. Left side is ours, right side is theirs."
              >
                <textarea
                  value={mapText} onChange={e => setMapText(e.target.value)} rows={7} spellCheck={false}
                  placeholder={'{\n  "amount": "txnAmount",\n  "ifsc": "beneIfscCode",\n  "credits": "transactionList"\n}'}
                  className={k.textarea}
                />
              </Field>
              <InfoNote tone="info">
                We send <code>reference</code>, <code>beneficiary_name</code>, <code>account_number</code>,{' '}
                <code>ifsc</code>, <code>amount</code>, <code>transfer_mode</code>, <code>narration</code> per credit,
                wrapped in <code>corporate_id</code>, <code>debit_account</code>, <code>debit_ifsc</code>,{' '}
                <code>value_date</code>, <code>batch_reference</code> and <code>credits</code>. Responses are read by
                trying the common field names, so most banks need no mapping at all.
              </InfoNote>
            </Advanced>
          </div>
        </SettingsCard>
      )}

      {/* File hand-off. */}
      {cfg.enabled && cfg.provider === 'bank_file' && (
        <SettingsCard icon={<FileSpreadsheet size={15} className="text-[#B8983C]" />} title="Transfer file layout">
          <p className={k.para}>
            Approving a {period} generates this file for download. Upload it in your bank&apos;s corporate portal
            (or drop it on your H2H path) to release the money. Match the column order to your bank&apos;s file spec.
          </p>

          <div className="space-y-3">
            <Field
              label="Columns, in order"
              hint="One per line. Known names are filled per staff member; anything else is written as-is, for constant columns a spec requires."
            >
              <textarea
                value={cfg.file.columns.join('\n')}
                onChange={e => set('file', { ...cfg.file, columns: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
                rows={8} spellCheck={false}
                className={k.textarea}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="File extension">
                <TextInput value={cfg.file.extension} onChange={v => set('file', { ...cfg.file, extension: v })} placeholder="csv" mono />
              </Field>
              <Field label="Delimiter">
                <TextInput value={cfg.file.delimiter} onChange={v => set('file', { ...cfg.file, delimiter: v })} placeholder="," mono />
              </Field>
              <Field label="Header row">
                <SelectInput
                  value={cfg.file.include_header ? 'yes' : 'no'}
                  onChange={(v: string) => set('file', { ...cfg.file, include_header: v === 'yes' })}
                  options={[{ value: 'yes', label: 'Include' }, { value: 'no', label: 'Omit' }]}
                />
              </Field>
            </div>

            <InfoNote tone="info">
              Available column names: {PAYOUT_FILE_TOKENS.map(t => <code key={t}>{t} </code>)}
            </InfoNote>
            <InfoNote tone="warn">
              Records are marked <em>initiated</em> when the file is generated — the money has not moved until you
              upload it at the bank. They settle when the bank calls back, or when you mark them paid.
            </InfoNote>

            <WebhookUrlField path={webhookPath} label="Payout callback URL (if your bank posts status updates)" />
          </div>
        </SettingsCard>
      )}

      {/* What to ask the bank for. */}
      {cfg.enabled && cfg.provider === 'bank_api' && (
        <SettingsCard icon={<Landmark size={15} className="text-[#B8983C]" />} title="What to ask your bank for">
          <SectionLabel>Onboarding checklist</SectionLabel>
          <ul className="space-y-2">
            {ONBOARDING_CHECKLIST.map(item => (
              <li key={item.field} className={`flex items-start gap-2 leading-relaxed ${k.glass ? 'text-[12.5px]' : 'text-xs'}`}>
                <span className={k.bullet} />
                <span className="min-w-0 break-words"><span className="text-[#18181B] font-medium">{item.field}</span>
                  <span className={k.glass ? 'text-slate-500' : 'text-[#A1A1AA]'}> — {item.why}</span>
                </span>
              </li>
            ))}
          </ul>
          <InfoNote tone="info">
            Ask for the corporate <em>bulk payment</em> / <em>payment initiation</em> programme, and for the sample
            request and response from their integration document — that sample is what the field renames above are
            filled in from.
          </InfoNote>
        </SettingsCard>
      )}

      {error && (
        <div className={k.error}>{error}</div>
      )}

      <SaveButton saving={saving} saved={saved} label="Save payout settings" onClick={save} />
    </div>
  )
}
