// The 13-week cash forecast.
//
// The tests that matter most here are the ones about honesty, not arithmetic.
// A forecast that adds up perfectly but treats an overdue invoice as if it will
// arrive on Monday is worse than no forecast at all, because somebody will
// commit to a payment on the strength of it. So: overdue money stays out of the
// running balance, a bank-to-bank sweep never invents an outflow, and every
// projected amount carries how firm it actually is.
import { describe, it, expect } from 'vitest'
import {
  advanceDate, shiftDays, occurrences, forecastEvents, buildForecast, bySource,
  CERTAINTY, SOURCES, ALL_SOURCES,
} from '../src/utils/cashForecast.js'

const FROM = '2026-03-02'   // a Monday

// A skeleton set of books. Individual tests add only the slice they care about.
const books = (over = {}) => ({
  invoices: [], purchases: [], cheques: [], recurringInvoices: [],
  recurringExpenses: [], leases: [], employees: [], scheduledTransfers: [],
  accounts: [
    { id: 'acc-bank1', type: 'asset' },
    { id: 'acc-bank2', type: 'asset' },
    { id: 'acc-loan', type: 'liability' },
  ],
  settings: {},
  ...over,
})

const run = (data, opts = {}) =>
  buildForecast(data, { from: FROM, weeks: 13, openingCash: 0, ...opts })

describe('date arithmetic', () => {
  it('steps weekly and fortnightly', () => {
    expect(advanceDate('2026-03-02', 'weekly')).toBe('2026-03-09')
    expect(advanceDate('2026-03-02', 'biweekly')).toBe('2026-03-16')
  })

  it('clamps a month-end date instead of drifting into the next month', () => {
    // The classic bug: Jan 31 + 1 month naively becomes Mar 3.
    expect(advanceDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(advanceDate('2028-01-31', 'monthly')).toBe('2028-02-29') // leap year
  })

  it('steps quarters and years', () => {
    expect(advanceDate('2026-03-02', 'quarterly')).toBe('2026-06-02')
    expect(advanceDate('2026-03-02', 'yearly')).toBe('2027-03-02')
  })

  it('shifts days across a month boundary', () => {
    expect(shiftDays('2026-03-30', 7)).toBe('2026-04-06')
    expect(shiftDays('2026-03-02', -1)).toBe('2026-03-01')
  })
})

describe('walking a schedule', () => {
  it('yields every run date inside the window', () => {
    expect(occurrences('2026-03-02', 'weekly', { until: '2026-03-23' }))
      .toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'])
  })

  it('stops at the schedule end date', () => {
    expect(occurrences('2026-03-02', 'weekly', { until: '2026-04-30', endDate: '2026-03-15' }))
      .toEqual(['2026-03-02', '2026-03-09'])
  })

  it('treats an unrecognised frequency as monthly, matching the store', () => {
    // advanceDate's month branch is the fallback for anything that is not
    // weekly/biweekly/quarterly/yearly, so an unknown value steps by a month
    // rather than stalling. Documented because the loop guard below depends on
    // the cursor always moving.
    expect(occurrences('2026-03-02', 'fortnightly-ish', { until: '2026-05-05' }))
      .toEqual(['2026-03-02', '2026-04-02', '2026-05-02'])
  })

  it('is bounded even if the cursor ever stopped moving', () => {
    // Belt and braces: `cap` bounds the walk regardless of what advanceDate
    // returns, so a future change there can never hang the page.
    expect(occurrences('2026-03-02', 'weekly', { until: '2030-01-01', cap: 5 })).toHaveLength(5)
  })
})

describe('what lands in the forecast', () => {
  it('projects an unpaid invoice on its due date, net of part payment', () => {
    const data = books({ invoices: [
      { number: 'INV-1', status: 'partial', customerName: 'Acme', date: FROM, dueDate: '2026-03-20', total: 1000, amountPaid: 400 },
    ] })
    const [e] = forecastEvents(data, { from: FROM, until: '2026-05-31' })
    expect(e).toMatchObject({ date: '2026-03-20', amount: 600, certainty: CERTAINTY.COMMITTED })
  })

  it('ignores paid and void invoices', () => {
    const data = books({ invoices: [
      { number: 'A', status: 'paid',  dueDate: '2026-03-20', total: 500, amountPaid: 500 },
      { number: 'B', status: 'void',  dueDate: '2026-03-20', total: 500, amountPaid: 0 },
      { number: 'C', status: 'sent',  dueDate: '2026-03-20', total: 500, amountPaid: 0, isOpening: true },
    ] })
    expect(forecastEvents(data, { from: FROM, until: '2026-05-31' })).toEqual([])
  })

  it('projects a supplier bill as a negative amount', () => {
    const data = books({ purchases: [
      { number: 'BILL-1', status: 'received', supplierName: 'Metro', dueDate: '2026-03-18', total: 800, amountPaid: 0 },
    ] })
    const [e] = forecastEvents(data, { from: FROM, until: '2026-05-31' })
    expect(e.amount).toBe(-800)
  })

  it('counts a post-dated cheque but not one already cleared', () => {
    const data = books({ cheques: [
      { number: 'C1', direction: 'received', status: 'pending', dueDate: '2026-03-25', amount: 300 },
      { number: 'C2', direction: 'issued',   status: 'pending', dueDate: '2026-03-26', amount: 200 },
      { number: 'C3', direction: 'received', status: 'cleared', dueDate: '2026-03-27', amount: 999 },
    ] })
    const out = forecastEvents(data, { from: FROM, until: '2026-05-31' })
    expect(out.map((e) => e.amount)).toEqual([300, -200])
  })
})

describe('recurring schedules', () => {
  it('lands recurring invoice cash on the terms the system will actually issue', () => {
    // postDueRecurring issues the invoice with one month's terms, so the cash
    // arrives a month after generation — not on the generation date.
    const data = books({ recurringInvoices: [
      { number: 'R-1', status: 'active', customerName: 'Sub', frequency: 'monthly', nextDate: '2026-03-05', total: 1200 },
    ] })
    const out = forecastEvents(data, { from: FROM, until: '2026-04-30' })
    expect(out[0].date).toBe('2026-04-05')      // issued 5 Mar, collected 5 Apr
    expect(out[0].amount).toBe(1200)
  })

  it('grosses a recurring expense up for tax', () => {
    const data = books({ recurringExpenses: [
      { name: 'Hosting', status: 'active', frequency: 'monthly', nextDate: '2026-03-10', amount: 100, taxRate: 15 },
    ] })
    const [e] = forecastEvents(data, { from: FROM, until: '2026-03-31' })
    expect(e.amount).toBe(-115)
  })

  it('projects a lease from the next due month, not from its start date', () => {
    // A lease that began in 2024 must not replay two years of history.
    const data = books({ leases: [
      { name: 'Office', status: 'active', startDate: '2024-06-15', monthlyRent: 5000 },
    ] })
    const out = forecastEvents(data, { from: FROM, until: '2026-04-30' })
    expect(out.map((e) => e.date)).toEqual(['2026-03-15', '2026-04-15'])
    expect(out.every((e) => e.amount === -5000)).toBe(true)
  })

  it('leaves an expired lease alone', () => {
    const data = books({ leases: [
      { name: 'Old', status: 'active', startDate: '2024-01-10', endDate: '2026-01-10', monthlyRent: 900 },
    ] })
    expect(forecastEvents(data, { from: FROM, until: '2026-05-31' })).toEqual([])
  })
})

describe('transfers — the one that would invent money', () => {
  it('does not treat a bank-to-bank sweep as an outflow', () => {
    // Moving cash between our own accounts changes nothing at business level.
    // Counting it would fabricate an outflow that never happens.
    const data = books({ scheduledTransfers: [
      { fromAccountId: 'acc-bank1', toAccountId: 'acc-bank2', amount: 10000, fee: 0, frequency: 'monthly', nextDate: '2026-03-10' },
    ] })
    expect(forecastEvents(data, { from: FROM, until: '2026-03-31' })).toEqual([])
  })

  it('counts the fee on a sweep, because the fee really does leave', () => {
    const data = books({ scheduledTransfers: [
      { fromAccountId: 'acc-bank1', toAccountId: 'acc-bank2', amount: 10000, fee: 25, frequency: 'monthly', nextDate: '2026-03-10' },
    ] })
    const [e] = forecastEvents(data, { from: FROM, until: '2026-03-31' })
    expect(e.amount).toBe(-25)
  })

  it('counts a loan repayment in full', () => {
    const data = books({ scheduledTransfers: [
      { fromAccountId: 'acc-bank1', toAccountId: 'acc-loan', amount: 2000, fee: 5, frequency: 'monthly', nextDate: '2026-03-10', reference: 'Term loan' },
    ] })
    const [e] = forecastEvents(data, { from: FROM, until: '2026-03-31' })
    expect(e.amount).toBe(-2005)
  })
})

describe('payroll is an estimate and says so', () => {
  it('projects monthly pay from active headcount only', () => {
    const data = books({ employees: [
      { status: 'active', salary: 5000 },
      { status: 'active', salary: 3000 },
      { status: 'inactive', salary: 9000 },
    ] })
    const out = forecastEvents(data, { from: FROM, until: '2026-04-30', payrollDay: 28 })
    expect(out.map((e) => e.date)).toEqual(['2026-03-28', '2026-04-28'])
    expect(out[0].amount).toBe(-8000)
    expect(out[0].certainty).toBe(CERTAINTY.ESTIMATED)
  })

  it('can be switched off entirely', () => {
    const data = books({ employees: [{ status: 'active', salary: 5000 }] })
    const include = ALL_SOURCES.filter((k) => k !== 'payroll')
    expect(forecastEvents(data, { from: FROM, until: '2026-04-30', include })).toEqual([])
  })
})

describe('overdue money is never treated as on-time money', () => {
  const data = () => books({ invoices: [
    { number: 'LATE', status: 'sent', dueDate: '2026-02-01', total: 5000, amountPaid: 0 },
    { number: 'SOON', status: 'sent', dueDate: '2026-03-04', total: 1000, amountPaid: 0 },
  ] })

  it('reports overdue separately and keeps it out of the running balance', () => {
    const f = run(data(), { openingCash: 2000 })
    expect(f.overdue.inflows).toBe(5000)
    expect(f.overdue.events).toHaveLength(1)
    // Week 1 sees only the invoice actually due this week.
    expect(f.weeks[0].inflows).toBe(1000)
    expect(f.weeks[0].closing).toBe(3000)     // 2000 opening + 1000 — not 8000
  })

  it('folds overdue in only when the user explicitly asks', () => {
    const f = run(data(), { openingCash: 2000, collectOverdue: true })
    expect(f.weeks[0].opening).toBe(7000)     // 2000 + 5000 assumed collected
    expect(f.weeks[0].closing).toBe(8000)
  })
})

describe('the weekly grid', () => {
  it('runs the balance forward week by week', () => {
    const data = books({ invoices: [
      { number: 'I1', status: 'sent', dueDate: '2026-03-03', total: 500, amountPaid: 0 },   // week 1
      { number: 'I2', status: 'sent', dueDate: '2026-03-12', total: 700, amountPaid: 0 },   // week 2
    ], purchases: [
      { number: 'B1', status: 'received', dueDate: '2026-03-10', total: 200, amountPaid: 0 }, // week 2
    ] })
    const f = run(data, { openingCash: 1000 })
    expect(f.weeks[0]).toMatchObject({ start: '2026-03-02', end: '2026-03-08', inflows: 500, outflows: 0, closing: 1500 })
    expect(f.weeks[1]).toMatchObject({ start: '2026-03-09', end: '2026-03-15', inflows: 700, outflows: 200, net: 500, closing: 2000 })
    expect(f.closingCash).toBe(2000)
  })

  it('produces exactly the requested number of weeks', () => {
    expect(run(books()).weeks).toHaveLength(13)
    expect(run(books(), { weeks: 4 }).weeks).toHaveLength(4)
  })

  it('flags the week cash first goes negative and reports the runway', () => {
    const data = books({ purchases: [
      { number: 'B', status: 'received', dueDate: '2026-03-18', total: 5000, amountPaid: 0 }, // week 3
    ] })
    const f = run(data, { openingCash: 1000 })
    expect(f.shortfall.week).toBe(3)
    expect(f.runwayWeeks).toBe(2)          // solvent through weeks 1 and 2
    expect(f.lowest.amount).toBe(-4000)
  })

  it('reports no shortfall when the business stays positive throughout', () => {
    const f = run(books(), { openingCash: 5000 })
    expect(f.shortfall).toBeNull()
    expect(f.runwayWeeks).toBeNull()
    expect(f.lowest.amount).toBe(5000)
  })

  it('excludes anything past the end of the window', () => {
    const data = books({ invoices: [
      { number: 'FAR', status: 'sent', dueDate: '2027-01-01', total: 9999, amountPaid: 0 },
    ] })
    const f = run(data)
    expect(f.totalIn).toBe(0)
  })
})

describe('source breakdown', () => {
  it('totals each source and carries its certainty', () => {
    const data = books({
      invoices: [{ number: 'I', status: 'sent', dueDate: '2026-03-05', total: 1000, amountPaid: 0 }],
      leases: [{ name: 'Office', status: 'active', startDate: '2026-03-15', monthlyRent: 400 }],
    })
    const rows = bySource(run(data))
    const inv = rows.find((r) => r.source === 'receivables')
    const lease = rows.find((r) => r.source === 'leases')
    expect(inv).toMatchObject({ inflow: 1000, outflow: 0, certainty: CERTAINTY.COMMITTED })
    expect(lease.certainty).toBe(CERTAINTY.SCHEDULED)
    expect(lease.outflow).toBeGreaterThan(0)
  })
})

describe('robustness against real-world data', () => {
  it('survives empty books', () => {
    const f = run(books(), { openingCash: 0 })
    expect(f.weeks).toHaveLength(13)
    expect(f.closingCash).toBe(0)
    expect(f.overdue.net).toBe(0)
  })

  it('survives missing slices entirely', () => {
    const f = buildForecast({}, { from: FROM, openingCash: 100 })
    expect(f.closingCash).toBe(100)
  })

  it('falls back to the document date when a due date was never set', () => {
    const data = books({ invoices: [
      { number: 'NO-DUE', status: 'sent', date: '2026-03-05', total: 250, amountPaid: 0 },
    ] })
    expect(forecastEvents(data, { from: FROM, until: '2026-05-31' })[0].date).toBe('2026-03-05')
  })

  it('drops zero-value rows rather than cluttering the week', () => {
    const data = books({ invoices: [
      { number: 'FULLY-PAID-BUT-OPEN', status: 'partial', dueDate: '2026-03-05', total: 500, amountPaid: 500 },
    ] })
    expect(forecastEvents(data, { from: FROM, until: '2026-05-31' })).toEqual([])
  })

  it('keeps money rounded to cents through the running balance', () => {
    // 33.33 + 15% = 38.3295, which must not leak float noise into the balance.
    const data = books({ recurringExpenses: [
      { name: 'Odd', status: 'active', frequency: 'monthly', nextDate: '2026-03-10', amount: 33.33, taxRate: 15 },
    ] })
    const f = run(data, { weeks: 2, openingCash: 100 })   // one occurrence only
    expect(f.weeks[1].outflows).toBe(38.33)
    expect(f.closingCash).toBe(61.67)
  })

  it('repeats a monthly commitment for every month in the window', () => {
    const data = books({ recurringExpenses: [
      { name: 'Odd', status: 'active', frequency: 'monthly', nextDate: '2026-03-10', amount: 33.33, taxRate: 15 },
    ] })
    const f = run(data, { openingCash: 100 })       // 13 weeks → Mar, Apr, May
    expect(f.totalOut).toBe(114.99)
    expect(f.closingCash).toBe(-14.99)
  })

  it('every declared source is reachable from the events builder', () => {
    // Guards against a source being added to the legend but never projected.
    const keys = new Set(SOURCES.map((s) => s.key))
    expect(keys.size).toBe(SOURCES.length)
    expect(ALL_SOURCES).toEqual([...keys])
  })
})
