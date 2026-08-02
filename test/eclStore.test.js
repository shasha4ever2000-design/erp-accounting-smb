// Expected credit losses, through the store.
//
// ecl.test.js proves the arithmetic. This proves the thing that would actually
// destroy a set of books: assessing repeatedly must adjust the allowance to
// the level the aged book requires, not add a fresh provision each time. Every
// entry balances either way, so if this is wrong nothing else in the system
// objects — receivables just quietly drain toward zero.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const net = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}

const AS_OF = '2026-06-30'

// One customer, 10,000 owing, 100 days overdue → the 25% bucket → 2,500.
const overdueInvoice = {
  customerId: 'c1', customerName: 'Acme',
  date: '2026-01-01', dueDate: '2026-03-22',
  items: [{ description: 'Consulting', quantity: 1, price: 10000, subtotal: 10000, accountId: 'acc-sales' }],
  subtotal: 10000, taxAmount: 0, total: 10000,
}

beforeEach(() => {
  useStore.setState({ journalEntries: [], invoices: [], creditNotes: [] })
  g().updateEclSettings({ enabled: true, matrix: { current: 0.5, days30: 2, days60: 5, days90: 10, over90: 25 } })
})

describe('assessing the book', () => {
  it('ages the receivables and works out what allowance is required', () => {
    g().addInvoice({ ...overdueInvoice })
    const a = g().eclAssessment(AS_OF)
    expect(a.aged.grandTotal).toBe(10000)
    expect(a.aged.totals.over90).toBe(10000)
    expect(a.required).toBe(2500)
    expect(a.existing).toBe(0)
    expect(a.movement).toBe(2500)
  })

  it('shows its working bucket by bucket', () => {
    g().addInvoice({ ...overdueInvoice })
    const { rows } = g().eclAssessment(AS_OF).ecl
    const over90 = rows.find((r) => r.key === 'over90')
    expect(over90).toMatchObject({ exposure: 10000, rate: 25, loss: 2500 })
  })
})

describe('posting the provision', () => {
  it('charges the loss and puts the allowance against receivables', () => {
    g().addInvoice({ ...overdueInvoice })
    const je = g().postEclProvision({ asOf: AS_OF })
    expect(je).toBeTruthy()
    expect(net('acc-baddebt')).toBe(2500)     // expense, a debit
    expect(net('acc-ecl')).toBe(-2500)        // contra-asset, a credit
  })

  it('does not compound when assessed again with nothing changed', () => {
    // The failure this guards against: twelve monthly assessments turning a
    // 2,500 allowance into 30,000 and writing the book down to nothing.
    g().addInvoice({ ...overdueInvoice })
    for (let i = 0; i < 12; i++) g().postEclProvision({ asOf: AS_OF })
    expect(net('acc-ecl')).toBe(-2500)
    expect(net('acc-baddebt')).toBe(2500)
  })

  it('posts no entry at all when the requirement has not moved', () => {
    g().addInvoice({ ...overdueInvoice })
    g().postEclProvision({ asOf: AS_OF })
    const before = g().journalEntries.length
    expect(g().postEclProvision({ asOf: AS_OF })).toBeNull()
    expect(g().journalEntries).toHaveLength(before)
  })

  it('tops the allowance up when the book deteriorates', () => {
    g().addInvoice({ ...overdueInvoice })
    g().postEclProvision({ asOf: AS_OF })
    g().addInvoice({ ...overdueInvoice, customerId: 'c2', customerName: 'Beta' })
    g().postEclProvision({ asOf: AS_OF })
    expect(net('acc-ecl')).toBe(-5000)
  })

  it('releases the allowance back to profit when a debt is collected', () => {
    const inv = g().addInvoice({ ...overdueInvoice })
    g().postEclProvision({ asOf: AS_OF })
    expect(net('acc-ecl')).toBe(-2500)

    g().recordInvoicePayment(inv.id, { date: '2026-06-29', amount: 10000, bankAccountId: 'acc-bank1' })
    g().postEclProvision({ asOf: AS_OF })
    expect(net('acc-ecl')).toBe(0)
    expect(net('acc-baddebt')).toBe(0)        // charge fully reversed
  })

  it('records when the assessment was last run', () => {
    g().addInvoice({ ...overdueInvoice })
    g().postEclProvision({ asOf: AS_OF })
    expect(g().settings.ecl.lastAssessedAt).toBe(AS_OF)
  })

  it('keeps every entry balanced', () => {
    g().addInvoice({ ...overdueInvoice })
    g().postEclProvision({ asOf: AS_OF })
    const ok = g().journalEntries.every((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      return Math.abs(dr - cr) < 0.005
    })
    expect(ok).toBe(true)
  })
})

describe('what the allowance does to the balance sheet', () => {
  it('reduces net receivables without touching the control account', () => {
    // The allowance must never be posted against AR itself: the subledger
    // still says the customer owes the full amount, and it does.
    g().addInvoice({ ...overdueInvoice })
    const arBefore = net('acc-ar')
    g().postEclProvision({ asOf: AS_OF })
    expect(net('acc-ar')).toBe(arBefore)
    expect(net('acc-ar') + net('acc-ecl')).toBe(arBefore - 2500)
  })
})

describe('robustness', () => {
  it('posts nothing on an empty book', () => {
    expect(g().postEclProvision({ asOf: AS_OF })).toBeNull()
    expect(g().journalEntries).toHaveLength(0)
  })

  it('ignores an invoice that is already settled', () => {
    const inv = g().addInvoice({ ...overdueInvoice })
    g().recordInvoicePayment(inv.id, { date: '2026-04-01', amount: 10000, bankAccountId: 'acc-bank1' })
    expect(g().eclAssessment(AS_OF).required).toBe(0)
  })
})
