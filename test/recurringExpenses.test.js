import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

describe('recurring expenses', () => {
  beforeEach(() => {
    useStore.setState({ recurringExpenses: [], purchases: [], journalEntries: [], suppliers: [] })
  })

  it('creates a schedule with sane defaults', () => {
    g().addRecurringExpense({ name: 'Office rent', amount: 2600, nextDate: daysAhead(5), expenseAccountId: 'acc-rent' })
    const r = last(g().recurringExpenses)
    expect(r).toMatchObject({ name: 'Office rent', amount: 2600, frequency: 'monthly', status: 'active', generatedCount: 0 })
    expect(r.id).toBeTruthy()
  })

  it('posting creates a REAL supplier bill (so it lands in AP and can be paid)', () => {
    g().addSupplier({ name: 'Landlord LLC' })
    const sup = last(g().suppliers)
    g().addRecurringExpense({ name: 'Office rent', supplierId: sup.id, supplierName: sup.name, amount: 1000, taxRate: 15, nextDate: daysAgo(1), expenseAccountId: 'acc-rent' })
    const r = last(g().recurringExpenses)

    const bill = g().postRecurringExpense(r.id)
    expect(bill).toBeTruthy()
    expect(g().purchases).toHaveLength(1)
    expect(bill.total).toBe(1150)          // 1000 + 15% tax
    expect(bill.supplierName).toBe('Landlord LLC')

    // and it posted a balanced journal entry
    const je = last(g().journalEntries)
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(Math.abs(dr - cr)).toBeLessThan(0.02)
  })

  it('advances nextDate by the frequency and counts the posting', () => {
    g().addRecurringExpense({ name: 'Rent', amount: 100, nextDate: '2026-01-31', frequency: 'monthly', expenseAccountId: 'acc-rent' })
    const r = last(g().recurringExpenses)
    g().postRecurringExpense(r.id)
    const after = g().recurringExpenses.find((x) => x.id === r.id)
    expect(after.nextDate).toBe('2026-02-28')   // clamped, never drifts into March
    expect(after.lastPosted).toBe('2026-01-31')
    expect(after.generatedCount).toBe(1)
  })

  it('the scheduler catches up every missed period at once', () => {
    // 3 months overdue → should post 3 bills in one sweep.
    g().addRecurringExpense({ name: 'SaaS', amount: 50, nextDate: daysAgo(95), frequency: 'monthly', expenseAccountId: 'acc-admin' })
    const n = g().generateDueRecurringExpenses()
    expect(n).toBeGreaterThanOrEqual(3)
    expect(g().purchases.length).toBe(n)
    // and it stops once caught up
    expect(g().generateDueRecurringExpenses()).toBe(0)
  })

  it('does not post a schedule that is not due yet', () => {
    g().addRecurringExpense({ name: 'Future', amount: 10, nextDate: daysAhead(10), expenseAccountId: 'acc-admin' })
    expect(g().generateDueRecurringExpenses()).toBe(0)
    expect(g().purchases).toHaveLength(0)
  })

  it('skips paused schedules', () => {
    g().addRecurringExpense({ name: 'Paused', amount: 10, nextDate: daysAgo(30), expenseAccountId: 'acc-admin' })
    const r = last(g().recurringExpenses)
    g().updateRecurringExpense(r.id, { status: 'paused' })
    expect(g().generateDueRecurringExpenses()).toBe(0)
    expect(g().purchases).toHaveLength(0)
  })

  it('stops and marks ended once past the end date', () => {
    g().addRecurringExpense({ name: 'Ends', amount: 10, nextDate: daysAgo(60), endDate: daysAgo(50), frequency: 'monthly', expenseAccountId: 'acc-admin' })
    const r = last(g().recurringExpenses)
    g().generateDueRecurringExpenses()
    const after = g().recurringExpenses.find((x) => x.id === r.id)
    // It posts what was due before the end date, then closes itself out.
    expect(after.status).toBe('ended')
  })

  it('is included in the boot scheduler alongside invoices and journals', () => {
    useStore.setState({ schedulerLastRun: null })
    g().addRecurringExpense({ name: 'Rent', amount: 500, nextDate: daysAgo(1), expenseAccountId: 'acc-rent' })
    const res = g().runScheduler()
    expect(res.expenses).toBeGreaterThan(0)
    expect(res.ran).toBe(true)
  })

  it('is included in exportData so backups and cloud sync carry it', () => {
    g().addRecurringExpense({ name: 'Rent', amount: 1, nextDate: daysAhead(1), expenseAccountId: 'acc-rent' })
    expect(g().exportData()).toHaveProperty('recurringExpenses')
    expect(g().exportData().recurringExpenses).toHaveLength(1)
  })

  it('deleting a schedule keeps the bills it already posted', () => {
    g().addRecurringExpense({ name: 'Rent', amount: 100, nextDate: daysAgo(1), expenseAccountId: 'acc-rent' })
    const r = last(g().recurringExpenses)
    g().postRecurringExpense(r.id)
    expect(g().purchases).toHaveLength(1)
    g().deleteRecurringExpense(r.id)
    expect(g().recurringExpenses).toHaveLength(0)
    expect(g().purchases).toHaveLength(1)   // history preserved
  })
})
