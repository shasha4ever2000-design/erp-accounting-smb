// What a customer owes you, and what you owe a supplier.
//
// This exists because four parts of the app used to answer that question
// differently. A credit note credits Accounts Receivable — the customer owes
// less — but it does not reduce the invoice it was raised against, because the
// invoice is a historical document and the credit is its own. Anything that
// answers "what is outstanding?" by summing invoices alone therefore overstates
// the debt by every credit note ever issued.
//
// The general ledger and the statement got this right. The customer list, the
// credit-limit check and the trade analytics did not, so the same customer
// showed 920 on one screen and 460 on another, and a customer sitting on
// credits could be refused a sale for breaching a limit they were nowhere near.
//
// One function, used everywhere, is the only way that stays fixed.

const num = (v) => Number(v) || 0
const r2 = (n) => Math.round(n * 100) / 100

/** Void and cancelled documents are history, not debt. */
export const isLiveDoc = (d) => d && d.status !== 'void' && d.status !== 'cancelled'

/** A document's unpaid remainder, in base currency. */
const outstandingBase = (d) => (num(d.total) - num(d.amountPaid)) * (num(d.exchangeRate) || 1)

/** A credit/debit note's value, in base currency. */
const noteBase = (n) => num(n.total) * (num(n.exchangeRate) || 1)

/**
 * What one customer owes, net of credit notes.
 * @param {string} customerId
 * @param {{invoices?: Array, creditNotes?: Array}} docs
 */
export function customerBalance(customerId, { invoices = [], creditNotes = [] } = {}) {
  const owed = invoices
    .filter((i) => i.customerId === customerId && isLiveDoc(i))
    .reduce((s, i) => s + outstandingBase(i), 0)
  const credited = creditNotes
    .filter((c) => c.customerId === customerId && isLiveDoc(c))
    .reduce((s, c) => s + noteBase(c), 0)
  return r2(owed - credited)
}

/** What one supplier is owed, net of debit notes. */
export function supplierBalance(supplierId, { purchases = [], debitNotes = [] } = {}) {
  const owed = purchases
    .filter((p) => p.supplierId === supplierId && isLiveDoc(p))
    .reduce((s, p) => s + outstandingBase(p), 0)
  const debited = debitNotes
    .filter((d) => d.supplierId === supplierId && isLiveDoc(d))
    .reduce((s, d) => s + noteBase(d), 0)
  return r2(owed - debited)
}

/** Total receivables across every customer — what Accounts Receivable should hold. */
export function totalReceivable({ invoices = [], creditNotes = [] } = {}) {
  const owed = invoices.filter(isLiveDoc).reduce((s, i) => s + outstandingBase(i), 0)
  const credited = creditNotes.filter(isLiveDoc).reduce((s, c) => s + noteBase(c), 0)
  return r2(owed - credited)
}

/** Total payables across every supplier — what Accounts Payable should hold. */
export function totalPayable({ purchases = [], debitNotes = [] } = {}) {
  const owed = purchases.filter(isLiveDoc).reduce((s, p) => s + outstandingBase(p), 0)
  const debited = debitNotes.filter(isLiveDoc).reduce((s, d) => s + noteBase(d), 0)
  return r2(owed - debited)
}

/**
 * What the credit (or debit) notes raised against one document have taken off
 * it, in the document's own currency.
 *
 * A sales return is linked to its invoice by `invoiceId`, a purchase return to
 * its bill by `purchaseId`. Notes raised on their own are not linked to any
 * one document and only count at the party level (see customerBalance).
 */
export function notesAgainst(doc, notes = [], key = 'invoiceId') {
  if (!doc?.id) return 0
  return r2((notes || [])
    .filter((n) => n && n[key] === doc.id && isLiveDoc(n))
    .reduce((s, n) => s + num(n.total), 0))
}

/**
 * What is still to be collected (or paid) on one document: its total, less
 * what has been paid, less the returns raised against it. In the document's
 * own currency; never below zero.
 *
 * Without the returns, an invoice of 1,000 with a 400 return still showed
 * 1,000 due, and receiving that 1,000 drove Accounts Receivable to -400.
 */
export function documentDue(doc, notes = [], key = 'invoiceId') {
  if (!doc) return 0
  return r2(Math.max(0, num(doc.total) - num(doc.amountPaid) - notesAgainst(doc, notes, key)))
}

/**
 * What was still due on a document at the end of `asAt` (YYYY-MM-DD): its
 * total, less payments and linked returns dated on or before that day. With
 * no `asAt`, it is simply documentDue. In the document's own currency.
 */
export function documentDueAsAt(doc, notes = [], key = 'invoiceId', asAt = '') {
  if (!doc) return 0
  if (!asAt) return documentDue(doc, notes, key)
  if (doc.date && doc.date > asAt) return 0
  const paid = (doc.payments || [])
    .filter((p) => !p.date || p.date <= asAt)
    .reduce((s, p) => s + num(p.amount), 0)
  const noted = (notes || [])
    .filter((n) => n && n[key] === doc.id && isLiveDoc(n) && (!n.date || n.date <= asAt))
    .reduce((s, n) => s + num(n.total), 0)
  return r2(Math.max(0, num(doc.total) - paid - noted))
}

/**
 * Credit (or debit) notes raised on their own, not against any one document,
 * in base currency, dated on or before `asAt`. They reduce what a party owes
 * overall but belong to no ageing bucket, so the ageing shows them as one
 * line of their own.
 */
export function unappliedNotes(notes = [], key = 'invoiceId', asAt = '') {
  return r2((notes || [])
    .filter((n) => n && !n[key] && isLiveDoc(n) && (!asAt || !n.date || n.date <= asAt))
    .reduce((s, n) => s + noteBase(n), 0))
}
