// The audit binder.
//
// At some point a business has to hand its books to somebody else — an
// auditor, a bank, a buyer, a tax authority. Until now that meant printing
// several reports from several screens and hoping the recipient believed
// them, because nothing in the package could be checked against anything.
//
// This assembles one file that answers the three questions such a recipient
// actually asks, in order:
//
//   1. What do the books say?          — trial balance and the position summary
//   2. Do they hang together?          — the integrity checks, in full
//   3. Are they the same books that
//      were posted?                    — the ledger seal
//
// The third is the one no accounting package usually answers, and it is the
// reason this is worth building rather than being a print-all button. The
// seal is a value the recipient can recompute from the data. If it matches
// what the binder claims, nothing in the ledger has moved since the binder
// was made.
//
// ── Why the trial balance rather than a formatted P&L ─────────────────
//
// A grouped income statement is a presentation, and presentation logic lives
// in the reports screen. Rebuilding it here would give the business two
// income statements that could disagree — precisely the failure the notes
// module exists to prevent, reintroduced in the document meant to establish
// trust.
//
// The trial balance has no presentation logic to duplicate: it is every
// account and its balance, which is what an auditor asks for first anyway.
// The position summary sums by account type, the same primitive the
// accounting-equation check uses. Neither can drift from the screen because
// neither is a second implementation of anything.

import { sha256Hex } from './ledgerChain'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const TOL = 0.02

/** Signed natural balance: debits less credits for assets and expenses. */
export const naturalOf = (type, b = { dr: 0, cr: 0 }) => (
  ['asset', 'expense'].includes(type)
    ? r2((b.dr || 0) - (b.cr || 0))
    : r2((b.cr || 0) - (b.dr || 0))
)

// ── Trial balance ──────────────────────────────────────────────────────

/**
 * Every account, its debits, its credits, and where it lands.
 *
 * The auditor's first request, and the one document from which every other
 * statement can be rebuilt. Accounts with no movement and no balance are left
 * out — a chart of accounts is not evidence — but an account that moved and
 * returned to zero is kept, because that movement is exactly what somebody
 * checking the books wants to see.
 */
export function trialBalance(accounts = [], balances = {}) {
  const rows = []
  let totalDr = 0
  let totalCr = 0

  ;(accounts || []).forEach((a) => {
    const b = balances[a.id] || { dr: 0, cr: 0 }
    const dr = r2(b.dr)
    const cr = r2(b.cr)
    if (dr === 0 && cr === 0) return
    const natural = naturalOf(a.type, b)
    rows.push({
      id: a.id, code: a.code || '', name: a.name || '', type: a.type,
      debit: dr, credit: cr, natural,
      // Which column the balance belongs in on a printed trial balance.
      balanceDebit: natural > 0 && ['asset', 'expense'].includes(a.type) ? natural
        : (natural < 0 && !['asset', 'expense'].includes(a.type) ? -natural : 0),
      balanceCredit: natural > 0 && !['asset', 'expense'].includes(a.type) ? natural
        : (natural < 0 && ['asset', 'expense'].includes(a.type) ? -natural : 0),
    })
    totalDr += dr
    totalCr += cr
  })

  rows.sort((x, y) => String(x.code).localeCompare(String(y.code)))
  const difference = r2(totalDr - totalCr)
  return {
    rows,
    totalDebit: r2(totalDr),
    totalCredit: r2(totalCr),
    // Balances are footed separately from movements. On a balanced ledger the
    // two column totals agree, and their agreeing is a second, independent
    // reading of the same property — a ledger can foot on movements while the
    // balances are miscolumned, and this is what would catch that.
    balanceDebitTotal: r2(rows.reduce((s, r) => s + r.balanceDebit, 0)),
    balanceCreditTotal: r2(rows.reduce((s, r) => s + r.balanceCredit, 0)),
    difference,
    // The oldest check in bookkeeping, and still the one that matters most.
    balances: Math.abs(difference) <= TOL,
  }
}

// ── Position summary ───────────────────────────────────────────────────

/**
 * Totals by account type, and whether the accounting equation holds.
 *
 * Deliberately not a formatted balance sheet — see the header. This is the
 * arithmetic underneath one, stated plainly enough that a reader can check it
 * with a calculator.
 */
export function positionSummary(accounts = [], balances = {}) {
  const sum = (t) => r2((accounts || [])
    .filter((a) => a.type === t)
    .reduce((s, a) => s + naturalOf(a.type, balances[a.id]), 0))

  const assets = sum('asset')
  const liabilities = sum('liability')
  const equity = sum('equity')
  const revenue = sum('revenue')
  const expenses = sum('expense')
  const profit = r2(revenue - expenses)
  const difference = r2(assets - (liabilities + equity + profit))

  return {
    assets, liabilities, equity, revenue, expenses, profit,
    difference,
    balances: Math.abs(difference) <= TOL,
  }
}

// ── Audit trail ────────────────────────────────────────────────────────

/**
 * What happened to the books during the period, summarised.
 *
 * A full trail can run to twenty thousand events and nobody reads it. What a
 * reviewer wants is the shape of it plus the handful of events that would
 * change their opinion — so edits to posted entries and anything flagged
 * high-severity are listed individually, and the rest is counted.
 *
 * Edits carrying a `ledgerHash` change are singled out because those are the
 * ones the seal cannot tell you about on its own: the chain was legitimately
 * re-sealed, so it verifies clean, and the only record that the entry ever
 * read differently is here.
 */
export function auditTrailSummary(auditLog = [], { start = '', end = '' } = {}) {
  const inPeriod = (auditLog || []).filter((e) => {
    const d = String(e?.ts || '').slice(0, 10)
    if (start && d < start) return false
    if (end && d > end) return false
    return true
  })

  const byAction = new Map()
  const notable = []
  inPeriod.forEach((e) => {
    byAction.set(e.action, (byAction.get(e.action) || 0) + 1)
    const touchedLedger = (e.changes || []).some((c) => c.field === 'ledgerHash')
    if (touchedLedger || e.severity === 'high') {
      notable.push({
        ts: e.ts, user: e.user || '', action: e.action, detail: e.detail || '',
        ref: e.entityRef || '', changes: e.changes || [], touchedLedger,
      })
    }
  })

  return {
    total: inPeriod.length,
    actions: [...byAction.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count),
    notable: notable.sort((a, b) => String(b.ts).localeCompare(String(a.ts))),
    users: [...new Set(inPeriod.map((e) => e.user).filter(Boolean))],
    // An empty trail over a period with postings would itself be a finding.
    empty: inPeriod.length === 0,
  }
}

// ── The binder ─────────────────────────────────────────────────────────

/** Everything the binder claims, in a fixed order, as the bytes that get hashed. */
export function canonicalBinder(b) {
  const line = (label, value) => `${label}=${value}`
  return [
    'binder-v1',
    line('company', b.company?.name || ''),
    line('start', b.period?.start || ''),
    line('end', b.period?.end || ''),
    line('ledgerAnchor', b.ledger?.anchor?.head || ''),
    line('ledgerCount', b.ledger?.anchor?.count ?? ''),
    line('trialDebit', b.trialBalance?.totalDebit ?? ''),
    line('trialCredit', b.trialBalance?.totalCredit ?? ''),
    line('assets', b.position?.assets ?? ''),
    line('liabilities', b.position?.liabilities ?? ''),
    line('equity', b.position?.equity ?? ''),
    line('profit', b.position?.profit ?? ''),
    line('integrityPassed', b.integrity?.passed ?? ''),
    line('integrityFailed', b.integrity?.failed ?? ''),
    line('notesReconcile', b.notes?.reconciles ?? ''),
    line('generatedAt', b.generatedAt || ''),
  ].join('\n')
}

/**
 * Assemble the binder.
 *
 * `verdict` is the part a reader should look at first, and it is deliberately
 * not a summary of how much is in the binder. It is a judgement on whether
 * the binder can be relied on: the books balance, every integrity check
 * passes, the ledger verifies against its own seal, and the notes tie to the
 * statements. Any one of those failing is stated at the top rather than left
 * for the reader to discover on page four.
 */
export function buildBinder({
  company = {}, period = {}, accounts = [], balances = {}, periodBalances = {},
  integrity = null, notes = null, ledger = null, auditLog = [],
  preparedBy = '', generatedAt = new Date().toISOString(),
} = {}) {
  const tb = trialBalance(accounts, balances)
  const position = positionSummary(accounts, balances)
  const performance = positionSummary(accounts, periodBalances)
  const trail = auditTrailSummary(auditLog, period)

  const findings = []
  if (!tb.balances) findings.push({ code: 'TRIAL_BALANCE_OUT', detail: `Out by ${tb.difference}` })
  if (!position.balances) findings.push({ code: 'EQUATION_OUT', detail: `Out by ${position.difference}` })
  if (integrity && integrity.failed > 0) {
    integrity.checks.filter((c) => !c.ok).forEach((c) => findings.push({ code: 'INTEGRITY_FAILED', detail: c.label }))
  }
  if (ledger?.verify && ledger.verify.ok === false) {
    findings.push({ code: 'LEDGER_ALTERED', detail: `${ledger.verify.broken.length} entr(ies) do not match the seal` })
  }
  if (notes && notes.reconciles === false) {
    findings.push({ code: 'NOTES_DISAGREE', detail: notes.failing.join(', ') })
  }
  // Entries that predate sealing are not a finding — they are a fact about
  // when the feature arrived, and calling them a problem would make every
  // restored backup look like tampering.
  const unsealed = ledger?.verify?.unsealed || 0

  const binder = {
    version: 'binder-v1',
    company, period, preparedBy, generatedAt,
    trialBalance: tb,
    position,
    performance,
    integrity,
    notes,
    ledger,
    auditTrail: trail,
    unsealed,
    findings,
    verdict: findings.length === 0 ? 'clean' : 'qualified',
  }
  binder.hash = sha256Hex(canonicalBinder(binder))
  return binder
}

/** Recompute a binder's own hash and compare it to the one it carries. */
export function verifyBinder(binder) {
  if (!binder?.hash) return { ok: false, reason: 'NO_HASH' }
  const expected = sha256Hex(canonicalBinder(binder))
  return expected === binder.hash ? { ok: true } : { ok: false, reason: 'ALTERED', expected, found: binder.hash }
}
