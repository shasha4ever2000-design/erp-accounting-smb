// Budget vs actual alerting.
//
// Deliberately pace-aware: a naive "you're at 60% of budget" warning fires all
// year and gets ignored. What actually matters is spending *faster than the
// year is elapsing* — being 60% through an annual budget is fine in August and
// alarming in February. So every comparison is against how far into the budget
// period we are, and alerts carry a severity so the UI can stay quiet until
// something genuinely needs attention.
//
// Pure over plain data (actuals are injected) so it is unit-testable.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const pct = (part, whole) => (whole ? (part / whole) * 100 : 0)

/** How far through a calendar year `asOf` falls, 0–100. */
export function elapsedPercent(year, asOf = new Date()) {
  const start = new Date(`${year}-01-01T00:00:00Z`).getTime()
  const end = new Date(`${Number(year) + 1}-01-01T00:00:00Z`).getTime()
  const now = (asOf instanceof Date ? asOf : new Date(asOf)).getTime()
  if (now <= start) return 0
  if (now >= end) return 100
  return ((now - start) / (end - start)) * 100
}

/**
 * Build budget alerts for a year.
 * @param accounts   chart of accounts
 * @param budgets    [{ accountId, year, amount }]
 * @param getActual  (accountId) => actual amount for the year (natural sign)
 * @param year       'YYYY'
 * @param asOf       Date used for pacing (defaults to now)
 * @param tolerance  percentage points of drift allowed before warning
 * @returns [{ id, accountId, name, type, budget, actual, pct, elapsed, severity, message }]
 *          severity: 'over' | 'warn' | 'behind'   (healthy lines are omitted)
 */
export function budgetAlerts({ accounts, budgets, getActual, year, asOf = new Date(), tolerance = 10 }) {
  const elapsed = elapsedPercent(year, asOf)
  const accById = Object.fromEntries((accounts || []).map((a) => [a.id, a]))
  const out = []

  ;(budgets || []).forEach((b) => {
    if (String(b.year) !== String(year)) return
    const amount = Number(b.amount) || 0
    if (amount <= 0) return
    const acc = accById[b.accountId]
    if (!acc) return

    const actual = r2(getActual(b.accountId))
    const used = pct(actual, amount)
    const base = { id: b.accountId, accountId: b.accountId, name: acc.name, code: acc.code, type: acc.type, budget: r2(amount), actual, pct: r2(used), elapsed: r2(elapsed) }

    if (acc.type === 'expense') {
      if (used >= 100) {
        out.push({ ...base, severity: 'over', message: `Over budget by ${r2(actual - amount)}` })
      } else if (used > elapsed + tolerance) {
        // Spending ahead of the calendar — flag before the budget is blown.
        out.push({ ...base, severity: 'warn', message: `${r2(used)}% spent, ${r2(elapsed)}% through the year` })
      }
    } else if (acc.type === 'revenue') {
      // Only meaningful once enough of the year has passed to judge.
      if (elapsed > 15 && used < elapsed - tolerance) {
        out.push({ ...base, severity: 'behind', message: `${r2(used)}% of target, ${r2(elapsed)}% through the year` })
      }
    }
  })

  // Most urgent first: blown budgets, then pace warnings, then revenue shortfalls.
  const rank = { over: 0, warn: 1, behind: 2 }
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.pct - a.pct))
}

/** Compact summary for a dashboard badge. */
export function alertSummary(alerts) {
  return {
    total: alerts.length,
    over: alerts.filter((a) => a.severity === 'over').length,
    warn: alerts.filter((a) => a.severity === 'warn').length,
    behind: alerts.filter((a) => a.severity === 'behind').length,
  }
}
