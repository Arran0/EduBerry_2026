import { describe, expect, it } from 'vitest'
import {
  buildTallyEnvelope, buildVoucher, buildZohoCsv, tallyDate, esc, TallyExportError,
  type TallyVoucher,
} from './tally'

function voucher(over: Partial<TallyVoucher> = {}): TallyVoucher {
  return {
    kind: 'receipt',
    date: '2026-08-14',
    voucherNo: '2026-27/000123',
    narration: 'Tuition Fee — Term I',
    bankLedger: 'HDFC Current A/c',
    amount: 12000,
    lines: [{ ledger: 'Tuition Fee Income', amount: 12000 }],
    ...over,
  }
}

describe('Tally date and escaping', () => {
  it('emits YYYYMMDD with no separators', () => {
    expect(tallyDate('2026-08-14')).toBe('20260814')
    expect(tallyDate('2026-08-14T10:30:00Z')).toBe('20260814')
  })

  // Tally's parser is not lenient; one bad character breaks the whole envelope,
  // not one voucher.
  it('escapes every character that would break the envelope', () => {
    expect(esc(`D'Souza & Co <Ltd> "X"`)).toBe('D&apos;Souza &amp; Co &lt;Ltd&gt; &quot;X&quot;')
  })

  it('escapes a student name inside a real voucher', () => {
    const xml = buildVoucher(voucher({ narration: 'Fee for R & D <test>' }))
    expect(xml).toContain('R &amp; D &lt;test&gt;')
    expect(xml).not.toContain('R & D <test>')
  })
})

describe('voucher signs', () => {
  // The sign convention is the thing most likely to be got wrong, and getting
  // it wrong reconciles to zero while making every Tally report incorrect.
  it('debits the bank and credits income on a receipt', () => {
    const xml = buildVoucher(voucher())
    const bank = xml.slice(xml.indexOf('HDFC'), xml.indexOf('Tuition Fee Income'))
    expect(bank).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>')
    expect(bank).toContain('<AMOUNT>-12000.00</AMOUNT>')

    const income = xml.slice(xml.indexOf('Tuition Fee Income'))
    expect(income).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>')
    expect(income).toContain('<AMOUNT>12000.00</AMOUNT>')
  })

  it('mirrors the signs on a payment', () => {
    const xml = buildVoucher(voucher({ kind: 'payment' }))
    const bank = xml.slice(xml.indexOf('HDFC'), xml.indexOf('Tuition Fee Income'))
    expect(bank).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>')
    expect(bank).toContain('<AMOUNT>12000.00</AMOUNT>')
  })

  // A negative receipt reconciles but makes every collection report in Tally
  // wrong, and the school's accountant is the one who finds out.
  it('uses a Payment voucher for a refund rather than a negative Receipt', () => {
    expect(buildVoucher(voucher({ kind: 'payment' }))).toContain('VCHTYPE="Payment"')
    expect(buildVoucher(voucher())).toContain('VCHTYPE="Receipt"')
  })

  it('splits a receipt across several income ledgers', () => {
    const xml = buildVoucher(voucher({
      amount: 15000,
      lines: [
        { ledger: 'Tuition Fee Income', amount: 12000 },
        { ledger: 'Exam Fee Income', amount: 3000 },
      ],
    }))
    expect(xml).toContain('<AMOUNT>-15000.00</AMOUNT>')
    expect(xml).toContain('<AMOUNT>12000.00</AMOUNT>')
    expect(xml).toContain('<AMOUNT>3000.00</AMOUNT>')
  })

  it('includes a party ledger only when one is given', () => {
    expect(buildVoucher(voucher({ partyLedger: 'Ananya R' }))).toContain('<PARTYLEDGERNAME>Ananya R</PARTYLEDGERNAME>')
    expect(buildVoucher(voucher())).not.toContain('PARTYLEDGERNAME')
  })
})

describe('the envelope refuses to produce a silently wrong import', () => {
  it('needs a company name', () => {
    expect(() => buildTallyEnvelope({ companyName: '  ', vouchers: [voucher()] }))
      .toThrow(TallyExportError)
  })

  it('refuses when a line has no ledger name', () => {
    // Tally creates a new ledger for an unrecognised name rather than
    // rejecting it, so this would go unnoticed for a quarter.
    expect(() => buildTallyEnvelope({
      companyName: 'Test School',
      vouchers: [voucher({ lines: [{ ledger: '', amount: 12000 }] })],
    })).toThrow(/no Tally ledger name/)
  })

  it('refuses an empty period rather than emitting an empty envelope', () => {
    expect(() => buildTallyEnvelope({ companyName: 'Test School', vouchers: [] }))
      .toThrow(/nothing to export/)
  })

  it('wraps every voucher in one addressed envelope', () => {
    const xml = buildTallyEnvelope({
      companyName: 'Test School',
      vouchers: [voucher(), voucher({ voucherNo: '2026-27/000124' })],
    })
    expect(xml).toContain('<SVCURRENTCOMPANY>Test School</SVCURRENTCOMPANY>')
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>')
    expect((xml.match(/<VOUCHER /g) ?? [])).toHaveLength(2)
  })
})

describe('Zoho CSV', () => {
  const row = {
    date: '2026-08-14',
    receiptNo: '2026-27/000123',
    customerName: 'Ananya R',
    account: 'Tuition Fee Income',
    description: 'Term I',
    amount: 12000,
    paymentMode: 'UPI',
    reference: 'pay_XYZ',
  }

  it('writes a header and a row', () => {
    const csv = buildZohoCsv([row])
    const [header, line] = csv.split('\r\n')
    expect(header).toContain('Payment Number')
    expect(line).toContain('2026-27/000123')
    expect(line).toContain('12000.00')
  })

  // A student named "Rao, Ananya" would otherwise shift every column after it.
  it('quotes a value containing a comma', () => {
    const csv = buildZohoCsv([{ ...row, customerName: 'Rao, Ananya' }])
    expect(csv).toContain('"Rao, Ananya"')
  })

  it('doubles an embedded quote', () => {
    const csv = buildZohoCsv([{ ...row, description: 'Term "I"' }])
    expect(csv).toContain('"Term ""I"""')
  })

  it('quotes a value containing a newline', () => {
    const csv = buildZohoCsv([{ ...row, description: 'Line one\nLine two' }])
    expect(csv).toContain('"Line one\nLine two"')
    // Still exactly two records: the header and one row.
    expect(csv.split('\r\n')).toHaveLength(2)
  })
})
