// Post-dated cheque register.
//
// In the Gulf, Egypt and much of the wider region a cheque is not a payment —
// it is a promise dated weeks or months ahead, and a business may be holding
// dozens at once. Treating one as cash the day it arrives overstates the bank
// balance and hides the risk that it bounces, so a cheque lives in its own
// account until it actually clears:
//
//   received   Dr Cheques Under Collection   Cr Accounts Receivable
//   cleared    Dr Bank                       Cr Cheques Under Collection
//   bounced    Dr Accounts Receivable        Cr Cheques Under Collection
//
//   issued     Dr Accounts Payable           Cr Cheques Payable
//   cleared    Dr Cheques Payable            Cr Bank
//   cancelled  Dr Cheques Payable            Cr Accounts Payable
//
// A bounce is deliberately a reversal rather than a deletion: the debt comes
// back and the cheque stays on the record, because "this customer bounced one"
// is exactly the history a credit decision needs.

export const CHEQUE_IN = 'received'
export const CHEQUE_OUT = 'issued'

export const CHEQUE_ACCOUNTS = {
  [CHEQUE_IN]: 'acc-chq-in',   // asset — cheques held, not yet cleared
  [CHEQUE_OUT]: 'acc-chq-out', // liability — cheques written, not yet presented
}

// pending  — received: in the drawer. issued: written, not yet presented.
// deposited— received only: lodged at the bank, awaiting clearance.
// cleared / bounced / cancelled are terminal.
export const CHEQUE_STATUS = ['pending', 'deposited', 'cleared', 'bounced', 'cancelled']

export const STATUS_LABEL = {
  pending: 'On hand',
  deposited: 'Deposited',
  cleared: 'Cleared',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
}

const TRANSITIONS = {
  [CHEQUE_IN]: {
    pending: ['deposited', 'cleared', 'bounced', 'cancelled'],
    deposited: ['cleared', 'bounced'],
    cleared: [], bounced: [], cancelled: [],
  },
  [CHEQUE_OUT]: {
    // Nobody deposits a cheque they wrote — it is presented by the payee.
    pending: ['cleared', 'bounced', 'cancelled'],
    deposited: ['cleared', 'bounced'],
    cleared: [], bounced: [], cancelled: [],
  },
}

export const isTerminal = (status) => ['cleared', 'bounced', 'cancelled'].includes(status)

/** Whether a cheque may move from one status to another. */
export function canTransition(direction, from, to) {
  const table = TRANSITIONS[direction]
  if (!table) return false
  return (table[from] || []).includes(to)
}

/** The statuses a cheque can move to right now, for building a menu. */
export function nextStatuses(direction, from) {
  return (TRANSITIONS[direction]?.[from]) || []
}

/**
 * Reject a cheque that cannot be posted. Returns { ok } or { ok:false, error }.
 * A cheque with no due date is the whole point of the register, so it is
 * required even though the accounting would survive without it.
 */
export function validateCheque(c = {}) {
  if (c.direction !== CHEQUE_IN && c.direction !== CHEQUE_OUT)
    return { ok: false, error: 'A cheque must be either received or issued.' }
  if (!String(c.number || '').trim())
    return { ok: false, error: 'Enter the cheque number — it is how the bank and the payer will refer to it.' }
  if (!c.partyId)
    return { ok: false, error: c.direction === CHEQUE_IN ? 'Choose the customer this cheque came from.' : 'Choose the supplier this cheque is for.' }
  const amount = Number(c.amount) || 0
  if (amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
  if (!c.dueDate) return { ok: false, error: 'Enter the date written on the cheque — a register without due dates cannot tell you what is coming.' }
  if (c.issueDate && c.dueDate && String(c.dueDate) < String(c.issueDate))
    return { ok: false, error: 'The cheque is dated before the day it was written. Check the dates.' }
  return { ok: true }
}

/** True when a cheque is still money in motion rather than settled history. */
export const isOutstanding = (c) => !isTerminal(c?.status)

/**
 * Cheques grouped by how close their due date is, for the register's summary.
 * `overdue` means past due and still not cleared — the ones worth chasing.
 */
export function chequeBuckets(cheques = [], asOf = new Date().toISOString().slice(0, 10)) {
  const out = { overdue: [], dueSoon: [], later: [], settled: [] }
  const soon = addDays(asOf, 7)
  cheques.forEach((c) => {
    if (isTerminal(c.status)) { out.settled.push(c); return }
    const due = String(c.dueDate || '')
    if (due && due < asOf) out.overdue.push(c)
    else if (due && due <= soon) out.dueSoon.push(c)
    else out.later.push(c)
  })
  return out
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Total of a set of cheques, in whatever currency they carry. */
export const chequeTotal = (cheques = []) =>
  Math.round(cheques.reduce((s, c) => s + (Number(c.amount) || 0), 0) * 100) / 100

/**
 * The ledger lines for a cheque event.
 *
 * `partyAccountId` is the AR or AP control account for that customer or
 * supplier, which the caller resolves — control accounts are configurable per
 * party, so this module must not assume acc-ar / acc-ap.
 */
export function chequeLines(event, { direction, amount, partyAccountId, bankAccountId, number }) {
  const amt = Math.round((Number(amount) || 0) * 100) / 100
  if (amt <= 0) return []
  const holding = CHEQUE_ACCOUNTS[direction]
  const ref = `Cheque ${number || ''}`.trim()

  if (direction === CHEQUE_IN) {
    if (event === 'receive') return [
      { accountId: holding, debit: amt, credit: 0, description: `${ref} received` },
      { accountId: partyAccountId, debit: 0, credit: amt, description: ref },
    ]
    if (event === 'clear') return [
      { accountId: bankAccountId, debit: amt, credit: 0, description: `${ref} cleared` },
      { accountId: holding, debit: 0, credit: amt, description: ref },
    ]
    // bounced or cancelled — the receivable comes back
    return [
      { accountId: partyAccountId, debit: amt, credit: 0, description: `${ref} returned unpaid` },
      { accountId: holding, debit: 0, credit: amt, description: ref },
    ]
  }

  if (event === 'receive') return [ // "issued"
    { accountId: partyAccountId, debit: amt, credit: 0, description: ref },
    { accountId: holding, debit: 0, credit: amt, description: `${ref} issued` },
  ]
  if (event === 'clear') return [
    { accountId: holding, debit: amt, credit: 0, description: `${ref} presented` },
    { accountId: bankAccountId, debit: 0, credit: amt, description: ref },
  ]
  return [
    { accountId: holding, debit: amt, credit: 0, description: `${ref} cancelled` },
    { accountId: partyAccountId, debit: 0, credit: amt, description: ref },
  ]
}
