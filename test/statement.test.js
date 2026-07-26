import { describe, it, expect } from 'vitest'
import {
  DEAD_STATUSES, DEFAULT_BUCKETS,
  buildEntries, activityStatement, openItems, agedSummary, reconcile, buildStatement,
} from '../src/utils/statement.js'

const inv = (n, date, total, paid = 0, extra = {}) => ({
  id: `i-${n}`, number: n, customerId: 'c1', date, dueDate: extra.dueDate || date,
  total, amountPaid: paid, status: extra.status || 'sent',
  payments: extra.payments || (paid ? [{ date: extra.paidOn || date, amount: paid, number: `REC-${n}` }] : []),
  ...extra,
})
const bill = (n, date, total, paid = 0, extra = {}) => ({
  id: `b-${n}`, number: n, supplierId: 's1', date, dueDate: extra.dueDate || date,
  total, amountPaid: paid, status: extra.status || 'received',
  payments: extra.payments || (paid ? [{ date: extra.paidOn || date, amount: paid, number: `PAY-${n}` }] : []),
  ...extra,
})

const DOCS = {
  invoices: [
    inv('INV-1', '2026-01-10', 1000, 1000, { paidOn: '2026-02-05' }),
    inv('INV-2', '2026-03-01', 2000, 500, { paidOn: '2026-03-20', dueDate: '2026-03-31' }),
    inv('INV-3', '2026-06-01', 750, 0, { dueDate: '2026-07-01' }),
  ],
  creditNotes: [{ id: 'cn-1', number: 'CN-1', customerId: 'c1', date: '2026-04-01', total: 100, status: 'issued' }],
  purchases: [
    bill('PUR-1', '2026-02-01', 800, 800, { paidOn: '2026-02-20' }),
    bill('PUR-2', '2026-05-01', 1200, 0, { dueDate: '2026-06-01' }),
  ],
  debitNotes: [{ id: 'dn-1', number: 'DN-1', supplierId: 's1', date: '2026-05-15', total: 200, status: 'issued' }],
}

describe('buildEntries', () => {
  it('lists a customer\'s invoices, receipts and credit notes in date order', () => {
    const e = buildEntries('customer', 'c1', DOCS)
    expect(e.map((x) => x.kind).sort()).toEqual(
      ['creditNote', 'invoice', 'invoice', 'invoice', 'payment', 'payment'])
    expect(e.map((x) => x.date)).toEqual([...e.map((x) => x.date)].sort())
  })

  it('debits the customer for a sale and credits them for a receipt', () => {
    const e = buildEntries('customer', 'c1', DOCS)
    const sale = e.find((x) => x.ref === 'INV-1' && x.kind === 'invoice')
    const receipt = e.find((x) => x.kind === 'payment' && x.against === 'INV-1')
    expect(sale.debit).toBe(1000)
    expect(receipt.credit).toBe(1000)
  })

  it('mirrors the signs for a supplier', () => {
    const e = buildEntries('supplier', 's1', DOCS)
    expect(e.find((x) => x.ref === 'PUR-1' && x.kind === 'bill').credit).toBe(800)
    expect(e.find((x) => x.kind === 'payment' && x.against === 'PUR-1').debit).toBe(800)
  })

  it('leaves out cancelled, void and draft documents', () => {
    DEAD_STATUSES.forEach((status) => {
      const e = buildEntries('customer', 'c1', { invoices: [inv('X', '2026-01-01', 500, 0, { status })] })
      expect(e, status).toHaveLength(0)
    })
  })

  it('ignores other parties entirely', () => {
    const e = buildEntries('customer', 'other', DOCS)
    expect(e).toEqual([])
  })

  it('copes with missing document lists', () => {
    expect(buildEntries('customer', 'c1', {})).toEqual([])
    expect(buildEntries('customer', '', DOCS)).toEqual([])
  })
})

describe('activityStatement', () => {
  const entries = buildEntries('customer', 'c1', DOCS)

  it('opens at nil when run from inception', () => {
    const s = activityStatement('customer', entries, {})
    expect(s.opening).toBe(0)
  })

  it('closes on what is actually outstanding', () => {
    // 1000 − 1000 + 2000 − 500 − 100 + 750 = 2150
    const s = activityStatement('customer', entries, {})
    expect(s.closing).toBe(2150)
  })

  it('carries a real opening balance into a later period', () => {
    const s = activityStatement('customer', entries, { start: '2026-05-01' })
    // Everything before May: 1000 − 1000 + 2000 − 500 − 100 = 1400
    expect(s.opening).toBe(1400)
    expect(s.closing).toBe(2150)
  })

  it('runs the balance forward line by line', () => {
    const s = activityStatement('customer', entries, { start: '2026-05-01' })
    expect(s.rows[s.rows.length - 1].balance).toBe(s.closing)
  })

  it('joins up with the previous period — one closing is the next opening', () => {
    const first = activityStatement('customer', entries, { start: '2026-01-01', end: '2026-04-30' })
    const second = activityStatement('customer', entries, { start: '2026-05-01', end: '2026-12-31' })
    expect(second.opening).toBe(first.closing)
  })

  it('excludes movements after the end date', () => {
    const s = activityStatement('customer', entries, { start: '2026-01-01', end: '2026-05-31' })
    expect(s.rows.some((r) => r.ref === 'INV-3')).toBe(false)
    expect(s.closing).toBe(1400)
  })

  it('flips the sign convention for a supplier, so a bill increases what we owe', () => {
    const sup = buildEntries('supplier', 's1', DOCS)
    const s = activityStatement('supplier', sup, {})
    // 800 − 800 + 1200 − 200 = 1000
    expect(s.closing).toBe(1000)
  })
})

describe('openItems', () => {
  it('lists only what is still unpaid', () => {
    const items = openItems('customer', DOCS, 'c1', { asAt: '2026-07-15' })
    expect(items.map((r) => r.ref)).toEqual(['INV-2', 'INV-3'])
    expect(items.find((r) => r.ref === 'INV-2').outstanding).toBe(1500)
  })

  it('ages from the due date, not the invoice date', () => {
    // INV-3 is dated 1 June but due 1 July, so on 15 July it is 14 days over —
    // not 44. A statement that says otherwise gets argued with, not paid.
    const items = openItems('customer', DOCS, 'c1', { asAt: '2026-07-15' })
    expect(items.find((r) => r.ref === 'INV-3').daysOverdue).toBe(14)
  })

  it('shows nothing overdue before the due date arrives', () => {
    const items = openItems('customer', DOCS, 'c1', { asAt: '2026-06-15' })
    expect(items.find((r) => r.ref === 'INV-3').daysOverdue).toBe(0)
  })

  it('ignores documents raised after the statement date', () => {
    const items = openItems('customer', DOCS, 'c1', { asAt: '2026-02-01' })
    expect(items.map((r) => r.ref)).toEqual(['INV-1'])
  })

  it('drops anything settled to the cent', () => {
    const items = openItems('customer', { invoices: [inv('P', '2026-01-01', 100, 100)] }, 'c1', { asAt: '2026-02-01' })
    expect(items).toEqual([])
  })

  it('works for suppliers too', () => {
    const items = openItems('supplier', DOCS, 's1', { asAt: '2026-07-15' })
    expect(items.map((r) => r.ref)).toEqual(['PUR-2'])
  })
})

describe('agedSummary', () => {
  const at = '2026-07-15'
  const items = openItems('customer', DOCS, 'c1', { asAt: at })

  it('splits the debt into current and the overdue buckets', () => {
    const aged = agedSummary(items)
    expect(aged.labels).toEqual(['Current', '30–59 days', '60–89 days', '90+ days'])
    expect(aged.cells).toHaveLength(4)
  })

  it('totals to what is outstanding', () => {
    const aged = agedSummary(items)
    const outstanding = items.reduce((s, r) => s + r.outstanding, 0)
    expect(aged.total).toBe(Math.round(outstanding * 100) / 100)
  })

  it('puts a not-yet-due invoice in Current', () => {
    const aged = agedSummary([{ outstanding: 500, daysOverdue: 0 }])
    expect(aged.cells[0]).toBe(500)
  })

  it('puts a 14-day-late invoice in Current, since the first bucket starts at 30', () => {
    const aged = agedSummary([{ outstanding: 500, daysOverdue: 14 }])
    expect(aged.cells[0]).toBe(500)
  })

  it('places each age in the right bucket', () => {
    const aged = agedSummary([
      { outstanding: 10, daysOverdue: 0 },
      { outstanding: 20, daysOverdue: 35 },
      { outstanding: 40, daysOverdue: 70 },
      { outstanding: 80, daysOverdue: 400 },
    ])
    expect(aged.cells).toEqual([10, 20, 40, 80])
  })

  it('honours custom buckets', () => {
    const aged = agedSummary([{ outstanding: 100, daysOverdue: 20 }], [14, 28])
    expect(aged.labels).toEqual(['Current', '14–27 days', '28+ days'])
    expect(aged.cells).toEqual([0, 100, 0])
  })

  it('handles an empty ledger', () => {
    expect(agedSummary([]).total).toBe(0)
  })
})

describe('reconcile — the number in the letter has to be right', () => {
  const ALLOCATED = {
    invoices: [inv('A', '2026-01-10', 1000, 1000, { paidOn: '2026-02-05' }), inv('B', '2026-03-01', 2000, 500, { paidOn: '2026-03-20' })],
    creditNotes: [],
    purchases: [bill('P1', '2026-02-01', 800, 800, { paidOn: '2026-02-20' }), bill('P2', '2026-05-01', 1200, 0)],
    debitNotes: [],
  }

  it('agrees when every payment is against a real document', () => {
    const s = buildStatement('customer', 'c1', ALLOCATED, { end: '2026-07-15' })
    expect(s.reconciliation.ok).toBe(true)
    expect(s.reconciliation.difference).toBe(0)
    expect(s.closing).toBe(1500)
  })

  it('agrees for suppliers as well', () => {
    const s = buildStatement('supplier', 's1', ALLOCATED, { end: '2026-07-15' })
    expect(s.reconciliation.ok).toBe(true)
    expect(s.closing).toBe(1200)
  })

  it('catches an unallocated credit note in the standard fixture', () => {
    // DOCS carries a 100 credit note applied to no invoice, so the running
    // balance is 100 lower than the sum of the open invoices. That is a real
    // discrepancy and the statement must surface it, not pick a side.
    const s = buildStatement('customer', 'c1', DOCS, { end: '2026-07-15' })
    expect(s.reconciliation.ok).toBe(false)
    expect(s.reconciliation.difference).toBe(-100)
  })

  it('reports the gap when a credit note is not applied to any invoice', () => {
    // The credit reduces the running balance but no invoice shows it, so the
    // two views legitimately disagree — and the statement must say so rather
    // than quietly print one of them.
    const s = buildStatement('customer', 'c1', {
      invoices: [inv('A', '2026-01-01', 500, 0)],
      creditNotes: [{ id: 'x', number: 'CN-9', customerId: 'c1', date: '2026-02-01', total: 200, status: 'issued' }],
    }, { end: '2026-03-01' })
    expect(s.reconciliation.ok).toBe(false)
    expect(s.reconciliation.difference).toBe(-200)
  })

  it('does not claim to reconcile over a narrow window', () => {
    // Older unpaid invoices are legitimately outside a one-month statement.
    const s = buildStatement('customer', 'c1', DOCS, { start: '2026-06-01', end: '2026-07-15' })
    expect(s.reconciliation).toBeNull()
  })

  it('still reconciles when the start date simply predates every document', () => {
    // The screen always supplies a start date, so testing only for a blank one
    // made this check unreachable in the app it was written for.
    const s = buildStatement('customer', 'c1', DOCS, { start: '2020-01-01', end: '2026-07-15' })
    expect(s.reconciliation).not.toBeNull()
    expect(s.reconciliation.ok).toBe(false)
    expect(s.reconciliation.difference).toBe(-100)
  })

  it('reconciles when the start lands exactly on the first document', () => {
    const s = buildStatement('customer', 'c1', DOCS, { start: '2026-01-10', end: '2026-07-15' })
    expect(s.reconciliation).not.toBeNull()
  })
})

describe('buildStatement', () => {
  const s = buildStatement('customer', 'c1', DOCS, { end: '2026-07-15' })

  it('returns both views at once, so the page can switch without recomputing', () => {
    expect(s.rows.length).toBeGreaterThan(0)
    expect(s.items.length).toBeGreaterThan(0)
    expect(s.aged.total).toBeGreaterThan(0)
  })

  it('reports the overdue total and the oldest debt', () => {
    expect(s.overdueTotal).toBe(2250)      // 1,500 on INV-2 plus 750 on INV-3
    expect(s.oldestDays).toBeGreaterThan(100)
  })

  it('survives a party with no history at all', () => {
    const empty = buildStatement('customer', 'nobody', DOCS, {})
    expect(empty.closing).toBe(0)
    expect(empty.items).toEqual([])
    expect(empty.aged.total).toBe(0)
    expect(empty.reconciliation.ok).toBe(true)
  })

  it('uses the default buckets unless told otherwise', () => {
    expect(DEFAULT_BUCKETS).toEqual([30, 60, 90])
    expect(s.aged.edges).toEqual([30, 60, 90])
  })
})
