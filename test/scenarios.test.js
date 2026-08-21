// Scenario planning.
//
// One property decides whether any of this is honest: a fall in sales must
// not un-sell what has already been invoiced. Money a customer already owes
// is affected by *when* they pay, not by whether the business wins new work.
//
// Scaling receivables by a sales lever would model customers refusing to pay
// for goods already delivered — a different and much worse scenario — and it
// makes every downturn look roughly twice as bad as it is. A business that
// plans around that prepares for a crisis it is not in. Most of what follows
// is about that distinction.
import { describe, it, expect } from 'vitest'
import {
  applyLevers, emptyScenario, isActive, compareForecasts, runScenario,
  verdictOf, PRESETS, LEVERS, COMMITTED_SOURCES,
} from '../src/utils/scenarios.js'
import { buildForecast, CERTAINTY } from '../src/utils/cashForecast.js'

const FROM = '2026-01-01'

const ev = (over = {}) => ({
  date: '2026-01-15', amount: 1000, source: 'receivables',
  certainty: CERTAINTY.COMMITTED, label: 'Acme', ref: 'INV-1', overdue: false, ...over,
})

const invoiced = ev({ source: 'receivables', certainty: CERTAINTY.COMMITTED, amount: 10000 })
const recurring = ev({ source: 'recurring', certainty: CERTAINTY.SCHEDULED, amount: 5000 })
const pipeline = ev({ source: 'pipeline', certainty: CERTAINTY.ESTIMATED, amount: 8000 })
const bill = ev({ source: 'payables', certainty: CERTAINTY.COMMITTED, amount: -4000 })
const payroll = ev({ source: 'payroll', certainty: CERTAINTY.SCHEDULED, amount: -6000 })

const apply = (events, patch) => applyLevers(events, { ...emptyScenario(), ...patch }, { from: FROM })
const find = (out, ref) => out.find((e) => e.ref === ref)   // events built by ev() share a ref; use source where it matters

describe('a change in sales', () => {
  it('does not touch money a customer already owes', () => {
    // The distinction the whole module turns on.
    const out = apply([invoiced], { salesChangePct: -20 })
    expect(out[0].amount).toBe(10000)
  })

  it('does move revenue still to be won', () => {
    const out = apply([recurring, pipeline], { salesChangePct: -20 })
    expect(out.find((e) => e.source === 'recurring').amount).toBe(4000)
    expect(out.find((e) => e.source === 'pipeline').amount).toBe(6400)
  })

  it('scales the future and leaves the invoiced alone in the same run', () => {
    // Both halves of the rule at once, which is how it will actually be used —
    // and the case where getting it wrong doubles the apparent damage.
    const out = apply([invoiced, recurring, pipeline], { salesChangePct: -50 })
    expect(out.find((e) => e.source === 'receivables').amount).toBe(10000)
    expect(out.find((e) => e.source === 'recurring').amount).toBe(2500)
    expect(out.find((e) => e.source === 'pipeline').amount).toBe(4000)
  })

  it('works upwards as well', () => {
    expect(apply([pipeline], { salesChangePct: 25 })[0].amount).toBe(10000)
  })

  it('leaves outgoings alone', () => {
    const out = apply([bill, payroll], { salesChangePct: -50 })
    expect(out.find((e) => e.source === 'payables').amount).toBe(-4000)
    expect(out.find((e) => e.source === 'payroll').amount).toBe(-6000)
  })

  it('drops an event scaled away to nothing', () => {
    expect(apply([pipeline], { salesChangePct: -100 })).toHaveLength(0)
  })
})

describe('a change in costs', () => {
  it('scales projected outgoings', () => {
    expect(apply([payroll], { costChangePct: 10 })[0].amount).toBe(-6600)
  })

  it('leaves a bill already received alone', () => {
    // The supplier's invoice does not grow because trading costs rose.
    expect(apply([bill], { costChangePct: 50 })[0].amount).toBe(-4000)
  })

  it('leaves loan repayments and tax alone', () => {
    const loan = ev({ source: 'loans', amount: -2000, ref: 'L1' })
    const tax = ev({ source: 'tax', amount: -3000, ref: 'T1' })
    const out = apply([loan, tax], { costChangePct: 30 })
    expect(find(out, 'L1').amount).toBe(-2000)
    expect(find(out, 'T1').amount).toBe(-3000)
  })

  it('knows which sources are committed', () => {
    expect(COMMITTED_SOURCES.has('receivables')).toBe(true)
    expect(COMMITTED_SOURCES.has('payables')).toBe(true)
    expect(COMMITTED_SOURCES.has('payroll')).toBe(false)
  })
})

describe('customers paying later', () => {
  it('pushes an expected receipt back', () => {
    const out = apply([invoiced], { collectionDelayDays: 30 })
    expect(out[0].date).toBe('2026-02-14')
    expect(out[0].shifted).toBe(true)
  })

  it('applies to recurring revenue too', () => {
    expect(apply([recurring], { collectionDelayDays: 30 })[0].date).toBe('2026-02-14')
  })

  it('does not move what the business owes other people', () => {
    // "Customers pay later" is not "I pay later" — conflating them would
    // cancel out the very squeeze being modelled.
    const out = apply([bill, payroll], { collectionDelayDays: 30 })
    expect(out.find((e) => e.source === 'payables').date).toBe('2026-01-15')
    expect(out.find((e) => e.source === 'payroll').date).toBe('2026-01-15')
  })

  it('can model customers paying sooner', () => {
    expect(apply([invoiced], { collectionDelayDays: -10 })[0].date).toBe('2026-01-05')
  })

  it('scales before it delays', () => {
    // A delayed receipt is the scaled amount arriving later, not the original.
    const out = apply([pipeline], { salesChangePct: -50, collectionDelayDays: 30 })
    expect(out[0]).toMatchObject({ amount: 4000, date: '2026-02-14' })
  })
})

describe('overdue money', () => {
  const late = ev({ overdue: true, amount: 7000, ref: 'OLD' })

  it('can be written down to what is really expected', () => {
    expect(apply([late], { overdueRecoveryPct: 40 })[0].amount).toBe(2800)
  })

  it('can be removed entirely', () => {
    expect(apply([late], { overdueRecoveryPct: 0 })).toHaveLength(0)
  })

  it('is left alone when the lever is not set', () => {
    expect(apply([late], {})[0].amount).toBe(7000)
  })

  it('is not delayed as well', () => {
    // Its timing is already unknown; delaying it further means nothing.
    expect(apply([late], { collectionDelayDays: 60 })[0].date).toBe('2026-01-15')
  })
})

describe('one-off decisions', () => {
  it('adds a single purchase', () => {
    const out = apply([], { oneOffs: [{ label: 'Van', amount: -45000, date: '2026-03-01' }] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ amount: -45000, date: '2026-03-01', label: 'Van', scenario: true })
  })

  it('spreads a hire across months', () => {
    const out = apply([], { oneOffs: [{ label: 'New hire', amount: -8000, date: '2026-02-01', recurring: true, months: 3 }] })
    expect(out.map((e) => e.date)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01'])
    expect(out.every((e) => e.amount === -8000)).toBe(true)
  })

  it('can be money coming in', () => {
    const out = apply([], { oneOffs: [{ label: 'Loan', amount: 100000, date: '2026-02-01' }] })
    expect(out[0].amount).toBe(100000)
  })

  it('ignores one with no amount or no date', () => {
    expect(apply([], { oneOffs: [{ label: 'Nothing', amount: 0, date: '2026-02-01' }, { label: 'x', amount: 5 }] })).toHaveLength(0)
  })

  it('leaves out occurrences before the forecast starts', () => {
    const out = apply([], { oneOffs: [{ label: 'Old', amount: -100, date: '2025-11-01', recurring: true, months: 6 }] })
    expect(out.every((e) => e.date >= FROM)).toBe(true)
  })
})

describe('knowing whether a scenario does anything', () => {
  it('is inactive when untouched', () => {
    expect(isActive(emptyScenario())).toBe(false)
  })

  it('is active once any lever moves', () => {
    expect(isActive({ salesChangePct: -10 })).toBe(true)
    expect(isActive({ overdueRecoveryPct: 0 })).toBe(true)
    expect(isActive({ oneOffs: [{ label: 'x', amount: 1, date: '2026-01-01' }] })).toBe(true)
  })

  it('offers presets phrased as the question being asked', () => {
    expect(PRESETS.map((p) => p.key)).toContain('lateCustomers')
    expect(LEVERS.map((l) => l.key)).toContain('collectionDelayDays')
  })
})

describe('through the real forecast machinery', () => {
  // One customer owing 20,000 due in week 2, and rent going out monthly.
  const data = {
    invoices: [{ id: 'i1', number: 'INV-1', status: 'sent', customerName: 'Acme',
      date: '2026-01-01', dueDate: '2026-01-08', total: 20000, amountPaid: 0 }],
    purchases: [], recurringInvoices: [], recurringExpenses: [], leases: [],
    scheduledTransfers: [], employees: [], cheques: [], bankTransactions: [],
  }
  const opts = { from: FROM, weeks: 13, openingCash: 5000 }

  it('reuses the forecast’s own weekly roll-up', () => {
    // Nothing here re-implements the trough or the runway; a variation that
    // computed them differently would contradict the forecast it varies.
    const base = buildForecast(data, opts)
    const s = runScenario(buildForecast, data, opts, { ...emptyScenario(), collectionDelayDays: 30 })
    expect(s.weeks).toHaveLength(13)
    expect(base.weeks).toHaveLength(13)
  })

  it('shows a delay pushing the receipt into a later week', () => {
    const base = buildForecast(data, opts)
    const s = runScenario(buildForecast, data, opts, { ...emptyScenario(), collectionDelayDays: 30 })
    const weekOf = (f) => f.weeks.findIndex((w) => w.inflows > 0) + 1
    expect(weekOf(s)).toBeGreaterThan(weekOf(base))
  })

  it('leaves the total collected unchanged when only the timing moves', () => {
    const base = buildForecast(data, opts)
    const s = runScenario(buildForecast, data, opts, { ...emptyScenario(), collectionDelayDays: 30 })
    expect(s.totalIn).toBe(base.totalIn)
  })

  it('makes a hire visible as a hole in the cash', () => {
    const base = buildForecast(data, opts)
    const s = runScenario(buildForecast, data, opts, {
      ...emptyScenario(),
      oneOffs: [{ label: 'New hire', amount: -9000, date: '2026-01-15', recurring: true, months: 3 }],
    })
    expect(s.closingCash).toBeLessThan(base.closingCash)
    expect(r(base.closingCash - s.closingCash)).toBe(27000)
  })
})

const r = (n) => Math.round(n * 100) / 100

describe('comparing against the base case', () => {
  const base = { closingCash: 50000, lowest: { amount: 10000, week: 4 }, runwayWeeks: null, shortfall: null }

  it('reports what changed at the end and at the worst point', () => {
    const s = { closingCash: 20000, lowest: { amount: -5000, week: 6 }, runwayWeeks: 5, shortfall: { week: 6, date: '2026-02-05', amount: -5000 } }
    const c = compareForecasts(base, s)
    expect(c.closingChange).toBe(-30000)
    expect(c.lowestChange).toBe(-15000)
    expect(c.survives).toBe(false)
  })

  it('does not treat "never ran out" as a number', () => {
    // A base case that never goes negative has no runway figure to subtract
    // from, and pretending otherwise produces nonsense.
    const s = { closingCash: 1, lowest: { amount: -1 }, runwayWeeks: 3, shortfall: { week: 4 } }
    expect(compareForecasts(base, s).runwayChange).toBe('became_negative')
  })

  it('reports a scenario that fixes a shortfall', () => {
    const broken = { closingCash: -1, lowest: { amount: -1 }, runwayWeeks: 2, shortfall: { week: 3 } }
    const fixed = { closingCash: 9000, lowest: { amount: 500 }, runwayWeeks: null, shortfall: null }
    expect(compareForecasts(broken, fixed).runwayChange).toBe('no_longer_negative')
  })

  it('says outright that it is a projection of a projection', () => {
    expect(compareForecasts(base, base).projectionOfProjection).toBe(true)
  })
})

describe('the one-line answer', () => {
  it('says a scenario runs out, and when', () => {
    const v = verdictOf({ shortfall: { week: 6, date: '2026-02-12' }, openingCash: 10000, lowest: { amount: -400 } })
    expect(v).toMatchObject({ key: 'breaks', week: 6 })
  })

  it('says a scenario survives but is thin', () => {
    const v = verdictOf({ shortfall: null, openingCash: 100000, lowest: { amount: 2000, week: 5 } })
    expect(v.key).toBe('tight')
  })

  it('says a scenario is comfortable', () => {
    const v = verdictOf({ shortfall: null, openingCash: 100000, lowest: { amount: 60000, week: 5 } })
    expect(v.key).toBe('safe')
  })

  it('has nothing to say about nothing', () => {
    expect(verdictOf(null)).toBeNull()
  })
})
