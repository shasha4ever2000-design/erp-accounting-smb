// Whether a posted document can still be corrected in place.
//
// Editing a sales or purchase invoice re-posts its own journal entries and
// re-runs its stock effect. That is safe only while nothing else has been hung
// off the document. Once money has moved against it, a return has been raised,
// the period has closed, or another document is matching quantities to it, the
// invoice is part of a wider story and quietly rewriting it would leave two
// records disagreeing. The honest correction there is Void + re-issue: both
// versions stay in the ledger and the audit trail says what happened.
//
// This module holds that decision on its own so the store can enforce it and
// the UI can explain it in the same words, without either re-deriving it.

/** Reason codes, in the order they are checked. */
export const EDIT_BLOCK_REASONS = ['missing', 'void', 'paid', 'returned', 'locked', 'grni', 'ordered']

/**
 * Why a document cannot be edited, or `null` when it can.
 *
 * @param {object|null} doc          the invoice or bill
 * @param {object}      ctx
 * @param {'invoice'|'purchase'} ctx.kind
 * @param {string}      ctx.lockDate closed-period date (YYYY-MM-DD), '' when open
 * @param {boolean}     ctx.fromOrder document is quantity-matched to a quotation,
 *                                    sales order or purchase order
 * @returns {string|null} a code from EDIT_BLOCK_REASONS
 */
export function editBlock(doc, { kind = 'invoice', lockDate = '', fromOrder = false } = {}) {
  if (!doc) return 'missing'
  if (doc.status === 'void') return 'void'
  if ((Number(doc.amountPaid) || 0) > 0 || (doc.payments || []).length > 0) return 'paid'
  if ((doc.items || []).some((l) => (Number(l.returnedQty) || 0) > 0)) return 'returned'
  if (lockDate && doc.date && String(doc.date) <= String(lockDate)) return 'locked'
  // A bill raised off a goods receipt clears the GRNI accrual rather than
  // debiting expense or inventory, so re-posting it through the ordinary
  // purchase path would book the cost a second time.
  if (kind === 'purchase' && doc.fromGrni) return 'grni'
  if (fromOrder) return 'ordered'
  return null
}

/** English explanation for a reason code — translated at the point of display. */
export const EDIT_BLOCK_MESSAGE = {
  missing: 'This document no longer exists.',
  void: 'This document has been voided. A voided document is kept exactly as it was posted.',
  paid: 'Money has already moved against this document. Reverse the payment first, or void it and issue a corrected one.',
  returned: 'A return has already been raised against this document. Void it and issue a corrected one instead.',
  locked: 'This document falls in a closed accounting period. Void it with a reversal dated in an open period instead.',
  grni: 'This bill came from a goods receipt and clears the GRNI accrual. Correct it on the purchase order it came from.',
  ordered: 'This document is quantity-matched to an order, and editing it here would leave the two disagreeing. Correct it on the order.',
}
