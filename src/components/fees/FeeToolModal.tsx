'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The popup a fee tool opens in — Reminders, late-fee rules, Concessions.
//
// The module's one sheet (ModalShell, glass, squared), wide enough for a table
// and tall enough that switching what is inside does not make it jump.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import ModalShell from '@/components/ui/ModalShell'
import { FEE_ICON } from '@/components/fees/ui'

export default function FeeToolModal({
  title, subtitle, icon, onClose, children,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <ModalShell
      onClose={onClose}
      sharp
      size="2xl"
      title={title}
      subtitle={subtitle}
      icon={icon}
      iconClassName={FEE_ICON}
      bodyClassName="space-y-3"
      minHClass="sm:min-h-[34rem]"
    >
      {children}
    </ModalShell>
  )
}
