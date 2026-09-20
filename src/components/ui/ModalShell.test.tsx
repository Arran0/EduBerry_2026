/**
 * @vitest-environment jsdom
 *
 * Regression cover for the Download Centre freeze.
 *
 * The report: open a pay cycle → Download Centre → EPF/ESI → close it, and
 * from then on nothing anywhere on the page responds. Nothing is thrown that
 * reaches the console and the page still looks perfectly normal, which is what
 * made it so hard to place.
 *
 * Two separate defects in that flow are covered here. Both are real; which one
 * the client was actually hitting has never been observed first-hand, so both
 * are fixed and both are pinned down below.
 *
 *  1. The popups were flat siblings in one AnimatePresence with no `key`
 *     props. AnimatePresence identifies children *only* by key
 *     (`getChildKey = child => child.key || ''`), and its own docblock
 *     requires every child to have a unique one. Without keys they all
 *     collapse onto a single anonymous slot, and the moment two are on screen
 *     at once — the EPF panel plus the remittance preview it opens — React is
 *     handed two children under one key. What it then does with the two
 *     subtrees is undefined, and an exit that is never completed leaves
 *     ModalShell's portal root mounted: `fixed inset-0`, faded to nothing,
 *     covering the page and swallowing every click.
 *
 *  2. A crash inside a popup used to take the whole page with it. React's
 *     recovery from an uncaught render error with no boundary above it is to
 *     unmount the root, and an unmounted root is not a blank screen: the last
 *     painted frame stays exactly as it was. The page looks fine and answers
 *     nothing.
 *
 * The tests drive the real ModalShell through the real flow and assert on what
 * the user experiences: is anything still covering the page, does the page
 * still scroll, and does a click still land.
 */
import React, { useState } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'
import { AnimatePresence, MotionGlobalConfig } from 'framer-motion'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ModalShell from './ModalShell'
import ModalErrorBoundary from './ModalErrorBoundary'

// Run animations to their end instantly — the exit *completing* is what
// matters here, not how long it looks good doing it.
MotionGlobalConfig.skipAnimations = true
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
  document.body.style.overflow = ''
})

/** Let queued effects, frames and microtasks settle. */
async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }
}

function render(ui: React.ReactElement) {
  act(() => root.render(ui))
}

/** Every modal layer still mounted on <body> — what would sit over the page. */
function overlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.modal-portal'))
}

function click(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`no element ${testId}`)
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function closeTopmost() {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('.modal-portal button[aria-label="Close"]'),
  )
  act(() => { buttons.pop()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/**
 * The Download Centre, in the shape the pay cycle page renders it: flat
 * siblings in one AnimatePresence, where the Download Centre hands over to the
 * EPF panel in a single tick and the EPF panel opens a preview *alongside*
 * itself while staying open.
 */
function Page({ keyed = true }: { keyed?: boolean }) {
  const [docs, setDocs] = useState(false)
  const [epf, setEpf] = useState(false)
  const [preview, setPreview] = useState(false)
  const k = (name: string) => (keyed ? name : undefined)

  return (
    <>
      <button data-testid="page-button" onClick={() => setDocs(true)}>Download Centre</button>
      <AnimatePresence>
        {docs && (
          <ModalShell key={k('download-centre')} onClose={() => setDocs(false)} title="Download Centre">
            <button data-testid="epf-tile" onClick={() => { setDocs(false); setEpf(true) }}>EPF / ESI</button>
          </ModalShell>
        )}
        {epf && (
          <ModalShell key={k('epf-docs')} onClose={() => setEpf(false)} title="EPF / ESI Filing">
            <button data-testid="summary-tile" onClick={() => setPreview(true)}>Remittance Summary</button>
          </ModalShell>
        )}
        {preview && (
          <ModalShell key={k('statement-preview')} onClose={() => setPreview(false)} title="Preview">
            <p>Remittance summary</p>
          </ModalShell>
        )}
      </AnimatePresence>
    </>
  )
}

describe('Download Centre → EPF/ESI → close', () => {
  it('leaves nothing covering the page, and the page still responds', async () => {
    const onPageClick = vi.fn()
    render(<Page />)
    await settle()
    document.querySelector('[data-testid="page-button"]')!.addEventListener('click', onPageClick)

    click('page-button')   // open Download Centre
    await settle()
    click('epf-tile')      // hand over to EPF/ESI in a single tick
    await settle()
    click('summary-tile')  // EPF opens the preview *alongside* itself
    await settle()
    expect(overlays()).toHaveLength(2)

    closeTopmost()         // close the preview
    await settle()
    closeTopmost()         // close the EPF panel
    await settle()

    // The freeze, as the user meets it: something left over and covering the
    // page. ModalShell's portal root is `fixed inset-0`, so one left behind is
    // invisible and swallows every click on the page.
    expect(overlays()).toHaveLength(0)
    expect(document.body.style.overflow).not.toBe('hidden')

    onPageClick.mockClear()
    click('page-button')
    expect(onPageClick).toHaveBeenCalledTimes(1)
  })

  it('releases the body scroll lock once every popup has closed', async () => {
    render(<Page />)
    await settle()

    click('page-button')
    await settle()
    expect(document.body.style.overflow).toBe('hidden')

    click('epf-tile')
    await settle()
    click('summary-tile')
    await settle()
    // Two shells open at once must still be one net lock to release.
    expect(document.body.style.overflow).toBe('hidden')

    closeTopmost()
    await settle()
    closeTopmost()
    await settle()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  /**
   * Guards the fix rather than a symptom. Drop the keys and React is handed
   * two children under the same key the moment two popups are open together —
   * so if someone removes them later, this says so immediately and why.
   */
  it('without keys, React is handed duplicate children', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Page keyed={false} />)
    await settle()

    click('page-button')
    await settle()
    click('epf-tile')
    await settle()
    click('summary-tile')
    await settle()

    expect(err.mock.calls.some(c => String(c[0]).includes('same key'))).toBe(true)
    err.mockRestore()
  })
})

describe('a crash inside a popup', () => {
  function Boom(): React.ReactElement {
    throw new Error('PDF preview exploded')
  }

  /**
   * The other half of the freeze. Without a boundary between a popup and the
   * root, React unmounts the entire app — which leaves the last frame painted
   * on screen and every control on it dead.
   */
  it('is contained, and leaves the rest of the page working', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onPageClick = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button data-testid="page-button" onClick={() => setOpen(true)}>open</button>
          <AnimatePresence>
            {open && (
              <ModalErrorBoundary key="boom" onClose={() => setOpen(false)}>
                <Boom />
              </ModalErrorBoundary>
            )}
          </AnimatePresence>
        </>
      )
    }

    render(<Harness />)
    await settle()
    document.querySelector('[data-testid="page-button"]')!.addEventListener('click', onPageClick)

    click('page-button')
    await settle()

    // The apology is shown...
    expect(document.body.textContent).toContain('Something went wrong')
    // ...and the page behind it is still mounted and still listening.
    onPageClick.mockClear()
    click('page-button')
    expect(onPageClick).toHaveBeenCalledTimes(1)

    err.mockRestore()
  })
})
