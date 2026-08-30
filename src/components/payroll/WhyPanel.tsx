'use client'

import React, { useState } from 'react'
import { ChevronRight, Scale, Users, Info } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import type { ExplainNode } from '@/lib/payroll/engine/types'
import { inr, PUI } from './ui'

/**
 * The "Why?" panel — a stored trace rendered as an expandable tree.
 *
 * Nothing here recomputes anything. The tree was produced by the engine at the
 * moment the figure was, and stored alongside it, so what a teacher reads in
 * December is what actually happened in June even if every rule and rate has
 * changed since. That is the whole reason the trace is persisted rather than
 * derived on demand.
 */

function fmt(value: number, unit: ExplainNode['unit']): string {
  switch (unit) {
    case 'INR': return inr(value, Math.abs(value) % 1 !== 0)
    case 'days': return `${value} day${Math.abs(value) === 1 ? '' : 's'}`
    case 'percent': return `${value}%`
    default: return String(value)
  }
}

function NodeRow({ node, depth }: { node: ExplainNode; depth: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0
  const hasDetail = !!(node.formula || node.inputs || node.note || node.rule || node.policy)
  // The top two levels start open: a reader who clicked "why" wants the answer,
  // not another thing to click.
  const [open, setOpen] = useState(depth < 2)
  const expandable = hasChildren || hasDetail

  return (
    <div className={depth > 0 ? 'border-l border-[#E4E4E7] pl-3 ml-1.5' : ''}>
      <button
        onClick={() => expandable && setOpen(o => !o)}
        disabled={!expandable}
        className={`w-full flex items-start gap-2 py-1.5 text-left ${expandable ? 'hover:bg-[#FAFAFA]' : ''} rounded px-1 -mx-1 transition-colors`}
      >
        <ChevronRight
          size={13}
          className={`mt-0.5 flex-shrink-0 text-[#A1A1AA] transition-transform ${open ? 'rotate-90' : ''} ${expandable ? '' : 'opacity-0'}`}
        />
        <span className="flex-1 text-[13px] text-[#3F3F46] leading-snug">{node.label}</span>
        <span className={`text-[13px] font-semibold tabular-nums flex-shrink-0 ${node.value < 0 ? 'text-rose-600' : 'text-[#27272A]'}`}>
          {fmt(node.value, node.unit)}
        </span>
      </button>

      {open && hasDetail && (
        <div className="ml-5 mb-2 space-y-1.5">
          {node.formula && (
            <div className="text-[11px] text-[#71717A] font-mono bg-[#FAFAFA] border border-[#F4F4F5] rounded px-2 py-1">
              {node.formula}
            </div>
          )}

          {node.inputs && Object.keys(node.inputs).length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {Object.entries(node.inputs).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-[#A1A1AA] truncate">{k}</span>
                  <span className="text-[#52525B] tabular-nums font-medium flex-shrink-0">
                    {typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '—')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Which rule version, and which cohort policy. These two lines are
              what turn a disputed deduction from an argument into a fact. */}
          {node.rule && (
            <div className="flex items-start gap-1.5 text-[11px] text-[#71717A]">
              <Scale size={11} className="mt-0.5 flex-shrink-0" />
              <span>
                {node.rule.domain.toUpperCase()} rules v{node.rule.version}, in force from {node.rule.effectiveFrom}.
              </span>
            </div>
          )}
          {node.policy && (
            <div className="flex items-start gap-1.5 text-[11px] text-[#71717A]">
              <Users size={11} className="mt-0.5 flex-shrink-0" />
              <span>{node.policy.why}</span>
            </div>
          )}
          {node.note && (
            <div className="flex items-start gap-1.5 text-[11px] text-[#52525B]">
              <Info size={11} className="mt-0.5 flex-shrink-0 text-[#A1A1AA]" />
              <span>{node.note}</span>
            </div>
          )}
        </div>
      )}

      {open && hasChildren && (
        <div>{node.children!.map((c, i) => <NodeRow key={`${c.label}-${i}`} node={c} depth={depth + 1} />)}</div>
      )}
    </div>
  )
}

export function ExplainTree({ trace }: { trace: ExplainNode }) {
  return <NodeRow node={trace} depth={0} />
}

export default function WhyPanel({ trace, title, subtitle, onClose }: {
  trace: ExplainNode
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      title={title}
      subtitle={subtitle}
      icon={<Scale size={16} />}
      iconClassName="bg-[#FBF6E9] text-[#8A6D1F]"
      minHClass="sm:min-h-[28rem]"
    >
      <div className="pb-2">
        <ExplainTree trace={trace} />
      </div>
      <p className="mt-4 pt-3 border-t border-[#F4F4F5] text-[11px] text-[#A1A1AA] leading-relaxed">
        These workings were saved when the figure was calculated, not worked out again just now — so they
        still describe this payslip even after salaries, policies or statutory rates change.
      </p>
    </ModalShell>
  )
}

/** Wraps any amount so clicking it opens its own workings. */
export function Explain({ trace, children, title, subtitle }: {
  trace: ExplainNode | null | undefined
  children: React.ReactNode
  title: string
  subtitle?: string
}) {
  const [open, setOpen] = useState(false)
  if (!trace) return <>{children}</>
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="underline decoration-dotted decoration-[#D4D4D8] underline-offset-2 hover:decoration-[#27272A] transition-colors"
        title="Show the workings"
      >
        {children}
      </button>
      {open && <WhyPanel trace={trace} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />}
    </>
  )
}

export { PUI }
