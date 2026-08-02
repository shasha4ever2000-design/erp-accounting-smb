// Buying stock has to end with stock on the shelf.
//
// A purchase order line only moves inventory if it carries an `itemId`.
// Without one, receiving books the goods to an expense account and the item's
// quantity never changes — which is right for a service and catastrophic for
// goods. The purchase order form used to hide which kind of line you had: its
// product picker was bound to a constant empty value, so it snapped back to
// "Pick from inventory..." the moment you chose something and the expense
// account stayed on screen. You could not tell a stock line from an expense
// line, and the mistake only surfaced later as an expense you never intended
// and stock that never arrived.
//
// These tests pin the ledger consequences of both kinds of line so the
// distinction stays honest, whatever the form looks like.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const QTY = 5
const PRICE = 15000
const NET = QTY * PRICE          // 75,000
const VAT = NET * 0.15           // 11,250

const netOf = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
const item = () => g().inventoryItems.find((i) => i.code === 'SKU-001')

let supp, laptop
beforeEach(() => {
  useStore.setState({
    journalEntries: [], purchases: [], purchaseOrders: [], goodsReceipts: [],
    inventoryItems: [], suppliers: [], stockMovements: [], auditLog: [],
  })
  g().updateTax({ enabled: true, rate: 15, name: 'VAT', system: 'vat' })
  g().addSupplier({ name: 'Samsung' })
  supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Laptop', code: 'SKU-001', costPrice: 0, salePrice: 0, quantity: 0, unit: 'pcs', type: 'stock' })
  laptop = last(g().inventoryItems)
})

const orderFor = (line) => g().addPurchaseOrder({
  supplierId: supp.id, supplierName: supp.name, date: '2026-08-02',
  items: [{ id: 'L1', quantity: QTY, unitPrice: PRICE, discount: 0, taxRate: 15, ...line }],
  subtotal: NET, taxAmount: VAT, total: NET + VAT,
})

describe('a purchase order line linked to a stock item', () => {
  it('puts the goods on the shelf and into Inventory, not into an expense', () => {
    const po = orderFor({ itemId: laptop.id, description: 'Laptop', accountId: 'acc-inv' })
    g().receiveGoods(po.id, { L1: QTY }, { date: '2026-08-02' })

    expect(item().quantity).toBe(QTY)
    expect(item().costPrice).toBe(PRICE)
    expect(netOf('acc-inv')).toBeCloseTo(NET, 2)
    expect(netOf('acc-grni')).toBeCloseTo(-NET, 2)   // a liability until billed
    expect(netOf('acc-admin')).toBeCloseTo(0, 2)     // nothing landed in overheads
  })

  it('clears the accrual when the bill arrives, without touching stock twice', () => {
    const po = orderFor({ itemId: laptop.id, description: 'Laptop', accountId: 'acc-inv' })
    g().receiveGoods(po.id, { L1: QTY }, { date: '2026-08-02' })
    g().billReceivedPO(po.id, { L1: QTY }, { date: '2026-08-02' })

    expect(item().quantity).toBe(QTY)                 // still five, not ten
    expect(netOf('acc-inv')).toBeCloseTo(NET, 2)
    expect(netOf('acc-grni')).toBeCloseTo(0, 2)       // accrual settled
    expect(netOf('acc-vatin')).toBeCloseTo(VAT, 2)
    expect(netOf('acc-ap')).toBeCloseTo(-(NET + VAT), 2)
  })
})

describe('a purchase order line with no stock item', () => {
  it('is an expense — it moves no stock, and the books say so plainly', () => {
    const po = orderFor({ description: 'Laptop', accountId: 'acc-admin' })
    g().receiveGoods(po.id, { L1: QTY }, { date: '2026-08-02' })

    expect(item().quantity).toBe(0)
    expect(netOf('acc-admin')).toBeCloseTo(NET, 2)
    expect(netOf('acc-inv')).toBeCloseTo(0, 2)
  })

  it('still balances, so the damage is visible rather than corrupt', () => {
    const po = orderFor({ description: 'Laptop', accountId: 'acc-admin' })
    g().receiveGoods(po.id, { L1: QTY }, { date: '2026-08-02' })
    g().billReceivedPO(po.id, { L1: QTY }, { date: '2026-08-02' })

    const balanced = g().journalEntries.every((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      return Math.round((dr - cr) * 100) / 100 === 0
    })
    expect(balanced).toBe(true)
    expect(netOf('acc-grni')).toBeCloseTo(0, 2)
  })
})

describe('billing goods that were never received', () => {
  it('is refused rather than accrued', () => {
    const po = orderFor({ itemId: laptop.id, description: 'Laptop', accountId: 'acc-inv' })
    const before = g().journalEntries.length

    expect(g().billReceivedPO(po.id, { L1: QTY }, { date: '2026-08-02' })).toBeNull()
    expect(g().journalEntries).toHaveLength(before)
    expect(netOf('acc-grni')).toBeCloseTo(0, 2)
  })
})

describe('a standalone purchase invoice', () => {
  it('receives stock on its own, with no goods receipt involved', () => {
    g().addPurchase({
      supplierId: supp.id, supplierName: supp.name, date: '2026-08-02', dueDate: '2026-08-16',
      items: [{ itemId: laptop.id, description: 'Laptop', quantity: QTY, unitPrice: PRICE, taxRate: 15, subtotal: NET, accountId: 'acc-inv' }],
      subtotal: NET, taxAmount: VAT, total: NET + VAT,
    })

    expect(item().quantity).toBe(QTY)
    expect(netOf('acc-inv')).toBeCloseTo(NET, 2)
    expect(netOf('acc-grni')).toBeCloseTo(0, 2)   // no accrual on the direct path
    expect(netOf('acc-ap')).toBeCloseTo(-(NET + VAT), 2)
  })
})
