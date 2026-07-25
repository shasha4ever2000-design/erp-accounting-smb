import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

// State accumulates across tests (the store is a module singleton), so every
// assertion measures the *delta* it caused rather than an absolute balance.
const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('transactional multi-currency', () => {
  it('books an EUR sale in base and realizes an FX gain when the currency strengthens', () => {
    g().addCustomer({ name: 'Euro Co' }); const cust = last(g().customers)
    const ar0 = bal('acc-ar'), sales0 = bal('acc-sales'), cash0 = bal('acc-bank1'), fx0 = bal('acc-fxreal')
    // 1 EUR = 1.10 base at invoice; paid later when 1 EUR = 1.20 base
    const inv = g().addInvoice({ customerId: cust.id, customerName: 'Euro Co', date: '2026-03-01', dueDate: '2026-04-01', currency: 'EUR', exchangeRate: 1.10, items: [{ description: 'Svc', quantity: 1, unitPrice: 1000, taxRate: 0, subtotal: 1000, accountId: 'acc-sales' }], subtotal: 1000, taxAmount: 0, total: 1000 })
    expect(inv.baseTotal).toBe(1100)
    expect(bal('acc-ar') - ar0).toBeCloseTo(1100, 2)
    expect(bal('acc-sales') - sales0).toBeCloseTo(1100, 2)

    g().recordInvoicePayment(inv.id, { date: '2026-04-01', amount: 1000, exchangeRate: 1.20, bankAccountId: 'acc-bank1' })
    expect(bal('acc-ar') - ar0).toBeCloseTo(0, 2)          // AR cleared
    expect(bal('acc-bank1') - cash0).toBeCloseTo(1200, 2)  // cash at pay rate
    expect(bal('acc-fxreal') - fx0).toBeCloseTo(100, 2)    // 1000 × (1.20 − 1.10)
    expect(g().invoices.find((i) => i.id === inv.id).status).toBe('paid')
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('leaves a base-currency invoice untouched (rate 1, no FX line)', () => {
    g().addCustomer({ name: 'Local Co' }); const cust = last(g().customers)
    const fx0 = bal('acc-fxreal')
    const inv = g().addInvoice({ customerId: cust.id, customerName: 'Local Co', date: '2026-03-02', dueDate: '2026-04-02', items: [{ description: 'x', quantity: 1, unitPrice: 500, taxRate: 15, subtotal: 500, accountId: 'acc-sales' }], subtotal: 500, taxAmount: 75, total: 575 })
    expect(inv.exchangeRate).toBe(1)
    expect(inv.baseTotal).toBe(575)
    g().recordInvoicePayment(inv.id, { date: '2026-04-02', amount: 575, bankAccountId: 'acc-bank1' })
    expect(bal('acc-fxreal') - fx0).toBeCloseTo(0, 2)
  })

  it('books an EUR purchase in base, values inventory in base, and realizes FX on payment', () => {
    g().addSupplier({ name: 'Berlin GmbH' }); const supp = last(g().suppliers)
    g().addInventoryItem({ name: 'Widget', code: 'WD', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' }); const item = last(g().inventoryItems)
    const ap0 = bal('acc-ap'), fx0 = bal('acc-fxreal')
    const pur = g().addPurchase({ supplierId: supp.id, supplierName: 'Berlin GmbH', date: '2026-03-05', dueDate: '2026-04-05', currency: 'EUR', exchangeRate: 1.10, items: [{ description: 'Widget', quantity: 10, unitPrice: 100, taxRate: 0, subtotal: 1000, itemId: item.id, accountId: 'acc-inv' }], subtotal: 1000, taxAmount: 0, total: 1000 })
    expect(pur.baseTotal).toBe(1100)
    // weighted-average cost is held in base: 1000 EUR × 1.10 / 10 units = 110
    expect(g().inventoryItems.find((i) => i.id === item.id).costPrice).toBeCloseTo(110, 2)

    g().recordPurchasePayment(pur.id, { date: '2026-04-05', amount: 1000, exchangeRate: 1.05, bankAccountId: 'acc-bank1' })
    expect(bal('acc-ap') - ap0).toBeCloseTo(0, 2)               // AP cleared
    expect(bal('acc-fxreal') - fx0).toBeCloseTo(50, 2)          // 1000 × (1.10 − 1.05)
    expect(tbDiff()).toBeLessThan(0.01)
  })
})
