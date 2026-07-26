import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

beforeEach(() => {
  useStore.setState({
    salesOrders: [], purchaseQuotes: [], quotations: [], purchaseOrders: [],
    invoices: [], purchases: [], deliveryNotes: [], journalEntries: [],
    customers: [], suppliers: [], recycleBin: [],
  })
})

const line = (id, qty, price) => ({
  id, description: `Item ${id}`, quantity: qty, unitPrice: price,
  taxRate: 0, subtotal: qty * price, accountId: 'acc-sales',
})

const makeQuotation = () => {
  g().addCustomer({ name: 'Quoted Co' })
  const c = last(g().customers)
  return g().addQuotation({
    customerId: c.id, customerName: 'Quoted Co', date: '2026-05-01', expiryDate: '2026-06-01',
    items: [line('l1', 10, 100), line('l2', 4, 50)],
    subtotal: 1200, taxAmount: 0, total: 1200,
  })
}

const makeOrder = (items) => {
  g().addCustomer({ name: 'Order Co' })
  const c = last(g().customers)
  return g().addSalesOrder({
    customerId: c.id, customerName: 'Order Co', date: '2026-05-01', expectedDate: '2026-06-01',
    items: items || [line('l1', 10, 100)],
    subtotal: 1000, taxAmount: 0, total: 1000,
  })
}

describe('a sales order posts nothing', () => {
  it('creates no journal entry', () => {
    const before = g().journalEntries.length
    makeOrder()
    // A customer agreeing to buy is not a sale. Booking revenue here would
    // overstate both income and receivables.
    expect(g().journalEntries.length).toBe(before)
  })

  it('leaves every account at nil', () => {
    makeOrder()
    const moved = Object.entries(g().getAllBalances()).filter(([, b]) => b.dr !== 0 || b.cr !== 0)
    expect(moved).toEqual([])
  })

  it('numbers itself with the SO prefix and increments', () => {
    const a = makeOrder()
    const b = makeOrder()
    expect(a.number).toMatch(/^SO-/)
    expect(a.number).not.toBe(b.number)
  })

  it('starts open', () => {
    expect(makeOrder().status).toBe('open')
  })
})

describe('quotation → sales order', () => {
  it('carries the lines across and marks the quotation ordered', () => {
    const q = makeQuotation()
    const so = g().convertQuotationToSalesOrder(q.id)

    expect(so.items).toHaveLength(2)
    expect(so.total).toBe(1200)
    expect(g().quotations.find((x) => x.id === q.id).status).toBe('ordered')
    expect(so.quotationId).toBe(q.id)
  })

  it('converts part of a quotation and leaves the rest open', () => {
    const q = makeQuotation()
    const so = g().convertQuotationToSalesOrder(q.id, { l1: 4 })

    expect(so.items).toHaveLength(1)
    expect(so.items[0].quantity).toBe(4)
    const after = g().quotations.find((x) => x.id === q.id)
    expect(after.items.find((l) => l.id === 'l1').orderedQty).toBe(4)
    expect(after.status).not.toBe('ordered')
  })

  it('can be converted twice until the quotation is used up', () => {
    const q = makeQuotation()
    g().convertQuotationToSalesOrder(q.id, { l1: 6 })
    g().convertQuotationToSalesOrder(q.id, { l1: 4, l2: 4 })
    expect(g().quotations.find((x) => x.id === q.id).status).toBe('ordered')
    expect(g().salesOrders).toHaveLength(2)
  })

  it('refuses to convert nothing', () => {
    const q = makeQuotation()
    expect(g().convertQuotationToSalesOrder(q.id, { l1: 0, l2: 0 })).toBeNull()
  })

  it('returns nothing for a quotation that is not there', () => {
    expect(g().convertQuotationToSalesOrder('ghost')).toBeNull()
  })
})

describe('sales order → invoice', () => {
  it('raises the invoice and only then hits the ledger', () => {
    const so = makeOrder()
    const before = g().journalEntries.length

    const inv = g().convertSalesOrderToInvoice(so.id)

    expect(inv.total).toBe(1000)
    expect(inv.salesOrderId).toBe(so.id)
    // The invoice is the point revenue is earned, so entries appear now.
    expect(g().journalEntries.length).toBeGreaterThan(before)
  })

  it('marks the order invoiced when nothing is left to bill', () => {
    const so = makeOrder()
    g().convertSalesOrderToInvoice(so.id)
    expect(g().salesOrders.find((x) => x.id === so.id).status).toBe('invoiced')
  })

  it('bills part of an order and keeps the remainder open', () => {
    const so = makeOrder()
    g().convertSalesOrderToInvoice(so.id, { l1: 3 })

    const after = g().salesOrders.find((x) => x.id === so.id)
    expect(after.status).toBe('partial')
    expect(after.items[0].invoicedQty).toBe(3)
    expect(g().invoices[0].items[0].quantity).toBe(3)
  })

  it('never bills more than the order, however many times it is converted', () => {
    const so = makeOrder()
    g().convertSalesOrderToInvoice(so.id, { l1: 7 })
    g().convertSalesOrderToInvoice(so.id)
    const billed = g().invoices.reduce((s, i) => s + i.items.reduce((t, l) => t + l.quantity, 0), 0)
    expect(billed).toBe(10)
    expect(g().convertSalesOrderToInvoice(so.id)).toBeNull()
  })

  it('records every invoice it produced', () => {
    const so = makeOrder()
    g().convertSalesOrderToInvoice(so.id, { l1: 4 })
    g().convertSalesOrderToInvoice(so.id, { l1: 6 })
    expect(g().salesOrders.find((x) => x.id === so.id).invoiceIds).toHaveLength(2)
  })
})

describe('sales order → delivery note', () => {
  it('creates the note without touching the ledger', () => {
    const so = makeOrder()
    const before = g().journalEntries.length
    const dn = g().convertSalesOrderToDeliveryNote(so.id)

    expect(dn.salesOrderId).toBe(so.id)
    expect(g().journalEntries.length).toBe(before)
  })

  it('tracks delivery separately from billing', () => {
    const so = makeOrder()
    g().convertSalesOrderToDeliveryNote(so.id, { l1: 6 })
    g().convertSalesOrderToInvoice(so.id, { l1: 2 })

    const after = g().salesOrders.find((x) => x.id === so.id)
    // Goods can go out before they are billed, and vice versa; one must not
    // consume the other's remaining quantity.
    expect(after.items[0].deliveredQty).toBe(6)
    expect(after.items[0].invoicedQty).toBe(2)
  })

  it('never delivers more than ordered', () => {
    const so = makeOrder()
    g().convertSalesOrderToDeliveryNote(so.id, { l1: 8 })
    g().convertSalesOrderToDeliveryNote(so.id)
    const shipped = g().deliveryNotes.reduce((s, d) => s + d.items.reduce((t, l) => t + l.quantity, 0), 0)
    expect(shipped).toBe(10)
  })
})

describe('a purchase quote posts nothing', () => {
  const makeQuote = () => {
    g().addSupplier({ name: 'Bidding Supplier' })
    const sup = last(g().suppliers)
    return g().addPurchaseQuote({
      supplierId: sup.id, supplierName: 'Bidding Supplier', date: '2026-05-01', validUntil: '2026-06-01',
      items: [{ id: 'p1', description: 'Steel', quantity: 20, unitPrice: 30, taxRate: 0, subtotal: 600, accountId: 'acc-admin' }],
      subtotal: 600, taxAmount: 0, total: 600,
    })
  }

  it('creates no journal entry', () => {
    const before = g().journalEntries.length
    makeQuote()
    // Asking three suppliers for a price creates no liability.
    expect(g().journalEntries.length).toBe(before)
  })

  it('numbers itself with the PQ prefix', () => {
    expect(makeQuote().number).toMatch(/^PQ-/)
  })

  it('converts to a purchase order', () => {
    const q = makeQuote()
    const po = g().convertPurchaseQuoteToOrder(q.id)

    expect(po.supplierName).toBe('Bidding Supplier')
    expect(po.total).toBe(600)
    expect(po.purchaseQuoteId).toBe(q.id)
    expect(g().purchaseQuotes.find((x) => x.id === q.id).status).toBe('ordered')
  })

  it('still posts nothing once it becomes a purchase order', () => {
    const q = makeQuote()
    const before = g().journalEntries.length
    g().convertPurchaseQuoteToOrder(q.id)
    // A purchase order is a commitment, not a liability — the bill is.
    expect(g().journalEntries.length).toBe(before)
  })

  it('converts partially and keeps the rest available', () => {
    const q = makeQuote()
    g().convertPurchaseQuoteToOrder(q.id, { p1: 5 })
    const after = g().purchaseQuotes.find((x) => x.id === q.id)
    expect(after.items[0].orderedQty).toBe(5)
    expect(after.status).toBe('partial')
  })

  it('refuses to convert a quote twice over', () => {
    const q = makeQuote()
    g().convertPurchaseQuoteToOrder(q.id)
    expect(g().convertPurchaseQuoteToOrder(q.id)).toBeNull()
  })
})

describe('both documents go to the recycle bin, not the void path', () => {
  it('bins a deleted sales order', () => {
    const so = makeOrder()
    g().deleteSalesOrder(so.id)
    expect(g().recycleBin.some((e) => e.recordId === so.id && e.entity === 'salesOrders')).toBe(true)
  })

  it('bins a deleted purchase quote', () => {
    g().addSupplier({ name: 'S' })
    const sup = last(g().suppliers)
    const q = g().addPurchaseQuote({
      supplierId: sup.id, supplierName: 'S', date: '2026-05-01',
      items: [{ id: 'p1', description: 'x', quantity: 1, unitPrice: 1, taxRate: 0, subtotal: 1 }],
      subtotal: 1, taxAmount: 0, total: 1,
    })
    g().deletePurchaseQuote(q.id)
    expect(g().recycleBin.some((e) => e.recordId === q.id && e.entity === 'purchaseQuotes')).toBe(true)
  })
})
