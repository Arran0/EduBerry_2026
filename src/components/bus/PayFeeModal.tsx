'use client'

import React from 'react'
import PaySchoolFeeModal from '@/components/fees/PaySchoolFeeModal'
import type { BusFee } from '@/lib/bus'
import type { SchoolFee } from '@/lib/fees'

/**
 * Paying a bus fee.
 *
 * This was a 250-line near-copy of the school fee modal, and the two had
 * already drifted — different tab defaults, different confirmation wording, and
 * only one of them polling for the webhook. Bus and school fees are paid the
 * same way and now settle into the same ledger, so this is a thin wrapper over
 * the one modal with `source="bus"`.
 *
 * The only real difference is which table the fee came from, and the shared
 * modal reads nothing from it beyond an id, an amount and a description.
 */

interface PayFeeModalProps {
  fee: BusFee
  /** Amount the passenger still owes; defaults to the full fee amount. */
  payable?: number
  onClose: () => void
  onPaid: () => void
}

export default function PayFeeModal({ fee, payable, onClose, onPaid }: PayFeeModalProps) {
  // The shared modal needs an id, an amount, a description and a reference.
  // Everything else on SchoolFee is unread by it, so the bus row is adapted
  // rather than the two types being merged.
  const adapted = {
    id: fee.id,
    amount: fee.amount,
    description: fee.description ?? 'Bus fee',
    upi_reference: fee.upi_reference,
    student_id: fee.passenger_id,
    fee_head_id: fee.fee_head_id ?? null,
    due_date: fee.due_date,
    status: fee.status,
    academic_year: null,
    created_by: null,
    created_at: fee.created_at,
    updated_at: fee.updated_at,
  } as unknown as SchoolFee

  return (
    <PaySchoolFeeModal
      fee={adapted}
      payable={payable}
      source="bus"
      onClose={onClose}
      onPaid={onPaid}
    />
  )
}
