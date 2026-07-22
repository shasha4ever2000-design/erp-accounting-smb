import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../src/store.js'
import { seedDemoData, isCompanyEmpty } from '../src/utils/demoData.js'

const g = () => useStore.getState()

describe('demo data seeder', () => {
  let summary
  beforeAll(() => { summary = seedDemoData(g) })

  it('populates a meaningful company', () => {
    expect(summary.customers).toBeGreaterThanOrEqual(3)
    expect(summary.invoices).toBeGreaterThanOrEqual(5)
    expect(summary.purchases).toBeGreaterThanOrEqual(2)
    expect(summary.journalEntries).toBeGreaterThanOrEqual(15)
  })

  it('covers the interesting payment states', () => {
    const statuses = new Set(g().invoices.map((i) => i.status))
    expect(statuses.has('paid')).toBe(true)
    // at least one invoice with an outstanding balance
    expect(g().invoices.some((i) => (i.total || 0) - (i.amountPaid || 0) > 0)).toBe(true)
  })

  it('every posted entry balances and the balance-sheet equation holds', () => {
    let gd = 0, gc = 0
    g().journalEntries.forEach((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      expect(Math.abs(dr - cr)).toBeLessThan(0.02)
      gd += dr; gc += cr
    })
    expect(Math.abs(gd - gc)).toBeLessThan(0.02)

    const bals = g().getAllBalances()
    const nat = (a) => { const b = bals[a.id] || { dr: 0, cr: 0 }; return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
    const sum = (t) => g().accounts.filter((a) => a.type === t).reduce((s, a) => s + nat(a), 0)
    const A = sum('asset'), L = sum('liability'), E = sum('equity'), NI = sum('revenue') - sum('expense')
    expect(Math.abs(A - (L + E + NI))).toBeLessThan(0.02)
  })

  it('keeps the bank positive (no embarrassing demo overdraft)', () => {
    const b = g().getAllBalances()['acc-bank1']
    expect(b.dr - b.cr).toBeGreaterThan(0)
  })

  it('stock on hand stays non-negative', () => {
    g().inventoryItems.forEach((it) => expect(it.quantity).toBeGreaterThanOrEqual(0))
  })

  it('refuses to run on a non-empty company', () => {
    expect(isCompanyEmpty(g())).toBe(false)
    expect(() => seedDemoData(g)).toThrow('DEMO_NOT_EMPTY')
  })
})
