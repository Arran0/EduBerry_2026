/**
 * A minimal ZIP writer.
 *
 * Sixty lines rather than a dependency, because the only archive this app ever
 * builds is a GTFS feed: a handful of small text files that a consumer expects
 * as one `.zip`. Entries are stored uncompressed (method 0), which is legal
 * ZIP, universally readable, and saves implementing DEFLATE for files that are
 * a few kilobytes of CSV.
 *
 * Deliberately limited: no directories, no ZIP64, no encryption, UTF-8 names
 * flagged as such. A feed that outgrows these limits wants a real library.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  /** File contents. A string is encoded as UTF-8. */
  data: string | Uint8Array<ArrayBuffer>
}

export function makeZip(entries: ZipEntry[], modified = new Date()): Blob {
  const enc = new TextEncoder()
  // DOS timestamp: 2-second resolution, years from 1980.
  const dosTime = ((modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1)) & 0xffff
  const dosDate = (((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate()) & 0xffff

  // Typed as ArrayBuffer-backed rather than plain Uint8Array: Blob refuses a
  // view that might be over a SharedArrayBuffer, and TextEncoder's return type
  // does not promise it is not.
  const locals: Uint8Array<ArrayBuffer>[] = []
  const centrals: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const entry of entries) {
    const name = enc.encode(entry.name) as Uint8Array<ArrayBuffer>
    const data = (typeof entry.data === 'string'
      ? enc.encode(entry.data)
      : entry.data) as Uint8Array<ArrayBuffer>
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)          // version needed
    local.setUint16(6, 0x0800, true)      // UTF-8 filename
    local.setUint16(8, 0, true)           // stored
    local.setUint16(10, dosTime, true)
    local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    locals.push(new Uint8Array(local.buffer), name, data)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)        // version made by
    central.setUint16(6, 20, true)        // version needed
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, dosTime, true)
    central.setUint16(14, dosDate, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, data.length, true)
    central.setUint32(24, data.length, true)
    central.setUint16(28, name.length, true)
    central.setUint32(42, offset, true)
    centrals.push(new Uint8Array(central.buffer), name)

    offset += 30 + name.length + data.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

/**
 * One CSV row, escaped per RFC 4180.
 *
 * School-entered stop names contain commas, quotes and newlines — `St. Mary"s,
 * Gate 2` is a real kind of name — and a feed that breaks on one is a feed that
 * breaks silently, halfway down the file, for the consumer rather than for us.
 */
function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

/** A CSV file from a header row and a list of objects keyed by that header. */
export function csvFile(header: string[], rows: Record<string, unknown>[]): string {
  const lines = [csvRow(header)]
  for (const row of rows) {
    lines.push(csvRow(header.map(h => row[h] as string | number | null | undefined)))
  }
  // GTFS consumers vary on trailing newlines; including one is the safe side.
  return lines.join('\r\n') + '\r\n'
}
