'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The popup a fee tool opens in.
//
// Reminders, late fees and concessions are things the office reaches for a few
// times a day and then closes again. They were tabs, which meant the Collection
// Center carried six of them and the two screens anybody actually works in —
// the counter and the ledger — were two of six rather than the page itself.
//
// They are now popups over that page. This is the one surface they share, so a
// tool cannot drift into looking like a screen of its own: the module's paper
// background, the module's hairlines, and a body wide enough for a table.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import ModalShell from '@/components/ui/ModalShell'

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
      iconClassName="bg-[#27272A] text-[#B8983C]"
      // The fee module's paper, not the shell's white: a dense ledger dropped
      // on white reads as a different product from the page behind it.
      bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3 space-y-3"
      minHClass="sm:min-h-[34rem]"
    >
      {children}
    </ModalShell>
  )
}
