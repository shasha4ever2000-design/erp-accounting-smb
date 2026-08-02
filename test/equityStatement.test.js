// Statement of Changes in Equity.
//
// The property that decides whether this statement is worth anything is
// whether it reconciles to the balance sheet. Everything else — the labels,
// the grouping, the column order — is presentation. If closing equity here
// disagrees with assets less liabilities, the statement is telling the reader
// a story about a business that does not exist.
//
// The trap specific to this app is retained earnings. Profit is computed into
// equity rather than posted, so retained earnings has no journal lines of its
// own; reading its ledger movements would report nothing moved in a year the
// business made money.
import { describe, it, expect } from 'vitest'
import {
  buildEquityStatement, profitFor, movementLabel, movementColumns,
} from '../src/utils/equityStatement.js'

const ACCOUNTS = [
  { id: 'acc-bank1', code: '1001', name: 'Bank', type: 'asset' },
  { id: 'acc-ap', code: '2001', name: 'Payables', type: 'liability' },
  { id: 'acc-capital', code: '3001', name: "Owner's Capital", type: 'equity' },
  { id: 'acc-retained', code: '3002', name: 'Retained Earnings', type: 'equity' },
  { id: 'acc-drawings', code: '3003', name: "Owner's Drawings", type: 'equity' },
  { id: 'acc-sales', code: '4001', name: 'Sales', type: 'revenue' },
  { id: 'acc-rent', code: '5003', name: 'Rent', type: 'expense' },
]

/**
 * A stand-in for the store's getAllBalances: sums the supplied journal lines
 * over whatever window it is asked for, exactly as the real one does.
 */
const balancer = (entries) => (start, end) => {
  const out = {}
  entries.forEach((je) => {
    if (start && je.date < start) return
    if (end && je.date > end) return
    je.lines.forEach((l) => {
      const b = out[l.accountId] || (out[l.accountId] = { dr: 0, cr: 0 })
      b.dr += l.debit || 0
      b.cr += l.credit || 0
    })
  })
  return out
}

// Prior year: owner puts in 50,000, business makes 10,000 profit.
const PRIOR = [
  { date: '2025-01-05', type: 'capital_intro', lines: [
    { accountId: 'acc-bank1', debit: 50000, credit: 0 },
    { accountId: 'acc-capital', debit: 0, credit: 50000 },
  ] },
  { date: '2025-06-01', type: 'manual', lines: [
    { accountId: 'acc-bank1', debit: 10000, credit: 0 },
    { accountId: 'acc-sales', debit: 0, credit: 10000 },
  ] },
]

// Current year: 30,000 sales, 12,000 rent, 5,000 drawn, 20,000 more capital.
const CURRENT = [
  { date: '2026-03-01', type: 'manual', lines: [
    { accountId: 'acc-bank1', debit: 30000, credit: 0 },
    { accountId: 'acc-sales', debit: 0, credit: 30000 },
  ] },
  { date: '2026-04-01', type: 'manual', lines: [
    { accountId: 'acc-rent', debit: 12000, credit: 0 },
    { accountId: 'acc-bank1', debit: 0, credit: 12000 },
  ] },
  { date: '2026-05-01', type: 'drawings', lines: [
    { accountId: 'acc-drawings', debit: 5000, credit: 0 },
    { accountId: 'acc-bank1', debit: 0, credit: 5000 },
  ] },
  { date: '2026-07-01', type: 'capital_intro', lines: [
    { accountId: 'acc-bank1', debit: 20000, credit: 0 },
    { accountId: 'acc-capital', debit: 0, credit: 20000 },
  ] },
]

const build = (entries = [...PRIOR, ...CURRENT], opts = {}) =>
  buildEquityStatement(
    { accounts: ACCOUNTS, journalEntries: entries, balancesFor: balancer(entries) },
    { start: '2026-01-01', end: '2026-12-31', ...opts },
  )

describe('profit for a period', () => {
  it('is revenue less expenses', () => {
    const b = balancer(CURRENT)('2026-01-01', '2026-12-31')
    expect(profitFor(ACCOUNTS, b)).toBe(18000)
  })

  it('is zero on an empty period', () => {
    expect(profitFor(ACCOUNTS, {})).toBe(0)
  })
})

describe('the statement', () => {
  const s = build()

  it('reconciles to the balance sheet — the test that makes it worth printing', () => {
    expect(s.reconciles).toBe(true)
    expect(s.difference).toBe(0)
    // 50,000 + 20,000 capital − 5,000 drawings + 10,000 prior + 18,000 this year
    expect(s.totals.closing).toBe(93000)
    expect(s.balanceSheetEquity).toBe(93000)
  })

  it('carries prior profit into the opening retained earnings', () => {
    // Profit is computed rather than posted, so retained earnings has no
    // ledger balance at all — its opening is last year's result.
    const retained = s.rows.find((r) => r.isRetained)
    expect(retained.opening).toBe(10000)
  })

  it('reports this period’s profit as the retained-earnings movement', () => {
    const retained = s.rows.find((r) => r.isRetained)
    expect(retained.movements).toEqual([{ label: 'Profit for the period', amount: 18000 }])
    expect(retained.closing).toBe(28000)
  })

  it('separates capital introduced from profit', () => {
    // The whole point of the statement: a balance sheet cannot tell these
    // apart, and they are entirely different stories about a business.
    const capital = s.rows.find((r) => r.id === 'acc-capital')
    expect(capital.opening).toBe(50000)
    expect(capital.movements).toEqual([{ label: 'Capital introduced', amount: 20000 }])
    expect(capital.closing).toBe(70000)
  })

  it('shows drawings as a reduction, not a loss', () => {
    const drawings = s.rows.find((r) => r.id === 'acc-drawings')
    expect(drawings.movementTotal).toBe(-5000)
    expect(drawings.closing).toBe(-5000)
  })

  it('labels a movement by what caused it', () => {
    expect(movementLabel('capital_intro')).toBe('Capital introduced')
    expect(movementLabel('drawings')).toBe('Drawings')
    expect(movementLabel('dividend')).toBe('Dividends declared')
    expect(movementLabel('something_new')).toBe('Other movements')
  })

  it('lists every movement description for the column headers', () => {
    expect(movementColumns(s)).toEqual(
      expect.arrayContaining(['Capital introduced', 'Drawings', 'Profit for the period']))
  })

  it('opens the period where the last one closed', () => {
    const prior = buildEquityStatement(
      { accounts: ACCOUNTS, journalEntries: PRIOR, balancesFor: balancer(PRIOR) },
      { start: '2025-01-01', end: '2025-12-31' })
    expect(prior.totals.closing).toBe(s.totals.opening)
  })
})

describe('a loss-making period', () => {
  it('reduces retained earnings and still reconciles', () => {
    const loss = [
      ...PRIOR,
      { date: '2026-04-01', type: 'manual', lines: [
        { accountId: 'acc-rent', debit: 4000, credit: 0 },
        { accountId: 'acc-bank1', debit: 0, credit: 4000 },
      ] },
    ]
    const s = build(loss)
    expect(s.profit).toBe(-4000)
    expect(s.rows.find((r) => r.isRetained).closing).toBe(6000)
    expect(s.reconciles).toBe(true)
  })
})

describe('robustness', () => {
  it('needs a balances function and says so', () => {
    expect(() => buildEquityStatement({ accounts: ACCOUNTS }, {})).toThrow(/balancesFor/)
  })

  it('survives a business with no transactions at all', () => {
    const s = buildEquityStatement(
      { accounts: ACCOUNTS, journalEntries: [], balancesFor: balancer([]) },
      { start: '2026-01-01', end: '2026-12-31' })
    expect(s.totals.closing).toBe(0)
    expect(s.reconciles).toBe(true)
  })

  it('reconciles in a first period, where there is no prior year', () => {
    const s = buildEquityStatement(
      { accounts: ACCOUNTS, journalEntries: CURRENT, balancesFor: balancer(CURRENT) },
      { start: '2026-01-01', end: '2026-12-31' })
    expect(s.totals.opening).toBe(0)
    expect(s.reconciles).toBe(true)
  })

  it('ignores journal entries outside the period', () => {
    const s = build([...PRIOR, ...CURRENT], { start: '2026-01-01', end: '2026-06-30' })
    // The July capital injection is out of range.
    const capital = s.rows.find((r) => r.id === 'acc-capital')
    expect(capital.movementTotal).toBe(0)
  })

  it('reports a discrepancy rather than hiding it', () => {
    // An unbalanced ledger must surface as a failure to reconcile, not be
    // quietly absorbed into a total.
    const broken = [...PRIOR, { date: '2026-02-01', type: 'manual', lines: [
      { accountId: 'acc-bank1', debit: 999, credit: 0 },   // one-sided on purpose
    ] }]
    const s = build(broken)
    expect(s.reconciles).toBe(false)
    expect(s.difference).not.toBe(0)
  })
})
