// The inventory control-account reconciliation, path by path.
//
// Every journal entry in this system balances, and every path below balanced
// before these tests existed. That is exactly the point: a balanced entry
// proves nothing about whether the ledger still describes the warehouse. Stock
// can move with no entry behind it, an entry can post with no stock behind it,
// and goods can be relieved at a cost they were never carried at — none of
// which any other check notices.
//
// So each test runs a path and then asks one question: are the inventory
// accounts still worth what is on the shelf? Work orders got this wrong in
// three separate ways and nothing caught it, because the only test they had
// asked whether their entries balanced.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const netOf = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
// What the perpetual stock ledger says the shelf is worth.
const stockValue = () => Math.round(g().inventoryItems.reduce(
  (s, i) => s + (Number(i.quantity) || 0) * (Number(i.costPrice) || 0), 0) * 100) / 100

/** Ledger minus shelf. Zero, always — anything else is the bug. */
const drift = () => Math.round((netOf('acc-inv') - stockValue()) * 100) / 100

let cust, supp, widget
beforeEach(() => {
  useStore.setState({
    journalEntries: [], invoices: [], purchases: [], purchaseOrders: [], goodsReceipts: [],
    quotations: [], salesOrders: [], creditNotes: [], debitNotes: [], deliveryNotes: [],
    inventoryItems: [], customers: [], suppliers: [], stockMovements: [], auditLog: [],
    stockAdjustments: [], warehouses: [], stockTransfers: [], productionOrders: [],
  })
  g().updateTax({ enabled: true, rate: 15, name: 'VAT', system: 'vat' })
  g().addCustomer({ name: 'Acme' })
  cust = last(g().customers)
  g().addSupplier({ name: 'Supplier' })
  supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Widget', code: 'W1', costPrice: 0, salePrice: 200, quantity: 0, unit: 'pcs', type: 'stock' })
  widget = last(g().inventoryItems)
})

const buy = (qty, price) => g().addPurchase({
  supplierId: supp.id, supplierName: supp.name, date: '2026-08-02', dueDate: '2026-09-01',
  items: [{ id: 'P1', itemId: widget.id, description: 'Widget', quantity: qty, unitPrice: price, discount: 0, taxRate: 15, subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15, accountId: 'acc-inv' }],
  subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15,
})

const sell = (qty, price) => g().addInvoice({
  customerId: cust.id, customerName: cust.name, date: '2026-08-05', dueDate: '2026-09-05',
  items: [{ id: 'S1', itemId: widget.id, description: 'Widget', quantity: qty, unitPrice: price, discount: 0, taxRate: 15, subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15, accountId: 'acc-sales' }],
  subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15,
})

describe('inventory control account vs the shelf', () => {
  it('purchase then sale', () => {
    buy(10, 100)
    expect(drift()).toBe(0)
    sell(4, 200)
    expect(drift()).toBe(0)
  })

  it('sales return (credit note restocks)', () => {
    buy(10, 100)
    const inv = sell(4, 200)
    g().createSalesReturn(inv.id, { S1: 2 }, { reason: 'faulty' })
    expect(drift()).toBe(0)
  })

  it('purchase return (debit note)', () => {
    const p = buy(10, 100)
    g().createPurchaseReturn(p.id, { P1: 3 }, { reason: 'damaged' })
    expect(drift()).toBe(0)
  })

  it('void a purchase', () => {
    const p = buy(10, 100)
    g().voidPurchase(p.id, { reason: 'wrong' })
    expect(drift()).toBe(0)
  })

  it('void an invoice', () => {
    buy(10, 100)
    const inv = sell(4, 200)
    g().voidInvoice(inv.id, { reason: 'wrong' })
    expect(drift()).toBe(0)
  })

  it('stock adjustment increase', () => {
    buy(10, 100)
    const adj = g().addStockAdjustment({
      itemId: widget.id, itemName: 'Widget', date: '2026-08-06', type: 'increase',
      quantity: 5, unitCost: 100, totalAmount: 500, reason: 'found',
    })
    g().approveStockAdjustment(adj.id, { id: 'u1', name: 'Owner' })
    expect(drift()).toBe(0)
  })

  it('stock adjustment decrease (write-off)', () => {
    buy(10, 100)
    const adj = g().addStockAdjustment({
      itemId: widget.id, itemName: 'Widget', date: '2026-08-06', type: 'decrease',
      quantity: 3, unitCost: 100, totalAmount: 300, reason: 'broken',
    })
    g().approveStockAdjustment(adj.id, { id: 'u1', name: 'Owner' })
    expect(drift()).toBe(0)
  })

  it('goods receipt then bill (three-way match)', () => {
    const po = g().addPurchaseOrder({
      supplierId: supp.id, supplierName: supp.name, date: '2026-08-02',
      items: [{ id: 'L1', itemId: widget.id, description: 'Widget', quantity: 10, unitPrice: 100, discount: 0, taxRate: 15, subtotal: 1000, accountId: 'acc-inv' }],
      subtotal: 1000, taxAmount: 150, total: 1150,
    })
    g().receiveGoods(po.id, { L1: 10 }, { date: '2026-08-03' })
    expect(drift()).toBe(0)
    g().billReceivedPO(po.id, { L1: 10 }, { date: '2026-08-04' })
    expect(drift()).toBe(0)
  })

  it('editing a bill (the new revise path)', () => {
    const p = buy(10, 100)
    g().revisePurchase(p.id, {
      ...p,
      items: [{ ...p.items[0], quantity: 12, subtotal: 1200, taxAmount: 180, total: 1380 }],
      subtotal: 1200, taxAmount: 180, total: 1380,
    })
    expect(drift()).toBe(0)
  })

  it('editing an invoice (the new revise path)', () => {
    buy(10, 100)
    const inv = sell(4, 200)
    g().reviseInvoice(inv.id, {
      ...inv,
      items: [{ ...inv.items[0], quantity: 6, subtotal: 1200, taxAmount: 180, total: 1380 }],
      subtotal: 1200, taxAmount: 180, total: 1380,
    })
    expect(drift()).toBe(0)
  })

  it('deleting an invoice', () => {
    buy(10, 100)
    const inv = sell(4, 200)
    g().deleteInvoice(inv.id)
    expect(drift()).toBe(0)
  })

  it('deleting a purchase', () => {
    const p = buy(10, 100)
    g().deletePurchase(p.id)
    expect(drift()).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Manufacturing, counts and landed costs, where items can be carried in
// more than one inventory account. Each account is compared on its own:
// two errors in opposite directions must not cancel out and look healthy.
// ─────────────────────────────────────────────────────────────────────
const INV_ACCOUNTS = ['acc-inv', 'acc-rawmat', 'acc-wip', 'acc-fingoods']
const glStock = () => Math.round(INV_ACCOUNTS.reduce((s, a) => s + netOf(a), 0) * 100) / 100
const shelf = () => Math.round(g().inventoryItems.reduce(
  (s, i) => s + (Number(i.quantity) || 0) * (Number(i.costPrice) || 0), 0) * 100) / 100
const wideDrift = () => Math.round((glStock() - shelf()) * 100) / 100
const layerQty = (i) => (i.costLayers || []).reduce((s, l) => s + (Number(l.qty) || 0), 0)

const stockItem = (name, code, extra = {}) => {
  g().addInventoryItem({ name, code, costPrice: 0, salePrice: 0, quantity: 0, unit: 'pcs', type: 'stock', ...extra })
  return last(g().inventoryItems)
}
const buyItem = (it, qty, price) => g().addPurchase({
  supplierId: supp.id, supplierName: supp.name, date: '2026-08-02', dueDate: '2026-09-01',
  items: [{ id: 'P1', itemId: it.id, description: it.name, quantity: qty, unitPrice: price, discount: 0, taxRate: 0, subtotal: qty * price, taxAmount: 0, total: qty * price, accountId: it.inventoryAccountId || 'acc-inv' }],
  subtotal: qty * price, taxAmount: 0, total: qty * price,
})
const buildOrder = (steel, frame, over = {}) => g().addWorkOrder({
  outputItemId: frame.id, outputName: 'Frame', outputQuantity: 1, targetQuantity: 10,
  components: [{ itemId: steel.id, name: 'Steel', quantity: 5, unitCost: 10, materialAccountId: 'acc-rawmat' }],
  wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods', ...over,
})

describe('a work order turning materials into product', () => {
  it('leaves the ledger worth what the shelf is worth', () => {
    const steel = stockItem('Steel', 'RM1', { inventoryAccountId: 'acc-rawmat' })
    const frame = stockItem('Frame', 'FG1', { inventoryAccountId: 'acc-fingoods' })
    buyItem(steel, 100, 10)
    expect(wideDrift()).toBe(0)
    g().completeWorkOrder(buildOrder(steel, frame).id, '2026-08-05')
    expect(wideDrift()).toBe(0)
  })

  it('relieves the account the stock is actually carried in', () => {
    // Neither item names an inventory account, so both are carried in
    // Inventory. Crediting a fixed Raw Materials account instead used to
    // drive it negative while Inventory kept value for consumed goods.
    const steel = stockItem('Steel', 'RM1')
    const frame = stockItem('Frame', 'FG1')
    buyItem(steel, 100, 10)
    g().completeWorkOrder(buildOrder(steel, frame, {
      components: [{ itemId: steel.id, name: 'Steel', quantity: 5, unitCost: 10 }],
    }).id, '2026-08-05')

    expect(netOf('acc-rawmat')).toBeCloseTo(0, 2)
    expect(netOf('acc-inv')).toBeCloseTo(1000, 2)   // 500 consumed, 500 produced, same account
    expect(wideDrift()).toBe(0)
  })

  it('costs materials at what they are carried at, not at a stale typed cost', () => {
    const steel = stockItem('Steel', 'RM1', { inventoryAccountId: 'acc-rawmat' })
    const frame = stockItem('Frame', 'FG1', { inventoryAccountId: 'acc-fingoods' })
    buyItem(steel, 100, 12)                       // really 12 each
    // ...but the order still carries the 10 that was typed when it was raised
    g().completeWorkOrder(buildOrder(steel, frame).id, '2026-08-05')

    expect(wideDrift()).toBe(0)
    expect(netOf('acc-rawmat')).toBeCloseTo(600, 2)   // 100@12 less 50@12
    expect(netOf('acc-fingoods')).toBeCloseTo(600, 2) // built at 12, not 10
  })

  it('moves cost layers with the quantity, so FIFO stays honest', () => {
    const steel = stockItem('Steel', 'RM1', { inventoryAccountId: 'acc-rawmat' })
    const frame = stockItem('Frame', 'FG1', { inventoryAccountId: 'acc-fingoods' })
    buyItem(steel, 100, 10)
    g().completeWorkOrder(buildOrder(steel, frame).id, '2026-08-05')

    const s = g().inventoryItems.find((i) => i.code === 'RM1')
    const f = g().inventoryItems.find((i) => i.code === 'FG1')
    expect(layerQty(s)).toBeCloseTo(s.quantity, 6)   // no phantom layers left behind
    expect(layerQty(f)).toBeCloseTo(f.quantity, 6)   // produced goods have layers of their own
  })
})

describe('a posted stock count', () => {
  it('books the difference it found', () => {
    const w = stockItem('Widget', 'W2')
    buyItem(w, 100, 10)
    const c = g().startStockCount({ date: '2026-08-06' })
    g().updateStockCount(c.id, {
      lines: (c.lines || []).map((l) => (l.itemId === w.id ? { ...l, counted: 94 } : l)),
    })
    g().postStockCount(c.id)
    expect(wideDrift()).toBe(0)
  })
})

describe('a landed cost', () => {
  it('adds freight to the shelf and the ledger alike', () => {
    const w = stockItem('Widget', 'W2')
    buyItem(w, 100, 10)
    g().postLandedCost({
      date: '2026-08-04', reference: 'FRT-1', note: 'Freight', method: 'value',
      amount: 500, creditAccountId: 'acc-ap', lines: [{ itemId: w.id, qty: 100 }],
    })
    expect(wideDrift()).toBe(0)
  })
})
