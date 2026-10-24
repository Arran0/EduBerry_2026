// ============================================================================
// Linking a school's devices on the shared GPS gateway.
//
// One Traccar server serves every school, so the thing worth pinning is that a
// school can create, re-key and remove its own devices but never take over or
// delete one that another school linked — that would silently send a bus's
// positions to the wrong school. Checked against a real Traccar 6.16 when
// written; these tests stub its API at fetch.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { linkDevice, unlinkDevice, GatewayError, type GatewayConfig } from './traccar'

const cfg: GatewayConfig = { url: 'https://gw.example', token: 't' }
const A = 'https://school-a.example'
const B = 'https://school-b.example'

type Device = { id: number; uniqueId: string; name: string; disabled: boolean; attributes: Record<string, unknown> }
let devices: Device[]
let calls: { method: string; path: string; body?: unknown }[]

beforeEach(() => {
  devices = []
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const { pathname, searchParams } = new URL(url)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, path: pathname, body })
    const json = (v: unknown, status = 200) => new Response(v === undefined ? null : JSON.stringify(v), { status })

    if (method === 'GET' && pathname === '/api/devices') {
      const kw = searchParams.get('keyword') ?? ''
      return json(devices.filter(d => d.uniqueId.includes(kw)))
    }
    if (method === 'POST' && pathname === '/api/devices') {
      const d = { ...body, id: devices.length + 1 }
      devices.push(d)
      return json(d)
    }
    const m = pathname.match(/^\/api\/devices\/(\d+)$/)
    if (m && method === 'PUT') {
      devices = devices.map(d => (d.id === Number(m[1]) ? body : d))
      return json(body)
    }
    if (m && method === 'DELETE') {
      devices = devices.filter(d => d.id !== Number(m[1]))
      return json(undefined, 204)
    }
    return json({}, 404)
  }))
})

const link = (school: string, key: string, disabled = false) =>
  linkDevice(cfg, { uniqueId: '864000000000001', name: 'Bus 1', school, forwardUrl: `${school}/ingest?key=${key}`, disabled })

describe('linkDevice', () => {
  it('creates the device with its owner and forward address', async () => {
    await link(A, 'k1')
    expect(devices).toHaveLength(1)
    expect(devices[0].attributes).toEqual({ 'eduberry.school': A, 'forward.url': `${A}/ingest?key=k1` })
  })

  it('updates the same device on a re-key or disable instead of adding another', async () => {
    await link(A, 'k1')
    await link(A, 'k2', true)
    expect(devices).toHaveLength(1)
    expect(devices[0].disabled).toBe(true)
    expect(devices[0].attributes['forward.url']).toBe(`${A}/ingest?key=k2`)
  })

  it('refuses an IMEI another school already linked', async () => {
    await link(A, 'k1')
    await expect(link(B, 'x')).rejects.toBeInstanceOf(GatewayError)
    expect(devices[0].attributes['forward.url']).toBe(`${A}/ingest?key=k1`)
  })

  it('claims a device added by hand with no owner', async () => {
    devices.push({ id: 1, uniqueId: '864000000000001', name: 'manual', disabled: false, attributes: {} })
    await link(B, 'k')
    expect(devices[0].attributes['eduberry.school']).toBe(B)
  })

  it('matches the IMEI exactly, not as a substring', async () => {
    devices.push({ id: 1, uniqueId: '8640000000000012', name: 'other', disabled: false, attributes: { 'eduberry.school': B } })
    await link(A, 'k1')
    expect(devices).toHaveLength(2)
  })
})

describe('unlinkDevice', () => {
  it('removes the school’s own device, and is a no-op once gone', async () => {
    await link(A, 'k1')
    await unlinkDevice(cfg, { uniqueId: '864000000000001', school: A })
    expect(devices).toHaveLength(0)
    await unlinkDevice(cfg, { uniqueId: '864000000000001', school: A })
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
  })

  it('never deletes another school’s device', async () => {
    await link(A, 'k1')
    await expect(unlinkDevice(cfg, { uniqueId: '864000000000001', school: B })).rejects.toBeInstanceOf(GatewayError)
    expect(devices).toHaveLength(1)
  })
})

describe('errors', () => {
  it('turns a rejected token into a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(link(A, 'k')).rejects.toThrow('rejected EduBerry’s credentials')
  })

  it('keeps only the first line of a Java stack trace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('java.lang.Oops: bad\n\tat a.b.C(D.java:1)', { status: 400 })))
    await expect(link(A, 'k')).rejects.toThrow('GPS server answered 400: java.lang.Oops: bad')
  })
})
