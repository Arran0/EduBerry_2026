import { describe, it, expect } from 'vitest'
import { attachmentProblem, normalizeLinkUrl, csvField, isImageAttachment, ATTACHMENT_MAX_BYTES } from './attachmentPolicy'

describe('attachmentProblem', () => {
  it('accepts images and office documents', () => {
    expect(attachmentProblem({ name: 'photo.JPG', size: 1000 })).toBeNull()
    expect(attachmentProblem({ name: 'plan.docx', size: 1000 })).toBeNull()
    expect(attachmentProblem({ name: 'sheet.xlsx', size: 1000 })).toBeNull()
  })

  it('refuses files that would be served as active content', () => {
    expect(attachmentProblem({ name: 'logo.svg', size: 10 })).toMatch(/only images/)
    expect(attachmentProblem({ name: 'page.html', size: 10 })).toMatch(/only images/)
    expect(attachmentProblem({ name: 'noextension', size: 10 })).toMatch(/only images/)
  })

  it('refuses files over the size cap', () => {
    expect(attachmentProblem({ name: 'big.pdf', size: ATTACHMENT_MAX_BYTES + 1 })).toMatch(/15 MB/)
  })
})

describe('isImageAttachment', () => {
  it('goes by extension', () => {
    expect(isImageAttachment('a.webp')).toBe(true)
    expect(isImageAttachment('a.pdf')).toBe(false)
  })
})

describe('normalizeLinkUrl', () => {
  it('keeps http(s) links', () => {
    expect(normalizeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/')
  })

  it('reads a bare domain as https', () => {
    expect(normalizeLinkUrl('  docs.google.com/x ')).toBe('https://docs.google.com/x')
  })

  it('refuses script and data links', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('data:text/html,<script>')).toBeNull()
    expect(normalizeLinkUrl('')).toBeNull()
    expect(normalizeLinkUrl('notalink')).toBeNull()
  })
})

describe('csvField', () => {
  it('passes plain values through', () => {
    expect(csvField('Asha')).toBe('Asha')
    expect(csvField(12)).toBe('12')
    expect(csvField(null)).toBe('')
  })

  it('quotes commas and quotes', () => {
    expect(csvField('Rao, Priya')).toBe('"Rao, Priya"')
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""')
  })

  it('defuses formulas', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('@cmd')).toBe("'@cmd")
  })
})
