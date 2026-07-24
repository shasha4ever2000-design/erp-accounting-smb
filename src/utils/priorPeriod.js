// Prior-period comparison windows for reports.
//
// Two bases, because they answer different questions:
//   'previous' — the same-length window immediately before (is this month
//                better than last month?)
//   'lastYear' — the same calendar window one year earlier (is this Ramadan
//                better than last Ramadan?), which is the honest comparison
//                for any seasonal business.
//
// Pure date arithmetic, unit-testable, UTC throughout so a user's timezone
// can never shift a period boundary onto the wrong day.

const toUTC = (iso) => new Date(`${iso}T00:00:00Z`)
const fmt = (d) => d.toISOString().slice(0, 10)
const DAY = 86400000

/** Inclusive day count of a period. */
export function periodDays(start, end) {
  return Math.round((toUTC(end) - toUTC(start)) / DAY) + 1
}

/**
 * @param basis 'previous' | 'lastYear'
 * @returns { start, end } for the comparison window
 */
export function priorPeriod(start, end, basis = 'previous') {
  if (!start || !end) return { start, end }

  if (basis === 'lastYear') {
    const shift = (iso) => {
      const d = toUTC(iso)
      const day = d.getUTCDate()
      d.setUTCFullYear(d.getUTCFullYear() - 1)
      // Feb 29 has no counterpart in a common year — clamp to Feb 28 rather
      // than letting it roll over into March.
      if (d.getUTCDate() !== day) d.setUTCDate(0)
      return fmt(d)
    }
    return { start: shift(start), end: shift(end) }
  }

  // 'previous': the same-length window ending the day before `start`.
  const days = periodDays(start, end)
  const prevEnd = new Date(toUTC(start).getTime() - DAY)
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY)
  return { start: fmt(prevStart), end: fmt(prevEnd) }
}

/** Percentage change, guarding the divide-by-zero the naive version hits. */
export function variancePct(current, prior) {
  const c = Number(current) || 0
  const p = Number(prior) || 0
  if (p === 0) return c === 0 ? 0 : null   // null = "no meaningful %" (from nothing)
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10
}

/**
 * Whether a variance should read as good or bad depends on the account:
 * more revenue, assets or equity is good; more expense or liability is not.
 */
const FAVOURABLE_WHEN_UP = new Set(['revenue', 'asset', 'equity'])

export function varianceTone(delta, accountType) {
  if (Math.abs(delta) < 0.005) return 'flat'
  return (delta > 0) === FAVOURABLE_WHEN_UP.has(accountType) ? 'good' : 'bad'
}
