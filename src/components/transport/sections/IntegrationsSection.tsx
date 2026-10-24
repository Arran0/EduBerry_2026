'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MessageCircle, Radio, Plus, Trash2, KeyRound, Copy, Check, Loader2, ExternalLink,
  CreditCard, Download, Globe, RefreshCw, Search, Ban, Send,
} from 'lucide-react'
import { ADMIN, SegTabs, SHEET, Sheet, EmptyRow } from '../glassAdmin'
import { supabase } from '@/lib/supabase'
import {
  createSource, deleteSource, fetchSources, rotateSourceSecret, sourceHealth,
  testSource, updateSource, type SourceKind, type TelemetrySource,
} from '@/lib/transport/devices'
import { fetchSchoolLocation } from '@/lib/transport/settings'
import { GPS_GATEWAY, linkDetails, vendorMessage } from '@/lib/transport/gateway'
import { fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import {
  CREDENTIAL_LABELS, fetchCredentials, issueCredential, registerCard, revokeCredential,
  type CredentialMethod, type StudentCredential,
} from '@/lib/transport/credentials'
import {
  downloadBlob, fetchGtfsRealtime, fetchGtfsStatic, gtfsSummary, gtfsZip, type GtfsStatic,
} from '@/lib/transport/gtfs'
import { fetchAssignableStudents } from '@/lib/transport/assignments'
import QRCode from 'qrcode'
import type { TransportVehicle } from '@/lib/transport/types'
import { Field, FormError, Select, TextInput } from '../formUI'

type Tab = 'whatsapp' | 'devices' | 'cards' | 'gtfs'

/**
 * The combined setup screen.
 *
 * Kept whole because the four panels still belong together conceptually, but
 * each is now exported on its own: the Manage popup opens WhatsApp, GPS and
 * Scan as separate destinations, so a school that never touches cards never
 * has to walk past them.
 */
export default function IntegrationsSection() {
  const [tab, setTab] = useState<Tab>('whatsapp')
  return (
    <div className="space-y-4">
      <SegTabs
        tabs={[
          { key: 'whatsapp' as const, label: 'WhatsApp', icon: <MessageCircle size={14} /> },
          { key: 'devices' as const, label: 'GPS devices', icon: <Radio size={14} /> },
          { key: 'cards' as const, label: 'Cards & QR', icon: <CreditCard size={14} /> },
          { key: 'gtfs' as const, label: 'Open data', icon: <Globe size={14} /> },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'whatsapp' ? <WhatsAppPanel />
        : tab === 'devices' ? <DevicesPanel />
        : tab === 'cards' ? <CardsPanel />
        : <GtfsPanel />}
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

export function WhatsAppPanel() {
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
          <p className="text-sm font-semibold text-[#13306B]">Meta WhatsApp Cloud API</p>
          <p className="text-[11px] text-[#5B6676] mt-1">
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
        <p className="text-sm font-semibold text-[#13306B]">Before messages will send</p>
        <ol className="text-[11px] text-[#5B6676] mt-2 space-y-1.5 list-decimal list-inside">
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

export function DevicesPanel() {
  const [sources, setSources] = useState<TelemetrySource[]>([])
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newSecret, setNewSecret] = useState<{ label: string; bus: string; imei: string; keyId: string; secret: string } | null>(null)
  const [messageFor, setMessageFor] = useState<string | null>(null)
  const [form, setForm] = useState<{ label: string; vendor: string; external_id: string; vehicle_id: string; kind: SourceKind }>({
    label: '', vendor: 'traccar', external_id: '', vehicle_id: '', kind: 'gps_device',
  })
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null)

  // Nothing is stored, so any real coordinate will do; the school's is the one
  // every deployment already has.
  const runTest = async (s: TelemetrySource) => {
    setTesting(s.id); setTestResult(null)
    const school = await fetchSchoolLocation()
    if (!school) {
      setTestResult({ id: s.id, ok: false, message: 'Set the school location first (Configuration → School location).' })
      setTesting(null)
      return
    }
    const res = await testSource(s.id, { lat: school.lat, lng: school.lng })
    setTestResult({
      id: s.id,
      ok: res.success,
      message: res.success
        ? 'Test passed: the key, secret and data format all work. Health changes only when the real device reports.'
        : `Test failed: ${res.error}`,
    })
    setTesting(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [s, v] = await Promise.all([fetchSources(), fetchVehicles()])
    setSources(s); setVehicles(v); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const busName = (vehicleId: string | null, fallback: string) => {
    const v = vehicles.find(x => x.id === vehicleId)
    return v ? vehicleLabel(v) : fallback
  }

  const add = async () => {
    if (!form.label.trim() || !form.external_id.trim()) {
      setError('A label and the IMEI are both needed')
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
    setNewSecret({
      label: form.label.trim(),
      bus: busName(form.vehicle_id || null, form.label.trim()),
      imei: form.external_id.trim(),
      keyId: res.keyId ?? '',
      secret: res.secret ?? '',
    })
    setForm({ label: '', vendor: 'traccar', external_id: '', vehicle_id: '', kind: 'gps_device' })
    setAdding(false)
    load()
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <p className="text-sm font-semibold text-[#13306B]">Connect a bus GPS</p>
        <p className="text-[11px] text-[#5B6676] mt-1">
          For buses that already have an AIS-140 GPS device. The device keeps reporting
          to the government exactly as before; it simply also reports to EduBerry.
        </p>
        <ol className="mt-3 space-y-2">
          {[
            ['Find the IMEI', 'The 15-digit number on the GPS device label. Your GPS vendor can also tell you. Note the device make and model too.'],
            ['Register it here', 'Tap Register a device, enter the IMEI and choose the bus.'],
            ['Send the linking details to EduBerry support', 'They appear right after you register. Copy them and send them to us; we connect the device on EduBerry’s GPS server.'],
            ['Message your GPS vendor', 'Tap the message icon on the device’s row, then Copy or WhatsApp. It asks them to add EduBerry as an extra server without touching the government or SOS servers.'],
            ['Check it', 'Once the vendor confirms, Health changes to Reporting within 5 minutes and the bus shows live during its scheduled trips. Still “Never reported” a day later? Contact EduBerry support with the IMEI.'],
          ].map(([title, detail], i) => (
            <li key={title} className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#13306B] text-white text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#13306B]">{title}</p>
                <p className="text-[11px] text-[#5B6676]">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {!GPS_GATEWAY.host && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-3">
            EduBerry&apos;s GPS server address isn&apos;t set for this school yet, so the vendor
            message can&apos;t be prepared. Contact EduBerry support.
          </p>
        )}
        <details className="mt-3">
          <summary className="text-[11px] text-[#94A0B1] cursor-pointer">Using your own forwarder instead (developers)</summary>
          <code className="block mt-2 text-[11px] bg-[#F7F9FB] border border-[#E2E7EE] rounded-lg px-2.5 py-2 text-[#475264] break-all">
            POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/transport/ingest
          </code>
          <p className="text-[11px] text-[#94A0B1] mt-1.5">
            Each device gets a <strong>key id</strong> and a <strong>secret</strong>. Send the key id
            in <code>x-transport-key-id</code>, a unix time in <code>x-transport-timestamp</code>, and
            in <code>x-transport-signature</code> the value
            <code> sha256=HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)</code>. The secret
            itself is never sent. Forwarders that cannot sign may append
            <code> ?key=&lt;key id&gt;&amp;secret=&lt;secret&gt;</code> instead — simpler, but the
            secret then appears in server logs, so rotate it periodically.
          </p>
        </details>
      </div>

      {newSecret && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <KeyRound size={14} /> Linking details for {newSecret.label}
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
            Copy these now and send them to EduBerry support. They contain the
            device&apos;s secret, which is shown only once. If you lose it, rotate the
            key and send the new details.
          </p>
          <SecretRow
            secret={linkDetails({
              bus: newSecret.bus,
              imei: newSecret.imei,
              origin: typeof window !== 'undefined' ? window.location.origin : '',
              keyId: newSecret.keyId,
              secret: newSecret.secret,
            })}
            multiline
          />
          <details className="mt-2">
            <summary className="text-[11px] text-amber-800 cursor-pointer">Key id and secret separately</summary>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mt-2 mb-1">Key id</p>
            <SecretRow secret={newSecret.keyId} />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mt-2 mb-1">Secret</p>
            <SecretRow secret={newSecret.secret} />
          </details>
          <button
            className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 mt-2"
            onClick={() => setNewSecret(null)}
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-[#5B6676]">
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
            <Field label="IMEI" hint="15-digit number on the device label, or ask your GPS vendor.">
              <TextInput inputMode="numeric" value={form.external_id} onChange={e => setForm(f => ({ ...f, external_id: e.target.value }))} />
            </Field>
            <Field label="Gateway" hint="Leave as EduBerry GPS server unless support says otherwise.">
              <Select value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}>
                <option value="traccar">EduBerry GPS server (Traccar)</option>
                <option value="flespi">flespi</option>
                <option value="generic">Custom / own forwarder</option>
              </Select>
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
            <span className={`${SHEET.headCell} w-40 text-right`}>Actions</span>
          </>
        }
      >
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-[#94A0B1]">Loading…</div>
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
            const message = GPS_GATEWAY.host && s.external_id
              ? vendorMessage({ bus: busName(s.vehicle_id, s.label), imei: s.external_id, host: GPS_GATEWAY.host, port: GPS_GATEWAY.port })
              : null
            return (
              <React.Fragment key={s.id}>
              <div className={SHEET.row}>
                <div className={`${SHEET.bar} ${
                  health.tone === 'ok' ? 'bg-emerald-400' : health.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-400'
                }`} />
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#13306B] truncate">{s.label}</p>
                    <p className="text-[11px] text-[#5B6676] truncate">
                      {s.vendor} · {s.external_id}
                      {s.ingest_key_prefix && ` · key ${s.ingest_key_prefix}`}
                    </p>
                    {s.last_error && (
                      <p className="text-[11px] text-rose-600 truncate">{s.last_error}</p>
                    )}
                    {testResult?.id === s.id && (
                      <p className={`text-[11px] ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {testResult.message}
                      </p>
                    )}
                  </div>
                  <span className="w-36 text-xs text-[#475264] hidden sm:block truncate">
                    {vehicle ? vehicleLabel(vehicle) : 'Not assigned'}
                  </span>
                  <span className={`w-32 text-xs hidden sm:block ${
                    health.tone === 'ok' ? 'text-emerald-600' : health.tone === 'warn' ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                    {health.label}
                  </span>
                  <div className="w-40 flex items-center justify-end gap-1 flex-shrink-0">
                    <button
                      onClick={() => setMessageFor(m => (m === s.id ? null : s.id))}
                      disabled={!message}
                      className={`p-1.5 rounded-md transition-colors disabled:opacity-40 ${
                        messageFor === s.id ? 'text-[#13306B] bg-[#F1F4F8]' : 'text-[#94A0B1] hover:text-[#13306B] hover:bg-[#F1F4F8]'
                      }`}
                      aria-label="Message for GPS vendor"
                      title={message ? 'Message for GPS vendor' : 'GPS server address not set yet'}
                    >
                      <MessageCircle size={14} />
                    </button>
                    <button
                      onClick={() => runTest(s)}
                      disabled={testing === s.id}
                      className="p-1.5 rounded-md text-[#94A0B1] hover:text-[#13306B] hover:bg-[#F1F4F8] transition-colors disabled:opacity-50"
                      aria-label="Send test" title="Send test"
                    >
                      {testing === s.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Rotate the key for “${s.label}”? The device stops reporting until EduBerry support links the new details.`)) return
                        const res = await rotateSourceSecret(s.id)
                        if (res.success && res.secret) {
                          setNewSecret({
                            label: s.label,
                            bus: busName(s.vehicle_id, s.label),
                            imei: s.external_id ?? '',
                            keyId: res.keyId ?? '',
                            secret: res.secret,
                          })
                        }
                        load()
                      }}
                      className="p-1.5 rounded-md text-[#94A0B1] hover:text-[#13306B] hover:bg-[#F1F4F8] transition-colors"
                      aria-label="Rotate key" title="Rotate key"
                    >
                      <KeyRound size={14} />
                    </button>
                    <button
                      onClick={async () => { await updateSource(s.id, { active: !s.active }); load() }}
                      className={`p-1.5 rounded-md transition-colors ${
                        s.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-[#94A0B1] hover:bg-[#F1F4F8]'
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
                      className="p-1.5 rounded-md text-[#94A0B1] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      aria-label="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
              {messageFor === s.id && message && <VendorMessage message={message} />}
              </React.Fragment>
            )
          })
        )}
      </Sheet>
    </div>
  )
}

/** The vendor message under a device row: read it, copy it, or hand it to WhatsApp. */
function VendorMessage({ message }: { message: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="px-4 py-3 bg-[#F7F9FB] border-t border-[#E2E7EE]">
      <p className="text-[11px] text-[#5B6676] mb-2">
        Send this to the company that installed the GPS device.
      </p>
      <pre className="text-[11px] whitespace-pre-wrap break-words bg-white border border-[#E2E7EE] rounded-lg px-3 py-2.5 text-[#13306B] font-sans">
        {message}
      </pre>
      <div className="flex items-center gap-2 mt-2">
        <button
          className={ADMIN.darkBtn}
          onClick={() => { navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.97] transition"
        >
          <MessageCircle size={14} /> WhatsApp
        </a>
      </div>
    </div>
  )
}

function SecretRow({ secret, multiline = false }: { secret: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className={`flex-1 min-w-0 text-[11px] bg-white border border-amber-200 rounded-lg px-2.5 py-2 text-[#13306B] break-all ${multiline ? 'whitespace-pre-wrap' : ''}`}>
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

// ── Cards & QR ──────────────────────────────────────────────────────────────

/**
 * Issue and revoke boarding credentials.
 *
 * The QR is rendered here and never anywhere else, because the token exists in
 * the browser for exactly as long as this panel is open — the server keeps only
 * its hash. An admin who navigates away has lost it, which is stated plainly
 * rather than discovered later.
 */
type PickableStudent = Awaited<ReturnType<typeof fetchAssignableStudents>>[number]

export function CardsPanel() {
  const [students, setStudents] = useState<PickableStudent[]>([])
  const [creds, setCreds] = useState<StudentCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [method, setMethod] = useState<CredentialMethod>('qr')
  const [uid, setUid] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; token: string; dataUrl: string } | null>(null)

  // The name search runs in the query rather than over the loaded page — see
  // fetchCredentials. Debounced so typing a name is one request, not one per
  // keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setCreds(await fetchCredentials(undefined, { search: debouncedQuery || undefined }))
    setLoading(false)
  }, [debouncedQuery])

  useEffect(() => { load() }, [load])

  // The picker is search-driven and capped at 50 by the query, not a dropdown
  // of every student in the school. Debounced so typing a name is one request
  // rather than one per keystroke.
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      fetchAssignableStudents(studentSearch).then(rows => { if (alive) setStudents(rows) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [studentSearch])

  const create = async () => {
    if (!studentId) { setError('Pick a student first'); return }
    setError(null); setBusy(true)

    if (method === 'qr') {
      const res = await issueCredential(studentId, 'qr', label.trim() || undefined)
      setBusy(false)
      if (!res.success || !res.token) { setError(res.error ?? 'Could not issue the card'); return }
      const name = students.find(s => s.id === studentId)?.full_name ?? 'Student'
      // Rendered client-side: the token must not travel to an image service.
      const dataUrl = await QRCode.toDataURL(res.token, { width: 320, margin: 1 })
      setIssued({ name, token: res.token, dataUrl })
    } else {
      const res = await registerCard(studentId, uid, method, label.trim() || undefined)
      setBusy(false)
      if (!res.success) { setError(res.error ?? 'Could not register the card'); return }
      setUid('')
    }
    setLabel('')
    load()
  }

  // Names are already filtered by the query; this only widens the same search
  // to the admin's own card labels within what came back.
  const filtered = useMemo(() => {
    const q = debouncedQuery.toLowerCase()
    if (!q) return creds
    return creds.filter(c =>
      (c.student?.full_name ?? '').toLowerCase().includes(q)
      || (c.label ?? '').toLowerCase().includes(q))
  }, [creds, debouncedQuery])

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <p className="text-sm font-semibold text-[#13306B]">How a card boards a child</p>
        <p className="text-[11px] text-[#5B6676] mt-1 max-w-3xl">
          A scan resolves the card to a student and then boards them exactly as a tap
          would — it cannot do anything the attendant could not. The attendant still sees
          the name that comes back, which is what catches a child carrying a friend&apos;s
          card, and a card whose owner is not on that bus says so loudly. An RFID or NFC
          reader that behaves as a keyboard needs no app: the driver screen has a scan
          field that accepts it.
        </p>
      </div>

      <div className={`${ADMIN.card} p-4 space-y-3`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <Field label="Student" hint="Type to narrow the list.">
            <div className="space-y-1.5">
              <TextInput
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                placeholder="Search by name"
              />
              <Select value={studentId} onChange={e => setStudentId(e.target.value)}>
                <option value="">Pick a student…</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}{s.grade ? ` · ${s.grade}${s.section ?? ''}` : ''}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="Kind">
            <Select value={method} onChange={e => setMethod(e.target.value as CredentialMethod)}>
              {(Object.keys(CREDENTIAL_LABELS) as CredentialMethod[]).map(m => (
                <option key={m} value={m}>{CREDENTIAL_LABELS[m]}</option>
              ))}
            </Select>
          </Field>
          {method === 'qr' ? (
            <Field label="Label" hint="What you write on the card, so you can match it later.">
              <TextInput value={label} onChange={e => setLabel(e.target.value)} placeholder="Bag tag" />
            </Field>
          ) : (
            <Field label="Card number" hint="Tap the fob on a reader, or type the UID printed on it.">
              <TextInput value={uid} onChange={e => setUid(e.target.value)} placeholder="04A2B8C1D3" />
            </Field>
          )}
          <div className="flex items-end">
            <button className={`${ADMIN.darkBtn} w-full`} onClick={create} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {method === 'qr' ? 'Issue QR' : 'Register card'}
            </button>
          </div>
        </div>
        <FormError message={error} />
      </div>

      {issued && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <CreditCard size={14} /> QR for {issued.name}
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5 mb-2">
            Print or save this now. The code is not stored and cannot be shown again —
            if it is lost, issue a new one and revoke this.
          </p>
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={issued.dataUrl} alt="Boarding QR code" width={160} height={160}
              className="rounded-lg border border-amber-200 bg-white p-1.5" />
            <div className="flex-1 min-w-[14rem] space-y-2">
              <SecretRow secret={issued.token} />
              <div className="flex gap-2">
                <button className={ADMIN.ghostBtn}
                  onClick={() => downloadBlob(dataUrlToBlob(issued.dataUrl), `qr-${issued.name.replace(/\W+/g, '-')}.png`)}>
                  <Download size={13} /> Download PNG
                </button>
                <button className={ADMIN.ghostBtn} onClick={() => setIssued(null)}>
                  I&apos;ve saved it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A0B1]" />
          <input className={ADMIN.input} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Find a student or a label" />
        </div>
        <button className={ADMIN.ghostBtn} onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <Sheet columns={<>
        <span className={`${SHEET.headCell} flex-1`}>Student</span>
        <span className={`${SHEET.headCell} w-32`}>Kind</span>
        <span className={`${SHEET.headCell} w-36`}>Last used</span>
        <span className={`${SHEET.headCell} w-28 text-right`}>Actions</span>
      </>}>
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-[#94A0B1]">Loading cards…</div>
        ) : filtered.length === 0 ? (
          <EmptyRow
            icon={<CreditCard size={22} />}
            title="No cards issued"
            detail="Issue a QR or register a fob above. Boarding by tap keeps working either way."
          />
        ) : filtered.map(c => (
          <div key={c.id} className={SHEET.row}>
            <div className={`${SHEET.bar} ${c.active ? 'bg-emerald-400' : 'bg-[#E2E7EE]'}`} />
            <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#13306B] truncate">
                  {c.student?.full_name ?? 'Unknown student'}
                </p>
                <p className="text-[11px] text-[#5B6676] truncate">
                  {c.label || 'No label'}
                  {c.student?.grade ? ` · ${c.student.grade}${c.student.section ?? ''}` : ''}
                </p>
              </div>
              <span className="w-32 text-xs text-[#475264] hidden sm:block truncate">
                {CREDENTIAL_LABELS[c.method]}
              </span>
              <span className="w-36 text-xs hidden sm:block truncate text-[#5B6676]">
                {!c.active ? <span className="text-[#94A0B1]">Revoked</span>
                  : c.last_used_at
                    ? new Date(c.last_used_at).toLocaleDateString([], { dateStyle: 'medium' })
                    : 'Never'}
              </span>
              <div className="w-28 flex items-center justify-end flex-shrink-0">
                {c.active && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Revoke this card? ${c.student?.full_name ?? 'The student'} will have to be boarded by tap until a new one is issued.`)) return
                      await revokeCredential(c.id)
                      load()
                    }}
                    className="p-1.5 rounded-md text-[#94A0B1] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    aria-label="Revoke card" title="Revoke card"
                  >
                    <Ban size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </Sheet>
    </div>
  )
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ── Open data ───────────────────────────────────────────────────────────────

/**
 * GTFS export.
 *
 * Deliberately prominent rather than buried: being able to hand the whole
 * timetable over in an open format on demand is a better argument for a school
 * staying than any lock-in would be, and a transport authority that asks for
 * the feed is not going to wait.
 */
export function GtfsPanel() {
  const [feed, setFeed] = useState<GtfsStatic | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const build = useCallback(async () => {
    setLoading(true); setError(null)
    const f = await fetchGtfsStatic()
    setLoading(false)
    if (!f) { setError('Could not build the feed. Check that routes and schedules exist.'); return }
    setFeed(f)
  }, [])

  useEffect(() => { build() }, [build])

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <p className="text-sm font-semibold text-[#13306B]">GTFS — the open timetable format</p>
        <p className="text-[11px] text-[#5B6676] mt-1 max-w-3xl">
          GTFS is what transport authorities and map apps read. Routes, stops, running
          days and stop times come straight out of what you have already set up here —
          no separate entry, and no reformatting. Declared holidays are exported as
          service exceptions, so a consumer knows not to expect a bus on Deepavali.
        </p>
        <p className="text-[11px] text-[#5B6676] mt-2 max-w-3xl">
          Live positions are available too, as GTFS-Realtime. A bus whose GPS is not
          currently reporting is left out of that feed rather than published at its last
          known position, because a consumer cannot tell a stale position from a fresh
          one and will draw the bus somewhere it is not.
        </p>
      </div>

      {error && <FormError message={error} />}

      {loading ? (
        <div className="px-4 py-10 text-center text-xs text-[#94A0B1]">
          <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Building the feed…
        </div>
      ) : feed ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
            {gtfsSummary(feed).map(s => (
              <div key={s.label} className={`${ADMIN.card} px-3 py-2.5`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#94A0B1]">{s.label}</p>
                <p className="text-xl font-bold text-[#13306B] tabular-nums mt-0.5">{s.count}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={ADMIN.darkBtn}
              onClick={() => downloadBlob(gtfsZip(feed), `gtfs-${new Date().toLocaleDateString('en-CA')}.zip`)}
              disabled={feed.routes.length === 0}
            >
              <Download size={14} /> Download GTFS feed (.zip)
            </button>
            <button
              className={ADMIN.ghostBtn}
              onClick={async () => {
                const rt = await fetchGtfsRealtime()
                if (!rt) { setError('Could not build the live feed.'); return }
                downloadBlob(
                  new Blob([JSON.stringify(rt, null, 2)], { type: 'application/json' }),
                  `gtfs-realtime-${Date.now()}.json`,
                )
              }}
            >
              <Download size={13} /> Live snapshot (JSON)
            </button>
            <button className={ADMIN.ghostBtn} onClick={build}>
              <RefreshCw size={13} /> Rebuild
            </button>
            {feed.routes.length === 0 && (
              <span className="text-[11px] text-[#94A0B1]">
                Nothing to export yet — create a route and a schedule first.
              </span>
            )}
          </div>

          <p className="text-[11px] text-[#94A0B1]">
            Built {new Date(feed.generated_at).toLocaleString()}. The live snapshot is a
            single moment; a consumer wanting a continuous feed should poll it.
          </p>
        </>
      ) : null}
    </div>
  )
}
