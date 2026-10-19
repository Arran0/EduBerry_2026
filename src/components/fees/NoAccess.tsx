'use client'

// Shown when someone reaches a fee screen they do not hold the permission for.
//
// It names the permission in plain words and says where it is granted, because
// "access denied" leaves a clerk to guess and then ring whoever set the system
// up. Lives here rather than in a page file: Next.js pages may only export a
// default, and several screens need this one.

import React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function NoAccess({ what }: { what: string }) {
  return (
    <div className="min-h-screen bg-[#FDFCF9] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <AlertTriangle size={24} className="mx-auto text-[#C9C4B4] mb-3" />
        <h2 className="font-display text-[15px] font-bold text-slate-900">You cannot {what}</h2>
        <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
          An administrator can grant this in Admin Space → Fee Settings → Permissions.
        </p>
        <Link href="/more/fees"
              className="text-[12px] font-semibold text-slate-600
                         hover:text-slate-900 mt-4 inline-block">
          Back to fees
        </Link>
      </div>
    </div>
  )
}
