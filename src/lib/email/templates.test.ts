import { describe, it, expect } from 'vitest'
import { renderAccountEmail, senderDisplayName } from './templates'

const base = {
  schoolName: 'Muthamil Public School',
  platformName: 'EduBerry',
  actionUrl: 'https://mps.example.com/update-password?token_hash=abc&type=invite',
}

describe('sender display name', () => {
  it('names the school and the platform it is sent through', () => {
    expect(senderDisplayName('Muthamil Public School', 'EduBerry')).toBe('Muthamil Public School via EduBerry')
  })

  it('strips characters that would break the From header', () => {
    expect(senderDisplayName('Evil "School" <x@y.z>\r\nBcc: a@b.c', 'EduBerry'))
      .toBe('Evil School x@y.zBcc: a@b.c via EduBerry')
  })

  it('falls back to the platform alone when the school is unnamed', () => {
    expect(senderDisplayName('  ', 'EduBerry')).toBe('EduBerry')
  })
})

describe('account email', () => {
  it('invites with the school in the subject, body and footer', () => {
    const m = renderAccountEmail({ ...base, kind: 'invite', recipientName: 'Priya Raman' })
    expect(m.subject).toBe('Set up your Muthamil Public School account')
    expect(m.text).toContain('Hi Priya,')
    expect(m.text).toContain(base.actionUrl)
    expect(m.text).toContain('Sent by EduBerry on behalf of Muthamil Public School.')
    expect(m.html).toContain('Set my password')
  })

  it('words a reset as a reset', () => {
    const m = renderAccountEmail({ ...base, kind: 'recovery' })
    expect(m.subject).toBe('Reset your Muthamil Public School password')
    expect(m.text).toContain('Hello,')
    expect(m.html).toContain('Reset my password')
  })

  it('escapes school-controlled text in the HTML', () => {
    const m = renderAccountEmail({ ...base, kind: 'invite', schoolName: '<script>alert(1)</script>' })
    expect(m.html).not.toContain('<script>alert(1)</script>')
    expect(m.html).toContain('&lt;script&gt;')
  })

  it('only uses an https logo and a hex accent colour', () => {
    const bad = renderAccountEmail({ ...base, kind: 'invite', logoUrl: 'javascript:alert(1)', accentColor: 'red;background:url(x)' })
    expect(bad.html).not.toContain('javascript:')
    expect(bad.html).not.toContain('url(x)')
    const good = renderAccountEmail({ ...base, kind: 'invite', logoUrl: 'https://cdn.example.com/logo.png', accentColor: '#0284c7' })
    expect(good.html).toContain('https://cdn.example.com/logo.png')
    expect(good.html).toContain('#0284c7')
  })

  it('points help at the school when it has a contact address', () => {
    const m = renderAccountEmail({ ...base, kind: 'recovery', schoolEmail: 'office@mps.example.com' })
    expect(m.text).toContain('Contact Muthamil Public School at office@mps.example.com.')
  })
})
