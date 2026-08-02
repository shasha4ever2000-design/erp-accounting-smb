// IFRS 9 expected credit losses on trade receivables.
//
// The standard replaced the old "incurred loss" model — wait until a customer
// actually defaults, then write the debt off — with a forward-looking one: a
// receivable carries an expected loss from the day it is raised, because some
// proportion of any book never gets collected. For trade receivables IFRS 9
// permits the *simplified approach* (IFRS 9.5.5.15), which is what this
// implements: no staging, no significant-increase-in-credit-risk assessment,
// just lifetime expected losses estimated from a provision matrix.
//
// A provision matrix is a loss rate per ageing bucket, derived from the
// entity's own history of what it eventually collected. The rates here are a
// starting point, not a recommendation — an entity is required to use its own
// observed default experience, adjusted for forward-looking information, and
// nothing in this file can know that. They are settings for exactly that
// reason.
//
// The one thing this gets right that a naive implementation gets wrong: the
// allowance is a *balance*, not an expense. Each assessment posts the movement
// between what is already provided and what is now required — posting the full
// requirement every time would pile provision on provision until the
// receivables book was worth nothing.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Ageing buckets, in the order they appear on the aged receivables report. */
export const BUCKETS = [
  { key: 'current', label: 'Not yet due', maxDays: 0 },
  { key: 'days30',  label: '1 – 30 days', maxDays: 30 },
  { key: 'days60',  label: '31 – 60 days', maxDays: 60 },
  { key: 'days90',  label: '61 – 90 days', maxDays: 90 },
  { key: 'over90',  label: 'Over 90 days', maxDays: Infinity },
]

/**
 * A conservative starting matrix, in percent.
 *
 * Deliberately not zero for the current bucket: the whole point of IFRS 9 is
 * that even a receivable that is not yet due carries some expected loss. An
 * entity that sets this to zero has effectively opted back into the incurred
 * loss model the standard replaced.
 */
export const DEFAULT_MATRIX = { current: 0.5, days30: 2, days60: 5, days90: 10, over90: 25 }

/** Which bucket a number of days overdue falls into. */
export function bucketFor(daysOverdue) {
  const d = Number(daysOverdue) || 0
  if (d <= 0) return 'current'
  if (d <= 30) return 'days30'
  if (d <= 60) return 'days60'
  if (d <= 90) return 'days90'
  return 'over90'
}

const daysBetween = (from, to) =>
  Math.floor((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000)

/**
 * Age the open receivables as at a date.
 *
 * Only what is actually outstanding is aged. A void invoice is not a
 * receivable, and an overpaid one is a liability rather than an asset — it
 * must not net against another customer's debt and quietly reduce the
 * allowance the book needs.
 */
export function ageReceivables(invoices = [], { asOf, customers = [] } = {}) {
  const at = asOf || new Date().toISOString().slice(0, 10)
  const byCustomer = new Map()
  const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]))

  invoices.forEach((inv) => {
    if (!inv || inv.status === 'void' || inv.isOpening) return
    if (!['sent', 'partial'].includes(inv.status)) return
    if (inv.date && inv.date > at) return                    // not yet raised at this date
    const open = r2((Number(inv.total) || 0) - (Number(inv.amountPaid) || 0))
    if (open <= 0) return                                    // settled or overpaid

    const bucket = bucketFor(daysBetween(inv.dueDate || inv.date, at))
    totals[bucket] = r2(totals[bucket] + open)

    const key = inv.customerId || '—'
    const row = byCustomer.get(key) || {
      customerId: key,
      customerName: inv.customerName || customers.find((c) => c.id === key)?.name || 'Unknown customer',
      total: 0,
      ...Object.fromEntries(BUCKETS.map((b) => [b.key, 0])),
    }
    row[bucket] = r2(row[bucket] + open)
    row.total = r2(row.total + open)
    byCustomer.set(key, row)
  })

  return {
    asOf: at,
    totals,
    grandTotal: r2(Object.values(totals).reduce((s, v) => s + v, 0)),
    customers: [...byCustomer.values()].sort((a, b) => b.total - a.total),
  }
}

/** Normalise a matrix, filling any missing bucket from the default. */
export function normaliseMatrix(matrix = {}) {
  const out = {}
  BUCKETS.forEach((b) => {
    const v = Number(matrix[b.key])
    out[b.key] = Number.isFinite(v) && v >= 0 ? Math.min(v, 100) : DEFAULT_MATRIX[b.key]
  })
  return out
}

/**
 * The allowance the book requires, bucket by bucket.
 *
 * @returns {{ rows, total, matrix }} `rows` carries the exposure, rate and
 *   loss for each bucket so the provision can be shown as a working, not
 *   just a number somebody has to take on trust.
 */
export function computeEcl(aged, matrix = DEFAULT_MATRIX) {
  const m = normaliseMatrix(matrix)
  const rows = BUCKETS.map((b) => {
    const exposure = r2(aged?.totals?.[b.key] || 0)
    const rate = m[b.key]
    return { key: b.key, label: b.label, exposure, rate, loss: r2(exposure * (rate / 100)) }
  })
  return { rows, total: r2(rows.reduce((s, r) => s + r.loss, 0)), matrix: m }
}

/** Expected loss for one customer, using the same matrix. */
export function customerEcl(customerRow, matrix = DEFAULT_MATRIX) {
  const m = normaliseMatrix(matrix)
  return r2(BUCKETS.reduce((s, b) => s + (Number(customerRow?.[b.key]) || 0) * (m[b.key] / 100), 0))
}

/**
 * The movement to post: what is required now, less what is already provided.
 *
 * Positive means an extra charge, negative a release back to profit. This is
 * the whole reason the function exists — posting `required` directly each
 * period would compound the allowance until receivables were carried at
 * nothing, and the entries would balance the whole way down.
 */
export function eclMovement(required, existingAllowance) {
  const req = r2(required)
  const have = r2(Math.abs(Number(existingAllowance) || 0))
  return { required: req, existing: have, movement: r2(req - have) }
}

/**
 * Journal lines adjusting the allowance to the required level.
 *
 * Returns an empty array when nothing has changed — an entry for zero is
 * noise in the ledger and makes a genuine assessment harder to find.
 */
export function provisionLines(movement, accounts = {}) {
  const delta = r2(movement)
  if (delta === 0) return []
  const allowance = accounts.allowanceAccountId || 'acc-ecl'
  const expense = accounts.expenseAccountId || 'acc-baddebt'
  return delta > 0
    // More loss expected: charge it, and build the allowance against AR.
    ? [
        { accountId: expense, debit: delta, credit: 0, description: 'Expected credit loss' },
        { accountId: allowance, debit: 0, credit: delta, description: 'Allowance for expected credit losses' },
      ]
    // Collections improved: release the excess back to profit.
    : [
        { accountId: allowance, debit: -delta, credit: 0, description: 'Allowance released' },
        { accountId: expense, debit: 0, credit: -delta, description: 'Expected credit loss released' },
      ]
}
