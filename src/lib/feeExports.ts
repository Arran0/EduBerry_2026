/**
 * Tabular export helper — writes an .xlsx the browser downloads.
 *
 * `rows` is an array of flat objects; the keys of the first row become the
 * column headers, so build the rows in display order.
 *
 * SheetJS is loaded on the click rather than with the page. It is ~150 kB
 * parsed, which was arriving in the Collection Center's first load and paid
 * for by every reader, to serve an Export button most of them never press.
 * The import is cached after the first use, so a second export is immediate.
 */
export async function exportRows(
  rows: Record<string, string | number>[],
  sheetName: string,
  fileName: string,
): Promise<void> {
  const XLSX = await import('xlsx')
  const safeSheet = sheetName.slice(0, 31) // Excel caps sheet names at 31 chars
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, safeSheet)
  const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  XLSX.writeFile(workbook, name)
}
