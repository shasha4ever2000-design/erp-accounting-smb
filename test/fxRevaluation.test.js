import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

// The store is a module singleton, so every assertion measures the delta it
// caused rather than an absolute balance.
const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const balAt = (id, end) => {
  const b = g().getAllBalances(undefined, end)[id] || { dr: 0, cr: 0 }
  const a = g().accounts.find((x) => x.id === id)
  return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
}
const bal = (id) => balAt(id, undefined)
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('FX revaluation reverses into the next period', () => {
  it('restates AR at the closing rate, then reverses so settlement still clears it', () => {
    g().addCustomer({ name: 'Reval Co' }); const cust = last(g().customers)
    const ar0 = bal('acc-ar'), fxu0 = bal('acc-fxgl'), fxr0 = bal('acc-fxreal')
    const arAt31 = balAt('acc-ar', '2026-01-31')

    // 1000 EUR invoiced when EUR = 1.10
    const inv = g().addInvoice({
      customerId: cust.id, customerName: 'Reval Co', date: '2026-01-10', dueDate: '2026-02-10',
      currency: 'EUR', exchangeRate: 1.10,
      items: [{ description: 'Svc', quantity: 1, unitPrice: 1000, taxRate: 0, subtotal: 1000, accountId: 'acc-sales' }],
      subtotal: 1000, taxAmount: 0, total: 1000,
    })

    // Month-end: EUR closes at 1.15, so AR should *report* 1150 as at 31 Jan.
    const rec = g().postFxRevaluation({
      date: '2026-01-31',
      entries: [{ accountId: 'acc-ar', currency: 'EUR', fcBalance: 1000, rate: 1.15, currentBase: 1100, revaluedBase: 1150 }],
    })
    expect(balAt('acc-ar', '2026-01-31') - arAt31).toBeCloseTo(1150, 2)
    expect(balAt('acc-fxgl', '2026-01-31')).toBeCloseTo(fxu0 + 50, 2)

    // …and reverses on 1 February, so the restatement never outlives the report.
    expect(rec.reversalJEId).toBeTruthy()
    expect(rec.reversalDate).toBe('2026-02-01')
    expect(balAt('acc-ar', '2026-02-01') - ar0).toBeCloseTo(1100, 2)

    // Settled on 10 Feb at 1.20.
    g().recordInvoicePayment(inv.id, { date: '2026-02-10', amount: 1000, exchangeRate: 1.20, bankAccountId: 'acc-bank1' })

    // AR must clear completely — the bug this guards against stranded the
    // revaluation delta in AR forever.
    expect(bal('acc-ar') - ar0).toBeCloseTo(0, 2)
    // The unrealized estimate is fully undone; only the real cash difference remains.
    expect(bal('acc-fxgl') - fxu0).toBeCloseTo(0, 2)
    expect(bal('acc-fxreal') - fxr0).toBeCloseTo(100, 2)   // 1000 × (1.20 − 1.10)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('does the same for a supplier bill in AP', () => {
    g().addSupplier({ name: 'Paris SARL' }); const supp = last(g().suppliers)
    const ap0 = bal('acc-ap'), fxu0 = bal('acc-fxgl'), fxr0 = bal('acc-fxreal')

    const pur = g().addPurchase({
      supplierId: supp.id, supplierName: 'Paris SARL', date: '2026-01-12', dueDate: '2026-02-12',
      currency: 'EUR', exchangeRate: 1.10,
      items: [{ description: 'Parts', quantity: 1, unitPrice: 1000, taxRate: 0, subtotal: 1000, accountId: 'acc-admin' }],
      subtotal: 1000, taxAmount: 0, total: 1000,
    })
    g().postFxRevaluation({
      date: '2026-01-31',
      entries: [{ accountId: 'acc-ap', currency: 'EUR', fcBalance: 1000, rate: 1.15, currentBase: 1100, revaluedBase: 1150 }],
    })
    g().recordPurchasePayment(pur.id, { date: '2026-02-12', amount: 1000, exchangeRate: 1.05, bankAccountId: 'acc-bank1' })

    expect(bal('acc-ap') - ap0).toBeCloseTo(0, 2)
    expect(bal('acc-fxgl') - fxu0).toBeCloseTo(0, 2)
    expect(bal('acc-fxreal') - fxr0).toBeCloseTo(50, 2)    // paid cheaper: 1000 × (1.10 − 1.05)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('always reverses, because a date that clears the period lock has an open next day', () => {
    g().addCustomer({ name: 'Locked Co' }); const cust = last(g().customers)
    g().addInvoice({
      customerId: cust.id, customerName: 'Locked Co', date: '2026-05-05', dueDate: '2026-06-05',
      currency: 'EUR', exchangeRate: 1.10,
      items: [{ description: 'Svc', quantity: 1, unitPrice: 100, taxRate: 0, subtotal: 100, accountId: 'acc-sales' }],
      subtotal: 100, taxAmount: 0, total: 100,
    })
    g().setPeriodLock({ lockDate: '2026-04-30' })
    const rec = g().postFxRevaluation({
      date: '2026-05-31',
      entries: [{ accountId: 'acc-ar', currency: 'EUR', fcBalance: 100, rate: 1.15, currentBase: 110, revaluedBase: 115 }],
    })
    expect(rec.reversalJEId).toBeTruthy()
    expect(rec.reversalDate).toBe('2026-06-01')
    g().setPeriodLock({ lockDate: '' })
  })

  it('posts nothing at all when every line rounds to zero', () => {
    const before = g().journalEntries.length
    const rec = g().postFxRevaluation({
      date: '2026-07-31',
      entries: [{ accountId: 'acc-ar', currency: 'EUR', fcBalance: 100, rate: 1.1, currentBase: 110, revaluedBase: 110.001 }],
    })
    expect(rec).toBeNull()
    expect(g().journalEntries.length).toBe(before)   // no orphan reversal either
  })
})
