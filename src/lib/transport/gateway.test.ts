// ============================================================================
// The message a school sends its GPS vendor.
//
// Vendors act on this text literally, so it must carry the exact address and
// port, the IMEI, and the warning that keeps the government and SOS servers
// untouched — an AIS-140 unit pointed away from those is out of compliance.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { linkDetails, vendorMessage } from './gateway'

describe('vendorMessage', () => {
  const msg = vendorMessage({ bus: 'Bus 1', imei: '864000000000001', host: '159.89.1.1', port: 5179 })

  it('names the bus, IMEI, address and port', () => {
    expect(msg).toContain('Bus 1 (IMEI 864000000000001)')
    expect(msg).toContain('Server IP: 159.89.1.1')
    expect(msg).toContain('Port: 5179')
    expect(msg).toContain('TCP, standard AIS-140')
  })

  it('asks for a spare slot and forbids touching the government and SOS servers', () => {
    expect(msg).toContain('spare or additional server slot')
    expect(msg).toContain('Do NOT change or remove the government (VLTD) server or the emergency (SOS) server')
  })
})

describe('linkDetails', () => {
  it('gives support the IMEI and the exact forward address', () => {
    expect(linkDetails({ bus: 'Bus 1', imei: '864', origin: 'https://s.example', keyId: 'k', secret: 's' }))
      .toBe('Bus: Bus 1\nIMEI: 864\nForward URL: https://s.example/api/transport/ingest?key=k&secret=s')
  })
})
