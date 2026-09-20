'use client'

/**
 * Form atoms shared by the transport modals.
 *
 * Thin wrappers over the existing ADMIN tokens in components/bus/adminUI so the
 * new screens sit in the same design language as the fee and payroll surfaces
 * rather than introducing a third one.
 */

import React from 'react'
import { ADMIN } from '@/components/bus/adminUI'

export function Field({
  label, hint, children, className = '',
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className={ADMIN.label}>{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-[#A1A1AA]">{hint}</p>}
    </label>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${ADMIN.inputPlain} ${props.className ?? ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${ADMIN.inputPlain} ${props.className ?? ''}`} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${ADMIN.inputPlain} resize-none ${props.className ?? ''}`} />
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
      {message}
    </p>
  )
}

export function ModalFooter({
  onCancel, onSubmit, saving, submitLabel = 'Save', disabled = false,
}: {
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
  submitLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" className={ADMIN.ghostBtn} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={ADMIN.darkBtn} onClick={onSubmit} disabled={saving || disabled}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
