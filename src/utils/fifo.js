// FIFO cost layers.
//
// Weighted average answers "what does a unit cost on average"; FIFO answers
// "what did *these* units cost". In a rising market the two diverge, and some
// jurisdictions want the second.
//
// The design keeps `costPrice` as the single valuation figure the rest of the
// app reads — stock counts, kit costing, manufacturing and landed cost all
// consult it, and having two competing valuations on different screens would
// be worse than having one that is merely approximate. Under FIFO that figure
// is restated after every movement as *remaining layer value ÷ remaining
// quantity*, which is exactly the carrying cost of what is still on the shelf.
// So only the issue path needs to change; every other reader stays correct
// without knowing FIFO exists.
//
// Layers are maintained under both methods, so switching a company from one to
// the other does not need a rebuild — and switching back is not lossy.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6

export const WAC = 'wac'
export const FIFO = 'fifo'
export const COSTING_METHODS = [
  { id: WAC, label: 'Weighted average', hint: 'Every unit carries the blended cost of everything on hand.' },
  { id: FIFO, label: 'FIFO (first in, first out)', hint: 'The oldest stock is sold first, so cost of sales follows what you actually paid earliest.' },
]

/** Total units across the layers. */
export const layerQty = (layers = []) => r6(layers.reduce((s, l) => s + (Number(l.qty) || 0), 0))

/** Total money tied up in the layers. */
export const layerValue = (layers = []) =>
  r2(layers.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0))

/**
 * The carrying cost of one unit given the layers that remain.
 * Falls back when there is nothing left to average — an empty shelf has no
 * cost of its own, so the last known figure is the honest answer.
 */
export function unitCostOf(layers = [], fallback = 0) {
  const q = layerQty(layers)
  if (q <= 0) return r2(fallback)
  return Math.round((layerValue(layers) / q) * 10000) / 10000
}

/** Add a receipt to the end of the queue. Zero-quantity receipts are ignored. */
export function pushLayer(layers = [], { qty, unitCost, date, ref } = {}) {
  const q = Number(qty) || 0
  if (q <= 0) return [...layers]
  return [...layers, { qty: r6(q), unitCost: r2(unitCost), date: date || '', ref: ref || '' }]
}

/**
 * Take `qty` off the front of the queue.
 *
 * @returns {{ cost:number, layers:Array, shortfall:number }}
 *   `cost` is what those units actually cost. `shortfall` is any quantity the
 *   layers could not cover — the app permits negative stock, and this reports
 *   it rather than pretending the units were free. The shortfall is costed at
 *   the last unit cost seen, or `fallbackCost`, so cost of sales is never
 *   silently understated by a receipt that has not been entered yet.
 */
export function consume(layers = [], qty, fallbackCost = 0) {
  let want = Number(qty) || 0
  if (want <= 0) return { cost: 0, layers: [...layers], shortfall: 0 }

  const out = []
  let cost = 0
  let lastUnit = null

  for (const layer of layers) {
    const have = Number(layer.qty) || 0
    const unit = Number(layer.unitCost) || 0
    if (have > 0) lastUnit = unit
    if (want <= 0) { out.push({ ...layer }); continue }
    const take = Math.min(have, want)
    cost += take * unit
    want = r6(want - take)
    const left = r6(have - take)
    if (left > 0) out.push({ ...layer, qty: left })
  }

  const shortfall = r6(Math.max(0, want))
  if (shortfall > 0) {
    const unit = lastUnit == null ? (Number(fallbackCost) || 0) : lastUnit
    cost += shortfall * unit
  }
  return { cost: r2(cost), layers: out, shortfall }
}

/**
 * What issuing `qty` of an item costs, and the fields to write back.
 *
 * Under weighted average this is deliberately the arithmetic the app has
 * always used — quantity times the carried cost — so turning FIFO off gives
 * back the previous numbers exactly.
 */
export function issueFrom(item, { qty, method = WAC, fallbackCost } = {}) {
  const q = Number(qty) || 0
  const carried = Number(item?.costPrice) || 0
  const layers = Array.isArray(item?.costLayers) ? item.costLayers : []
  if (q <= 0) return { cost: 0, patch: {} }

  const taken = consume(layers, q, fallbackCost == null ? carried : fallbackCost)

  if (method !== FIFO) {
    // Layers still move — they have to stay in step for a later switch — but
    // the cost and the carried unit cost are the average-method ones.
    return { cost: r2(q * carried), patch: { costLayers: taken.layers }, shortfall: taken.shortfall }
  }
  return {
    cost: taken.cost,
    patch: { costLayers: taken.layers, costPrice: unitCostOf(taken.layers, carried) },
    shortfall: taken.shortfall,
  }
}

/**
 * The fields to write back when stock comes in.
 *
 * `value` is the total cost of the receipt, not per unit — matching how the
 * receipt paths already accumulate it.
 */
export function receiveInto(item, { qty, value, date, ref, method = WAC, wacCost } = {}) {
  const q = Number(qty) || 0
  if (q <= 0) return {}
  const layers = pushLayer(Array.isArray(item?.costLayers) ? item.costLayers : [], {
    qty: q, unitCost: (Number(value) || 0) / q, date, ref,
  })
  const carried = Number(item?.costPrice) || 0
  return {
    costLayers: layers,
    // Under FIFO the carried figure is what the remaining layers say; under
    // weighted average the caller has already computed the blend, and passing
    // it through keeps that path byte-identical to before.
    costPrice: method === FIFO ? unitCostOf(layers, carried) : (wacCost == null ? carried : wacCost),
  }
}

/** Seed a layer set for an item that predates layer tracking. */
export const layersFromBalance = (qty, unitCost, date = '') => {
  const q = Number(qty) || 0
  return q > 0 ? [{ qty: r6(q), unitCost: r2(unitCost), date, ref: 'Opening' }] : []
}
