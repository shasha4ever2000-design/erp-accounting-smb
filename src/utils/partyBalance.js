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
