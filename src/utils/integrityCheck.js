import { totalReceivable, totalPayable } from './partyBalance'
import { verifyChain, shortHash } from './ledgerChain'
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
 * The capital subledger must equal its control account.
 *
 * The store refuses to post an unattributed capital line, so a break can only
 * arrive through imported or hand-edited data. It is still worth checking: the
 * balance sheet would go on balancing while the capital accounts report quietly
 * disagreed with it, and that is exactly the kind of error nobody notices until
 * a partner queries their own balance.
 */
function checkCapitalSubledgerAgrees(journalEntries, capitalAccounts) {
  const label = 'Capital accounts agree with the ledger'
  if (!(capitalAccounts || []).length)
    return { id: 'capital-subledger', label, ok: true, detail: 'No capital accounts in use', items: [] }

  const known = new Set(capitalAccounts.map((a) => a.id))
  let control = 0
  let attributed = 0
  const strays = []

  ;(journalEntries || []).forEach((je) => {
    if (je?.void) return
    ;(je.lines || []).forEach((l) => {
      if (l?.accountId !== 'acc-capital-ctl') return
      const amount = (+l.credit || 0) - (+l.debit || 0)
      control += amount
      if (l.capitalAccountId && known.has(l.capitalAccountId)) attributed += amount
      else strays.push({
        ref: je.number || je.id,
        detail: `${Math.abs(amount).toFixed(2)} names no valid capital account`,
      })
    })
  })

  const difference = Math.round((control - attributed) * 100) / 100
  const ok = Math.abs(difference) < 0.01
  return {
    id: 'capital-subledger',
    label,
    ok,
    detail: ok
      ? 'Every capital movement is attributed'
      : `${Math.abs(difference).toFixed(2)} on the control account belongs to no capital account`,
    items: ok ? [] : strays.slice(0, 20),
  }
}

/**
 * The stock on the shelf must be worth what the inventory accounts say.
 *
 * This is the inventory control-account reconciliation, and it is the check
 * that catches a whole family of quiet failures: stock moved without a journal
 * entry, an entry posted without moving stock, goods relieved at a stale
 * standard cost, or a build crediting an account the stock was never carried
 * in. None of those unbalance a journal entry, so every other check here passes
 * while the balance sheet slowly stops describing the warehouse.
 *
 * Each item is compared against the account it is actually carried in, so an
 * item routed to Raw Materials is not netted off against one in Inventory —
 * two errors in opposite directions must not cancel out and look like health.
 */
function checkInventoryAgreesWithLedger(journalEntries, inventoryItems, accounts) {
  const label = 'Stock on hand agrees with the inventory accounts'
  const tracked = (inventoryItems || []).filter((i) => i.type !== 'service' && !i.isKit)
  if (!tracked.length)
    return { id: 'inventory-subledger', label, ok: true, detail: 'No stock items', items: [] }

  // What the shelf is worth, per inventory account.
  const shelf = {}
  tracked.forEach((i) => {
    const acc = i.inventoryAccountId || 'acc-inv'
    shelf[acc] = (shelf[acc] || 0) + (Number(i.quantity) || 0) * (Number(i.costPrice) || 0)
  })
  // What the ledger says those accounts hold.
  const ledger = {}
  ;(journalEntries || []).forEach((je) => {
    if (je?.void) return
    ;(je.lines || []).forEach((l) => {
      if (!(l?.accountId in shelf)) return
      ledger[l.accountId] = (ledger[l.accountId] || 0) + (+l.debit || 0) - (+l.credit || 0)
    })
  })

  const nameOf = (id) => (accounts || []).find((a) => a.id === id)?.name || id
  // Much the commonest cause of stock exceeding the ledger is an opening
  // quantity typed straight onto the item, which puts goods on the shelf
  // without ever posting their value. Saying so turns a red light into an
  // instruction, rather than leaving someone to guess what went wrong.
  const unbooked = tracked.filter((i) => (Number(i.quantity) || 0) > 0 && !(i.costLayers || []).length)
  const hint = unbooked.length
    ? ` — likely the opening quantity on ${unbooked.slice(0, 3).map((i) => i.code || i.name).join(', ')}${unbooked.length > 3 ? ` and ${unbooked.length - 3} more` : ''}, which was never journalled. Post it through Opening Balances so the value reaches the balance sheet.`
    : ''

  const items = []
  Object.keys(shelf).forEach((acc) => {
    const drift = r2((ledger[acc] || 0) - shelf[acc])
    if (Math.abs(drift) < 0.01) return
    items.push({
      ref: nameOf(acc),
      detail: drift > 0
        ? `Ledger holds ${drift.toFixed(2)} more than the stock is worth`
        : `Stock is worth ${Math.abs(drift).toFixed(2)} more than the ledger holds${hint}`,
    })
  })

  return {
    id: 'inventory-subledger',
    label,
    ok: items.length === 0,
    detail: items.length === 0
      ? `${tracked.length} item(s) reconcile`
      : `${items.length} inventory account(s) disagree with the shelf`,
    items,
  }
}

/**
 * Accounts Receivable and Accounts Payable must equal their subledgers.
 *
 * These are the two accounts an accountant reconciles first and the two this
 * check list was missing. A break means the customer or supplier list disagrees
 * with the balance sheet — every entry still balances, so nothing else here
 * notices, while the aged debt report and the accounts quietly tell different
 * stories.
 */
function checkPartySubledgers(journalEntries, invoices, creditNotes, purchases, debitNotes, customers, suppliers) {
  const items = []
  const ledgerOf = (accId, sign) => {
    let n = 0
    ;(journalEntries || []).forEach((je) => {
      if (je?.void) return
      ;(je.lines || []).forEach((l) => { if (l?.accountId === accId) n += (+l.debit || 0) - (+l.credit || 0) })
    })
    return r2(n * sign)
  }

  // Only the parties still on the default control account are compared here;
  // one moved to a control account of its own is that account's business.
  const onDefault = (list, id) => !(list || []).find((x) => x.id === id)?.controlAccountId
  const ar = ledgerOf('acc-ar', 1)
  const arSub = totalReceivable({
    invoices: (invoices || []).filter((i) => onDefault(customers, i.customerId)),
    creditNotes: (creditNotes || []).filter((c) => onDefault(customers, c.customerId)),
  })
  if (Math.abs(r2(ar - arSub)) >= 0.01) {
    items.push({ ref: 'Accounts Receivable', detail: `Ledger ${ar.toFixed(2)} vs customers ${arSub.toFixed(2)} — ${Math.abs(r2(ar - arSub)).toFixed(2)} apart` })
  }

  const ap = ledgerOf('acc-ap', -1)
  const apSub = totalPayable({
    purchases: (purchases || []).filter((p) => onDefault(suppliers, p.supplierId)),
    debitNotes: (debitNotes || []).filter((d) => onDefault(suppliers, d.supplierId)),
  })
  if (Math.abs(r2(ap - apSub)) >= 0.01) {
    items.push({ ref: 'Accounts Payable', detail: `Ledger ${ap.toFixed(2)} vs suppliers ${apSub.toFixed(2)} — ${Math.abs(r2(ap - apSub)).toFixed(2)} apart` })
  }

  return {
    id: 'party-subledgers',
    label: 'Customer and supplier balances agree with the ledger',
    ok: items.length === 0,
    detail: items.length === 0
      ? `AR ${ar.toFixed(2)} · AP ${ap.toFixed(2)}`
      : `${items.length} control account(s) disagree with their subledger`,
    items,
  }
}

/**
 * The ledger has not been altered behind the app's back.
 *
 * Every other check on this list asks whether the books are *consistent*. This
 * one asks something different and, for an auditor, more pointed: whether they
 * are the same books that were posted. A change made through the app re-seals
 * the chain and lands in the audit trail; a change made by editing storage
 * directly does neither, and shows up here.
 *
 * Unsealed entries — restored from a backup older than this feature — are
 * reported, not failed. They are not evidence of tampering, and treating them
 * as such would make this check worthless the first time anyone restored an
 * older file.
 */
function checkLedgerChain(journalEntries) {
  const v = verifyChain(journalEntries)
  const items = v.broken.map((b) => ({
    ref: b.number || b.id,
    date: b.date,
    detail: b.kind === 'contents'
      ? 'Contents changed after posting'
      : 'Entry moved, or an entry near it was inserted or removed',
  }))
  let detail
  if (items.length) detail = `${items.length} entr${items.length === 1 ? 'y does' : 'ies do'} not match the seal`
  else if (v.count === 0) detail = 'No entries to check'
  else if (v.unsealed) detail = `${v.sealed} sealed · ${v.unsealed} predate sealing (not an error)`
  else detail = `${v.sealed} entries sealed · anchor ${shortHash(v.head)}`
  return { id: 'ledger-chain', label: 'The ledger has not been altered since posting', ok: items.length === 0, detail, items }
}

/**
 * Run every check against a store snapshot.
 * @returns { ok, passed, failed, checks[], ranAt }
 */
export function runIntegrityCheck(state) {
  const { accounts, journalEntries, inventoryItems, invoices, purchases, creditNotes, debitNotes, customers, suppliers, settings, capitalAccounts } = state || {}
  const checks = [
    checkEntriesBalance(journalEntries),
    checkLedgerNetsZero(journalEntries),
    checkAccountingEquation(accounts, journalEntries),
    checkNoOrphanAccounts(accounts, journalEntries),
    checkUniqueAccountCodes(accounts),
    checkNoBadNumbers(journalEntries),
    checkNoNegativeStock(inventoryItems),
    checkInventoryAgreesWithLedger(journalEntries, inventoryItems, accounts),
    checkPartySubledgers(journalEntries, invoices, creditNotes, purchases, debitNotes, customers, suppliers),
    checkNoOverpayments(invoices, purchases),
    checkLockRespected(journalEntries, settings?.accounting?.lockDate),
    checkOpeningBalanceEquityCleared(journalEntries, settings),
    checkCapitalSubledgerAgrees(journalEntries, capitalAccounts),
    checkLedgerChain(journalEntries),
  ]
  const failed = checks.filter((c) => !c.ok).length
  return { ok: failed === 0, passed: checks.length - failed, failed, checks, ranAt: new Date().toISOString() }
}
