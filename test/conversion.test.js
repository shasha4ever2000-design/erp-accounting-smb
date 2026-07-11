import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'
import { docFulfillment } from '../src/utils/fulfillment.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

describe('partial quotation → invoice conversion', () => {
  g().addCustomer({ name: 'C' }); const cust = last(g().customers)
  const quote = g().addQuotation({
    customerId: cust.id, customerName: 'C', date: '2026-03-01',
    items: [
      { id: 'L1', description: 'Widget', quantity: 10, unitPrice: 100, discount: 0, taxRate: 0, accountId: 'acc-sales' },
      { id: 'L2', description: 'Gadget', quantity: 5, unitPrice: 50, discount: 0, taxRate: 0, accountId: 'acc-sales' },
    ],
    subtotal: 1250, taxAmount: 0, total: 1250,
  })

  it('invoices part of the quote and leaves the rest open', () => {
    const inv = g().convertQuotationToInvoice(quote.id, { L1: 4, L2: 5 })
    expect(inv).toBeTruthy()
    expect(inv.total).toBe(4 * 100 + 5 * 50)   // 650
    const q = g().quotations.find((x) => x.id === quote.id)
    expect(q.status).toBe('partial')
    expect(q.items.find((l) => l.id === 'L1').invoicedQty).toBe(4)
    expect(q.items.find((l) => l.id === 'L2').invoicedQty).toBe(5)
    expect(docFulfillment(q.items, 'invoicedQty').remaining).toBe(6) // 6 of L1 left
    expect(q.invoiceIds.length).toBe(1)
  })

  it('clamps a second conversion to the remaining and completes the quote', () => {
    const inv2 = g().convertQuotationToInvoice(quote.id, { L1: 99, L2: 99 }) // wants more than remains
    expect(inv2.total).toBe(6 * 100)            // only 6 of L1 remained; L2 already done
    const q = g().quotations.find((x) => x.id === quote.id)
    expect(q.status).toBe('invoiced')
    expect(docFulfillment(q.items, 'invoicedQty').remaining).toBe(0)
    expect(q.invoiceIds.length).toBe(2)
  })

  it('refuses to convert a fully-invoiced quote', () => {
    expect(g().convertQuotationToInvoice(quote.id)).toBeNull()
  })
})

describe('partial purchase order → bill conversion', () => {
  g().addSupplier({ name: 'S' }); const supp = last(g().suppliers)
  const po = g().addPurchaseOrder({
    supplierId: supp.id, supplierName: 'S', date: '2026-03-01',
    items: [{ id: 'P1', description: 'Steel', quantity: 100, unitPrice: 10, discount: 0, taxRate: 0, accountId: 'acc-admin' }],
    subtotal: 1000, taxAmount: 0, total: 1000,
  })

  it('receives part of the PO and keeps it partial', () => {
    const bill = g().convertPOToPurchase(po.id, { P1: 40 })
    expect(bill.total).toBe(400)
    const p = g().purchaseOrders.find((x) => x.id === po.id)
    expect(p.status).toBe('partial')
    expect(p.items[0].receivedQty).toBe(40)
    expect(docFulfillment(p.items, 'receivedQty').remaining).toBe(60)
  })

  it('receives the remainder and completes the PO', () => {
    g().convertPOToPurchase(po.id) // default = all remaining
    const p = g().purchaseOrders.find((x) => x.id === po.id)
    expect(p.status).toBe('invoiced')
    expect(p.items[0].receivedQty).toBe(100)
    expect(p.purchaseIds.length).toBe(2)
  })
})
