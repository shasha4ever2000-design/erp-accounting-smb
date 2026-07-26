// Physical stock counts.
//
// A stock count is the moment the books are made to agree with the shelves.
// Somebody walks the warehouse, counts what is actually there, and the
// difference is written off or written on. It is the single most destructive
// routine operation in an inventory system, because posting one adjusts every
// line it touches — so nearly all of the care here is about what it must
// *refuse* to touch.
//
// Three rules carry that:
//
//   1. **An uncounted line is not a zero.** This is the classic disaster. A
//      count is started for the whole warehouse, forty of two hundred items
//      are counted, someone posts it, and the other hundred and sixty are
//      written down to nothing. So `counted` is null until a number is
//      actually entered, and only lines with a real number are posted.
//
//   2. **The expected quantity is frozen when the line is added.** If it were
//      read at posting time instead, every sale made during the count would
//      appear as a shortage — the stock left legitimately, after it was
//      counted. Freezing it means the variance measures what the count found,
//      not how long the count took.
//
//   3. **Kits hold no stock, so they cannot be counted.** A kit is an invoice
//      convenience; what sits on the shelf is its components. Counting one
//      would invent stock that does not exist.

import { isKit } from './kits'

export const COUNT_STATUS = { open: 'open', posted: 'posted', cancelled: 'cancelled' }

const round6 = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

/** Stock on hand, in one warehouse or everywhere. */
export function qtyOnHand(item, warehouseId = '') {
  if (!item) return 0
  if (!warehouseId) return num(item.quantity)
  const byWh = item.stockByWarehouse
  // An item that predates warehouse tracking has no per-warehouse map; its
  // whole quantity belongs to wherever it is being counted.
  if (!byWh || typeof byWh !== 'object') return num(item.quantity)
  return num(byWh[warehouseId])
}

/** Items a count may include — stocked goods only. */
export function countableItems(items = []) {
  return items.filter((i) => i && !isKit(i))
}

/**
 * A line, with its expected quantity frozen at this moment.
 * `counted` stays null until someone enters a number.
 */
export function makeLine(item, warehouseId = '', { counted = null } = {}) {
  if (!item || isKit(item)) return null
  return {
    itemId: item.id,
    code: item.code || '',
    name: item.name || '',
    unit: item.unit || '',
    expected: round6(qtyOnHand(item, warehouseId)),
    counted: counted == null ? null : round6(counted),
    unitCost: round2(item.costPrice),
    scanned: false,
    note: '',
  }
}

/** Open a count over a whole warehouse, or over a chosen set of items. */
export function buildSheet(items = [], { warehouseId = '', itemIds = null } = {}) {
  const pool = countableItems(items).filter((i) => !itemIds || itemIds.includes(i.id))
  return pool
    .map((i) => makeLine(i, warehouseId))
    .filter(Boolean)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)) || String(a.name).localeCompare(String(b.name)))
}

/** Has this line actually been counted? Zero is a count; blank is not. */
export function isCounted(line) {
  return line && line.counted != null && line.counted !== '' && !Number.isNaN(Number(line.counted))
}

/** counted − expected, or null when the line has not been counted. */
export function variance(line) {
  if (!isCounted(line)) return null
  return round6(num(line.counted) - num(line.expected))
}

export function varianceValue(line) {
  const v = variance(line)
  return v == null ? null : round2(v * num(line.unitCost))
}

/**
 * Add or update a counted quantity, by item id.
 *
 * `mode` is 'set' (typed a total) or 'add' (scanned one more). Scanning the
 * same box twice should count two, so a scan adds; typing replaces.
 */
export function applyCount(lines = [], itemId, qty, { mode = 'set', scanned = false, note } = {}) {
  return lines.map((l) => {
    if (l.itemId !== itemId) return l
    const next = mode === 'add' ? num(l.counted) + num(qty) : num(qty)
    return {
      ...l,
      counted: round6(next),
      scanned: scanned || l.scanned,
      ...(note != null ? { note } : {}),
    }
  })
}

/** Clear a count back to uncounted — not to zero, which means something else. */
export function clearCount(lines = [], itemId) {
  return lines.map((l) => (l.itemId === itemId ? { ...l, counted: null, scanned: false } : l))
}

/** Headline figures for the count screen. */
export function summarise(lines = []) {
  const counted = lines.filter(isCounted)
  const withVariance = counted.filter((l) => variance(l) !== 0)
  const gains = withVariance.filter((l) => variance(l) > 0)
  const losses = withVariance.filter((l) => variance(l) < 0)
  const value = (rows) => round2(rows.reduce((s, l) => s + (varianceValue(l) || 0), 0))
  return {
    total: lines.length,
    counted: counted.length,
    uncounted: lines.length - counted.length,
    matching: counted.length - withVariance.length,
    gains: gains.length,
    losses: losses.length,
    gainValue: value(gains),
    lossValue: value(losses),
    netValue: round2(value(gains) + value(losses)),
    scanned: lines.filter((l) => l.scanned).length,
  }
}

/** Only the lines a posting would actually move. */
export function adjustingLines(lines = []) {
  return lines.filter((l) => isCounted(l) && variance(l) !== 0)
}

/**
 * Check a count before it is posted.
 * Uncounted lines are reported but never block — a partial count is a normal
 * way to work, as long as the person posting it knows that is what it is.
 */
export function validateCount(count, { lockDate = '' } = {}) {
  const errors = []
  const warnings = []
  if (!count) return { ok: false, errors: ['There is no count to post.'], warnings }
  if (count.status === COUNT_STATUS.posted) errors.push('This count has already been posted.')
  if (!count.date) errors.push('Give the count a date.')
  if (lockDate && count.date && String(count.date) <= String(lockDate))
    errors.push(`That date falls in a period closed on ${lockDate}.`)

  const lines = count.lines || []
  if (!lines.length) errors.push('The count sheet is empty.')

  const counted = lines.filter(isCounted)
  if (counted.length === 0) errors.push('Nothing has been counted yet.')

  const negative = counted.filter((l) => num(l.counted) < 0)
  if (negative.length) errors.push('A counted quantity cannot be negative.')

  const uncounted = lines.length - counted.length
  if (uncounted > 0)
    warnings.push(`${uncounted} line(s) were never counted. They will be left exactly as they are, not set to zero.`)

  const moving = adjustingLines(lines).length
  if (counted.length && moving === 0) warnings.push('Everything counted matches the books — posting will change nothing.')

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Journal lines for the adjustment.
 *
 * A gain debits inventory and credits the adjustment account; a loss does the
 * reverse. Each item relieves its own inventory account, so a company running
 * separate raw-material and finished-goods accounts stays correct.
 */
export function postingLines(count, items = [], { adjustmentAccountId = 'acc-invadj' } = {}) {
  const invByAcc = {}
  let net = 0

  adjustingLines(count?.lines || []).forEach((l) => {
    const item = items.find((i) => i.id === l.itemId)
    const value = round2(variance(l) * num(l.unitCost))
    if (value === 0) return
    const acc = item?.inventoryAccountId || 'acc-inv'
    invByAcc[acc] = round2((invByAcc[acc] || 0) + value)
    net = round2(net + value)
  })

  if (net === 0 && Object.values(invByAcc).every((v) => v === 0)) return []

  const lines = []
  Object.entries(invByAcc).forEach(([acc, value]) => {
    if (value === 0) return
    lines.push({
      accountId: acc,
      debit: value > 0 ? value : 0,
      credit: value < 0 ? round2(-value) : 0,
      description: 'Stock count adjustment',
    })
  })
  lines.push({
    accountId: adjustmentAccountId,
    debit: net < 0 ? round2(-net) : 0,
    credit: net > 0 ? net : 0,
    description: 'Stock count adjustment',
  })
  return lines
}

/** The stock movements a posting implies: { itemId: newQuantity }. */
export function stockChanges(count) {
  const out = {}
  adjustingLines(count?.lines || []).forEach((l) => { out[l.itemId] = round6(num(l.counted)) })
  return out
}
