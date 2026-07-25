import { describe, it, expect } from 'vitest'
import { allocateLandedCost } from '../src/utils/landedCost.js'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('allocateLandedCost (pure)', () => {
  it('splits by value and sums exactly to the amount', () => {
    const r = allocateLandedCost(300, [
      { itemId: 'a', qty: 10, unitCost: 10 },  // value 100
      { itemId: 'b', qty: 10, unitCost: 20 },  // value 200
    ], 'value')
    expect(r.find((x) => x.itemId === 'a').allocated).toBe(100)
    expect(r.find((x) => x.itemId === 'b').allocated).toBe(200)
  })

  it('splits by quantity', () => {
    const r = allocateLandedCost(90, [
      { itemId: 'a', qty: 1, unitCost: 999 },
      { itemId: 'b', qty: 2, unitCost: 1 },
    ], 'quantity')
    expect(r.find((x) => x.itemId === 'a').allocated).toBe(30)
    expect(r.find((x) => x.itemId === 'b').allocated).toBe(60)
  })

  it('folds rounding remainder in without leaking cents', () => {
    const r = allocateLandedCost(100, [
      { itemId: 'a', qty: 1, unitCost: 1 },
      { itemId: 'b', qty: 1, unitCost: 1 },
      { itemId: 'c', qty: 1, unitCost: 1 },
    ], 'value')
    const sum = r.reduce((s, x) => s + x.allocated, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
  })

  it('falls back to quantity when the value basis is all zero', () => {
    const r = allocateLandedCost(50, [
      { itemId: 'a', qty: 2, unitCost: 0 },
      { itemId: 'b', qty: 3, unitCost: 0 },
    ], 'value')
    expect(r.find((x) => x.itemId === 'a').allocated).toBe(20)
    expect(r.find((x) => x.itemId === 'b').allocated).toBe(30)
  })
})

describe('postLandedCost (store)', () => {
  g().addInventoryItem({ name: 'Imported A', code: 'IA', costPrice: 10, salePrice: 20, quantity: 100, unit: 'ea' })
  const a = last(g().inventoryItems)
  g().addInventoryItem({ name: 'Imported B', code: 'IB', costPrice: 20, salePrice: 40, quantity: 50, unit: 'ea' })
  const b = last(g().inventoryItems)

  const invBefore = bal('acc-inv')
  const apBefore = bal('acc-ap')

  it('capitalises freight into weighted-avg cost and posts a balanced JE', () => {
    // Extended values: A = 100*10 = 1000, B = 50*20 = 1000 → 50/50 split of 400.
    const rec = g().postLandedCost({
      date: '2026-05-01', reference: 'FRT-1', method: 'value', amount: 400,
      creditAccountId: 'acc-ap',
      lines: [{ itemId: a.id, qty: 100 }, { itemId: b.id, qty: 50 }],
    })
    expect(rec.amount).toBe(400)

    // Each item got 200; unit cost bumps by 200/qty.
    const A = g().inventoryItems.find((i) => i.id === a.id)
    const B = g().inventoryItems.find((i) => i.id === b.id)
    expect(A.costPrice).toBeCloseTo(10 + 200 / 100, 4)  // 12
    expect(B.costPrice).toBeCloseTo(20 + 200 / 50, 4)   // 24

    // Inventory asset rises by exactly 400; AP (liability) rises by 400.
    expect(bal('acc-inv') - invBefore).toBeCloseTo(400, 2)
    expect(bal('acc-ap') - apBefore).toBeCloseTo(400, 2)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('total inventory value increase equals the amount', () => {
    const A = g().inventoryItems.find((i) => i.id === a.id)
    const B = g().inventoryItems.find((i) => i.id === b.id)
    const valNow = A.quantity * A.costPrice + B.quantity * B.costPrice
    // Started at 1000 + 1000 = 2000, plus 400 landed → 2400.
    expect(valNow).toBeCloseTo(2400, 2)
  })

  it('rejects an empty amount', () => {
    expect(() => g().postLandedCost({ date: '2026-05-01', amount: 0, lines: [{ itemId: a.id, qty: 1 }] })).toThrow()
  })
})
