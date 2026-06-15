'use client'

import React from 'react'
import { BusFee } from '@/lib/bus'

// Monochrome status pills — emphasis by tone, not hue (matches Fee Manager).
const CHIP: Record<BusFee['status'], string> = {
  paid: 'bg-slate-800 text-white',
  partial: 'bg-slate-200 text-slate-700',
  unpaid: 'bg-white text-slate-700 border border-slate-300',
  cancelled: 'bg-slate-100 text-slate-400 line-through',
}

const LABEL: Record<BusFee['status'], string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', cancelled: 'Cancelled',
}

export default function FeeStatusBadge({ status }: { status: BusFee['status'] }) {
  return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${CHIP[status]}`}>{LABEL[status]}</span>
}
