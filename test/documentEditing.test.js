// Correcting a posted document.
//
// Everybody types an invoice wrong eventually — the wrong quantity, the wrong
// price, a line booked to overheads that should have gone into stock. Until now
// the only route back was to void and re-issue, which leaves two documents where
// there should be one, or to leave it wrong.
//
// Editing here means the document is unposted and posted again from the
// corrected version: same number, same id, ledger and stock exactly as they
// would have been had it been right the first time. That is only honest while
// nothing has been hung off the document. These tests pin both halves — what an
// edit does, and every state in which it is refused.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { editBlock } from '../src/utils/docEdit.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const netOf = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
const item = () => g().inventoryItems.find((i) => i.code === 'SKU-001')

let cust, supp, laptop
beforeEach(() => {
  useStore.setState({
    journalEntries: [], invoices: [], purchases: [], purchaseOrders: [], goodsReceipts: [],
    quotations: [], salesOrders: [], creditNotes: [], debitNotes: [],
    inventoryItems: [], customers: [], suppliers: [], stockMovements: [], auditLog: [],
  })
  g().updateTax({ enabled: true, rate: 15, name: 'VAT', system: 'vat' })
  g().setPeriodLock({ lockDate: '' })
  g().addCustomer({ name: 'Acme Co' })
  cust = last(g().customers)
  g().addSupplier({ name: 'Samsung' })
  supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Laptop', code: 'SKU-001', costPrice: 1000, salePrice: 2000, quantity: 10, unit: 'pcs', type: 'stock' })
  laptop = last(g().inventoryItems)
})

// A plain two-unit sale at 1,000 each: 2,000 net, 300 VAT, 2,300 receivable.
const saleOf = (qty, price) => g().addInvoice({
  customerId: cust.id, customerName: cust.name, date: '2026-08-02', dueDate: '2026-09-01',
  items: [{ id: 'L1', itemId: laptop.id, description: 'Laptop', quantity: qty, unitPrice: price, discount: 0, taxRate: 15, subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15, accountId: 'acc-sales' }],
  subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15,
})

const revisedSale = (inv, qty, price) => ({
  ...inv,
  items: [{ ...inv.items[0], quantity: qty, unitPrice: price, subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15 }],
  subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15,
})

describe('editing an unpaid sales invoice', () => {
  it('re-posts the ledger to match the corrected document', () => {
    const inv = saleOf(2, 1000)
    expect(netOf('acc-ar')).toBeCloseTo(2300, 2)

    g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))

    expect(netOf('acc-ar')).toBeCloseTo(3450, 2)      // not 2,300 + 3,450
    expect(netOf('acc-sales')).toBeCloseTo(-3000, 2)
    expect(netOf('acc-vatout')).toBeCloseTo(-450, 2)
  })

  it('keeps the invoice number and its place in the sequence', () => {
    const inv = saleOf(2, 1000)
    const seqBefore = g().settings.invoice.next

    g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))
    const after = g().invoices.find((i) => i.id === inv.id)

    expect(g().invoices).toHaveLength(1)
    expect(after.number).toBe(inv.number)
    expect(after.createdAt).toBe(inv.createdAt)
    expect(after.revision).toBe(1)
    expect(g().settings.invoice.next).toBe(seqBefore)   // no number burned
  })

  it('moves stock and cost of sales to the new quantity', () => {
    const inv = saleOf(2, 1000)
    expect(item().quantity).toBe(8)

    g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))

    expect(item().quantity).toBe(7)                    // 10 − 3, not 10 − 2 − 3
    expect(netOf('acc-cogs')).toBeCloseTo(3000, 2)     // 3 × 1,000 carried cost
    // The item's opening quantity was set on the item, not journalled (that is
    // what Opening Balances is for), so Inventory carries only this issue —
    // relieved once for three units, not twice for two and then three.
    expect(netOf('acc-inv')).toBeCloseTo(-3000, 2)
  })

  it('leaves no orphaned journal entries behind', () => {
    const inv = saleOf(2, 1000)
    g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))
    const after = g().invoices.find((i) => i.id === inv.id)

    // exactly one sale entry and one COGS entry, and both belong to this invoice
    expect(g().journalEntries).toHaveLength(2)
    expect(g().journalEntries.map((j) => j.id).sort())
      .toEqual([after.journalEntryId, after.cogsJournalEntryId].sort())
    expect(g().journalEntries.every((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      return Math.round((dr - cr) * 100) / 100 === 0
    })).toBe(true)
  })

  it('is written to the audit log as an edit, not a deletion', () => {
    const inv = saleOf(2, 1000)
    g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))
    const actions = g().auditLog.map((a) => a.action)

    expect(actions).toContain('Edited invoice')
    expect(actions).not.toContain('Deleted invoice')
  })
})

describe('a sales invoice that must not be edited', () => {
  it('is refused once a receipt has been recorded against it', () => {
    const inv = saleOf(2, 1000)
    g().recordInvoicePayment(inv.id, { date: '2026-08-05', amount: 500, bankAccountId: 'acc-cash' })

    expect(g().invoiceEditBlock(inv.id)).toBe('paid')
    expect(() => g().reviseInvoice(inv.id, revisedSale(inv, 3, 1000))).toThrow(/EDIT_BLOCKED:paid/)
    expect(netOf('acc-ar')).toBeCloseTo(1800, 2)   // untouched: 2,300 − 500
  })

  it('is refused once it has been voided', () => {
    const inv = saleOf(2, 1000)
    g().voidInvoice(inv.id, { reason: 'duplicate' })
    expect(g().invoiceEditBlock(inv.id)).toBe('void')
  })

  it('is refused once a credit note has been raised against it', () => {
    const inv = saleOf(2, 1000)
    g().createSalesReturn(inv.id, { L1: 1 }, { reason: 'faulty' })
    expect(g().invoiceEditBlock(inv.id)).toBe('returned')
  })

  it('is refused when its date falls in a closed period', () => {
    const inv = saleOf(2, 1000)
    g().setPeriodLock({ lockDate: '2026-08-31', lockedBy: 'owner' })
    expect(g().invoiceEditBlock(inv.id)).toBe('locked')
  })

  it('is refused when a sales order is matching quantities against it', () => {
    const inv = saleOf(2, 1000)
    useStore.setState({ salesOrders: [{ id: 'so-1', invoiceIds: [inv.id], items: [] }] })
    expect(g().invoiceEditBlock(inv.id)).toBe('ordered')
  })
})

// The bug this feature exists for: a bill entered against General &
// Administrative when the goods should have gone into stock.
describe('editing an unpaid purchase bill', () => {
  const billTo = (accountId, itemId) => g().addPurchase({
    supplierId: supp.id, supplierName: supp.name, date: '2026-08-02', dueDate: '2026-09-01',
    items: [{ id: 'L1', itemId: itemId || '', description: 'Laptop', quantity: 5, unitPrice: 15000, discount: 0, taxRate: 15, subtotal: 75000, taxAmount: 11250, total: 86250, accountId }],
    subtotal: 75000, taxAmount: 11250, total: 86250,
  })

  it('moves a line booked to overheads into inventory, and brings the stock in', () => {
    const bill = billTo('acc-admin', null)
    expect(netOf('acc-admin')).toBeCloseTo(75000, 2)
    expect(item().quantity).toBe(10)                    // nothing arrived

    g().revisePurchase(bill.id, {
      ...bill,
      items: [{ ...bill.items[0], itemId: laptop.id, accountId: 'acc-inv' }],
    })

    expect(netOf('acc-admin')).toBeCloseTo(0, 2)        // overheads cleared
    expect(netOf('acc-inv')).toBeCloseTo(75000, 2)      // the cost landed in stock
    expect(item().quantity).toBe(15)                    // 10 on the shelf + 5 delivered
    expect(netOf('acc-ap')).toBeCloseTo(-86250, 2)      // supplier still owed once
  })

  it('keeps its number and does not advance the sequence', () => {
    const bill = billTo('acc-admin', null)
    const seqBefore = g().settings.purchase.next

    g().revisePurchase(bill.id, { ...bill, total: 86250 })

    expect(g().purchases).toHaveLength(1)
    expect(g().purchases[0].number).toBe(bill.number)
    expect(g().purchases[0].revision).toBe(1)
    expect(g().settings.purchase.next).toBe(seqBefore)
  })

  it('is refused once a payment has gone out', () => {
    const bill = billTo('acc-admin', null)
    g().recordPurchasePayment(bill.id, { date: '2026-08-05', amount: 1000, bankAccountId: 'acc-cash' })
    expect(g().purchaseEditBlock(bill.id)).toBe('paid')
    expect(() => g().revisePurchase(bill.id, bill)).toThrow(/EDIT_BLOCKED:paid/)
  })

  it('is refused for a bill raised off a goods receipt', () => {
    const bill = billTo('acc-admin', null)
    g().updatePurchase(bill.id, { fromGrni: true })
    expect(g().purchaseEditBlock(bill.id)).toBe('grni')
  })

  it('is refused when a purchase order is matching quantities against it', () => {
    const bill = billTo('acc-admin', null)
    useStore.setState({ purchaseOrders: [{ id: 'po-1', purchaseIds: [bill.id], items: [] }] })
    expect(g().purchaseEditBlock(bill.id)).toBe('ordered')
  })
})

describe('editing a journal entry', () => {
  const manual = () => g().addJournalEntry({
    date: '2026-08-02', description: 'Accrue rent', type: 'manual',
    lines: [
      { accountId: 'acc-rent', debit: 5000, credit: 0 },
      { accountId: 'acc-accrued', debit: 0, credit: 5000 },
    ],
  })

  it('replaces the entry in place, keeping its number', () => {
    const je = manual()
    expect(netOf('acc-rent')).toBeCloseTo(5000, 2)

    g().updateJournalEntry(je.id, {
      description: 'Accrue rent (corrected)',
      lines: [
        { accountId: 'acc-rent', debit: 6200, credit: 0 },
        { accountId: 'acc-accrued', debit: 0, credit: 6200 },
      ],
    })

    expect(g().journalEntries).toHaveLength(1)
    expect(g().journalEntries[0].number).toBe(je.number)
    expect(g().journalEntries[0].description).toBe('Accrue rent (corrected)')
    expect(netOf('acc-rent')).toBeCloseTo(6200, 2)      // not 11,200
    expect(g().auditLog.map((a) => a.action)).toContain('Edited journal entry')
  })

  it('refuses a patch that would leave the entry unbalanced', () => {
    const je = manual()
    expect(() => g().updateJournalEntry(je.id, {
      lines: [
        { accountId: 'acc-rent', debit: 6200, credit: 0 },
        { accountId: 'acc-accrued', debit: 0, credit: 5000 },
      ],
    })).toThrow(/JE_UNBALANCED/)
    expect(netOf('acc-rent')).toBeCloseTo(5000, 2)
  })

  it('refuses an entry a document posted — that is corrected at its source', () => {
    const inv = saleOf(2, 1000)
    expect(g().journalEditBlock(inv.journalEntryId)).toBe('auto')
    expect(() => g().updateJournalEntry(inv.journalEntryId, { description: 'nope' })).toThrow(/JE_NOT_MANUAL/)
  })

  it('refuses a reversal and an entry already reversed', () => {
    const je = manual()
    g().voidJournalEntry(je.id, { date: '2026-08-03', reason: 'wrong month' })
    const reversal = g().journalEntries.find((j) => j.reverses === je.id)

    expect(g().journalEditBlock(je.id)).toBe('voided')
    expect(g().journalEditBlock(reversal.id)).toBe('reversal')
    expect(() => g().updateJournalEntry(je.id, { description: 'nope' })).toThrow(/JE_IMMUTABLE/)
  })

  it('refuses an entry in a closed period', () => {
    const je = manual()
    g().setPeriodLock({ lockDate: '2026-08-31', lockedBy: 'owner' })
    expect(g().journalEditBlock(je.id)).toBe('locked')
    expect(() => g().updateJournalEntry(je.id, { description: 'nope' })).toThrow(/PERIOD_LOCKED/)
  })
})

describe('the editability rule itself', () => {
  const doc = (over = {}) => ({ status: 'sent', amountPaid: 0, payments: [], items: [], date: '2026-08-02', ...over })

  it('lets an untouched document through', () => {
    expect(editBlock(doc())).toBeNull()
  })

  it('reports the first thing that blocks it, in severity order', () => {
    expect(editBlock(null)).toBe('missing')
    expect(editBlock(doc({ status: 'void', amountPaid: 500 }))).toBe('void')
    expect(editBlock(doc({ amountPaid: 500, items: [{ returnedQty: 1 }] }))).toBe('paid')
    expect(editBlock(doc({ items: [{ returnedQty: 1 }] }))).toBe('returned')
  })

  it('treats a zero-value payment record as payment all the same', () => {
    expect(editBlock(doc({ payments: [{ amount: 0 }] }))).toBe('paid')
  })

  it('only blocks on GRNI for purchases', () => {
    expect(editBlock(doc({ fromGrni: true }), { kind: 'purchase' })).toBe('grni')
    expect(editBlock(doc({ fromGrni: true }), { kind: 'invoice' })).toBeNull()
  })

  it('compares the lock date inclusively', () => {
    expect(editBlock(doc({ date: '2026-08-02' }), { lockDate: '2026-08-02' })).toBe('locked')
    expect(editBlock(doc({ date: '2026-08-03' }), { lockDate: '2026-08-02' })).toBeNull()
  })
})
