/**
 * @vitest-environment jsdom
 *
 * Announcements no longer have a card of their own — they are rows inside the
 * notifications box, and the whole point of the merge is that reading one makes
 * it leave. This pins down the parts of that the card itself is responsible for:
 * the headline is a link into the announcements page for the announcement that
 * was clicked (that URL is what marks it read at the other end), the click is
 * reported so the row can go immediately, and the box only claims the user is
 * caught up when *neither* kind of row is left.
 */
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NotificationsSummaryCard, { AnnouncementNotice } from './NotificationsSummaryCard'
import type { NotifItem } from '@/lib/leaveNotifications'

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

const announcements: AnnouncementNotice[] = [
  { id: 'ann-1', title: 'Annual Day rehearsal moves to Friday', created_at: new Date().toISOString() },
  { id: 'ann-2', title: 'Fee counter closed on Saturday', created_at: new Date(Date.now() - 864e5).toISOString() },
]

const leaveItems: NotifItem[] = [
  { id: 'n1', appId: 'app-1', tone: 'approved', text: 'Your leave on 14 Sep was approved.', href: '#', ts: Date.now() },
]

function render(props: Partial<React.ComponentProps<typeof NotificationsSummaryCard>> = {}) {
  act(() => {
    root.render(
      <NotificationsSummaryCard
        items={[]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        onRead={() => {}}
        onOpen={() => {}}
        {...props}
      />,
    )
  })
}

describe('NotificationsSummaryCard', () => {
  it('lists announcement headlines, each linking to that announcement', () => {
    render({ announcements })
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      '/announcements?a=ann-1',
      '/announcements?a=ann-2',
    ])
    expect(container.textContent).toContain('Annual Day rehearsal moves to Friday')
  })

  it('reports a followed headline so the row can clear straight away', () => {
    const onAnnouncementOpen = vi.fn()
    render({ announcements, onAnnouncementOpen })
    const link = container.querySelector('a') as HTMLAnchorElement
    act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onAnnouncementOpen).toHaveBeenCalledWith(announcements[0])
  })

  it('shows announcements above the leave rows', () => {
    render({ announcements, items: leaveItems })
    const text = container.textContent ?? ''
    expect(text.indexOf('Annual Day rehearsal')).toBeLessThan(text.indexOf('Your leave on 14 Sep'))
  })

  it('claims "all caught up" only when both kinds of row are empty', () => {
    render({ announcements, items: [] })
    expect(container.textContent).not.toContain('all caught up')

    render({ announcements: [], items: leaveItems })
    expect(container.textContent).not.toContain('all caught up')

    render({ announcements: [], items: [] })
    expect(container.textContent).toContain('all caught up')
  })
})
