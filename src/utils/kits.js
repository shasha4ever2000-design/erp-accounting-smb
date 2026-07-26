// Inventory kits — one sellable item made of several stocked ones.
//
// A shop sells a "starter bundle" of a drill, two batteries and a case. It is
// one line on the invoice at one price, but there is no such thing as a
// bundle in the warehouse: what leaves the shelf is a drill, two batteries and
// a case. Stock and cost of sales have to follow the components, or the
// bundle shows as stock the company does not hold while the parts it really
// sold never come off the books.
//
// So a kit holds no stock of its own. Selling one explodes into its
// components, and each of those relieves its own inventory account at its own
// weighted-average cost.
//
// The rule that has to hold: explosion must terminate. A kit that contains
// itself — directly, or through three other kits — would recurse for ever and
// take the invoice posting down with it. `explode` carries the chain it has
// walked and refuses to re-enter one it is already inside, and `validateKit`
// blocks the cycle from being saved in the first place.

export const MAX_KIT_DEPTH = 10

export function isKit(item) {
  return !!item?.isKit && Array.isArray(item.components) && item.components.length > 0
}

const round6 = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

/**
 * What actually leaves the shelf when `qty` of `item` is sold.
 *
 * Returns [{ itemId, qty }] of stocked items only — kits never appear in the
 * result, because there is no kit to take off a shelf.
 *
 * A component that has been deleted is skipped rather than throwing: an
 * invoice that cannot be saved because someone tidied the item list is worse
 * than one whose stock relief is short by a line the user can see is missing.
 */
export function explode(item, qty, items = [], { chain = [], depth = 0 } = {}) {
  const n = Number(qty) || 0
  if (!item || n <= 0) return []
  if (!isKit(item)) return [{ itemId: item.id, qty: round6(n) }]

  // Already inside this kit, or nested too deep to be anything but a mistake.
  if (chain.includes(item.id) || depth >= MAX_KIT_DEPTH) return []

  const out = []
  item.components.forEach((c) => {
    const each = Number(c?.quantity) || 0
    if (each <= 0) return
    const child = items.find((i) => i.id === c.itemId)
    if (!child) return
    explode(child, round6(n * each), items, { chain: [...chain, item.id], depth: depth + 1 })
      .forEach((row) => out.push(row))
  })

  // The same component can appear through two branches; merge so stock moves
  // once and the ledger carries one line per item.
  const merged = {}
  out.forEach((r) => { merged[r.itemId] = round6((merged[r.itemId] || 0) + r.qty) })
  return Object.entries(merged).map(([itemId, q]) => ({ itemId, qty: q }))
}

/** Explode a whole document's lines at once. Returns { itemId: qty }. */
export function explodeLines(lines = [], items = []) {
  const issue = {}
  lines.forEach((line) => {
    if (!line?.itemId) return
    const q = Number(line.quantity) || 0
    if (q <= 0) return
    const item = items.find((i) => i.id === line.itemId)
    if (!item) return
    explode(item, q, items).forEach((r) => {
      issue[r.itemId] = round6((issue[r.itemId] || 0) + r.qty)
    })
  })
  return issue
}

/**
 * What one kit costs, from its components' weighted-average costs.
 *
 * This is the figure that hits cost of sales. It is deliberately not stored on
 * the kit: component costs move every time stock is bought, and a cached kit
 * cost would drift away from the inventory it is supposed to relieve.
 */
export function kitCost(item, items = []) {
  if (!isKit(item)) return round2(item?.costPrice || 0)
  return round2(explode(item, 1, items).reduce((sum, r) => {
    const child = items.find((i) => i.id === r.itemId)
    return sum + r.qty * (Number(child?.costPrice) || 0)
  }, 0))
}

/**
 * How many whole kits could be assembled from stock on hand.
 *
 * The binding constraint is whichever component runs out first, so this is a
 * minimum over the components rather than a sum.
 */
export function kitAvailability(item, items = []) {
  if (!isKit(item)) return Number(item?.quantity) || 0
  const rows = explode(item, 1, items)
  if (!rows.length) return 0
  return Math.floor(rows.reduce((min, r) => {
    const child = items.find((i) => i.id === r.itemId)
    const have = Number(child?.quantity) || 0
    return Math.min(min, r.qty > 0 ? have / r.qty : Infinity)
  }, Infinity))
}

/** Components that cannot cover the quantity being sold. */
export function shortComponents(item, qty, items = []) {
  return explode(item, qty, items)
    .map((r) => {
      const child = items.find((i) => i.id === r.itemId)
      const have = Number(child?.quantity) || 0
      return { itemId: r.itemId, name: child?.name || r.itemId, need: r.qty, have, short: round6(r.qty - have) }
    })
    .filter((r) => r.short > 0)
}

/**
 * True when making `candidateId` a component of `kitId` would create a loop.
 * Walks downward from the candidate looking for the kit itself.
 */
export function wouldCycle(kitId, candidateId, items = []) {
  if (!kitId || !candidateId) return false
  if (kitId === candidateId) return true
  const seen = new Set()
  const walk = (id) => {
    if (id === kitId) return true
    if (seen.has(id)) return false
    seen.add(id)
    const item = items.find((i) => i.id === id)
    if (!isKit(item)) return false
    return item.components.some((c) => walk(c.itemId))
  }
  return walk(candidateId)
}

/**
 * Check a kit before it is saved.
 * @returns { ok: true } | { ok: false, errors: [string] }
 */
export function validateKit(kitId, components = [], items = []) {
  const errors = []
  const rows = components.filter((c) => c && c.itemId)
  if (!rows.length) errors.push('A kit needs at least one component.')

  const seen = new Set()
  rows.forEach((c) => {
    const child = items.find((i) => i.id === c.itemId)
    const label = child?.name || c.itemId
    if (!child) { errors.push(`"${label}" no longer exists.`); return }
    if ((Number(c.quantity) || 0) <= 0) errors.push(`Give "${label}" a quantity greater than zero.`)
    if (seen.has(c.itemId)) errors.push(`"${label}" is listed twice — combine it into one line.`)
    seen.add(c.itemId)
    if (c.itemId === kitId) errors.push('A kit cannot contain itself.')
    else if (wouldCycle(kitId, c.itemId, items))
      errors.push(`"${label}" already contains this kit, so adding it would loop for ever.`)
  })

  return errors.length ? { ok: false, errors } : { ok: true }
}

/** A human summary of what one kit contains, for a list row. */
export function describeKit(item, items = []) {
  if (!isKit(item)) return ''
  return item.components
    .map((c) => {
      const child = items.find((i) => i.id === c.itemId)
      return `${c.quantity}× ${child?.name || '?'}`
    })
    .join(', ')
}
