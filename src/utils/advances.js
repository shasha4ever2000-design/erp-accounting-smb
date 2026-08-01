// Customer advances — deposits, retainers, and money paid on account.
//
// Before this the app simply refused the money: recordInvoicePayment clamped
// a receipt to the invoice's outstanding balance so the receivable could not
// go negative, because there was nowhere else to put the excess. That is fine
// arithmetic and a poor answer for a business that takes 50% up front.
//
// An advance is a liability, not revenue and not a negative receivable: the
// cash is in the bank but the work is not done, and until it is the customer
// could ask for it back.
//
//   received   Dr Bank                Cr Customer Advances
//   applied    Dr Customer Advances   Cr Accounts Receivable
//   refunded   Dr Customer Advances   Cr Bank
//
// Applying an advance is deliberately routed through the ordinary invoice
// receipt path, with the advance account standing in for the bank. That way
// an invoice settled from a deposit gets the same paid status, the same
// receipt number and the same FX treatment as one settled by transfer —
// rather than a second, subtly different payment mechanism.

export const ADVANCE_ACCOUNT = 'acc-custadv'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** How much of an advance has been put against invoices. */
export const appliedTotal = (advance) =>
  r2((advance?.applications || []).reduce((s, a) => s + (Number(a.amount) || 0), 0))

/** What is left of an advance: unapplied, unrefunded, still owed to the customer. */
export function advanceBalance(advance) {
  return r2((Number(advance?.amount) || 0) - appliedTotal(advance) - (Number(advance?.refunded) || 0))
}

export const isSettled = (advance) => advanceBalance(advance) <= 0.005

/** Every advance from one customer that still has money on it. */
export const openAdvances = (advances = [], customerId) =>
  advances.filter((a) => a.customerId === customerId && !isSettled(a))

/** Total credit a customer is holding with you. */
export const customerCredit = (advances = [], customerId) =>
  r2(openAdvances(advances, customerId).reduce((s, a) => s + advanceBalance(a), 0))

export function validateAdvance(input = {}) {
  if (!input.customerId) return { ok: false, error: 'Choose the customer this money came from.' }
  if ((Number(input.amount) || 0) <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  if (!input.date) return { ok: false, error: 'Enter the date the money was received.' }
  if (!input.bankAccountId) return { ok: false, error: 'Choose the account the money was paid into.' }
  return { ok: true }
}

/**
 * The most of `advance` that can go against `invoice` — never more than the
 * advance holds, and never more than the invoice still owes, so neither side
 * can be pushed negative.
 */
export function applicableAmount(advance, invoice) {
  const outstanding = r2((Number(invoice?.total) || 0) - (Number(invoice?.amountPaid) || 0))
  return Math.max(0, Math.min(advanceBalance(advance), outstanding))
}

/** How much of a set of advances could settle this invoice in total. */
export function coverageFor(advances = [], invoice) {
  if (!invoice) return 0
  const outstanding = r2((Number(invoice.total) || 0) - (Number(invoice.amountPaid) || 0))
  const credit = customerCredit(advances, invoice.customerId)
  return Math.max(0, Math.min(credit, outstanding))
}

/** Ledger lines for taking money on account. */
export const receiveLines = (amount, bankAccountId, ref) => {
  const amt = r2(amount)
  if (amt <= 0) return []
  return [
    { accountId: bankAccountId, debit: amt, credit: 0, description: ref },
    { accountId: ADVANCE_ACCOUNT, debit: 0, credit: amt, description: ref },
  ]
}

/** Ledger lines for giving it back. */
export const refundLines = (amount, bankAccountId, ref) => {
  const amt = r2(amount)
  if (amt <= 0) return []
  return [
    { accountId: ADVANCE_ACCOUNT, debit: amt, credit: 0, description: ref },
    { accountId: bankAccountId, debit: 0, credit: amt, description: ref },
  ]
}
