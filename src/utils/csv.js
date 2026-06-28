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

/**
 * Parse CSV text into { headers, rows } where rows are arrays of strings.
 * Handles quoted fields, escaped quotes, and \r\n / \n line endings.
 */
export function parseCSV(text) {
  const clean = text.replace(/^﻿/, '') // strip BOM if present
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row) }
  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((h) => h.trim())
  return { headers, rows: rows.slice(1) }
}

/**
 * Best-effort detection of date / description / amount columns from headers.
 * Supports a single signed "amount" column OR separate debit/credit columns.
 */
export function detectStatementColumns(headers) {
  const idx = (re) => headers.findIndex((h) => re.test(h.toLowerCase()))
  return {
    date: idx(/date|تاريخ/),
    description: idx(/desc|narrative|details|memo|reference|particular|بيان|وصف/),
    amount: idx(/^amount$|^amt$|value|signed|مبلغ/),
    debit: idx(/debit|withdraw|paid out|dr\b|مدين|سحب/),
    credit: idx(/credit|deposit|paid in|cr\b|دائن|إيداع/),
  }
}

