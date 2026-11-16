import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { graphVersion } = await import('./metaCloud')

describe('graphVersion', () => {
  it('defaults to v26.0', () => {
    expect(graphVersion(undefined)).toBe('v26.0')
    expect(graphVersion('')).toBe('v26.0')
  })

  it('ignores a saved version Meta is switching off', () => {
    expect(graphVersion('v21.0')).toBe('v26.0')
    expect(graphVersion('v25.0')).toBe('v26.0')
  })

  it('keeps a saved version that is newer', () => {
    expect(graphVersion('v27.0')).toBe('v27.0')
  })

  it('ignores anything that is not a version', () => {
    expect(graphVersion('latest')).toBe('v26.0')
    expect(graphVersion('v26.0/../x')).toBe('v26.0')
  })
})
