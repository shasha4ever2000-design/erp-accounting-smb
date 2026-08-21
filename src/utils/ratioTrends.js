// Ratios over time.
//
// A current ratio of 1.4 is not a fact about a business, it is a frame from a
// film. Whether it means anything depends entirely on what came before: 1.4
// after 2.1 is a business consuming its buffer, and 1.4 after 0.9 is a
// business climbing out of trouble. The snapshot cannot tell those apart, and
// the snapshot is all this application has offered until now.
//
// ── What this adds that a chart would not ─────────────────────────────
//
// Plotting the numbers is the easy half. The half that changes decisions is
// noticing the things a reader will not: a metric that is still rated healthy
// but has fallen in every period measured, or one that crossed from healthy
// into watch this period after being stable for a year. Those are the two
// shapes worth interrupting somebody for, and they are what `signals` reports.
//
// ── The comparison has to be honest ──────────────────────────────────
//
// Every point is computed the same way at its own date: balance-sheet figures
// cumulative to that date, profit-and-loss figures for the twelve months
// ending there. A trend built by holding the P&L window fixed and only moving
// the balance date would show margins that never move and liquidity that
// swings wildly, which is an artefact of the method rather than anything
// happening in the business.
//
// Periods before the business had any books produce null ratios rather than
// zeroes. A gross margin of 0% in a month with no sales is not a bad month —
// it is not a month at all — and plotting it as a collapse to zero would
// invent a crisis.

const r4 = (n) => (n == null ? null : Math.round(n * 10000) / 10000)

/** Direction a metric moved, given whether higher is healthier. */
export const IMPROVING = 'improving'
export const WORSENING = 'worsening'
export const FLAT = 'flat'

/** How much a value must move before it counts as movement at all. */
export const NOISE = 0.02   // 2% of the earlier value

/** Month-ends going back from `end`, oldest first. */
export function periodEnds(end, count = 6, step = 'month') {
  const at = new Date(end || new Date().toISOString().slice(0, 10))
  if (Number.isNaN(at.getTime())) return []
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    if (step === 'quarter') d.setUTCMonth(d.getUTCMonth() - i * 3)
    else if (step === 'year') d.setUTCFullYear(d.getUTCFullYear() - i)
    else d.setUTCMonth(d.getUTCMonth() - i)
    // The last day of that month, which is what a balance sheet is drawn at.
    const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    out.push(eom.toISOString().slice(0, 10))
  }
  // The final point is the date asked for, not its month-end, so "as at today"
  // means today rather than a month that has not finished.
  out[out.length - 1] = at.toISOString().slice(0, 10)
  return out
}

/**
 * Which way a metric moved, and by how much.
 *
 * `dir` says whether higher is healthier, because the same movement means
 * opposite things for gross margin and for days sales outstanding — and
 * getting that backwards would congratulate a business for taking longer to
 * get paid.
 */
export function movement(from, to, dir = 'high') {
  if (from == null || to == null) return { direction: FLAT, change: null, pct: null, comparable: false }
  const change = r4(to - from)
  const pct = Math.abs(from) > 1e-9 ? r4((to - from) / Math.abs(from)) : null
  const moved = pct == null ? Math.abs(change) > 1e-9 : Math.abs(pct) >= NOISE
  if (!moved) return { direction: FLAT, change, pct, comparable: true }
  const better = dir === 'high' ? change > 0 : change < 0
  return { direction: better ? IMPROVING : WORSENING, change, pct, comparable: true }
}

/** Metrics where a smaller number is the healthier one. */
export const LOWER_IS_BETTER = new Set(['dso', 'dpo', 'de', 'dr'])
const dirFor = (key) => (LOWER_IS_BETTER.has(key) ? 'low' : 'high')

/**
 * Build the series.
 *
 * @param {string[]} dates
 * @param {(asOf: string) => object} inputsAt   figures as at a date
 * @param {(m: object) => object} compute       the ratio engine
 */
export function buildTrends(dates = [], inputsAt, compute) {
  const points = dates.map((d) => {
    const m = inputsAt(d)
    // A period with no trading at all is not a period with zero margins.
    const trading = Math.abs(m.revenue || 0) > 0.005 || Math.abs(m.totalAssets || 0) > 0.005
    return { asOf: d, inputs: m, result: trading ? compute(m) : null, trading }
  })

  const metrics = new Map()
  points.forEach((p, i) => {
    ;(p.result?.groups || []).forEach((g) => g.metrics.forEach((mt) => {
      if (!metrics.has(mt.key)) {
        metrics.set(mt.key, {
          key: mt.key, label: mt.label, group: g.group, isMoney: !!mt.isMoney,
          formula: mt.formula, hint: mt.hint,
          series: dates.map((d) => ({ asOf: d, value: null, rating: 'na', display: '—' })),
        })
      }
      const row = metrics.get(mt.key)
      row.series[i] = { asOf: p.asOf, value: r4(mt.value), rating: mt.rating, display: mt.display }
    }))
  })

  const rows = [...metrics.values()].map((row) => {
    const values = row.series.map((s) => s.value)
    const known = values.filter((v) => v != null)
    const first = known[0] ?? null
    const last = values[values.length - 1] ?? null
    const prev = values.length > 1 ? values[values.length - 2] : null
    const dir = dirFor(row.key)
    return {
      ...row,
      latest: last,
      latestRating: row.series[row.series.length - 1]?.rating || 'na',
      sinceStart: movement(first, last, dir),
      sinceLast: movement(prev, last, dir),
      direction: dir,
      // The shape of the line, not just its endpoints — see `runOf`.
      run: runOf(values, dir),
      min: known.length ? Math.min(...known) : null,
      max: known.length ? Math.max(...known) : null,
    }
  })

  const scores = points.map((p) => ({ asOf: p.asOf, score: p.result?.score ?? null }))
  return {
    dates,
    points,
    rows,
    scores,
    scoreMovement: movement(
      scores.map((s) => s.score).filter((s) => s != null)[0] ?? null,
      scores[scores.length - 1]?.score ?? null,
      'high',
    ),
    signals: signalsFrom(rows),
  }
}

/**
 * How many consecutive periods a metric has been moving one way.
 *
 * A ratio that fell a little every month for six months is a different
 * problem from one that fell once and held. Endpoint comparison cannot tell
 * them apart — both show the same total change — and the first is the one
 * that keeps going if nothing is done.
 */
export function runOf(values = [], dir = 'high') {
  const pts = values.filter((v) => v != null)
  if (pts.length < 3) return { direction: FLAT, periods: 0 }
  let periods = 0
  let direction = null
  for (let i = pts.length - 1; i > 0; i--) {
    const m = movement(pts[i - 1], pts[i], dir)
    if (m.direction === FLAT) break
    if (direction == null) direction = m.direction
    else if (m.direction !== direction) break
    periods++
  }
  return { direction: direction || FLAT, periods }
}

/**
 * The handful of things worth interrupting somebody for.
 *
 * Deliberately few. A page that flags fourteen metrics flags nothing, because
 * the reader stops reading. Only two shapes qualify: a metric that has just
 * changed band, and one that is sliding steadily whether or not it has
 * reached a bad band yet — the second being the one a snapshot can never show
 * and the whole reason this module exists.
 */
export function signalsFrom(rows = []) {
  const out = []
  rows.forEach((row) => {
    const series = row.series.filter((s) => s.rating !== 'na')
    if (series.length >= 2) {
      const now = series[series.length - 1].rating
      const before = series[series.length - 2].rating
      const rank = { good: 2, watch: 1, risk: 0 }
      if (now !== before && rank[now] != null && rank[before] != null) {
        out.push({
          key: row.key, label: row.label, kind: rank[now] < rank[before] ? 'dropped' : 'recovered',
          from: before, to: now, severity: rank[now] < rank[before] ? (now === 'risk' ? 'high' : 'medium') : 'good',
        })
      }
    }
    // Still healthy and sliding is the finding a snapshot cannot produce.
    if (row.run.direction === WORSENING && row.run.periods >= 3) {
      out.push({
        key: row.key, label: row.label, kind: 'sliding', periods: row.run.periods,
        stillHealthy: row.latestRating === 'good',
        severity: row.latestRating === 'good' ? 'medium' : 'high',
      })
    }
  })
  const order = { high: 0, medium: 1, good: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

export const SIGNAL_TEXT = {
  dropped: '{metric} has fallen from {from} to {to} this period.',
  recovered: '{metric} has recovered from {from} to {to} this period.',
  sliding: '{metric} has worsened for {n} periods running.',
  slidingHealthy: '{metric} is still healthy but has worsened for {n} periods running.',
}
