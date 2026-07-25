// Data-integrity self-check: runs the same invariants the test suite asserts,
// but against the user's live books, on demand. Pure over plain data so it is
// unit-testable and can never mutate anything it inspects.
//
// Every check returns { id, label, ok, detail, items } where `items` lists the
// specific offending records so a failure is actionable rather than just a red
// light. A clean result is the app's strongest trust signal: the books provably
// obey double-entry.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const TOL = 0.02 // currency rounding tolerance

/** Every journal entry's debits must equal its credits. */
function checkEntriesBalance(journalEntries) {
  const bad = []
  ;(journalEntries || []).forEach((je) => {
    const dr = (je.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const cr = (je.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0)
    if (Math.abs(dr - cr) > TOL) bad.push({ ref: je.number || je.id, date: je.date, detail: `Dr ${r2(dr)} vs Cr ${r2(cr)}` })
  })
  return {
    id: 'entries-balance',
    label: 'Every journal entry balances',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `${(journalEntries || []).length} entries checked` : `${bad.length} unbalanced`,
    items: bad,
  }
}

/** Across the whole ledger, total debits must equal total credits. */
function checkLedgerNetsZero(journalEntries) {
  let dr = 0, cr = 0
  ;(journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => { dr += Number(l.debit) || 0; cr += Number(l.credit) || 0 }))
  const diff = r2(dr - cr)
  return {
    id: 'ledger-nets-zero',
    label: 'Trial balance nets to zero',
    ok: Math.abs(diff) <= TOL,
    detail: Math.abs(diff) <= TOL ? `Dr = Cr = ${r2(dr)}` : `Out by ${diff}`,
    items: [],
  }
}

/** Assets = Liabilities + Equity + Net Income. */
function checkAccountingEquation(accounts, journalEntries) {
  const bal = {}
  ;(journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
    const b = bal[l.accountId] || (bal[l.accountId] = { dr: 0, cr: 0 })
    b.dr += Number(l.debit) || 0; b.cr += Number(l.credit) || 0
  }))
  const natural = (a) => {
    const b = bal[a.id] || { dr: 0, cr: 0 }
    return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
  }
  const sumType = (t) => (accounts || []).filter((a) => a.type === t).reduce((s, a) => s + natural(a), 0)
  const A = sumType('asset'), L = sumType('liability'), E = sumType('equity')
  const NI = sumType('revenue') - sumType('expense')
  const diff = r2(A - (L + E + NI))
  return {
    id: 'accounting-equation',
    label: 'Balance sheet equation holds (A = L + E + P/L)',
    ok: Math.abs(diff) <= TOL,
    detail: Math.abs(diff) <= TOL
      ? `Assets ${r2(A)} = L+E+P/L ${r2(L + E + NI)}`
      : `Out by ${diff} — Assets ${r2(A)} vs ${r2(L + E + NI)}`,
    items: [],
  }
}

/** Every posted line must reference an account that still exists. */
function checkNoOrphanAccounts(accounts, journalEntries) {
  const ids = new Set((accounts || []).map((a) => a.id))
  const bad = []
  ;(journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
    if (!ids.has(l.accountId)) bad.push({ ref: je.number || je.id, date: je.date, detail: `Missing account ${l.accountId}` })
  }))
  return {
    id: 'no-orphan-accounts',
    label: 'No entries reference a deleted account',
    ok: bad.length === 0,
    detail: bad.length === 0 ? 'All account references valid' : `${bad.length} orphaned line(s)`,
    items: bad,
  }
}

/** Account codes must be unique — duplicates break report grouping. */
function checkUniqueAccountCodes(accounts) {
  const seen = {}, dup = new Set()
  ;(accounts || []).forEach((a) => { if (a.code) { if (seen[a.code]) dup.add(a.code); seen[a.code] = 1 } })
  const items = [...dup].map((code) => ({ ref: code, detail: 'Duplicate account code' }))
  return {
    id: 'unique-account-codes',
    label: 'Account codes are unique',
    ok: items.length === 0,
    detail: items.length === 0 ? `${(accounts || []).length} accounts` : `${items.length} duplicate code(s)`,
    items,
  }
}

/** No amount anywhere should be NaN / Infinity. */
function checkNoBadNumbers(journalEntries) {
  // Inspect the raw value: `Number(NaN) || 0` silently yields 0 (NaN is falsy),
  // so coercing first would hide exactly the corruption this check exists for.
  const corrupt = (v) => {
    if (v === null || v === undefined || v === '') return false // absent = zero, fine
    return !isFinite(Number(v))
  }
  const bad = []
  ;(journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
    if (corrupt(l.debit) || corrupt(l.credit)) bad.push({ ref: je.number || je.id, date: je.date, detail: 'Non-numeric amount' })
  }))
  return {
    id: 'no-bad-numbers',
    label: 'No corrupted amounts',
    ok: bad.length === 0,
    detail: bad.length === 0 ? 'All amounts numeric' : `${bad.length} bad amount(s)`,
    items: bad,
  }
}

/** Stock on hand should never be negative (indicates over-issue). */
function checkNoNegativeStock(inventoryItems) {
  const bad = (inventoryItems || [])
    .filter((i) => (Number(i.quantity) || 0) < 0)
    .map((i) => ({ ref: i.code || i.name, detail: `On hand ${r2(i.quantity)}` }))
  return {
    id: 'no-negative-stock',
    label: 'No item has negative stock',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `${(inventoryItems || []).length} items` : `${bad.length} item(s) below zero`,
    items: bad,
  }
}

/** A document's recorded payments should never exceed its total. */
function checkNoOverpayments(invoices, purchases) {
  const bad = []
  ;(invoices || []).forEach((i) => {
    if (i.status === 'void' || i.status === 'cancelled') return
    if ((Number(i.amountPaid) || 0) - (Number(i.total) || 0) > TOL) {
      bad.push({ ref: i.number, detail: `Paid ${r2(i.amountPaid)} of ${r2(i.total)}` })
    }
  })
  ;(purchases || []).forEach((p) => {
    if (p.status === 'void' || p.status === 'cancelled') return
    if ((Number(p.amountPaid) || 0) - (Number(p.total) || 0) > TOL) {
      bad.push({ ref: p.number, detail: `Paid ${r2(p.amountPaid)} of ${r2(p.total)}` })
    }
  })
  return {
    id: 'no-overpayments',
    label: 'No document is paid more than its total',
    ok: bad.length === 0,
    detail: bad.length === 0 ? 'Payments within document totals' : `${bad.length} overpaid document(s)`,
    items: bad,
  }
}

/** Entries must not sit inside a closed (locked) period. */
function checkLockRespected(journalEntries, lockDate) {
  if (!lockDate) return { id: 'lock-respected', label: 'Closed periods contain no later edits', ok: true, detail: 'No period is locked', items: [] }
  const bad = (journalEntries || [])
    .filter((je) => je.date && je.date <= lockDate && je.createdAt && je.createdAt.slice(0, 10) > lockDate)
    .map((je) => ({ ref: je.number || je.id, date: je.date, detail: `Posted ${je.createdAt.slice(0, 10)} into locked period` }))
  return {
    id: 'lock-respected',
    label: 'Closed periods contain no later edits',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `Locked through ${lockDate}` : `${bad.length} entry(s) posted after lock`,
    items: bad,
  }
}

/**
 * A leftover balance in Opening Balance Equity means the migration never
 * balanced: the difference was parked there rather than allocated to real
 * capital, loans or assets. It is silent until someone reads the balance
 * sheet and finds an account no accountant recognises, so the check surfaces
 * it early.
 */
function checkOpeningBalanceEquityCleared(journalEntries, settings) {
  const label = 'Opening Balance Equity has been cleared'
  if (!settings?.opening?.posted)
    return { id: 'obe-cleared', label, ok: true, detail: 'No opening balances posted', items: [] }

  let net = 0
  ;(journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
    if (l.accountId === 'acc-obe') net += (+l.credit || 0) - (+l.debit || 0)
  }))
  net = Math.round(net * 100) / 100
  const ok = Math.abs(net) < 0.01
  return {
    id: 'obe-cleared',
    label,
    ok,
    detail: ok
      ? 'Nothing left unallocated'
      : `${Math.abs(net).toFixed(2)} still sits in Opening Balance Equity`,
    items: ok ? [] : [{
      ref: 'acc-obe',
      detail: net > 0
        ? 'Assets exceeded the capital and liabilities you entered — post the missing capital or loans.'
        : 'Liabilities exceeded the assets you entered — post the missing assets.',
    }],
  }
}

/**
 * Run every check against a store snapshot.
 * @returns { ok, passed, failed, checks[], ranAt }
 */
export function runIntegrityCheck(state) {
  const { accounts, journalEntries, inventoryItems, invoices, purchases, settings } = state || {}
  const checks = [
    checkEntriesBalance(journalEntries),
    checkLedgerNetsZero(journalEntries),
    checkAccountingEquation(accounts, journalEntries),
    checkNoOrphanAccounts(accounts, journalEntries),
    checkUniqueAccountCodes(accounts),
    checkNoBadNumbers(journalEntries),
    checkNoNegativeStock(inventoryItems),
    checkNoOverpayments(invoices, purchases),
    checkLockRespected(journalEntries, settings?.accounting?.lockDate),
    checkOpeningBalanceEquityCleared(journalEntries, settings),
  ]
  const failed = checks.filter((c) => !c.ok).length
  return { ok: failed === 0, passed: checks.length - failed, failed, checks, ranAt: new Date().toISOString() }
}
