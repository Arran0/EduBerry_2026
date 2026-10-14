/**
 * @vitest-environment jsdom
 *
 * What the home dashboard shows while it is still loading.
 *
 * The complaint these pin down is not that the page was slow — it is that it
 * moved. Cards were holes with a spinner in the middle until their fetch
 * returned, and then became something a different shape; panels stated a
 * confident zero and then replaced it. So the properties worth holding onto
 * are structural:
 *
 *  - a loading card draws the frame it is about to fill, not a spinner,
 *  - that frame is the *same* frame it has once loaded, so nothing is
 *    replaced when the data lands,
 *  - and a panel with no data yet never asserts a figure nobody measured,
 *    while still keeping the links that are true either way.
 */
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import MiniWeekCalendar, { MiniCalendarItem } from './MiniWeekCalendar'
import AttendanceInfographicPanel from './desktop/AttendanceInfographicPanel'
import FeesInfographicPanel from './desktop/FeesInfographicPanel'
import { NotificationsCardSkeleton } from './NotificationsSummaryCard'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no ResizeObserver; the week calendar uses one to pick its
// expanded-column ratio. A no-op stub leaves it at its default, which is all
// these assertions care about.
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => { root = createRoot(container) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(ui: React.ReactElement) {
  act(() => root.render(ui))
}

/** Every day number the calendar is currently showing, in order. */
function dayNumbers(): string[] {
  return Array.from(container.querySelectorAll('p'))
    .map(p => p.textContent ?? '')
    .filter(t => /^\d{1,2}$/.test(t))
}

function hrefs(): string[] {
  return Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href') ?? '')
}

const emptyWeek = new Map<string, MiniCalendarItem[]>()

describe('MiniWeekCalendar while loading', () => {
  it('draws the whole week, not a spinner', () => {
    render(<MiniWeekCalendar itemsByDay={emptyWeek} loading />)
    expect(container.querySelector('.spinner')).toBeNull()
    // Seven columns, each with its date — the frame needs no data to exist.
    expect(dayNumbers()).toHaveLength(7)
  })

  it('keeps exactly the same week when the data lands', () => {
    render(<MiniWeekCalendar itemsByDay={emptyWeek} loading />)
    const whileLoading = dayNumbers()

    render(<MiniWeekCalendar itemsByDay={emptyWeek} loading={false} />)
    // Same columns, same dates, same order: loading swaps the *entries*, never
    // the scaffold, so nothing in this card is replaced on arrival.
    expect(dayNumbers()).toEqual(whileLoading)
  })

  it('shows placeholders for entries, and drops them once loaded', () => {
    render(<MiniWeekCalendar itemsByDay={emptyWeek} loading />)
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    render(<MiniWeekCalendar itemsByDay={emptyWeek} loading={false} />)
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
  })
})

describe('notifications card while loading', () => {
  it('uses the shared shimmer rather than a spinner or a pulse', () => {
    render(<NotificationsCardSkeleton />)
    expect(container.querySelector('.spinner')).toBeNull()
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })
})

describe('desktop statistics panels while loading', () => {
  it('attendance states no rate until it has one, but keeps the way out', () => {
    render(<AttendanceInfographicPanel counts={null} loading />)
    // No donut, and so no "0%" standing in for a reading nobody took.
    expect(container.querySelector('svg[role="img"]')).toBeNull()
    expect(container.textContent).not.toContain('%')
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    // The report links are true whether or not today's numbers are in.
    expect(hrefs()).toContain('/more/attendance')
    expect(hrefs()).toContain('/more/staff-attendance')
  })

  it('fees states no collection rate until it has one', () => {
    render(
      <FeesInfographicPanel
        summary={null}
        loading
        collectedHref="/more/fees?filter=collected"
        outstandingHref="/more/fees?filter=outstanding"
        todayHref="/more/fees?section=collection"
        duesLabel="Students with Dues"
      />,
    )
    expect(container.textContent).not.toContain('%')
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(hrefs()).toContain('/more/fees?section=collection')
  })

  it('still reports a real zero as zero once loaded', () => {
    // The point is the difference between "not measured" and "measured, zero".
    render(
      <AttendanceInfographicPanel
        counts={{ students: { present: 0, absent: 0, exception: 0 }, staff: { present: 0, absent: 0, exception: 0 } }}
      />,
    )
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
    expect(container.textContent).toContain('not marked yet')
  })
})
