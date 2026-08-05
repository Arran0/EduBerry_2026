'use client'

import React from 'react'
import {
  BankConnection, BankAuthMode, BANK_AUTH_MODES, SignatureEncoding,
} from '@/lib/bankConfig'
import { BankConnectionSecrets } from '@/lib/paymentSecrets'
import {
  Field, TextInput, NumberInput, PwInput, PemInput, SelectInput,
  ToggleRow, InfoNote, Advanced, HeaderListField, SectionLabel,
} from './primitives'

// The credential form for one bank connection. Which fields appear is driven by
// the auth mode the bank uses, so an admin only ever sees the keys their own
// bank actually issued — the difference between "here are 14 boxes" and "here
// are the four things on your sanction letter".
//
// Shared by fee collection and salary payout. Everything typed here that is a
// credential lands in payment_secrets (admin-only); the rest is operational
// config in site_settings.

interface Props {
  connection: BankConnection
  onConnection: (next: BankConnection) => void
  secrets: BankConnectionSecrets
  onSecrets: (next: BankConnectionSecrets) => void
  /** Collections never debit an account, so the caller adds those fields. */
  children?: React.ReactNode
}

export default function BankConnectionFields({ connection, onConnection, secrets, onSecrets, children }: Props) {
  const set = <K extends keyof BankConnection>(key: K, value: BankConnection[K]) =>
    onConnection({ ...connection, [key]: value })
  const setSecret = <K extends keyof BankConnectionSecrets>(key: K, value: BankConnectionSecrets[K]) =>
    onSecrets({ ...secrets, [key]: value })

  const mode = connection.auth_mode
  const activeHint = BANK_AUTH_MODES.find(m => m.value === mode)?.hint

  return (
    <div className="space-y-4">
      <SectionLabel>Connection</SectionLabel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Bank name" hint="Label only — shown in these settings.">
          <TextInput value={connection.bank_name} onChange={v => set('bank_name', v)} placeholder="e.g. Indian Bank" />
        </Field>
        <Field label="Corporate / customer ID" hint="Identifies the school on every request.">
          <TextInput value={secrets.corporate_id} onChange={v => setSecret('corporate_id', v)} placeholder="From your bank onboarding pack" />
        </Field>
      </div>

      <Field
        label="API base URL"
        hint="Your bank issues a per-corporate host. Use the UAT host until they certify you for production."
      >
        <TextInput value={connection.api_base_url} onChange={v => set('api_base_url', v)} placeholder="https://api.yourbank.co.in/corporate/v1" mono />
      </Field>

      <Field label="Authentication" hint={activeHint}>
        <SelectInput
          value={mode}
          onChange={(v: BankAuthMode) => set('auth_mode', v)}
          options={BANK_AUTH_MODES.map(m => ({ value: m.value, label: m.label }))}
        />
      </Field>

      {/* Only the credentials the selected scheme actually uses. */}
      {mode === 'api_key' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="API key header" hint="The header name your bank documents.">
            <TextInput value={connection.api_key_header} onChange={v => set('api_key_header', v)} placeholder="x-api-key" mono />
          </Field>
          <Field label="API key">
            <PwInput value={secrets.api_key} onChange={v => setSecret('api_key', v)} placeholder="Key issued by the bank" />
          </Field>
        </div>
      )}

      {(mode === 'basic' || mode === 'oauth2') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Client ID">
            <TextInput value={secrets.client_id} onChange={v => setSecret('client_id', v)} placeholder="Consumer / client key" />
          </Field>
          <Field label="Client secret">
            <PwInput value={secrets.client_secret} onChange={v => setSecret('client_secret', v)} placeholder="Consumer / client secret" />
          </Field>
        </div>
      )}

      {mode === 'oauth2' && (
        <>
          <Field label="Token URL" hint="Absolute URL of the bank's OAuth2 token endpoint.">
            <TextInput value={connection.oauth_token_url} onChange={v => set('oauth_token_url', v)} placeholder="https://api.yourbank.co.in/oauth/token" mono />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Scope" hint="Leave blank unless your bank requires one.">
              <TextInput value={connection.oauth_scope} onChange={v => set('oauth_scope', v)} placeholder="payments" />
            </Field>
            <Field label="Audience" hint="Optional; some token endpoints demand it.">
              <TextInput value={secrets.oauth_audience} onChange={v => setSecret('oauth_audience', v)} placeholder="Leave blank if unused" />
            </Field>
          </div>
        </>
      )}

      {mode === 'hmac' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Request signing secret">
            <PwInput value={secrets.signing_secret} onChange={v => setSecret('signing_secret', v)} placeholder="Shared secret used to sign each request" />
          </Field>
          <Field label="Client ID" hint="Sent alongside the signature when your bank expects it.">
            <TextInput value={secrets.client_id} onChange={v => setSecret('client_id', v)} placeholder="Optional" />
          </Field>
        </div>
      )}

      {/* Callback verification — needed in every mode. */}
      <Field label="Callback secret" hint="Verifies that a payment notification really came from your bank.">
        <PwInput value={secrets.webhook_secret} onChange={v => setSecret('webhook_secret', v)} placeholder="HMAC secret for incoming callbacks" />
      </Field>

      {children}

      {/* Mutual TLS — required by most Indian corporate banking programmes. */}
      <ToggleRow
        label="Bank requires a client certificate (mutual TLS)"
        checked={connection.use_client_cert}
        onChange={() => set('use_client_cert', !connection.use_client_cert)}
      />
      {connection.use_client_cert && (
        <div className="space-y-3">
          <Field label="Client certificate (PEM)">
            <PemInput value={secrets.client_cert_pem} onChange={v => setSecret('client_cert_pem', v)} />
          </Field>
          <Field label="Client private key (PEM)">
            <PemInput value={secrets.client_key_pem} onChange={v => setSecret('client_key_pem', v)} placeholder="-----BEGIN PRIVATE KEY-----" />
          </Field>
          <Field label="Certificate passphrase" hint="Leave blank if the key is not encrypted.">
            <PwInput value={secrets.client_cert_passphrase} onChange={v => setSecret('client_cert_passphrase', v)} placeholder="Optional" />
          </Field>
          <InfoNote tone="info">
            Convert a <code>.p12</code> / <code>.pfx</code> bundle to PEM before pasting it —
            <code> openssl pkcs12 -in bank.p12 -clcerts -nokeys -out cert.pem</code> and
            <code> openssl pkcs12 -in bank.p12 -nocerts -nodes -out key.pem</code>.
          </InfoNote>
        </div>
      )}

      <Advanced title="Advanced — signatures, headers, timeout">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Signature header" hint="Header your bank puts the callback signature in.">
            <TextInput value={connection.signature_header} onChange={v => set('signature_header', v)} placeholder="x-signature" mono />
          </Field>
          <Field label="Signature encoding">
            <SelectInput
              value={connection.signature_encoding}
              onChange={(v: SignatureEncoding) => set('signature_encoding', v)}
              options={[{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Signature prefix" hint="Only if your bank prefixes the digest, e.g. sha256=">
            <TextInput value={connection.signature_prefix} onChange={v => set('signature_prefix', v)} placeholder="Leave blank for none" mono />
          </Field>
          <Field label="Timeout (ms)" hint="Bank gateways are slower than card gateways.">
            <NumberInput value={connection.timeout_ms} onChange={v => set('timeout_ms', v)} min={1000} step={1000} />
          </Field>
        </div>
        <Field label="Extra headers" hint="Non-secret headers your bank requires on every call (channel IDs, API versions).">
          <HeaderListField headers={connection.extra_headers} onChange={v => set('extra_headers', v)} />
        </Field>
        <InfoNote tone="info">
          Both encodings are accepted when a callback arrives, so an incorrect setting here
          will not silently drop a payment.
        </InfoNote>
      </Advanced>
    </div>
  )
}
