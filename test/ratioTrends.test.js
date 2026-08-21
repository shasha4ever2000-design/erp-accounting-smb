// Ratios over time.
//
// A current ratio of 1.4 is not a fact about a business, it is a frame from a
// film: 1.4 after 2.1 is a business consuming its buffer, 1.4 after 0.9 is one
// climbing out of trouble. The snapshot cannot tell those apart.
//
// So the tests that matter here are about direction, not arithmetic — and
// particularly about the two ways direction is easy to get wrong: reading a
// fall in days-sales-outstanding as bad when it is good, and reporting a
// metric as fine because it is still in the healthy band while it has been
// sliding every period measured.
import { describe, it, expect } from 'vitest'
import {
  periodEnds, movement, buildTrends, runOf, signalsFrom,
  IMPROVING, WORSENING, FLAT, LOWER_IS_BETTER,
} from '../src/utils/ratioTrends.js'
import { computeFinancialHealth } from '../src/utils/financialHealth.js'

describe('the dates measured', () => {
  it('walks back month-ends, oldest first', () => {
    const d = periodEnds('2026-06-30', 4)
    expect(d).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
  })

  it('ends on the date asked for, not its month-end', () => {
    // "As at today" has to mean today, not a month that has not finished.
    const d = periodEnds('2026-06-15', 3)
    expect(d[d.length - 1]).toBe('2026-06-15')
  })

  it('handles quarters and years', () => {
    expect(periodEnds('2026-12-31', 3, 'quarter')).toEqual(['2026-06-30', '2026-09-30', '2026-12-31'])
    expect(periodEnds('2026-12-31', 3, 'year')).toEqual(['2024-12-31', '2025-12-31', '2026-12-31'])
  })

  it('copes with a February and a leap year', () => {
    expect(periodEnds('2024-03-31', 2)).toEqual(['2024-02-29', '2024-03-31'])
    expect(periodEnds('2026-03-31', 2)).toEqual(['2026-02-28', '2026-03-31'])
  })

  it('returns nothing for a date it cannot read', () => {
    expect(periodEnds('not a date', 3)).toEqual([])
  })
})

describe('which way a metric moved', () => {
  it('calls a rise in a higher-is-better metric an improvement', () => {
    expect(movement(1.0, 1.5, 'high').direction).toBe(IMPROVING)
  })

  it('calls a rise in a lower-is-better metric a deterioration', () => {
    // Days sales outstanding going up is customers taking longer to pay.
    // Reading that as progress would congratulate a business for a problem.
    expect(movement(30, 45, 'low').direction).toBe(WORSENING)
    expect(movement(45, 30, 'low').direction).toBe(IMPROVING)
  })

  it('knows which metrics are the lower-is-better ones', () => {
    expect(LOWER_IS_BETTER.has('dso')).toBe(true)
    expect(LOWER_IS_BETTER.has('de')).toBe(true)
    expect(LOWER_IS_BETTER.has('gm')).toBe(false)
  })

  it('ignores movement too small to mean anything', () => {
    // A current ratio going from 1.500 to 1.505 is not news.
    expect(movement(1.5, 1.505, 'high').direction).toBe(FLAT)
  })

  it('reports the size of the move both ways', () => {
    expect(movement(1.0, 1.5, 'high')).toMatchObject({ change: 0.5, pct: 0.5 })
  })

  it('says a comparison is impossible rather than inventing one', () => {
    // A period the business did not exist in is not a period of zero.
    expect(movement(null, 1.5, 'high')).toMatchObject({ comparable: false, direction: FLAT })
    expect(movement(1.5, null, 'high').comparable).toBe(false)
  })

  it('does not divide by a zero starting point', () => {
    expect(movement(0, 5, 'high').pct).toBeNull()
    expect(movement(0, 5, 'high').direction).toBe(IMPROVING)
  })
})

describe('the shape of the line', () => {
  it('counts how many periods a metric has been sliding', () => {
    // A ratio that fell a little every month for six months is a different
    // problem from one that fell once and held; the endpoints look identical.
    expect(runOf([2.0, 1.8, 1.6, 1.4], 'high')).toMatchObject({ direction: WORSENING, periods: 3 })
  })

  it('stops counting where the direction changed', () => {
    expect(runOf([2.0, 1.5, 1.8, 2.1], 'high')).toMatchObject({ direction: IMPROVING, periods: 2 })
  })

  it('says nothing from too few points', () => {
    expect(runOf([1, 2], 'high').periods).toBe(0)
  })

  it('is not fooled by noise', () => {
    expect(runOf([1.5, 1.501, 1.502, 1.503], 'high').direction).toBe(FLAT)
  })
})

// A business whose liquidity is quietly draining while it still looks fine.
const shrinking = (i) => ({
  currentAssets: 200000 - i * 20000, inventory: 40000, cash: 60000 - i * 8000,
  currentLiabilities: 80000 + i * 6000,
  totalAssets: 300000, totalLiabilities: 100000, equity: 200000,
  revenue: 400000, cogs: 240000, grossProfit: 160000, netIncome: 40000,
  ar: 50000, ap: 30000,
})

describe('the series', () => {
  const dates = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']
  const trends = () => buildTrends(dates, (d) => shrinking(dates.indexOf(d)), computeFinancialHealth)

  it('produces one row per metric with a point per date', () => {
    const t = trends()
    const cur = t.rows.find((r) => r.key === 'current')
    expect(cur.series).toHaveLength(4)
    expect(cur.series.map((s) => s.asOf)).toEqual(dates)
  })

  it('tracks the overall score over time', () => {
    const t = trends()
    expect(t.scores).toHaveLength(4)
    expect(t.scores[0].score).toBeGreaterThan(t.scores[3].score)
  })

  it('reports the direction since the start and since last period', () => {
    const cur = trends().rows.find((r) => r.key === 'current')
    expect(cur.sinceStart.direction).toBe(WORSENING)
    expect(cur.sinceLast.direction).toBe(WORSENING)
  })

  it('carries the range the metric moved through', () => {
    const cur = trends().rows.find((r) => r.key === 'current')
    expect(cur.min).toBeLessThan(cur.max)
    expect(cur.latest).toBe(cur.min)
  })

  it('treats a period with no business as no data, not as zero', () => {
    // A gross margin of 0% in a month with no sales is not a bad month. It is
    // not a month. Plotting it as a collapse would invent a crisis.
    const t = buildTrends(['2026-01-31', '2026-02-28'],
      (d) => (d === '2026-01-31'
        ? { revenue: 0, totalAssets: 0 }
        : shrinking(0)),
      computeFinancialHealth)
    expect(t.points[0].trading).toBe(false)
    expect(t.points[0].result).toBeNull()
    expect(t.rows.find((r) => r.key === 'gm').series[0].value).toBeNull()
  })
})

describe('the signals', () => {
  it('flags a metric that is still healthy but sliding every period', () => {
    // The finding a snapshot can never produce, and the reason this module
    // exists at all.
    const rows = [{
      key: 'current', label: 'Current Ratio', latestRating: 'good',
      run: { direction: WORSENING, periods: 4 },
      series: [{ rating: 'good' }, { rating: 'good' }, { rating: 'good' }, { rating: 'good' }],
    }]
    const s = signalsFrom(rows)
    expect(s[0]).toMatchObject({ kind: 'sliding', stillHealthy: true, periods: 4 })
  })

  it('flags a metric that just changed band', () => {
    const rows = [{
      key: 'quick', label: 'Quick Ratio', latestRating: 'risk',
      run: { direction: FLAT, periods: 0 },
      series: [{ rating: 'good' }, { rating: 'risk' }],
    }]
    expect(signalsFrom(rows)[0]).toMatchObject({ kind: 'dropped', from: 'good', to: 'risk', severity: 'high' })
  })

  it('reports a recovery too', () => {
    const rows = [{
      key: 'quick', label: 'Quick Ratio', latestRating: 'good',
      run: { direction: FLAT, periods: 0 },
      series: [{ rating: 'risk' }, { rating: 'good' }],
    }]
    expect(signalsFrom(rows)[0]).toMatchObject({ kind: 'recovered', severity: 'good' })
  })

  it('puts the worst first', () => {
    const rows = [
      { key: 'a', label: 'A', latestRating: 'good', run: { direction: FLAT, periods: 0 }, series: [{ rating: 'risk' }, { rating: 'good' }] },
      { key: 'b', label: 'B', latestRating: 'risk', run: { direction: FLAT, periods: 0 }, series: [{ rating: 'good' }, { rating: 'risk' }] },
    ]
    expect(signalsFrom(rows)[0].severity).toBe('high')
  })

  it('stays quiet about a business that is not moving', () => {
    // A page that flags fourteen metrics flags nothing, because the reader
    // stops reading.
    const rows = [{
      key: 'current', label: 'Current Ratio', latestRating: 'good',
      run: { direction: FLAT, periods: 0 },
      series: [{ rating: 'good' }, { rating: 'good' }, { rating: 'good' }],
    }]
    expect(signalsFrom(rows)).toEqual([])
  })

  it('does not flag a single bad period as a slide', () => {
    const rows = [{
      key: 'current', label: 'Current Ratio', latestRating: 'good',
      run: { direction: WORSENING, periods: 1 },
      series: [{ rating: 'good' }, { rating: 'good' }],
    }]
    expect(signalsFrom(rows)).toEqual([])
  })
})

describe('end to end on a deteriorating business', () => {
  it('says the business is still healthy and going the wrong way', () => {
    const dates = periodEnds('2026-06-30', 5)
    const t = buildTrends(dates, (d) => shrinking(dates.indexOf(d)), computeFinancialHealth)
    const sliding = t.signals.filter((s) => s.kind === 'sliding')
    expect(sliding.length).toBeGreaterThan(0)
    expect(t.scoreMovement.direction).toBe(WORSENING)
  })
})
