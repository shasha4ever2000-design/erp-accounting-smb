// ZATCA (Saudi Arabia "Fatoorah") Phase-1 simplified tax invoice QR code.
// The QR encodes a Base64 string of TLV (Tag-Length-Value) fields:
//   1: Seller name
//   2: VAT registration number
//   3: Invoice timestamp (ISO 8601)
//   4: Invoice total (with VAT)
//   5: VAT total
// Reference: ZATCA e-invoicing (E-Invoice) detailed technical guidelines.

function tlv(tag, valueStr) {
  const value = new TextEncoder().encode(valueStr == null ? '' : String(valueStr))
  const out = new Uint8Array(2 + value.length)
  out[0] = tag
  out[1] = value.length & 0xff
  out.set(value, 2)
  return out
}

export function zatcaTlvBase64({ sellerName, vatNumber, timestamp, total, vatTotal }) {
  const parts = [
    tlv(1, sellerName || ''),
    tlv(2, vatNumber || ''),
    tlv(3, timestamp || new Date().toISOString()),
    tlv(4, Number(total || 0).toFixed(2)),
    tlv(5, Number(vatTotal || 0).toFixed(2)),
  ]
  const len = parts.reduce((s, p) => s + p.length, 0)
  const buf = new Uint8Array(len)
  let off = 0
  for (const p of parts) { buf.set(p, off); off += p.length }
  let bin = ''
  buf.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

// Build the timestamp ZATCA expects from an invoice (date + createdAt)
export function invoiceTimestamp(invoice) {
  if (invoice?.createdAt) return new Date(invoice.createdAt).toISOString()
  if (invoice?.date) return new Date(`${invoice.date}T00:00:00Z`).toISOString()
  return new Date().toISOString()
}
