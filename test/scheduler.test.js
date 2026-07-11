import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const today = new Date().toISOString().slice(0, 10)
const back = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10) }

describe('boot-time scheduler', () => {
  // Seed one due recurring invoice and one due recurring journal (nextDate in the past)
  g().addCustomer({ name: 'ACME' }); const cust = g().customers[g().customers.length - 1]
  g().addRecurringInvoice({ customerId: cust.id, customerName: 'ACME', frequency: 'monthly', nextDate: back(40), items: [{ description: 'Svc', quantity: 1, unitPrice: 100, taxRate: 0, subtotal: 100, taxAmount: 0, total: 100 }], subtotal: 100, taxAmount: 0, total: 100, number: 'R-1' })
  g().addRecurringJournal({ name: 'Rent accrual', frequency: 'monthly', nextDate: back(40), lines: [{ accountId: 'acc-admin', debit: 500, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 500 }] })

  it('posts everything due on the first run and records the day', () => {
    const invBefore = g().invoices.length
    const r = g().runScheduler()
    expect(r.ran).toBe(true)
    expect(r.invoices).toBeGreaterThanOrEqual(1)
    expect(r.journals).toBeGreaterThanOrEqual(1)
    expect(g().schedulerLastRun).toBe(today)
    expect(g().invoices.length).toBeGreaterThan(invBefore)
  })

  it('is idempotent within the same calendar day', () => {
    const invAfter = g().invoices.length
    const r = g().runScheduler()
    expect(r.ran).toBe(false)
    expect(g().invoices.length).toBe(invAfter)
  })

  it('does not post when auto-posting is disabled', () => {
    g().setAutoPostRecurring(false)
    useStore.setState({ schedulerLastRun: back(1) }) // simulate a new day
    g().addRecurringJournal({ name: 'X', frequency: 'monthly', nextDate: back(35), lines: [{ accountId: 'acc-admin', debit: 10, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 10 }] })
    const jeBefore = g().journalEntries.length
    const r = g().runScheduler()
    expect(r.ran).toBe(false)
    expect(g().journalEntries.length).toBe(jeBefore)
    expect(g().schedulerLastRun).toBe(today) // still advances so it won't retry all day
  })

  it('resumes posting once re-enabled on a new day', () => {
    g().setAutoPostRecurring(true)
    useStore.setState({ schedulerLastRun: back(1) })
    const r = g().runScheduler()
    expect(r.ran).toBe(true)
  })

  it('keeps every journal entry balanced', () => {
    const unbalanced = g().journalEntries.filter((je) => Math.abs(je.lines.reduce((a, l) => a + (+l.debit || 0) - (+l.credit || 0), 0)) > 0.02)
    expect(unbalanced).toEqual([])
  })
})
