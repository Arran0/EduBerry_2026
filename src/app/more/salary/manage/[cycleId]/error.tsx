'use client'

import { useEffect } from 'react'
import { RotateCw, ArrowLeft, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

/**
 * Route-level containment for the pay cycle sheet.
 *
 * ModalErrorBoundary catches a crash *inside* one of the Download Centre
 * popups. It cannot catch one in the page around them — the sheet's own
 * render, its memoised payroll figures, or anything a popup's callback pushes
 * back up into page state. With no boundary above that point React's only
 * recovery is to unmount the whole root, and an unmounted root is not a blank
 * screen: the last painted frame stays on screen exactly as it was. The page
 * looks completely normal and answers nothing — no button, no link, no scroll
 * — which is precisely how this failure was reported, three times, with
 * nothing in the console to explain it.
 *
 * Next's App Router picks this file up automatically for the segment. It turns
 * that silent death into something that says what happened and offers a way
 * out.
 */
export default function SalaryCycleError({ error, reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Pay cycle page crashed:', error)
  }, [error])

  // A crash can strand the body mid-scroll-lock, leaving the page unscrollable
  // even after recovery. Nothing is holding it now — the tree that was is gone.
  useEffect(() => {
    document.body.style.overflow = ''
  }, [])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="bg-white border border-[#E4E4E7] p-6 max-w-md w-full">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 bg-[#FBF6E9] border border-[#EFE3C4] flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={17} className="text-[#8A6D1F]" />
          </div>
          <h1 className="font-display text-base font-bold text-[#18181B] leading-tight">
            This pay cycle couldn&apos;t be displayed
          </h1>
        </div>

        <p className="text-[12.5px] text-[#71717A] leading-relaxed mb-1">
          Something in the sheet failed to render. Nothing has been changed — no figure, no record and
          no payment is affected by this.
        </p>
        <p className="text-[11px] text-[#A1A1AA] leading-relaxed mb-4 font-mono break-words">
          {error.message || 'Unknown error'}
          {error.digest ? ` · ${error.digest}` : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3.5 py-2 transition-colors"
          >
            <RotateCw size={13} /> Try again
          </button>
          <Link
            href="/more/salary"
            className="inline-flex items-center gap-1.5 border border-[#E4E4E7] text-[#52525B] hover:text-[#27272A] hover:border-[#A1A1AA] text-xs font-semibold px-3.5 py-2 transition-colors"
          >
            <ArrowLeft size={13} /> Salary Manager
          </Link>
        </div>
      </div>
    </div>
  )
}
