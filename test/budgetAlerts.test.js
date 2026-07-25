import { describe, it, expect } from 'vitest'
import { budgetAlerts, elapsedPercent, alertSummary } from '../src/utils/budgetAlerts.js'

const accounts = [
  { id: 'rent', code: '5000', name: 'Rent', type: 'expense' },
  { id: 'mkt', code: '5100', name: 'Marketing', type: 'expense' },
  { id: 'sales', code: '4000', name: 'Sales', type: 'revenue' },
]
const YEAR = '2026'
const JUN = new Date('2026-07-02T00:00:00Z') // ~50% through the year
const FEB = new Date('2026-02-01T00:00:00Z') // ~8.5% through
const mk = (m) => ({ accounts, budgets: Object.entries(m).map(([accountId, amount]) => ({ accountId, year: YEAR, amount })), getActual: (id) => (m[id] ? (m[id].__actual ?? 0) : 0), year: YEAR })

// helper: budgets + actuals given separately for clarity
const run = (budgets, actuals, asOf = JUN, tolerance = 10) =>
  budgetAlerts({
    accounts,
    budgets: Object.entries(budgets).map(([accountId, amount]) => ({ accountId, year: YEAR, amount })),
    getActual: (id) => actuals[id] || 0,
    year: YEAR, asOf, tolerance,
  })

describe('elapsedPercent', () => {
  it('is 0 before the year, 100 after, and ~50 mid-year', () => {
    expect(elapsedPercent('2026', new Date('2025-06-01T00:00:00Z'))).toBe(0)
    expect(elapsedPercent('2026', new Date('2027-06-01T00:00:00Z'))).toBe(100)
    expect(elapsedPercent('2026', JUN)).toBeGreaterThan(48)
    expect(elapsedPercent('2026', JUN)).toBeLessThan(52)
  })
})

describe('budgetAlerts — expenses', () => {
  it('flags an expense that is over budget', () => {
    const a = run({ rent: 1000 }, { rent: 1200 })
    expect(a).toHaveLength(1)
    expect(a[0].severity).toBe('over')
    expect(a[0].message).toContain('200')
  })

  it('flags an expense pacing ahead of the calendar', () => {
    // 80% spent but only ~50% through the year → warn (not yet over).
    const a = run({ rent: 1000 }, { rent: 800 })
    expect(a).toHaveLength(1)
    expect(a[0].severity).toBe('warn')
  })

  it('stays SILENT for an expense tracking on pace', () => {
    // 50% spent, ~50% elapsed → healthy, no noise.
    expect(run({ rent: 1000 }, { rent: 500 })).toEqual([])
  })

  it('stays silent for spending slightly ahead but inside tolerance', () => {
    // 55% spent vs ~50% elapsed, tolerance 10 → no alert.
    expect(run({ rent: 1000 }, { rent: 550 })).toEqual([])
  })

  it('does not warn in early Feb for modest spend (pace-aware, not naive)', () => {
    // A naive ">50% of budget" rule would be quiet here anyway, but a naive
    // "any spend" rule would fire. 10% spent vs 8.5% elapsed → fine.
    expect(run({ rent: 1000 }, { rent: 100 }, FEB)).toEqual([])
  })

  it('DOES warn in early Feb when spending is already way ahead', () => {
    const a = run({ rent: 1000 }, { rent: 400 }, FEB)
    expect(a[0].severity).toBe('warn')
  })
})

describe('budgetAlerts — revenue', () => {
  it('flags revenue meaningfully behind target', () => {
    const a = run({ sales: 10000 }, { sales: 2000 })   // 20% vs ~50% elapsed
    expect(a).toHaveLength(1)
    expect(a[0].severity).toBe('behind')
  })

  it('stays silent when revenue is on or ahead of pace', () => {
    expect(run({ sales: 10000 }, { sales: 5000 })).toEqual([])
    expect(run({ sales: 10000 }, { sales: 9000 })).toEqual([])
  })

  it('does not judge revenue too early in the year', () => {
    // Only ~8.5% elapsed — too early to call it behind.
    expect(run({ sales: 10000 }, { sales: 0 }, FEB)).toEqual([])
  })
})

describe('budgetAlerts — hygiene', () => {
  it('ignores zero/blank budgets and other years', () => {
    expect(run({ rent: 0 }, { rent: 999 })).toEqual([])
    const other = budgetAlerts({
      accounts, budgets: [{ accountId: 'rent', year: '2025', amount: 100 }],
      getActual: () => 999, year: YEAR, asOf: JUN,
    })
    expect(other).toEqual([])
  })

  it('ignores budgets pointing at a deleted account', () => {
    const a = budgetAlerts({ accounts, budgets: [{ accountId: 'ghost', year: YEAR, amount: 100 }], getActual: () => 500, year: YEAR, asOf: JUN })
    expect(a).toEqual([])
  })

  it('sorts most urgent first: over, then warn, then behind', () => {
    const a = run({ rent: 1000, mkt: 1000, sales: 10000 }, { rent: 800, mkt: 1500, sales: 1000 })
    expect(a.map((x) => x.severity)).toEqual(['over', 'warn', 'behind'])
  })

  it('summarises counts by severity', () => {
    const a = run({ rent: 1000, mkt: 1000, sales: 10000 }, { rent: 800, mkt: 1500, sales: 1000 })
    expect(alertSummary(a)).toEqual({ total: 3, over: 1, warn: 1, behind: 1 })
  })

  it('handles empty inputs without throwing', () => {
    expect(budgetAlerts({ accounts: [], budgets: [], getActual: () => 0, year: YEAR })).toEqual([])
    expect(budgetAlerts({ year: YEAR, getActual: () => 0 })).toEqual([])
  })
})
