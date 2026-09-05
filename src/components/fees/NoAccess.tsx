'use client'

// Shown when someone reaches a fee screen they do not hold the permission for.
//
// It names the permission in plain words and says where it is granted, because
// "access denied" leaves a clerk to guess and then ring whoever set the system
// up. Lives here rather than in a page file: Next.js pages may only export a
// default, and two screens need this one.

import React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function NoAccess({ what }: { what: string }) {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <AlertTriangle size={26} className="mx-auto text-[#D4D4D8] mb-3" />
        <h2 className="text-base font-bold text-[#27272A]">You cannot {what}</h2>
        <p className="text-sm text-[#71717A] mt-1">
          An administrator can grant this in Admin Space → Fee Settings → Permissions.
        </p>
        <Link href="/more/fees" className="text-sm text-[#27272A] hover:underline mt-4 inline-block">
          Back to fees
        </Link>
      </div>
    </div>
  )
}
