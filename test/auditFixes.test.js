// Regression tests for the bugs found in the September 2026 audit.
//
// Each block names the bug it pins down. Every one of these reproduced on the
// code before the fix: stock put back as a phantom kit, cost layers falling
// out of step with quantity, a legitimate edit reported as tampering, a
// customer allowed to pay for goods they had already returned, and so on.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { layerQty } from '../src/utils/fifo.js'

const g = () => useStore.getState()
const byName = (n) => g().inventoryItems.find((i) => i.name === n)
const bal = (id) => g().journalEntries.flatMap((j) => j.lines)
  .filter((l) => l.accountId === id).reduce((s, l) => s + (+l.debit || 0) - (+l.credit || 0), 0)

const invoice = (items, over = {}) => {
  const total = items.reduce((s, l) => s + l.subtotal, 0)
  return {
    customerId: 'c1', customerName: 'Acme', date: '2026-04-01', dueDate: '2026-05-01',
    items, subtotal: total, taxAmount: 0, total, ...over,
  }
}
const line = (itemId, qty, price, id = 'L1') =>
  ({ id, itemId, description: 'x', quantity: qty, unitPrice: price, taxRate: 0, subtotal: qty * price, accountId: 'acc-sales' })
const service = (amount, id = 'S1') =>
  ({ id, description: 'Work', quantity: 1, unitPrice: amount, taxRate: 0, subtotal: amount, accountId: 'acc-sales' })

beforeEach(() => {
  useStore.setState({
    inventoryItems: [], invoices: [], purchases: [], journalEntries: [], customers: [],
    creditNotes: [], debitNotes: [], stockMovements: [], recycleBin: [], payrollRuns: [],
  })
  g().updateInventorySettings({ costingMethod: 'wac' })
  g().setPeriodLock({ lockDate: '', lockedBy: '' })
  g().addInventoryItem({ name: 'Drill', quantity: 10, costPrice: 100, salePrice: 200 })
  g().addInventoryItem({ name: 'Battery', quantity: 50, costPrice: 20, salePrice: 40 })
  g().addInventoryItem({
    name: 'Kit', quantity: 0, costPrice: 0, salePrice: 400, isKit: true,
    components: [{ itemId: byName('Drill').id, quantity: 1 }, { itemId: byName('Battery').id, quantity: 2 }],
  })
})

describe('journal entries must balance to the cent', () => {
  it('refuses an entry that is 4 cents out', () => {
    expect(() => g().addJournalEntry({
      date: '2026-04-01',
      lines: [{ accountId: 'acc-bank1', debit: 100.04, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 100 }],
    })).toThrow(/JE_UNBALANCED/)
  })

  it('still accepts floating-point noise below half a cent', () => {
    expect(() => g().addJournalEntry({
      date: '2026-04-01',
      lines: [
        { accountId: 'acc-bank1', debit: 0.1, credit: 0 }, { accountId: 'acc-bank1', debit: 0.2, credit: 0 },
        { accountId: 'acc-sales', debit: 0, credit: 0.3 },
      ],
    })).not.toThrow()
  })
})

describe('deleting or editing a document keeps the ledger chain intact', () => {
  it('an invoice edit is not reported as tampering', () => {
    const a = g().addInvoice(invoice([service(100)]))
    g().addInvoice(invoice([service(50)]))
    g().reviseInvoice(a.id, invoice([service(120)]))
    expect(g().verifyLedger().ok).toBe(true)
  })

  it('deleting a bill in the middle of the ledger re-chains what follows', () => {
    g().addInvoice(invoice([service(10)]))
    const bill = g().addPurchase({
      supplierId: 's1', supplierName: 'S', date: '2026-04-02', dueDate: '2026-05-02',
      items: [{ description: 'Rent', quantity: 1, unitPrice: 80, subtotal: 80, accountId: 'acc-admin' }],
      subtotal: 80, taxAmount: 0, total: 80,
    }, { approved: true })
    g().addInvoice(invoice([service(20)]))
    g().deletePurchase(bill.id)
    expect(g().verifyLedger().ok).toBe(true)
  })
})

describe('voiding or editing a kit invoice returns the components', () => {
  it('void puts back what the kit took', () => {
    const inv = g().addInvoice(invoice([line(byName('Kit').id, 1, 400)]))
    expect(byName('Drill').quantity).toBe(9)
    g().voidInvoice(inv.id)
    expect(byName('Drill').quantity).toBe(10)
    expect(byName('Battery').quantity).toBe(50)
    expect(byName('Kit').quantity).toBe(0)
  })

  it('an edit does not issue the components twice', () => {
    const inv = g().addInvoice(invoice([line(byName('Kit').id, 1, 400)]))
    g().reviseInvoice(inv.id, invoice([line(byName('Kit').id, 1, 400)], { notes: 'fixed a typo' }))
    expect(byName('Drill').quantity).toBe(9)
    expect(byName('Battery').quantity).toBe(48)
    expect(byName('Kit').quantity).toBe(0)
  })

  it('uses what the sale actually issued, even if the kit recipe changed since', () => {
    const inv = g().addInvoice(invoice([line(byName('Kit').id, 1, 400)]))
    g().updateInventoryItem(byName('Kit').id, { components: [{ itemId: byName('Drill').id, quantity: 3 }] })
    g().voidInvoice(inv.id)
    expect(byName('Drill').quantity).toBe(10)
    expect(byName('Battery').quantity).toBe(50)
  })
})

describe('FIFO layers stay in step with quantity', () => {
  it('after a void', () => {
    g().updateInventorySettings({ costingMethod: 'fifo' })
    const inv = g().addInvoice(invoice([line(byName('Drill').id, 4, 200)]))
    g().voidInvoice(inv.id)
    const d = byName('Drill')
    expect(d.quantity).toBe(10)
    expect(layerQty(d.costLayers)).toBe(10)
    expect(d.costPrice).toBeCloseTo(100, 4)
  })

  it('after a customer return', () => {
    g().updateInventorySettings({ costingMethod: 'fifo' })
    const inv = g().addInvoice(invoice([line(byName('Drill').id, 4, 200)]))
    g().createSalesReturn(inv.id, { L1: 1 }, { date: '2026-04-05' })
    const d = byName('Drill')
    expect(d.quantity).toBe(7)
    expect(layerQty(d.costLayers)).toBe(7)
  })

  it('landed cost reaches cost of sales under FIFO', () => {
    g().updateInventorySettings({ costingMethod: 'fifo' })
    const drill = byName('Drill')
    g().postLandedCost({ date: '2026-04-01', amount: 100, method: 'value', lines: [{ itemId: drill.id, qty: 10 }] })
    const inv = g().addInvoice(invoice([line(drill.id, 10, 200)]))
    // 10 units at 100 plus 100 of freight: the whole 1,100 is cost of sales.
    expect(inv.cogsTotal).toBeCloseTo(1100, 2)
  })
})

describe('deleting a sales return undoes all of it', () => {
  it('takes the goods back off the shelf, removes the COGS reversal and reopens the line', () => {
    const inv = g().addInvoice(invoice([line(byName('Drill').id, 2, 200)]))
    const cn = g().createSalesReturn(inv.id, { L1: 1 }, { date: '2026-04-05' })
    expect(byName('Drill').quantity).toBe(9)
    g().deleteCreditNote(cn.id)
    expect(byName('Drill').quantity).toBe(8)
    expect(byName('Drill').costPrice).toBeCloseTo(100, 4)
    expect(g().journalEntries.filter((j) => j.reference === cn.number)).toHaveLength(0)
    expect(g().invoices[0].items[0].returnedQty).toBe(0)
    expect(g().invoices[0].creditNoteIds).toEqual([])
    expect(g().verifyLedger().ok).toBe(true)
    // ...and the line can be returned again.
    expect(g().createSalesReturn(inv.id, { L1: 2 }, { date: '2026-04-06' })).toBeTruthy()
  })

  it('deleting a purchase return puts the stock and the bill line back', () => {
    const bill = g().addPurchase({
      supplierId: 's1', supplierName: 'S', date: '2026-04-01', dueDate: '2026-05-01',
      items: [{ id: 'B1', itemId: byName('Drill').id, description: 'Drill', quantity: 5, unitPrice: 100, subtotal: 500, accountId: 'acc-inv' }],
      subtotal: 500, taxAmount: 0, total: 500,
    }, { approved: true })
    const dn = g().createPurchaseReturn(bill.id, { B1: 2 }, { date: '2026-04-03' })
    expect(byName('Drill').quantity).toBe(13)
    g().deleteDebitNote(dn.id)
    expect(byName('Drill').quantity).toBe(15)
    expect(g().purchases[0].items[0].returnedQty).toBe(0)
  })
})

describe('payments respect returns already credited', () => {
  it('an invoice with a return cannot be overpaid', () => {
    const inv = g().addInvoice(invoice([service(1000)]))
    g().createSalesReturn(inv.id, { S1: 0.4 }, { date: '2026-04-02' })
    const r = g().recordInvoicePayment(inv.id, { amount: 1000, date: '2026-04-05', bankAccountId: 'acc-bank1' })
    expect(r.amount).toBe(600)
    expect(bal('acc-ar')).toBeCloseTo(0, 2)
    expect(g().invoices[0].status).toBe('paid')
  })

  it('a bill with a return cannot be overpaid', () => {
    const bill = g().addPurchase({
      supplierId: 's1', supplierName: 'S', date: '2026-04-01', dueDate: '2026-05-01',
      items: [{ id: 'B1', itemId: byName('Drill').id, description: 'Drill', quantity: 5, unitPrice: 100, subtotal: 500, accountId: 'acc-inv' }],
      subtotal: 500, taxAmount: 0, total: 500,
    }, { approved: true })
    g().createPurchaseReturn(bill.id, { B1: 1 }, { date: '2026-04-03' })
    g().recordPurchasePayment(bill.id, { amount: 500, date: '2026-04-05', bankAccountId: 'acc-bank1' }, { approved: true })
    expect(g().purchases[0].amountPaid).toBe(400)
    expect(g().purchases[0].status).toBe('paid')
    expect(bal('acc-ap')).toBeCloseTo(0, 2)
  })
})

describe('backups and cloud sync', () => {
  it('never carry the AI API key', () => {
    g().updateAiSettings({ apiKey: 'sk-ant-secret' })
    const out = g().exportData()
    expect(JSON.stringify(out)).not.toContain('sk-ant-secret')
    // ...and the live settings are untouched.
    expect(g().settings.ai.apiKey).toBe('sk-ant-secret')
  })

  it('restoring a backup keeps the key this device already has', () => {
    g().updateAiSettings({ apiKey: 'sk-ant-secret' })
    g().importData(g().exportData())
    expect(g().settings.ai.apiKey).toBe('sk-ant-secret')
  })

  it('a backup from an older version is upgraded on restore', () => {
    const old = g().exportData()
    old._version = 38
    old.settings = { ...old.settings }
    delete old.settings.deferredTax
    old.accounts = old.accounts.filter((a) => a.id !== 'acc-dtl')
    g().importData(old)
    expect(g().settings.deferredTax).toBeTruthy()
    expect(g().accounts.some((a) => a.id === 'acc-dtl')).toBe(true)
  })
})
