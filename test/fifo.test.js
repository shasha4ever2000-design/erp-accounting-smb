import { describe, it, expect } from 'vitest'
import {
  WAC, FIFO, COSTING_METHODS, layerQty, layerValue, unitCostOf,
  pushLayer, consume, issueFrom, receiveInto, layersFromBalance,
} from '../src/utils/fifo.js'

const L = (qty, unitCost, date = '') => ({ qty, unitCost, date, ref: '' })

describe('reading a set of layers', () => {
  const layers = [L(10, 100), L(5, 120)]

  it('totals quantity and value', () => {
    expect(layerQty(layers)).toBe(15)
    expect(layerValue(layers)).toBe(1600) // 1000 + 600
  })

  it('averages what remains, which is the carrying cost', () => {
    expect(unitCostOf(layers)).toBeCloseTo(106.6667, 3)
  })

  it('falls back when the shelf is empty rather than dividing by zero', () => {
    expect(unitCostOf([], 42)).toBe(42)
    expect(Number.isFinite(unitCostOf([]))).toBe(true)
  })

  it('tolerates rubbish input', () => {
    expect(layerQty()).toBe(0)
    expect(layerValue()).toBe(0)
    expect(layerQty([{ qty: null }, {}])).toBe(0)
  })
})

describe('pushing a receipt', () => {
  it('adds to the back of the queue', () => {
    const out = pushLayer([L(10, 100)], { qty: 5, unitCost: 120, date: '2026-02-01' })
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ qty: 5, unitCost: 120 })
  })

  it('ignores an empty receipt', () => {
    expect(pushLayer([L(10, 100)], { qty: 0, unitCost: 120 })).toHaveLength(1)
  })

  it('does not mutate the original', () => {
    const before = [L(10, 100)]
    pushLayer(before, { qty: 5, unitCost: 120 })
    expect(before).toHaveLength(1)
  })
})

describe('consuming oldest first', () => {
  it('takes from one layer when it covers the issue', () => {
    const r = consume([L(10, 100), L(5, 120)], 4)
    expect(r.cost).toBe(400)
    expect(r.layers[0].qty).toBe(6)
    expect(r.layers).toHaveLength(2)
  })

  it('spans layers, pricing each at what it cost', () => {
    // 10 at 100 then 2 at 120 = 1000 + 240
    const r = consume([L(10, 100), L(5, 120)], 12)
    expect(r.cost).toBe(1240)
    expect(r.layers).toHaveLength(1)
    expect(r.layers[0]).toMatchObject({ qty: 3, unitCost: 120 })
  })

  it('empties the queue exactly', () => {
    const r = consume([L(10, 100), L(5, 120)], 15)
    expect(r.cost).toBe(1600)
    expect(r.layers).toEqual([])
    expect(r.shortfall).toBe(0)
  })

  it('is the difference from weighted average — that is the point', () => {
    const layers = [L(10, 100), L(10, 200)]
    // FIFO takes the old, cheap units first.
    expect(consume(layers, 10).cost).toBe(1000)
    // The average would have charged 150 each.
    expect(10 * unitCostOf(layers)).toBe(1500)
  })

  it('reports a shortfall instead of pretending units were free', () => {
    const r = consume([L(5, 100)], 8)
    expect(r.shortfall).toBe(3)
    // 5 at 100, then 3 more costed at the last price seen.
    expect(r.cost).toBe(800)
    expect(r.layers).toEqual([])
  })

  it('costs a shortfall on an empty shelf at the fallback', () => {
    const r = consume([], 4, 25)
    expect(r.cost).toBe(100)
    expect(r.shortfall).toBe(4)
  })

  it('does nothing for a zero or negative issue', () => {
    expect(consume([L(5, 100)], 0).cost).toBe(0)
    expect(consume([L(5, 100)], -3).cost).toBe(0)
    expect(consume([L(5, 100)], 0).layers).toHaveLength(1)
  })

  it('handles fractional quantities without drift', () => {
    const r = consume([L(1, 3), L(1, 3), L(1, 3)], 2.5)
    expect(r.cost).toBeCloseTo(7.5, 2)
    expect(layerQty(r.layers)).toBeCloseTo(0.5, 6)
  })
})

describe('issueFrom', () => {
  const item = { costPrice: 150, costLayers: [L(10, 100), L(10, 200)] }

  it('under FIFO charges what the oldest units cost', () => {
    const r = issueFrom(item, { qty: 10, method: FIFO })
    expect(r.cost).toBe(1000)
  })

  it('under FIFO restates the carried cost to what is left', () => {
    const r = issueFrom(item, { qty: 10, method: FIFO })
    expect(r.patch.costPrice).toBeCloseTo(200, 2) // only the 200 layer remains
  })

  it('under weighted average charges the carried cost, exactly as before', () => {
    const r = issueFrom(item, { qty: 10, method: WAC })
    expect(r.cost).toBe(1500) // 10 x 150
    expect(r.patch.costPrice).toBeUndefined() // the WAC path owns that field
  })

  it('still moves the layers under weighted average, so a later switch is safe', () => {
    const r = issueFrom(item, { qty: 10, method: WAC })
    expect(layerQty(r.patch.costLayers)).toBe(10)
  })

  it('costs nothing for a zero issue and leaves the item alone', () => {
    expect(issueFrom(item, { qty: 0, method: FIFO })).toEqual({ cost: 0, patch: {} })
  })

  it('survives an item that has no layers yet', () => {
    const r = issueFrom({ costPrice: 40 }, { qty: 3, method: FIFO })
    expect(r.cost).toBe(120)      // costed at the carried price
    expect(r.shortfall).toBe(3)
    expect(Number.isFinite(r.patch.costPrice)).toBe(true)
  })
})

describe('receiveInto', () => {
  it('adds a layer at the receipt unit cost', () => {
    const r = receiveInto({ costPrice: 100, costLayers: [L(10, 100)] }, { qty: 5, value: 600, method: FIFO })
    expect(r.costLayers).toHaveLength(2)
    expect(r.costLayers[1].unitCost).toBe(120)
  })

  it('under FIFO restates the carried cost from the layers', () => {
    const r = receiveInto({ costPrice: 100, costLayers: [L(10, 100)] }, { qty: 10, value: 2000, method: FIFO })
    expect(r.costPrice).toBeCloseTo(150, 2)
  })

  it('under weighted average keeps whatever the caller worked out', () => {
    const r = receiveInto({ costPrice: 100, costLayers: [] }, { qty: 10, value: 2000, method: WAC, wacCost: 133.33 })
    expect(r.costPrice).toBe(133.33)
  })

  it('ignores an empty receipt', () => {
    expect(receiveInto({ costPrice: 100 }, { qty: 0, value: 0 })).toEqual({})
  })

  it('handles a free receipt without producing NaN', () => {
    const r = receiveInto({ costPrice: 100, costLayers: [] }, { qty: 5, value: 0, method: FIFO })
    expect(r.costLayers[0].unitCost).toBe(0)
    expect(Number.isFinite(r.costPrice)).toBe(true)
  })
})

describe('seeding', () => {
  it('turns an existing balance into one layer', () => {
    expect(layersFromBalance(10, 100)).toEqual([{ qty: 10, unitCost: 100, date: '', ref: 'Opening' }])
  })

  it('gives nothing for an empty or negative balance', () => {
    expect(layersFromBalance(0, 100)).toEqual([])
    expect(layersFromBalance(-5, 100)).toEqual([])
  })
})

describe('the method list the settings screen renders', () => {
  it('offers both, each with an explanation', () => {
    expect(COSTING_METHODS.map((m) => m.id)).toEqual([WAC, FIFO])
    COSTING_METHODS.forEach((m) => expect(m.hint.length).toBeGreaterThan(10))
  })
})
