// Opening balances — the migration cutover.
//
// A business switching to this system on 1 July does not start from zero: it
// has cash in the bank, customers who owe it money, bills it has not paid, and
// stock on the shelf. Without a way to state that, the ERP can only ever serve
// a company founded the day it installed the software.
//
// The model follows the one every serious system uses:
//
//   * One cutover date. Everything before it is represented by these balances;
//     everything after it is a real transaction.
//   * Receivables, payables and inventory are NOT typed in as lump sums. They
//     are derived from the individual open invoices, open bills and stock
//     lines you enter, because a lump sum cannot age, cannot be paid off
//     invoice by invoice, and cannot be counted. This is the most important
//     decision in this file — it is why aging reports work after a migration
//     instead of showing every legacy invoice as brand new.
//   * Whatever does not balance goes to Opening Balance Equity. A non-zero
//     balance there is not an error to hide; it is the system telling you the
//     trial balance you typed in does not balance yet.
//
// This module is pure. It computes lines and totals; the store posts them.

export const OBE_ACCOUNT = 'acc-obe'

/** Accounts whose opening balance is derived from subledger detail, never typed. */
export const DERIVED_ACCOUNTS = {
  'acc-ar': 'customers',
  'acc-ap': 'suppliers',
  'acc-inv': 'items',
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const round = (n) => Math.round(n * 100) / 100

/** Debit-natured account types. The rest are credit-natured. */
const DEBIT_NATURED = new Set(['asset', 'expense'])

/**
 * Turn a signed balance into a debit or credit, respecting the account's
 * natural side. A negative asset (an overdrawn bank account) becomes a credit.
 */
export function sideFor(type, amount) {
  const a = round(num(amount))
  if (a === 0) return { debit: 0, credit: 0 }
  const positiveIsDebit = DEBIT_NATURED.has(type)
  const isDebit = a > 0 ? positiveIsDebit : !positiveIsDebit
  return isDebit ? { debit: Math.abs(a), credit: 0 } : { debit: 0, credit: Math.abs(a) }
}

/** Total of the open sales invoices being carried in. */
export function receivablesTotal(customers = []) {
  return round(customers.reduce((s, c) => s + num(c.amount), 0))
}

/** Total of the open supplier bills being carried in. */
export function payablesTotal(suppliers = []) {
  return round(suppliers.reduce((s, c) => s + num(c.amount), 0))
}

/** Value of opening stock at the cost you are carrying it in at. */
export function inventoryTotal(items = []) {
  return round(items.reduce((s, i) => s + num(i.quantity) * num(i.unitCost), 0))
}

/**
 * Build the single balanced journal entry that establishes the opening
 * position.
 *
 * @param input {{ date, accounts, customers, suppliers, items }}
 *   accounts  — [{ accountId, type, amount }] manually stated GL balances
 *   customers — [{ customerId, customerName, number, date, dueDate, amount }]
 *   suppliers — same shape
 *   items     — [{ itemId, itemName, quantity, unitCost }]
 * @param opts {{ accountName }} optional resolver for line descriptions
 * @returns { lines, debits, credits, plug, ar, ap, inventory, warnings }
 */
export function buildOpeningEntry(input = {}, { accountName } = {}) {
  const { accounts = [], customers = [], suppliers = [], items = [] } = input
  const nameOf = accountName || (() => 'Opening balance')
  const lines = []
  const warnings = []

  // Manually stated GL balances. Control accounts are refused here: their
  // opening balance comes from the detail, and accepting both would silently
  // double-count.
  accounts.forEach((a) => {
    if (DERIVED_ACCOUNTS[a.accountId]) {
      warnings.push(`${nameOf(a.accountId)} is set from its detail, not typed in — the value entered was ignored.`)
      return
    }
    const { debit, credit } = sideFor(a.type, a.amount)
    if (debit === 0 && credit === 0) return
    lines.push({ accountId: a.accountId, debit, credit, description: `Opening balance — ${nameOf(a.accountId)}` })
  })

  const ar = receivablesTotal(customers)
  const ap = payablesTotal(suppliers)
  const inventory = inventoryTotal(items)

  if (ar !== 0) lines.push({ accountId: 'acc-ar', debit: ar, credit: 0, description: `Opening receivables — ${customers.length} invoice(s)` })
  if (ap !== 0) lines.push({ accountId: 'acc-ap', debit: 0, credit: ap, description: `Opening payables — ${suppliers.length} bill(s)` })
  if (inventory !== 0) lines.push({ accountId: 'acc-inv', debit: inventory, credit: 0, description: `Opening stock — ${items.length} item(s)` })

  const debits = round(lines.reduce((s, l) => s + l.debit, 0))
  const credits = round(lines.reduce((s, l) => s + l.credit, 0))
  // The plug is what the books are missing, not a rounding fudge — it is
  // reported to the user as the difference still to allocate.
  const plug = round(debits - credits)

  if (plug > 0) lines.push({ accountId: OBE_ACCOUNT, debit: 0, credit: plug, description: 'Opening Balance Equity' })
  else if (plug < 0) lines.push({ accountId: OBE_ACCOUNT, debit: -plug, credit: 0, description: 'Opening Balance Equity' })

  return { lines, debits, credits, plug, ar, ap, inventory, warnings }
}

/** Human-readable state of the migration, for the page header and the check. */
export function openingSummary(entry) {
  const { plug = 0 } = entry || {}
  if (Math.abs(plug) < 0.005) return { balanced: true, message: 'Balanced — nothing left to allocate.' }
  return {
    balanced: false,
    // Which way the plug falls tells the user what is missing, which is more
    // useful than "out of balance".
    message: plug > 0
      ? `Assets exceed what you have entered by ${Math.abs(plug).toFixed(2)} — this will sit in Opening Balance Equity until you add the missing capital, loans or liabilities.`
      : `Liabilities exceed what you have entered by ${Math.abs(plug).toFixed(2)} — this will sit in Opening Balance Equity until you add the missing assets.`,
  }
}

/** Validate before posting. @returns string[] of blocking errors. */
export function validateOpening(input = {}, { lockDate } = {}) {
  const errors = []
  const { date, customers = [], suppliers = [], items = [] } = input

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Choose a valid cutover date.')
  else if (lockDate && String(date) <= String(lockDate)) errors.push(`The cutover date falls in a locked period (locked through ${lockDate}).`)

  const docs = [['invoice', customers], ['bill', suppliers]]
  docs.forEach(([label, rows]) => {
    rows.forEach((r, i) => {
      if (!num(r.amount)) errors.push(`Opening ${label} ${r.number || `#${i + 1}`} has no amount.`)
      if (num(r.amount) < 0) errors.push(`Opening ${label} ${r.number || `#${i + 1}`} is negative — enter a credit note after the cutover instead.`)
      // Without the original number, a payment arriving next week cannot be
      // matched to the invoice it settles.
      if (!r.number) errors.push(`Opening ${label} #${i + 1} needs its original document number, or it cannot be matched to a payment later.`)
    })
  })

  items.forEach((it, i) => {
    if (num(it.quantity) < 0) errors.push(`Opening stock for ${it.itemName || `item #${i + 1}`} is negative.`)
    if (num(it.unitCost) < 0) errors.push(`Opening cost for ${it.itemName || `item #${i + 1}`} is negative.`)
  })

  return errors
}

/**
 * Opening documents are dated before the cutover by definition. Anything the
 * user dates on or after it is a real transaction and should be entered as one.
 */
export function docDateWarnings(input = {}) {
  const { date, customers = [], suppliers = [] } = input
  if (!date) return []
  const out = []
  const check = (rows, label) => rows.forEach((r) => {
    if (r.date && String(r.date) > String(date))
      out.push(`${label} ${r.number || ''} is dated after the cutover — enter it as a normal ${label.toLowerCase()} instead.`.replace(/\s+/g, ' '))
  })
  check(customers, 'Invoice')
  check(suppliers, 'Bill')
  return out
}
