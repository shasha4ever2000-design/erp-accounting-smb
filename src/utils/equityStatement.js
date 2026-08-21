// Statement of Changes in Equity.
//
// One of the primary statements IAS 1 requires, alongside the balance sheet,
// the income statement and the cash flow statement. It is the only one that
// explains *why* equity moved: a balance sheet shows capital at two dates and
// leaves the reader to guess whether the difference was profit, an injection,
// or the owner drawing money out. Those are three completely different stories
// about a business.
//
// This app computes retained earnings rather than posting them (see
// utils/yearClose.js — closing a year never writes a closing journal, profit
// simply rolls into equity on the balance sheet). That has a direct
// consequence for this statement and is the thing most likely to be got wrong:
//
//   - Retained earnings has no ledger movements of its own to report. Its
//     opening balance is every prior period's profit, its movement for the
//     period *is* the period's profit, and its closing balance is the two
//     added together. Reading its journal lines instead would show nothing at
//     all and the statement would not reconcile.
//
//   - Every other equity account is the opposite: it moves only when somebody
//     posts to it, so its movement comes straight from the ledger.
//
// The statement is only trustworthy if it ties to the balance sheet, so
// `reconciles` is computed and surfaced rather than assumed.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Natural balance of an account: equity and liabilities are credit-natured. */
const natural = (account, bal) => {
  const b = bal || { dr: 0, cr: 0 }
  return ['asset', 'expense'].includes(account.type) ? b.dr - b.cr : b.cr - b.dr
}

/**
 * How each equity movement should be described.
 *
 * Journal entry types carry the intent that the amount alone cannot: 5,000
 * leaving the capital account is an owner's drawing, not a loss, and a reader
 * who cannot tell the two apart has learned nothing from the statement.
 */
export const MOVEMENT_LABELS = {
  capital_intro: 'Capital introduced',
  drawings: 'Drawings',
  dividend: 'Dividends declared',
  opening_balance: 'Opening balance adjustment',
  manual: 'Other movements',
}

/** A readable description for a movement, falling back to the raw type. */
export function movementLabel(type) {
  return MOVEMENT_LABELS[type] || MOVEMENT_LABELS.manual
}

/**
 * Profit for a period, from the revenue and expense accounts.
 *
 * Deliberately recomputed here rather than taken from a caller: the retained
 * earnings line depends on it, and a statement whose profit figure disagrees
 * with its own income statement is worse than no statement.
 */
export function profitFor(accounts = [], balances = {}) {
  const revenue = accounts.filter((a) => a.type === 'revenue')
    .reduce((s, a) => s + natural(a, balances[a.id]), 0)
  const expense = accounts.filter((a) => a.type === 'expense')
    .reduce((s, a) => s + natural(a, balances[a.id]), 0)
  return r2(revenue - expense)
}

/**
 * Build the statement.
 *
 * @param {object} data
 * @param {object[]} data.accounts
 * @param {object[]} data.journalEntries
 * @param {function} data.balancesFor  (start, end) => { [accountId]: {dr, cr} }
 *   The store's getAllBalances. Called for the period and for everything up to
 *   the day before it starts.
 * @param {object} opts  { start, end, retainedEarningsId }
 */
export function buildEquityStatement(data = {}, opts = {}) {
  const { accounts = [], journalEntries = [], balancesFor } = data
  const { start, end, retainedEarningsId = 'acc-retained' } = opts
  if (typeof balancesFor !== 'function') throw new Error('buildEquityStatement needs balancesFor')

  const dayBefore = start
    ? new Date(new Date(`${start}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
    : null

  const priorBalances = balancesFor(undefined, dayBefore || undefined)
  const periodBalances = balancesFor(start, end)
  const closingBalances = balancesFor(undefined, end)

  const equityAccounts = accounts.filter((a) => a.type === 'equity')
  const profit = profitFor(accounts, periodBalances)
  const priorProfit = profitFor(accounts, priorBalances)

  // Movements on each equity account, grouped by what caused them. Retained
  // earnings is excluded: it has no postings of its own under this model.
  const movementsByAccount = new Map()
  journalEntries.forEach((je) => {
    if (!je?.date) return
    if (start && je.date < start) return
    if (end && je.date > end) return
    ;(je.lines || []).forEach((l) => {
      const acc = equityAccounts.find((a) => a.id === l.accountId)
      if (!acc || acc.id === retainedEarningsId) return
      const delta = r2((Number(l.credit) || 0) - (Number(l.debit) || 0))
      if (!delta) return
      const key = acc.id
      const bucket = movementsByAccount.get(key) || new Map()
      const label = movementLabel(je.type)
      bucket.set(label, r2((bucket.get(label) || 0) + delta))
      movementsByAccount.set(key, bucket)
    })
  })

  const rows = equityAccounts.map((acc) => {
    const isRetained = acc.id === retainedEarningsId
    // Retained earnings is computed, so its opening is accumulated prior
    // profit and its only movement is this period's result.
    const opening = isRetained
      ? r2(natural(acc, priorBalances[acc.id]) + priorProfit)
      : r2(natural(acc, priorBalances[acc.id]))
    const movements = isRetained
      ? [{ label: 'Profit for the period', amount: profit }]
      : [...(movementsByAccount.get(acc.id) || new Map())].map(([label, amount]) => ({ label, amount }))
    const movementTotal = r2(movements.reduce((s, m) => s + m.amount, 0))
    return {
      id: acc.id, code: acc.code, name: acc.name, isRetained,
      opening, movements, movementTotal, closing: r2(opening + movementTotal),
    }
  })

  const totals = {
    opening: r2(rows.reduce((s, r) => s + r.opening, 0)),
    movement: r2(rows.reduce((s, r) => s + r.movementTotal, 0)),
    closing: r2(rows.reduce((s, r) => s + r.closing, 0)),
  }

  // What the balance sheet says equity is at the same date, by the accounting
  // identity. If the statement disagrees with that, it is wrong — so it is
  // checked rather than presented on trust.
  const assets = accounts.filter((a) => a.type === 'asset')
    .reduce((s, a) => s + natural(a, closingBalances[a.id]), 0)
  const liabilities = accounts.filter((a) => a.type === 'liability')
    .reduce((s, a) => s + natural(a, closingBalances[a.id]), 0)
  const balanceSheetEquity = r2(assets - liabilities)

  return {
    start, end, rows, totals,
    profit,
    balanceSheetEquity,
    difference: r2(totals.closing - balanceSheetEquity),
    reconciles: Math.abs(r2(totals.closing - balanceSheetEquity)) < 0.01,
  }
}

/** Every distinct movement description in the statement, for column headers. */
export function movementColumns(statement) {
  const seen = []
  ;(statement?.rows || []).forEach((r) => r.movements.forEach((m) => {
    if (!seen.includes(m.label)) seen.push(m.label)
  }))
  return seen
}
