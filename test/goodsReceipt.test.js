import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'
import { poMatch } from '../src/utils/fulfillment.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('goods receipt (GRN) + GRNI + 3-way match', () => {
  g().addSupplier({ name: 'Acme Supply' }); const supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Bolt', code: 'BLT', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' }); const item = last(g().inventoryItems)
  const po = g().addPurchaseOrder({
    supplierId: supp.id, supplierName: 'Acme Supply', date: '2026-03-01',
    items: [{ id: 'PL1', itemId: item.id, description: 'Bolt', quantity: 100, unitPrice: 10, discount: 0, taxRate: 0, subtotal: 1000, accountId: 'acc-inv' }],
    subtotal: 1000, taxAmount: 0, total: 1000,
  })

  it('receives goods into stock and accrues GRNI', () => {
    const grn = g().receiveGoods(po.id, { PL1: 40 }, { date: '2026-03-05' })
    expect(grn).toBeTruthy()
    expect(bal('acc-grni')).toBeCloseTo(400, 2)   // 40 × 10 accrued (liability)
    expect(bal('acc-inv')).toBeCloseTo(400, 2)    // stock in
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(40)
    expect(g().inventoryItems.find((i) => i.id === item.id).costPrice).toBeCloseTo(10, 2)
    const p = g().purchaseOrders.find((x) => x.id === po.id)
    expect(p.items[0].receivedQty).toBe(40)
    expect(p.items[0].billedQty ?? 0).toBe(0)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('bills received goods, clearing GRNI into AP without touching stock', () => {
    const stockBefore = g().inventoryItems.find((i) => i.id === item.id).quantity
    const bill = g().billReceivedPO(po.id, { PL1: 40 }, { date: '2026-03-06' })
    expect(bill.total).toBe(400)
    expect(bal('acc-grni')).toBeCloseTo(0, 2)     // accrual cleared
    expect(bal('acc-ap')).toBeCloseTo(400, 2)     // now payable
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(stockBefore) // no double receipt
    const p = g().purchaseOrders.find((x) => x.id === po.id)
    expect(p.items[0].billedQty).toBe(40)
    expect(g().purchases.some((x) => x.id === bill.id)).toBe(true)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('cannot bill more than has been received', () => {
    // only 40 received, 40 billed → nothing billable yet
    expect(g().billReceivedPO(po.id, { PL1: 60 })).toBeNull()
  })

  it('reports a 3-way match in progress, then matched when complete', () => {
    let m = poMatch(g().purchaseOrders.find((x) => x.id === po.id))
    expect(m.status).toBe('in_progress')
    expect(m.lines[0].awaitingReceipt).toBe(60)
    // receive + bill the remaining 60
    g().receiveGoods(po.id, { PL1: 60 }, { date: '2026-03-10' })
    g().billReceivedPO(po.id, { PL1: 60 }, { date: '2026-03-11' })
    m = poMatch(g().purchaseOrders.find((x) => x.id === po.id))
    expect(m.status).toBe('matched')
    expect(bal('acc-grni')).toBeCloseTo(0, 2)
    expect(bal('acc-ap')).toBeCloseTo(1000, 2)
    expect(g().purchaseOrders.find((x) => x.id === po.id).status).toBe('invoiced')
    expect(tbDiff()).toBeLessThan(0.01)
  })
})
