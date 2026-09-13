/**
 * @vitest-environment jsdom
 *
 * The desktop home dashboard renders the admin statistics as infographic
 * panels rather than the phone's stacked tiles. What the panels claim has to
 * stay true of the numbers behind them, so this pins down the parts that are
 * actual arithmetic rather than styling:
 *
 *  - the collection / attendance *rate* in the middle of each donut,
 *  - the arc lengths, which are what make the picture mean anything,
 *  - the empty state (nothing billed, nobody marked) reading as 0% rather
 *    than NaN, which is what a naive value/total would give on day one,
 *  - and the deep links, because the mobile tiles they replace were every
 *    admin's route into the filtered ledger and attendance views.
 */
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import FeesInfographicPanel from './FeesInfographicPanel'
import AttendanceInfographicPanel from './AttendanceInfographicPanel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

/** The visible arc lengths, in order, as fractions of the ring. */
function arcFractions(): number[] {
  // Scoped to the donut's own <svg role="img"> — lucide's icons are SVGs with
  // circles of their own and would otherwise be counted as segments.
  const donut = container.querySelector('svg[role="img"]') as SVGSVGElement
  const circles = Array.from(donut.querySelectorAll('circle'))
  const circumference = 2 * Math.PI * Number(circles[0].getAttribute('r'))
  return circles
    .slice(1) // index 0 is the empty track behind the segments
    .map(c => Number((c.getAttribute('stroke-dasharray') ?? '0').split(' ')[0]) / circumference)
}

function hrefs(): string[] {
  return Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href') ?? '')
}

const feeProps = {
  collectedHref: '/more/fees?section=issued&filter=collected',
  outstandingHref: '/more/fees?section=issued&filter=outstanding',
  todayHref: '/more/fees?section=collection',
  duesLabel: 'Students with Dues',
}

describe('FeesInfographicPanel', () => {
  it('shows the share of billed fees that has been collected', () => {
    render(
      <FeesInfographicPanel
        {...feeProps}
        summary={{ collected: 750000, outstanding: 250000, todayCollection: 4200, studentsWithDues: 37 }}
      />,
    )
    expect(container.textContent).toContain('75%')
    // 7.5L of 10L billed — three quarters of the ring, one quarter left.
    const arcs = arcFractions()
    expect(arcs[0]).toBeCloseTo(0.75, 5)
    expect(arcs[1]).toBeCloseTo(0.25, 5)
  })

  it('reads 0%, not NaN, before anything has been billed', () => {
    render(
      <FeesInfographicPanel
        {...feeProps}
        summary={{ collected: 0, outstanding: 0, todayCollection: 0, studentsWithDues: 0 }}
      />,
    )
    expect(container.textContent).toContain('0%')
    expect(container.textContent).not.toContain('NaN')
    // A zero total draws the empty track only — no arcs.
    expect(arcFractions()).toEqual([])
  })

  it('renders with no summary loaded yet', () => {
    render(<FeesInfographicPanel {...feeProps} summary={null} />)
    expect(container.textContent).toContain('0%')
    expect(container.textContent).toContain('—') // students-with-dues placeholder
  })

  it('keeps the deep links the mobile tiles carried', () => {
    render(
      <FeesInfographicPanel
        {...feeProps}
        summary={{ collected: 10, outstanding: 5, todayCollection: 1, studentsWithDues: 2 }}
      />,
    )
    const links = hrefs()
    expect(links).toContain(feeProps.collectedHref)
    expect(links).toContain(feeProps.outstandingHref)
    expect(links).toContain(feeProps.todayHref)
  })
})

describe('AttendanceInfographicPanel', () => {
  it('shows each scope\'s present rate over its own total', () => {
    render(
      <AttendanceInfographicPanel
        counts={{
          students: { present: 90, absent: 5, exception: 5 },
          staff: { present: 15, absent: 5, exception: 0 },
        }}
      />,
    )
    // 90/100 students, 15/20 staff.
    expect(container.textContent).toContain('90%')
    expect(container.textContent).toContain('75%')
  })

  it('falls back to an em dash on a day with nothing recorded', () => {
    render(
      <AttendanceInfographicPanel
        counts={{
          students: { present: 0, absent: 0, exception: 0 },
          staff: { present: 0, absent: 0, exception: 0 },
        }}
      />,
    )
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toContain('NaN')
  })

  it('links both scopes into their attendance reports', () => {
    render(<AttendanceInfographicPanel counts={null} />)
    const links = hrefs()
    expect(links).toContain('/more/attendance')
    expect(links).toContain('/more/attendance#student-absent')
    expect(links).toContain('/more/staff-attendance')
    expect(links).toContain('/more/staff-attendance#staff-exceptions')
  })
})
