// Dependency-free Excel (.xlsx) and PDF exporters.
//
// The .xlsx writer builds a minimal but valid OOXML workbook and packages it
// with a hand-rolled ZIP (stored / no compression) so it opens in Excel,
// Numbers and Google Sheets without the "format & extension don't match"
// warning that HTML-based .xls files trigger. Strings are written as inline
// strings (UTF-8) so Arabic renders correctly.

// ─── CRC-32 (for the ZIP container) ───────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ─── Minimal ZIP (stored method) ──────────────────────────────────
function zipStore(files) {
  const enc = new TextEncoder()
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const local = [
      0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0),
    ]
    parts.push(new Uint8Array(local), nameBytes, data)
    central.push({ crc, size: data.length, nameBytes, offset })
    offset += local.length + nameBytes.length + data.length
  }
  const centralParts = []
  let centralSize = 0
  for (const c of central) {
    const cd = [
      0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.nameBytes.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset),
    ]
    const arr = new Uint8Array(cd.length + c.nameBytes.length)
    arr.set(cd, 0); arr.set(c.nameBytes, cd.length)
    centralParts.push(arr); centralSize += arr.length
  }
  const end = [
    0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]
  return new Blob([...parts, ...centralParts, new Uint8Array(end)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isNumeric = (v) => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim() !== '')

function colRef(i) {
  let s = ''; i++
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
  return s
}

function sheetXml(matrix) {
  const rows = matrix.map((row, r) => {
    const cells = row.map((val, c) => {
      const ref = `${colRef(c)}${r + 1}`
      if (val === null || val === undefined || val === '') return `<c r="${ref}"/>`
      if (isNumeric(val)) return `<c r="${ref}" t="n"><v>${Number(val)}</v></c>`
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
}

export function buildXlsx(matrix, sheetName = 'Sheet1') {
  const safeName = (sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(matrix) },
  ]
  return zipStore(files)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Export rows to a real .xlsx file. columns: [{label, key, map?}] */
export function exportExcel(filename, rows, columns, sheetName = 'Sheet1') {
  const header = columns.map((c) => c.label)
  const body = rows.map((row) => columns.map((c) => {
    const v = c.map ? c.map(row[c.key], row) : row[c.key]
    return v === null || v === undefined ? '' : v
  }))
  const blob = buildXlsx([header, ...body], sheetName)
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * Export rows to PDF via a print window (the browser's "Save as PDF").
 * Produces vector, Arabic-correct output. meta = { title, subtitle, dir }.
 */
export function exportPDF(rows, columns, meta = {}) {
  const dir = meta.dir || document.documentElement.dir || 'ltr'
  const align = dir === 'rtl' ? 'right' : 'left'
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const head = `<tr>${columns.map((c) => `<th style="text-align:${c.right ? 'right' : align}">${esc(c.label)}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr>${columns.map((c) => {
    const v = c.map ? c.map(row[c.key], row) : row[c.key]
    return `<td style="text-align:${c.right ? 'right' : align}">${esc(v ?? '')}</td>`
  }).join('')}</tr>`).join('')
  const html = `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(meta.title || 'Export')}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;padding:24px;}
  h1{font-size:18px;margin:0 0 2px;} .sub{color:#666;font-size:12px;margin:0 0 16px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{border-bottom:1px solid #e5e7eb;padding:7px 9px;}
  thead th{border-bottom:2px solid #cbd5e1;font-size:11px;text-transform:uppercase;color:#555;}
  tbody tr:nth-child(even){background:#fafafa;}
  @page{margin:14mm;size:A4;}
</style></head><body onload="window.focus();window.print();">
  <h1>${esc(meta.title || '')}</h1>${meta.subtitle ? `<p class="sub">${esc(meta.subtitle)}</p>` : ''}
  <table><thead>${head}</thead><tbody>${body}</tbody></table>
</body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('Please allow pop-ups to export PDF.'); return }
  w.document.open(); w.document.write(html); w.document.close()
}

// Re-export CSV so callers can import all three from one module.
export { exportCSV } from './csv.js'
