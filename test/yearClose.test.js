import { describe, it, expect } from 'vitest'
import { fiscalYearBounds, listFiscalYears, preCloseChecks, yearSummary } from '../src/utils/yearClose.js'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()

describe('fiscalYearBounds', () => {
  it('calendar-year fiscal year (start month 01)', () => {
    expect(fiscalYearBounds('01', 2026)).toEqual({ label: 'FY 2026', start: '2026-01-01', end: '2026-12-31' })
  })
  it('offset fiscal year (start month 04 → ends 31 Mar)', () => {
    expect(fiscalYearBounds('04', 2026)).toEqual({ label: 'FY 2026', start: '2025-04-01', end: '2026-03-31' })
  })
  it('handles leap-February ends (start month 03)', () => {
    expect(fiscalYearBounds('03', 2028).end).toBe('2028-02-29')
  })
})

describe('listFiscalYears', () => {
  it('collects the fiscal years containing activity', () => {
    const jes = [{ date: '2025-06-01', lines: [] }, { date: '2026-02-10', lines: [] }]
    expect(listFiscalYears(jes, '01').map((f) => f.label)).toEqual(['FY 2025', 'FY 2026'])
    // With FY starting in April, 2026-02-10 still falls in FY 2026 but 2025-06-01 falls in FY 2026 too.
    expect(listFiscalYears(jes, '04').map((f) => f.label)).toEqual(['FY 2026'])
  })
})

describe('preCloseChecks', () => {
  const fy = { start: '2026-01-01', end: '2026-12-31' }
  it('flags unbalanced entries, pending approvals, and outstanding VAT', () => {
    const state = {
      journalEntries: [
        { date: '2026-03-01', lines: [{ accountId: 'a', debit: 100, credit: 0 }, { accountId: 'b', debit: 0, credit: 90 }] }, // unbalanced
        { date: '2026-04-01', lines: [{ accountId: 'acc-vatout', debit: 0, credit: 150 }, { accountId: 'acc-ar', debit: 150, credit: 0 }] },
      ],
      stockAdjustments: [{ status: 'pending', date: '2026-05-01' }],
      expenseClaims: [{ status: 'pending', date: '2025-05-01' }], // outside FY → not counted
      payrollRuns: [], workOrders: [],
    }
    const checks = preCloseChecks(state, fy)
    const by = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(by.balanced.ok).toBe(false)
    expect(by.balanced.count).toBe(1)
    expect(by.adjustments.ok).toBe(false)
    expect(by.claims.ok).toBe(true)
    expect(by.vat.ok).toBe(false)
    expect(by.vat.count).toBe(150)
  })
  it('passes on clean books', () => {
    const checks = preCloseChecks({ journalEntries: [], stockAdjustments: [], expenseClaims: [], payrollRuns: [], workOrders: [] }, fy)
    expect(checks.every((c) => c.ok)).toBe(true)
  })
})

describe('yearSummary', () => {
  it('computes P&L for the year and the retained-earnings roll-forward', () => {
    const accounts = [
      { id: 'sales', type: 'revenue' }, { id: 'rent', type: 'expense' }, { id: 'cash', type: 'asset' },
    ]
    const jes = [
      // prior year: 500 profit → opening RE
      { date: '2025-06-01', lines: [{ accountId: 'cash', debit: 500, credit: 0 }, { accountId: 'sales', debit: 0, credit: 500 }] },
      // this year: 1000 revenue, 300 expense
      { date: '2026-02-01', lines: [{ accountId: 'cash', debit: 1000, credit: 0 }, { accountId: 'sales', debit: 0, credit: 1000 }] },
      { date: '2026-03-01', lines: [{ accountId: 'rent', debit: 300, credit: 0 }, { accountId: 'cash', debit: 0, credit: 300 }] },
      // next year: must be ignored entirely
      { date: '2027-01-15', lines: [{ accountId: 'cash', debit: 999, credit: 0 }, { accountId: 'sales', debit: 0, credit: 999 }] },
    ]
    const s = yearSummary(accounts, jes, { start: '2026-01-01', end: '2026-12-31' })
    expect(s).toEqual({ revenue: 1000, expenses: 300, netIncome: 700, openingRE: 500, closingRE: 1200 })
  })
})

describe('closeFiscalYear / reopenFiscalYear store actions', () => {
  it('records the close and locks the books through year end', () => {
    g().closeFiscalYear({ label: 'FY 2025', start: '2025-01-01', end: '2025-12-31', netIncome: 700, by: 'Owner' })
    const acc = g().settings.accounting
    expect(acc.closedYears).toHaveLength(1)
    expect(acc.closedYears[0]).toMatchObject({ label: 'FY 2025', netIncome: 700, by: 'Owner' })
    expect(acc.lockDate).toBe('2025-12-31')
  })
  it('a later year extends the lock; an earlier close never shortens it', () => {
    g().closeFiscalYear({ label: 'FY 2026', start: '2026-01-01', end: '2026-12-31', netIncome: 100, by: 'Owner' })
    expect(g().settings.accounting.lockDate).toBe('2026-12-31')
    g().closeFiscalYear({ label: 'FY 2024', start: '2024-01-01', end: '2024-12-31', netIncome: 50, by: 'Owner' })
    expect(g().settings.accounting.lockDate).toBe('2026-12-31')
    expect(g().settings.accounting.closedYears.map((c) => c.label)).toEqual(['FY 2024', 'FY 2025', 'FY 2026'])
  })
  it('reopening the latest year rolls the lock back to the previous closed year', () => {
    g().reopenFiscalYear('FY 2026')
    const acc = g().settings.accounting
    expect(acc.closedYears.map((c) => c.label)).toEqual(['FY 2024', 'FY 2025'])
    expect(acc.lockDate).toBe('2025-12-31')
  })
  it('locked years actually reject postings', () => {
    expect(() => g().addJournalEntry({ date: '2025-06-15', type: 'manual', description: 'late entry',
      lines: [{ accountId: 'acc-cash', debit: 10, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 10 }] })).toThrow()
  })
})
