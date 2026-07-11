// Partial-fulfillment tracking for source documents (quotations, purchase
// orders). Each source line carries a cumulative "done" quantity — invoicedQty
// for quotes, receivedQty for POs — so a document can be converted piecemeal,
// with the remainder staying open (a backorder). Pure + testable.
import { computeLine } from './lineMath'

export const lineDone = (line, key) => Number(line?.[key]) || 0
export const lineRemaining = (line, key) => Math.max(0, Math.round(((Number(line?.quantity) || 0) - lineDone(line, key)) * 1e6) / 1e6)

// Roll a document's lines up into a fulfillment picture + a status.
export function docFulfillment(items = [], key) {
  const ordered = items.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const done = items.reduce((s, l) => s + Math.min(lineDone(l, key), Number(l.quantity) || 0), 0)
  const remaining = items.reduce((s, l) => s + lineRemaining(l, key), 0)
  const status = remaining <= 1e-6 ? 'complete' : done > 1e-6 ? 'partial' : 'open'
  return { ordered: Math.round(ordered * 1e6) / 1e6, done: Math.round(done * 1e6) / 1e6, remaining: Math.round(remaining * 1e6) / 1e6, status }
}

// Default "convert now" selection: every line's full remaining quantity.
export function defaultSelection(items = [], key) {
  const sel = {}
  items.forEach((l) => { const r = lineRemaining(l, key); if (r > 1e-9) sel[l.id] = r })
  return sel
}

// Build the child-document line items from a { lineId: qty } selection, clamped
// to each source line's remaining quantity. Returns the new items (with money
// recomputed at the line's own price/discount/tax) and the qty applied per line.
export function buildConversion(sourceItems = [], selections = {}, { key, taxEnabled = true } = {}) {
  const items = []
  const applied = {}
  sourceItems.forEach((l) => {
    const want = Number(selections?.[l.id] ?? 0) || 0
    const q = Math.max(0, Math.min(want, lineRemaining(l, key)))
    if (q <= 1e-9) return
    const line = { ...l, quantity: q, discount: l.discount || 0 }
    const c = computeLine(line, { taxEnabled })
    items.push({ ...line, subtotal: c.subtotal, taxAmount: c.taxAmount, total: c.total, sourceLineId: l.id })
    applied[l.id] = q
  })
  const subtotal = Math.round(items.reduce((s, i) => s + i.subtotal, 0) * 100) / 100
  const taxAmount = Math.round(items.reduce((s, i) => s + i.taxAmount, 0) * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100
  return { items, applied, subtotal, taxAmount, total }
}

// Three-way match: reconcile a purchase order's Ordered vs Received vs Billed
// quantities per line and roll up a status. `variance` = physically received or
// billed more than ordered (needs attention); `matched` = every line ordered =
// received = billed; otherwise it's still `in_progress`.
export function poMatch(po) {
  const lines = (po?.items || []).map((l) => {
    const ordered = Number(l.quantity) || 0
    const received = Number(l.receivedQty) || 0
    const billed = Number(l.billedQty) || 0
    return {
      id: l.id, description: l.description, ordered, received, billed,
      awaitingReceipt: Math.max(0, ordered - received),
      awaitingBill: Math.max(0, received - billed),
      overReceived: received > ordered + 1e-6,
      overBilled: billed > received + 1e-6,
    }
  })
  const variance = lines.some((l) => l.overReceived || l.overBilled)
  const matched = lines.length > 0 && lines.every((l) => Math.abs(l.ordered - l.received) < 1e-6 && Math.abs(l.received - l.billed) < 1e-6)
  const status = variance ? 'variance' : matched ? 'matched' : 'in_progress'
  return { lines, status, variance, matched }
}
