import * as XLSX from 'xlsx'

/**
 * Tabular export helper for the Fee Manager reports (Collection Report / Daily
 * Collection Report, Defaulter List, Fee Head Breakdown). Writes an .xlsx the
 * browser downloads — `xlsx` is already a project dependency.
 *
 * `rows` is an array of flat objects; the keys of the first row become the
 * column headers, so build the rows in display order.
 */
export function exportRows(
  rows: Record<string, string | number>[],
  sheetName: string,
  fileName: string,
): void {
  const safeSheet = sheetName.slice(0, 31) // Excel caps sheet names at 31 chars
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheet)
  const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  XLSX.writeFile(workbook, name)
}
