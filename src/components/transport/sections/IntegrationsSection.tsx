'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  MessageCircle, Radio, Plus, Trash2, KeyRound, Copy, Check, Loader2, ExternalLink,
} from 'lucide-react'
import { ADMIN, SegTabs, SHEET, Sheet } from '@/components/bus/adminUI'
import { supabase } from '@/lib/supabase'
import {
  createSource, deleteSource, fetchSources, rotateSourceSecret, sourceHealth,
  updateSource, type SourceKind, type TelemetrySource,
} from '@/lib/transport/devices'
import { fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportVehicle } from '@/lib/transport/types'
import { Field, FormError, Select, TextInput } from '../formUI'
import { EmptyRow } from './FleetSection'

type Tab = 'whatsapp' | 'devices'

export default function IntegrationsSection() {
  const [tab, setTab] = useState<Tab>('whatsapp')
  return (
    <div className="space-y-4">
      <SegTabs
        tabs={[
          { key: 'whatsapp' as const, label: 'WhatsApp', icon: <MessageCircle size={14} /> },
          { key: 'devices' as const, label: 'GPS devices', icon: <Radio size={14} /> },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'whatsapp' ? <WhatsAppPanel /> : <DevicesPanel />}
    </div>
  )
}

// ── WhatsApp ────────────────────────────────────────────────────────────────

const WA_FIELDS: { key: string; label: string; secret?: boolean; hint?: string }[] = [
  { key: 'phone_number_id', label: 'Phone number ID', hint: 'From the WhatsApp section of Meta Business.' },
  { key: 'access_token', label: 'Access token', secret: true, hint: 'A permanent system-user token, not a temporary one.' },
  { key: 'app_secret', label: 'App secret', secret: true, hint: 'Used to verify delivery-status webhooks.' },
  { key: 'verify_token', label: 'Webhook verify token', secret: true, hint: 'Any string you also paste into Meta.' },
  { key: 'default_country_code', label: 'Default country code', hint: 'Applied to numbers stored without one. 91 for India.' },
]

function WhatsAppPanel() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('integration_secrets').select('value').eq('key', 'whatsapp').maybeSingle()
      .then(({ data }) => setValues((data?.value ?? {}) as Record<string, string>))
  }, [])

  const save = async () => {
    setSaving(true); setError(null)
    const { error: err } = await supabase
      .from('integration_secrets')
      .upsert({ key: 'whatsapp', value: { provider: 'meta_cloud', ...values } }, { onConflict: 'key' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`${ADMIN.card} p-4 space-y-4`}>
        <div>
          <p className="text-sm font-semibold text-[#27272A]">Meta WhatsApp Cloud API</p>
          <p className="text-[11px] text-[#71717A] mt-1">
            WhatsApp is used only for the messages where a missed push has real
            consequence: a child who didn&apos;t board, a child not dropped off, a
            serious delay, a trip change, and an emergency. Everything else goes
            out as a free push notification.
          </p>
        </div>

        <FormError message={error} />

        {WA_FIELDS.map(f => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <TextInput
              type={f.secret ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              autoComplete="off"
            />
          </Field>
        ))}

        <div className="flex items-center gap-2">
          <button className={ADMIN.darkBtn} onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save credentials
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 font-semibold inline-flex items-center gap-1">
              <Check size={13} /> Saved
            </span>
          )}
        </div>
      </div>

      <div className={`${ADMIN.card} p-4`}>
        <p className="text-sm font-semibold text-[#27272A]">Before messages will send</p>
        <ol className="text-[11px] text-[#71717A] mt-2 space-y-1.5 list-decimal list-inside">
          <li>
            Meta requires every business-initiated message to use a template they have
            approved. The six templates EdZee sends are seeded with suggested copy —
            submit them in Meta Business, then paste each approved template name against
            its event.
          </li>
          <li>
            A family must have opted in before EdZee will message them. That consent is
            recorded per student, and the sender skips anyone without it rather than
            risking the school&apos;s number being blocked.
          </li>
          <li>
            Until a template is approved, its event still delivers as a push
            notification — nothing is lost while you wait.
          </li>
        </ol>
        <a
          className="text-[11px] font-semibold text-sky-700 hover:underline inline-flex items-center gap-1 mt-2"
          href="https://business.facebook.com/wa/manage/message-templates/"
          target="_blank" rel="noreferrer"
        >
          Open Meta message templates <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

// ── Devices ─────────────────────────────────────────────────────────────────

function DevicesPanel() {
  const [sources, setSources] = useState<TelemetrySource[]>([])
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newSecret, setNewSecret] = useState<{ label: string; keyId: string; secret: string } | null>(null)
  const [form, setForm] = useState<{ label: string; vendor: string; external_id: string; vehicle_id: string; kind: SourceKind }>({
    label: '', vendor: 'traccar', external_id: '', vehicle_id: '', kind: 'gps_device',
  })
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, v] = await Promise.all([fetchSources(), fetchVehicles()])
    setSources(s); setVehicles(v); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!form.label.trim() || !form.external_id.trim()) {
      setError('A label and the device id are both needed')
      return
    }
    setError(null)
    const res = await createSource({
      kind: form.kind,
      label: form.label.trim(),
      vendor: form.vendor,
      external_id: form.external_id.trim(),
      vehicle_id: form.vehicle_id || null,
    })
    if (!res.success) { setError(res.error ?? 'Could not register the device'); return }
    setNewSecret({ label: form.label.trim(), keyId: res.keyId ?? '', secret: res.secret ?? '' })
    setForm({ label: '', vendor: 'traccar', external_id: '', vehicle_id: '', kind: 'gps_device' })
    setAdding(false)
    load()
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <p className="text-sm font-semibold text-[#27272A]">Using the school&apos;s existing GPS</p>
        <p className="text-[11px] text-[#71717A] mt-1.5">
          AIS-140 units push over a raw TCP socket, which this app cannot accept
          directly. The standard requires devices to report to two servers at once,
          so point the <strong>second</strong> slot at a Traccar or flespi channel and
          have it forward to the address below. The statutory feed to the state
          backend keeps working untouched, and nothing has to be reconfigured away
          from compliance.
        </p>
        <code className="block mt-2 text-[11px] bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg px-2.5 py-2 text-[#52525B] break-all">
          POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/transport/ingest
        </code>
        <p className="text-[11px] text-[#A1A1AA] mt-1.5">
          Each device gets a <strong>key id</strong> and a <strong>secret</strong>. Send the key id
          in <code>x-transport-key-id</code>, a unix time in <code>x-transport-timestamp</code>, and
          in <code>x-transport-signature</code> the value
          <code> sha256=HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)</code>. The secret
          itself is never sent. Forwarders that cannot sign may append
          <code> ?key=&lt;key id&gt;&amp;secret=&lt;secret&gt;</code> instead — simpler, but the
          secret then appears in server logs, so rotate it periodically.
        </p>
      </div>

      {newSecret && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <KeyRound size={14} /> Ingest key for {newSecret.label}
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
            Copy the secret now — it is shown once and never again. If you lose it,
            rotate the key rather than trying to recover it. The key id is not
            secret and stays visible in the list below.
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mb-1">Key id</p>
          <SecretRow secret={newSecret.keyId} />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mt-2 mb-1">Secret</p>
          <SecretRow secret={newSecret.secret} />
          <button
            className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 mt-2"
            onClick={() => setNewSecret(null)}
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-[#71717A]">
          {loading ? 'Loading…' : `${sources.length} source${sources.length === 1 ? '' : 's'}`}
        </p>
        <button className={ADMIN.darkBtn} onClick={() => setAdding(a => !a)}>
          <Plus size={14} /> Register a device
        </button>
      </div>

      {adding && (
        <div className={`${ADMIN.card} p-4 space-y-3`}>
          <FormError message={error} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Label" hint="How you'll recognise it, e.g. “Bus 12 tracker”.">
              <TextInput value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </Field>
            <Field label="Gateway" hint="Which system forwards this device's data.">
              <Select value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}>
                <option value="traccar">Traccar</option>
                <option value="flespi">flespi</option>
                <option value="generic">Custom / own forwarder</option>
              </Select>
            </Field>
            <Field label="Device id" hint="IMEI, or the unique id the gateway uses.">
              <TextInput value={form.external_id} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} />
            </Field>
            <Field label="Bus" hint="What this device is fitted to.">
              <Select value={form.vehicle_id} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">Not set</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
              </Select>
            </Field>
          </div>
          <button className={ADMIN.darkBtn} onClick={add}>Register and mint key</button>
        </div>
      )}

      <Sheet
        columns={
          <>
            <span className={`${SHEET.headCell} flex-1`}>Source</span>
            <span className={`${SHEET.headCell} w-36`}>Bus</span>
            <span className={`${SHEET.headCell} w-32`}>Health</span>
            <span className={`${SHEET.headCell} w-24 text-right`}>Actions</span>
          </>
        }
      >
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-[#A1A1AA]">Loading…</div>
        ) : sources.length === 0 ? (
          <EmptyRow
            icon={<Radio size={22} />}
            title="No GPS devices registered"
            detail="Without one, buses are tracked by the driver's phone alone — which works, but dies when the phone does."
          />
        ) : (
          sources.map(s => {
            const health = sourceHealth(s)
            const vehicle = vehicles.find(v => v.id === s.vehicle_id)
            return (
              <div key={s.id} className={SHEET.row}>
                <div className={`${SHEET.bar} ${
                  health.tone === 'ok' ? 'bg-emerald-400' : health.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-400'
                }`} />
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#27272A] truncate">{s.label}</p>
                    <p className="text-[11px] text-[#71717A] truncate">
                      {s.vendor} · {s.external_id}
                      {s.ingest_key_prefix && ` · key ${s.ingest_key_prefix}`}
                    </p>
                    {s.last_error && (
                      <p className="text-[11px] text-rose-600 truncate">{s.last_error}</p>
                    )}
                  </div>
                  <span className="w-36 text-xs text-[#52525B] hidden sm:block truncate">
                    {vehicle ? vehicleLabel(vehicle) : 'Not assigned'}
                  </span>
                  <span className={`w-32 text-xs hidden sm:block ${
                    health.tone === 'ok' ? 'text-emerald-600' : health.tone === 'warn' ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                    {health.label}
                  </span>
                  <div className="w-24 flex items-center justify-end gap-1 flex-shrink-0">
                    <button
                      onClick={async () => {
                        if (!confirm(`Rotate the key for “${s.label}”? The gateway will stop reporting until you paste the new one.`)) return
                        const res = await rotateSourceSecret(s.id)
                        if (res.success && res.secret) {
                          setNewSecret({ label: s.label, keyId: res.keyId ?? '', secret: res.secret })
                        }
                        load()
                      }}
                      className="p-1.5 rounded-md text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] transition-colors"
                      aria-label="Rotate key" title="Rotate key"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      onClick={async () => { await updateSource(s.id, { active: !s.active }); load() }}
                      className={`p-1.5 rounded-md transition-colors ${
                        s.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-[#A1A1AA] hover:bg-[#F4F4F5]'
                      }`}
                      aria-label={s.active ? 'Disable' : 'Enable'}
                      title={s.active ? 'Disable' : 'Enable'}
                    >
                      <Radio size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Remove “${s.label}”? Its stored history stays.`)) return
                        await deleteSource(s.id); load()
                      }}
                      className="p-1.5 rounded-md text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      aria-label="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </Sheet>
    </div>
  )
}

function SecretRow({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 text-[11px] bg-white border border-amber-200 rounded-lg px-2.5 py-2 text-[#27272A] break-all">
        {secret}
      </code>
      <button
        onClick={() => { navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="p-2 rounded-lg text-amber-800 hover:bg-white/70 transition-colors flex-shrink-0"
        aria-label="Copy key"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}
