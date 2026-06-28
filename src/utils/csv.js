// Lightweight CSV export — no external dependencies.
// Excel-friendly: prepends a UTF-8 BOM so Arabic (and other non-ASCII) renders
// correctly, and guards against CSV-injection on fields starting with = + - @.

function escapeCell(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@]/.test(s)) s = "'" + s
  // Quote if the cell contains a comma, quote, or newline.
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

/**
 * Build a CSV string from rows.
 * @param {Array<Object>} rows
 * @param {Array<{key:string,label:string,map?:(v,row)=>any}>} columns
 */
export function toCSV(rows, columns) {
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const body = rows.map((row) =>
    columns
      .map((c) => escapeCell(c.map ? c.map(row[c.key], row) : row[c.key]))
      .join(',')
  )
  return [header, ...body].join('\r\n')
}

/** Trigger a browser download of `content` as a UTF-8 CSV file. */
export function downloadCSV(filename, content) {
  const BOM = '﻿'
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Convenience: build + download in one call. */
export function exportCSV(filename, rows, columns) {
  downloadCSV(filename, toCSV(rows, columns))
}
