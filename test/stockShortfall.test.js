import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()

// The forms warn before selling stock that isn't there. The check lives in the
// store and explodes kits through the same helper the posting path uses, so a
// warning can never disagree with what the save actually does to stock.

const ITEMS = [
  { id: 'i-widget', name: 'Widget', quantity: 5, costPrice: 10 },
  { id: 'i-bolt', name: 'Bolt', quantity: 100, costPrice: 1 },
  { id: 'i-nut', name: 'Nut', quantity: 2, costPrice: 1 },
  { id: 'i-kit', name: 'Fixing Kit', quantity: 0, costPrice: 0, isKit: true, components: [
    { itemId: 'i-bolt', quantity: 4 },
    { itemId: 'i-nut', quantity: 4 },
  ] },
]

const sell = (itemId, quantity) => ({ id: 'l-' + itemId, itemId, quantity, description: 'x', unitPrice: 1 })

beforeEach(() => useStore.setState({ inventoryItems: ITEMS.map((i) => ({ ...i })) }))

describe('stockShortfall', () => {
  it('is silent when there is enough stock', () => {
    expect(g().stockShortfall([sell('i-widget', 5)])).toEqual([])
  })

  it('reports the shortfall when a line oversells', () => {
    const out = g().stockShortfall([sell('i-widget', 8)])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ itemId: 'i-widget', name: 'Widget', onHand: 5, required: 8, shortBy: 3 })
  })

  it('reports every short item, not just the first', () => {
    const out = g().stockShortfall([sell('i-widget', 6), sell('i-nut', 3)])
    expect(out.map((s) => s.itemId).sort()).toEqual(['i-nut', 'i-widget'])
  })

  it('adds up repeated lines for the same item', () => {
    // Individually fine, together they oversell.
    expect(g().stockShortfall([sell('i-widget', 3), sell('i-widget', 3)])).toHaveLength(1)
  })

  it('looks through a kit to its components', () => {
    // One kit needs 4 bolts (100 on hand, fine) and 4 nuts (only 2).
    const out = g().stockShortfall([sell('i-kit', 1)])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ itemId: 'i-nut', onHand: 2, required: 4, shortBy: 2 })
  })

  it('does not report the kit itself, which is never on a shelf', () => {
    const out = g().stockShortfall([sell('i-kit', 1)])
    expect(out.some((s) => s.itemId === 'i-kit')).toBe(false)
  })

  it('ignores service lines with no item', () => {
    expect(g().stockShortfall([{ id: 'l1', description: 'Consulting', quantity: 1, unitPrice: 500 }])).toEqual([])
  })

  it('ignores an item that no longer exists', () => {
    expect(g().stockShortfall([sell('i-deleted', 99)])).toEqual([])
  })

  it('treats an already-negative balance as short', () => {
    useStore.setState({ inventoryItems: [{ id: 'i-widget', name: 'Widget', quantity: -4, costPrice: 10 }] })
    const out = g().stockShortfall([sell('i-widget', 1)])
    expect(out[0]).toMatchObject({ onHand: -4, required: 1, shortBy: 5 })
  })

  it('handles no lines at all', () => {
    expect(g().stockShortfall([])).toEqual([])
    expect(g().stockShortfall()).toEqual([])
  })
})
