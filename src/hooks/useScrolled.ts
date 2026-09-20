import { useEffect, useState } from 'react'

/**
 * True once the page has been scrolled past `threshold`. Used to fade a
 * sticky header toward translucency as the user scrolls, so it doesn't sit
 * fully opaque over content once they're actively using the page.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  return scrolled
}
