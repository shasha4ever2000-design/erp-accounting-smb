// Cycle counting — counting a slice of the warehouse continuously, instead of
// shutting the business for a day once a year.
//
// The annual count is the worst of both worlds: it is disruptive, it is done
// in a hurry by people who do not normally count, and any error it finds has
// been wrong for up to twelve months. Cycle counting replaces it with a short
// list every week, weighted so the stock that matters is counted often and the
// stock that does not is counted rarely.
//
// The weighting is ABC, by value: roughly 20% of lines carry 80% of the value,
// and those are the ones worth counting monthly. The long tail gets counted
// once a year, which is all it is worth.
//
// The rule that keeps this honest: **only a posted count resets the clock.**
// A count that was started and abandoned proves nothing about what is on the
// shelf, and treating it as evidence would quietly push the item to the back
// of the queue for another year.

import { isKit } from './kits'

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

/** Share of total value each class covers, in order. */
export const ABC_THRESHOLDS = { A: 0.8, B: 0.95 }

/** How often each class should be counted, in days. */
export function defaultPolicy() {
  return { A: 30, B: 90, C: 365 }
}

export const CLASS_LABELS = {
  A: 'Class A — most of the value',
  B: 'Class B — the middle',
  C: 'Class C — the long tail',
}

/**
 * Sort items by stock value and label them A, B or C by cumulative share.
 *
 * Value, not quantity: ten thousand washers worth 200 riyals do not deserve
 * the attention of one machine worth 40,000.
 */
export function classifyABC(items = []) {
  const stocked = items.filter((i) => i && !isKit(i))
  const valued = stocked.map((i) => ({
    id: i.id, code: i.code || '', name: i.name || '',
    quantity: num(i.quantity),
    unitCost: num(i.costPrice),
    value: round2(num(i.quantity) * num(i.costPrice)),
  }))
  const total = valued.reduce((s, r) => s + r.value, 0)

  const sorted = [...valued].sort((a, b) => b.value - a.value)
  let cumulative = 0
  return sorted.map((r) => {
    // With no value anywhere, every item is equally unimportant — calling them
    // all A would put the whole catalogue on a monthly count for no reason.
    if (total <= 0) return { ...r, share: 0, cumulativeShare: 0, cls: 'C' }
    // Classify on the share reached *before* this item, so the item that
    // crosses a boundary belongs to the class it is crossing out of. Testing
    // the share after adding it demotes the single most valuable line whenever
    // it alone exceeds 80% — which is exactly the item most worth counting.
    const priorShare = cumulative / total
    cumulative += r.value
    const cls = priorShare < ABC_THRESHOLDS.A ? 'A'
      : priorShare < ABC_THRESHOLDS.B ? 'B' : 'C'
    return { ...r, share: r.value / total, cumulativeShare: cumulative / total, cls }
  })
}

/**
 * When each item was last actually counted.
 *
 * Only posted counts count. Returns `{ itemId: 'YYYY-MM-DD' }`.
 */
export function lastCountedMap(stockCounts = []) {
  const out = {}
  stockCounts
    .filter((c) => c && c.status === 'posted')
    .forEach((c) => {
      ;(c.lines || []).forEach((l) => {
        // A line on a posted sheet that was never filled in was not counted.
        if (l.counted == null || l.counted === '') return
        const d = String(c.date || '')
        if (!out[l.itemId] || d > out[l.itemId]) out[l.itemId] = d
      })
    })
  return out
}

const addDays = (iso, days) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + Math.floor(Number(days) || 0))
  return d.toISOString().slice(0, 10)
}

const daysBetween = (from, to) => {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.floor((b - a) / 86400000)
}

/**
 * What is due to be counted, most overdue first.
 *
 * An item never counted is due immediately — that is the point of starting.
 */
export function dueForCount(items = [], stockCounts = [], { policy = null, asAt = '' } = {}) {
  const pol = { ...defaultPolicy(), ...(policy || {}) }
  const at = asAt || new Date().toISOString().slice(0, 10)
  const last = lastCountedMap(stockCounts)

  return classifyABC(items)
    .map((r) => {
      const interval = num(pol[r.cls]) || defaultPolicy()[r.cls]
      const lastCounted = last[r.id] || ''
      const dueDate = lastCounted ? addDays(lastCounted, interval) : at
      const daysOverdue = lastCounted ? Math.max(0, daysBetween(dueDate, at)) : Infinity
      return {
        ...r,
        interval,
        lastCounted,
        dueDate,
        neverCounted: !lastCounted,
        daysSince: lastCounted ? daysBetween(lastCounted, at) : null,
        due: !lastCounted || String(dueDate) <= String(at),
        daysOverdue: Number.isFinite(daysOverdue) ? daysOverdue : null,
      }
    })
    .sort((a, b) => {
      // Never counted first, then most overdue, then most valuable.
      if (a.neverCounted !== b.neverCounted) return a.neverCounted ? -1 : 1
      const ao = a.daysOverdue ?? 0
      const bo = b.daysOverdue ?? 0
      if (ao !== bo) return bo - ao
      return b.value - a.value
    })
}

/**
 * The next batch to count.
 *
 * Capped, because a list of four hundred items is not a cycle count — it is an
 * annual count with extra steps, and it will not get done.
 */
export function nextBatch(items = [], stockCounts = [], { policy = null, asAt = '', limit = 20 } = {}) {
  const rows = dueForCount(items, stockCounts, { policy, asAt })
  const dueRows = rows.filter((r) => r.due)
  const cap = Math.max(1, Math.floor(num(limit) || 20))
  const batch = dueRows.slice(0, cap)
  return {
    batch,
    itemIds: batch.map((r) => r.id),
    dueCount: dueRows.length,
    remaining: Math.max(0, dueRows.length - batch.length),
    value: round2(batch.reduce((s, r) => s + r.value, 0)),
  }
}

/** Coverage: how much of the catalogue and its value has been counted lately. */
export function coverage(items = [], stockCounts = [], { asAt = '' } = {}) {
  const rows = dueForCount(items, stockCounts, { asAt })
  const total = rows.length
  const counted = rows.filter((r) => !r.neverCounted).length
  const totalValue = round2(rows.reduce((s, r) => s + r.value, 0))
  const dueValue = round2(rows.filter((r) => r.due).reduce((s, r) => s + r.value, 0))
  const byClass = { A: 0, B: 0, C: 0 }
  const dueByClass = { A: 0, B: 0, C: 0 }
  rows.forEach((r) => {
    byClass[r.cls] = (byClass[r.cls] || 0) + 1
    if (r.due) dueByClass[r.cls] = (dueByClass[r.cls] || 0) + 1
  })
  return {
    total,
    counted,
    neverCounted: total - counted,
    due: rows.filter((r) => r.due).length,
    totalValue,
    dueValue,
    byClass,
    dueByClass,
    pctCounted: total ? Math.round((counted / total) * 100) : 0,
  }
}
