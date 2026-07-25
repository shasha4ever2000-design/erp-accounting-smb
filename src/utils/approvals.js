// Threshold-based approval workflow.
//
// The design decision worth explaining: rather than teaching every posting
// action (purchases, journal entries, payments) how to be "pending", a request
// captures the *draft payload* — the exact argument the posting action would
// have received — and parks it. Nothing touches the ledger until someone
// approves, and on approval the payload is replayed through the ordinary
// posting path. So the approval layer sits entirely outside the accounting
// logic and cannot corrupt it: an approved bill posts through precisely the
// same code as an unapproved one, VAT, freight, FX and inventory included.
//
// Roles: 'owner' and 'admin' can approve. Segregation of duties means the
// submitter cannot approve their own request, which is the whole point of the
// control — a threshold you can wave through yourself is theatre.

export const APPROVAL_KINDS = {
  purchase: { label: 'Purchase bills', hint: 'Supplier bills at or above this amount need a second pair of eyes.' },
  journal: { label: 'Manual journal entries', hint: 'Manual entries move money without a document behind them.' },
  payment: { label: 'Outgoing payments', hint: 'Payments to suppliers at or above this amount.' },
}

export const APPROVER_ROLES = ['owner', 'admin']

export const defaultApprovalSettings = () => ({
  enabled: false,
  requireDifferentUser: true,
  thresholds: { purchase: 0, journal: 0, payment: 0 },
})

/** Amount at or above which `kind` needs approval; 0 / blank means never. */
export function thresholdFor(settings, kind) {
  const n = Number(settings?.thresholds?.[kind])
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Does a document of this kind and size need approval before it can post?
 * Compared on the absolute amount, so a large credit is caught as readily as
 * a large debit.
 */
export function needsApproval(settings, kind, amount) {
  if (!settings?.enabled) return false
  const threshold = thresholdFor(settings, kind)
  if (threshold === 0) return false
  return Math.abs(Number(amount) || 0) >= threshold
}

/** Can this user approve at all, regardless of which request? */
export function isApprover(user) {
  return APPROVER_ROLES.includes(user?.role)
}

/**
 * Whether `user` may act on `request`.
 *
 * `users` is the full user list, used for one exception: a sole manager must
 * still be able to approve their own request, or a one-person company would
 * deadlock the moment it crossed a threshold — the request could only ever be
 * withdrawn, never posted. Segregation of duties is a control, not a trap.
 *
 * @returns { ok: boolean, reason?: string }
 */
export function canApprove(request, user, settings, users) {
  if (!request) return { ok: false, reason: 'Request not found' }
  if (request.status !== 'pending') return { ok: false, reason: 'Already decided' }
  if (!isApprover(user)) return { ok: false, reason: 'Only an owner or admin can approve' }
  if (settings?.requireDifferentUser !== false && request.submittedBy && request.submittedBy === user?.id) {
    const otherApprover = (users || []).some((u) => u.id !== user.id && isApprover(u))
    if (otherApprover) return { ok: false, reason: 'You cannot approve your own request' }
  }
  return { ok: true }
}

/**
 * The amount an approval decision hinges on, pulled from a draft payload.
 * Journal entries carry no total, so use the balanced debit side.
 */
export function amountOf(kind, payload) {
  if (!payload) return 0
  if (kind === 'journal')
    return (payload.lines || []).reduce((t, l) => t + (Number(l.debit) || 0), 0)
  // A parked payment wraps the payment in its target, so look one level down too.
  return Number(payload.total ?? payload.amount ?? payload.payment?.amount) || 0
}

/** Short human label for an inbox row. */
export function describeRequest(req) {
  if (!req) return ''
  const p = req.payload || {}
  if (req.kind === 'journal') return p.description || 'Manual journal entry'
  if (req.kind === 'purchase') return `${p.supplierName || 'Supplier'}${p.reference ? ` · ${p.reference}` : ''}`
  if (req.kind === 'payment') return `${p.targetRef || 'Payment'}${p.payment?.reference ? ` · ${p.payment.reference}` : ''}`
  return req.kind
}

/** Pending requests this user is allowed to act on — what the nav badge counts. */
export function actionableFor(requests, user, settings, users) {
  return (requests || []).filter((r) => canApprove(r, user, settings, users).ok)
}
