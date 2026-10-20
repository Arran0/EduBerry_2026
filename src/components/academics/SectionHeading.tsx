import React from 'react'

/**
 * The heading every Academics section uses: a small gradient chip, the title,
 * an optional count, and the section's own action on the right.
 *
 * The title wraps instead of truncating, and the action drops below it when a
 * narrow phone has no room for both — nothing is ever cut off.
 */
export default function SectionHeading({
  icon: Icon, chipClass, title, count, titleAction, action, as: Tag = 'h2',
}: {
  icon: React.ElementType
  chipClass: string
  title: string
  count?: number | null
  /** A small control that belongs to the title itself (e.g. a toggle glyph). */
  titleAction?: React.ReactNode
  action?: React.ReactNode
  as?: 'h2' | 'h3'
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 min-h-[2.25rem]">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className={`icon-chip w-8 h-8 flex-shrink-0 ${chipClass}`}>
          <Icon size={15} className="relative z-10 text-white" />
        </div>
        <Tag className="min-w-0 font-display text-[1.125rem] sm:text-[1.25rem] font-bold leading-tight text-slate-900 break-words">
          {title}
          {count != null && (
            <span className="ml-2 align-middle text-[12px] font-semibold text-slate-500 tabular-nums">{count}</span>
          )}
        </Tag>
        {titleAction && <span className="flex-shrink-0 inline-flex">{titleAction}</span>}
      </div>
      {action && <div className="flex-shrink-0 ml-auto max-w-full">{action}</div>}
    </div>
  )
}
