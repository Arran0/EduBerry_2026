// Serialisers for the monthly EPF and ESI uploads.
//
// The arithmetic lives in src/lib/statutory.ts; this file only decides what the
// bytes look like. Four shapes come out of it, because the two portals and the
// office's own working copy each want something different:
//
//   .txt   the ECR itself — eleven fields per line, joined by `#~#`
//   .csv   the same eleven fields, comma separated, for opening in a sheet
//   .xlsx  the office working sheet, with the contribution columns left as
//          live formulas so a wage can be corrected and everything re-adds
//   .xls   the ESIC Monthly Contribution template, which has to be an
//          Excel 97-2003 workbook with every cell stored as text
//
// SheetJS is imported lazily in the two spreadsheet writers: it is a large
// dependency and nothing on the pay cycle page needs it until someone actually
// asks for a workbook.

import {
  EcrRow, EsiRow, StatutoryConfig,
  ecrFields, esiFields, ecrRowIsFilable, esiRowIsFilable, ESI_COLUMN_HEADERS,
} from '@/lib/statutory'

/** EPFO's field separator. Not a character anyone types, which is the point. */
const ECR_DELIMITER = '#~#'

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** `jun-2026` — shared by every file name so a month's uploads sort together. */
export function statutoryPeriodSlug(month: number, year: number): string {
  return `${MONTHS_SHORT[(month || 1) - 1]}-${year}`
}

/** Only rows that would survive validation on the portal make it into a file. */
export function filableEcrRows(rows: EcrRow[]): EcrRow[] {
  return rows.filter(ecrRowIsFilable)
}

export function filableEsiRows(rows: EsiRow[]): EsiRow[] {
  return rows.filter(esiRowIsFilable)
}

// ============================================
// Plain-text formats
// ============================================

/** The ECR as uploaded: one member per line, CRLF terminated. */
export function ecrTextContent(rows: EcrRow[]): string {
  return filableEcrRows(rows)
    .map(r => ecrFields(r).join(ECR_DELIMITER))
    .join('\r\n')
}

/**
 * The same eleven fields as a comma-separated file. Names are sanitised to
 * letters and spaces upstream, so nothing here can ever need quoting.
 */
export function ecrCsvContent(rows: EcrRow[]): string {
  return filableEcrRows(rows)
    .map(r => ecrFields(r).join(','))
    .join('\r\n')
}

/** Save a string as a file. Used for the two ECR text formats. */
export function downloadTextFile(fileName: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  triggerDownload(fileName, new Blob([content], { type: mime }))
}

function triggerDownload(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ============================================
// EPF working spreadsheet (.xlsx)
// ============================================

/**
 * Rows of the working sheet as they appear on screen — the same numbers the
 * formulas below evaluate to, so the preview and the file never disagree.
 */
export function epfSheetPreviewRows(rows: EcrRow[]): (string | number)[][] {
  return filableEcrRows(rows).map(ecrFields)
}

/**
 * The office working sheet: wages as typed values, contributions as formulas.
 *
 * Keeping columns E–I live is the whole point of this file. The ECR text is
 * final once it is generated, but the wage columns get corrected right up to
 * the filing deadline, and a sheet that re-adds itself is the difference
 * between fixing one cell and rebuilding the return.
 *
 * There is no header row: the sheet mirrors the ECR's own column order, which
 * starts at the first member.
 */
async function epfWageSheetBytes(
  rows: EcrRow[],
  cfg: StatutoryConfig,
  sheetName: string,
): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const filable = filableEcrRows(rows)
  const epfPct = (cfg.epf_rate * 100).toFixed(2).replace(/\.?0+$/, '')
  const epsPct = (cfg.eps_rate * 100).toFixed(2).replace(/\.?0+$/, '')

  const ws: Record<string, unknown> = {}
  filable.forEach((r, i) => {
    const n = i + 1
    // UAN stays text: it is an identifier, and a spreadsheet left to guess
    // will render twelve digits in scientific notation.
    ws[`A${n}`] = { t: 's', v: r.uan }
    ws[`B${n}`] = { t: 's', v: r.name }
    ws[`C${n}`] = { t: 'n', v: r.grossWages }
    ws[`D${n}`] = { t: 'n', v: r.epfWages }
    // A member outside the pension scheme has no EPS wage to derive, so the
    // cell is fixed at zero rather than tracking the EPF wage above it.
    ws[`E${n}`] = r.epsApplicable
      ? { t: 'n', v: r.epsWages, f: `MIN(D${n},${cfg.eps_wage_ceiling})` }
      : { t: 'n', v: 0 }
    ws[`F${n}`] = { t: 'n', v: r.edliWages, f: `MIN(D${n},${cfg.edli_wage_ceiling})` }
    ws[`G${n}`] = { t: 'n', v: r.epfContribution, f: `ROUND(D${n}*${epfPct}%,0)` }
    ws[`H${n}`] = { t: 'n', v: r.epsContribution, f: `ROUND(E${n}*${epsPct}%,0)` }
    ws[`I${n}`] = { t: 'n', v: r.epfEpsDiff, f: `G${n}-H${n}` }
    ws[`J${n}`] = { t: 'n', v: r.ncpDays }
    ws[`K${n}`] = { t: 'n', v: r.refundOfAdvances }
  })
  ws['!ref'] = filable.length > 0 ? `A1:K${filable.length}` : 'A1:K1'
  ws['!cols'] = [
    { wch: 15 }, { wch: 28 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 10 }, { wch: 12 },
  ]

  const wb = XLSX.utils.book_new()
  // Sheet names cannot carry / \ ? * [ ] and stop at 31 characters.
  XLSX.utils.book_append_sheet(wb, ws as never, sheetName.replace(/[/\\?*[\]]/g, '').slice(0, 31))
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

export async function downloadEpfWageSheet(
  fileName: string,
  rows: EcrRow[],
  cfg: StatutoryConfig,
  sheetName: string,
): Promise<void> {
  const bytes = await epfWageSheetBytes(rows, cfg, sheetName)
  triggerDownload(fileName, new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
}

// ============================================
// ESI Monthly Contribution template (.xls)
// ============================================

/** Header row plus one row per Insured Person, exactly as written to the file. */
export function esiSheetPreviewRows(rows: EsiRow[]): string[][] {
  return filableEsiRows(rows).map(esiFields)
}

/**
 * The ESIC Monthly Contribution workbook.
 *
 * Two things about this file are not negotiable, both straight out of the
 * template's own instructions sheet: it has to be saved as Excel 97-2003
 * (`biff8`), and every cell — the day count and the wage included — has to be
 * stored as text. A numeric cell is the usual reason an otherwise correct
 * upload is rejected.
 */
async function esiContributionSheetBytes(rows: EsiRow[]): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const filable = filableEsiRows(rows)

  const ws: Record<string, unknown> = {}
  const cols = ['A', 'B', 'C', 'D', 'E', 'F']
  ESI_COLUMN_HEADERS.forEach((h, c) => { ws[`${cols[c]}1`] = { t: 's', v: h } })
  filable.forEach((r, i) => {
    esiFields(r).forEach((value, c) => { ws[`${cols[c]}${i + 2}`] = { t: 's', v: value } })
  })
  ws['!ref'] = `A1:F${filable.length + 1}`
  ws['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }]
  ws['!rows'] = [{ hpt: 46 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws as never, 'Sheet1')
  return XLSX.write(wb, { bookType: 'biff8', type: 'array' }) as ArrayBuffer
}

export async function downloadEsiContributionSheet(fileName: string, rows: EsiRow[]): Promise<void> {
  const bytes = await esiContributionSheetBytes(rows)
  triggerDownload(fileName, new Blob([bytes], { type: 'application/vnd.ms-excel' }))
}
