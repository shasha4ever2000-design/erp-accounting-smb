// Receivables and payables ageing, as at a chosen date.
//
// One builder for both sides, so the screen, the export and any test read the
// same numbers. What is due on each document is worked out as it stood at the
// end of `asAt` — payments and returns dated later are not counted yet — and
// converted to base currency at the document's own rate. Credit or debit notes
// raised on their own belong to no bucket; they are reported as one
// "unapplied" figure that comes off the total.

import { documentDueAsAt, unappliedNotes, isLiveDoc } from './partyBalance'

export const AGING_BUCKETS = [
  { id: 'current', label: 'Current (not yet due)', short: 'Current', max: 0 },
  { id: 'days30', label: '1–30 Days Overdue', short: '1–30 Days', max: 30 },
  { id: 'days60', label: '31–60 Days Overdue', short: '31–60 Days', max: 60 },
  { id: 'days90', label: '61–90 Days Overdue', short: '61–90 Days', max: 90 },
  { id: 'over90', label: '90+ Days Overdue', short: '90+ Days', max: Infinity },
]

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Whole days from `from` to `to`, both YYYY-MM-DD, read as calendar dates. */
export function daysBetween(from, to) {
  if (!from || !to) return 0
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/**
 * @param {object} p
 * @param {Array}  p.docs        invoices or purchase bills
 * @param {Array}  p.notes       credit notes or debit notes
 * @param {'invoiceId'|'purchaseId'} p.key  how a note names its document
 * @param {string} p.partyField  'customerName' | 'supplierName'
 * @param {string} p.asAt        YYYY-MM-DD
 */
export function buildAging({ docs = [], notes = [], key = 'invoiceId', partyField = 'customerName', asAt }) {
  const rows = []
  docs.forEach((d) => {
    if (!isLiveDoc(d)) return
    const due = documentDueAsAt(d, notes, key, asAt)
    if (due <= 0.005) return
    const amt = r2(due * (Number(d.exchangeRate) || 1))
    const days = daysBetween(d.dueDate || d.date, asAt)
    const bucket = AGING_BUCKETS.find((b) => days <= b.max).id
    rows.push({ id: d.id, number: d.number, party: d[partyField] || '', dueDate: d.dueDate || d.date, days, amt, bucket })
  })
  rows.sort((a, b) => b.days - a.days)
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b.id, r2(rows.filter((r) => r.bucket === b.id).reduce((s, r) => s + r.amt, 0))]))
  const gross = r2(rows.reduce((s, r) => s + r.amt, 0))
  const unapplied = unappliedNotes(notes, key, asAt)
  return { rows, totals, gross, unapplied, net: r2(gross - unapplied) }
}
