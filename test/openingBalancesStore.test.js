import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

// The store is a module singleton, so each test measures the delta it caused
// and resets the opening state it owns.
const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  const a = g().accounts.find((x) => x.id === id)
  return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
}
const tbDiff = () => {
  let d = 0, c = 0
  g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) }))
  return Math.abs(d - c)
}
// Test-harness only. The store is a singleton, so a test that deliberately
// leaves an un-reversible opening (one with a payment against it) would
// otherwise poison every test after it. Reverse properly when we can; scrub
// directly when the product correctly refuses.
const resetOpening = () => {
  try { if (g().settings.opening?.posted) g().reverseOpeningBalances() } catch { /* refused — scrub below */ }
  useStore.setState((s) => ({
    invoices: s.invoices.filter((i) => !i.isOpening),
    purchases: s.purchases.filter((p) => !p.isOpening),
    settings: { ...s.settings, opening: { date: '', posted: false, journalEntryId: null, postedAt: '', counts: null } },
  }))
}

describe('postOpeningBalances', () => {
  beforeEach(resetOpening)

  it('posts one balanced entry and leaves the trial balance intact', () => {
    const bank0 = bal('acc-bank1'), obe0 = bal('acc-obe')
    const { journalEntry } = g().postOpeningBalances({
      date: '2026-01-01',
      accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 75000 }],
    })
    expect(journalEntry.type).toBe('opening')
    expect(bal('acc-bank1') - bank0).toBeCloseTo(75000, 2)
    // Nothing else was stated, so the whole 75,000 is unexplained equity.
    expect(bal('acc-obe') - obe0).toBeCloseTo(75000, 2)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('creates real open invoices, so aging works from day one', () => {
    const ar0 = bal('acc-ar')
    g().addCustomer({ name: 'Legacy Co' })
    const cust = last(g().customers)
    g().postOpeningBalances({
      date: '2026-01-01',
      customers: [
        { customerId: cust.id, customerName: 'Legacy Co', number: 'OLD-1', date: '2025-11-02', dueDate: '2025-12-02', amount: 4000 },
        { customerId: cust.id, customerName: 'Legacy Co', number: 'OLD-2', date: '2025-12-20', dueDate: '2026-01-19', amount: 1500 },
      ],
    })

    expect(bal('acc-ar') - ar0).toBeCloseTo(5500, 2)
    const opened = g().invoices.filter((i) => i.isOpening)
    expect(opened).toHaveLength(2)
    // The original numbers and dates survive — an aging report needs the real
    // due date, and a payment has to match the customer's own paperwork.
    expect(opened.map((i) => i.number).sort()).toEqual(['OLD-1', 'OLD-2'])
    expect(opened.find((i) => i.number === 'OLD-1').dueDate).toBe('2025-12-02')
    expect(opened.every((i) => i.amountPaid === 0 && i.status === 'sent')).toBe(true)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('lets a payment settle an opening invoice through the normal path', () => {
    const ar0 = bal('acc-ar'), cash0 = bal('acc-bank1')
    g().addCustomer({ name: 'Payer Co' })
    const cust = last(g().customers)
    g().postOpeningBalances({
      date: '2026-01-01',
      customers: [{ customerId: cust.id, customerName: 'Payer Co', number: 'OLD-9', date: '2025-12-01', dueDate: '2025-12-31', amount: 3000 }],
    })
    const inv = g().invoices.find((i) => i.number === 'OLD-9')

    g().recordInvoicePayment(inv.id, { date: '2026-01-15', amount: 3000, bankAccountId: 'acc-bank1' })

    // Receivables clear back to where they started; the cash is real.
    expect(bal('acc-ar') - ar0).toBeCloseTo(0, 2)
    expect(bal('acc-bank1') - cash0).toBeCloseTo(3000, 2)
    expect(g().invoices.find((i) => i.id === inv.id).status).toBe('paid')
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('carries stock in at cost and sets the weighted-average', () => {
    const inv0 = bal('acc-inv')
    g().addInventoryItem({ name: 'Carried Widget', code: 'CW', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' })
    const item = last(g().inventoryItems)

    g().postOpeningBalances({
      date: '2026-01-01',
      items: [{ itemId: item.id, itemName: 'Carried Widget', quantity: 40, unitCost: 25 }],
    })

    const after = g().inventoryItems.find((i) => i.id === item.id)
    expect(after.quantity).toBe(40)
    expect(after.costPrice).toBeCloseTo(25, 2)
    expect(bal('acc-inv') - inv0).toBeCloseTo(1000, 2)
    expect(g().stockMovements.some((m) => m.itemId === item.id && m.type === 'opening')).toBe(true)
  })

  it('balances a full migration with no residue in Opening Balance Equity', () => {
    const obe0 = bal('acc-obe')
    g().addCustomer({ name: 'Full Co' }); const cust = last(g().customers)
    g().addSupplier({ name: 'Full Supplier' }); const supp = last(g().suppliers)
    g().addInventoryItem({ name: 'Full Item', code: 'FI', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' })
    const item = last(g().inventoryItems)

    g().postOpeningBalances({
      date: '2026-01-01',
      // 30,000 bank + 10,000 AR + 5,000 stock = 45,000 debits
      // 8,000 AP + 37,000 capital                = 45,000 credits
      accounts: [
        { accountId: 'acc-bank1', type: 'asset', amount: 30000 },
        { accountId: 'acc-capital', type: 'equity', amount: 37000 },
      ],
      customers: [{ customerId: cust.id, customerName: 'Full Co', number: 'C-1', amount: 10000 }],
      suppliers: [{ supplierId: supp.id, supplierName: 'Full Supplier', number: 'S-1', amount: 8000 }],
      items: [{ itemId: item.id, itemName: 'Full Item', quantity: 50, unitCost: 100 }],
    })

    // A balanced migration leaves nothing unexplained.
    expect(bal('acc-obe') - obe0).toBeCloseTo(0, 2)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('refuses to post twice', () => {
    g().postOpeningBalances({ date: '2026-01-01', accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 100 }] })
    expect(() => g().postOpeningBalances({ date: '2026-01-01', accounts: [] })).toThrow(/OPENING_ALREADY_POSTED/)
  })

  it('refuses an invalid migration and posts nothing at all', () => {
    const jes = g().journalEntries.length
    expect(() => g().postOpeningBalances({
      date: '2026-01-01',
      customers: [{ customerName: 'No Number Co', amount: 500 }],   // missing number
    })).toThrow(/OPENING_INVALID/)
    expect(g().journalEntries.length).toBe(jes)
    expect(g().settings.opening.posted).toBe(false)
  })

  it('is not gated by the approval threshold — a cutover is not a manual entry', () => {
    g().updateApprovals({ enabled: true, thresholds: { journal: 100 } })
    const res = g().postOpeningBalances({ date: '2026-01-01', accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 999999 }] })
    expect(res.journalEntry).toBeTruthy()
    expect(res.journalEntry.pendingApproval).toBeUndefined()
    g().updateApprovals({ enabled: false })
  })
})

describe('reverseOpeningBalances', () => {
  beforeEach(resetOpening)

  it('undoes the entry, the documents and the stock', () => {
    const bank0 = bal('acc-bank1'), ar0 = bal('acc-ar'), obe0 = bal('acc-obe')
    g().addCustomer({ name: 'Undo Co' }); const cust = last(g().customers)
    g().addInventoryItem({ name: 'Undo Item', code: 'UI', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' })
    const item = last(g().inventoryItems)

    g().postOpeningBalances({
      date: '2026-01-01',
      accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 5000 }],
      customers: [{ customerId: cust.id, customerName: 'Undo Co', number: 'U-1', amount: 900 }],
      items: [{ itemId: item.id, itemName: 'Undo Item', quantity: 10, unitCost: 3 }],
    })
    expect(g().invoices.some((i) => i.isOpening)).toBe(true)

    g().reverseOpeningBalances()

    expect(bal('acc-bank1') - bank0).toBeCloseTo(0, 2)
    expect(bal('acc-ar') - ar0).toBeCloseTo(0, 2)
    expect(bal('acc-obe') - obe0).toBeCloseTo(0, 2)
    expect(g().invoices.some((i) => i.isOpening)).toBe(false)
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(0)
    expect(g().settings.opening.posted).toBe(false)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('refuses once a payment has been received against an opening invoice', () => {
    g().addCustomer({ name: 'Settled Co' }); const cust = last(g().customers)
    g().postOpeningBalances({
      date: '2026-01-01',
      customers: [{ customerId: cust.id, customerName: 'Settled Co', number: 'S-9', amount: 1200 }],
    })
    const inv = g().invoices.find((i) => i.number === 'S-9')
    g().recordInvoicePayment(inv.id, { date: '2026-02-01', amount: 600, bankAccountId: 'acc-bank1' })

    // Reversing now would strand the receipt against an invoice that no
    // longer exists.
    expect(() => g().reverseOpeningBalances()).toThrow(/OPENING_HAS_ACTIVITY/)
    expect(g().settings.opening.posted).toBe(true)
  })

  it('leaves stock received after the cutover alone', () => {
    g().addSupplier({ name: 'Later Supplier' }); const supp = last(g().suppliers)
    g().addInventoryItem({ name: 'Mixed Item', code: 'MI', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' })
    const item = last(g().inventoryItems)

    g().postOpeningBalances({
      date: '2026-01-01',
      items: [{ itemId: item.id, itemName: 'Mixed Item', quantity: 10, unitCost: 5 }],
    })
    g().addPurchase({
      supplierId: supp.id, supplierName: 'Later Supplier', date: '2026-03-01', dueDate: '2026-04-01',
      items: [{ description: 'Mixed Item', quantity: 7, unitPrice: 6, taxRate: 0, subtotal: 42, itemId: item.id, accountId: 'acc-inv' }],
      subtotal: 42, taxAmount: 0, total: 42,
    })
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(17)

    g().reverseOpeningBalances()

    // Only the opening 10 come back out; the 7 received in March are real.
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(7)
  })

  it('refuses when nothing has been posted', () => {
    expect(() => g().reverseOpeningBalances()).toThrow(/OPENING_NOT_POSTED/)
  })

  it('refuses to reverse into a locked period', () => {
    g().postOpeningBalances({ date: '2026-01-01', accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 100 }] })
    g().setPeriodLock({ lockDate: '2026-06-30' })
    expect(() => g().reverseOpeningBalances()).toThrow(/PERIOD_LOCKED/)
    g().setPeriodLock({ lockDate: '' })
  })
})
