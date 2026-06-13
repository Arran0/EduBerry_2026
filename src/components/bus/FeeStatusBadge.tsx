'use client'

import React from 'react'
import { BusFee } from '@/lib/bus'

const CHIP: Record<BusFee['status'], string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  unpaid: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
}

const LABEL: Record<BusFee['status'], string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', cancelled: 'Cancelled',
}

export default function FeeStatusBadge({ status }: { status: BusFee['status'] }) {
  return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[status]}`}>{LABEL[status]}</span>
}
