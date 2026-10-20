import { describe, expect, it } from 'vitest'
import { safeHref, safeSrc } from './safeUrl'

describe('safeHref', () => {
  it('keeps web, mail and phone links', () => {
    expect(safeHref('https://youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(safeHref('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeHref('tel:+911234')).toBe('tel:+911234')
  })

  it('keeps paths on this site', () => {
    expect(safeHref('/classrooms/1')).toBe('/classrooms/1')
    expect(safeHref('#top')).toBe('#top')
  })

  it('drops script and data links however they are written', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('  JavaScript:alert(1)')).toBeUndefined()
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('vbscript:msgbox')).toBeUndefined()
    expect(safeHref('//evil.example/x')).toBeUndefined()
  })

  it('adds https to a bare domain', () => {
    expect(safeHref('example.com/page')).toBe('https://example.com/page')
  })

  it('handles empty input', () => {
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref('   ')).toBeUndefined()
    expect(safeHref('just some words')).toBeUndefined()
  })
})

describe('safeSrc', () => {
  it('only allows web addresses for embeds', () => {
    expect(safeSrc('https://www.youtube.com/embed/x')).toBe('https://www.youtube.com/embed/x')
    expect(safeSrc('mailto:a@b.com')).toBeUndefined()
    expect(safeSrc('javascript:alert(1)')).toBeUndefined()
  })
})
