// Customer and supplier statements.
//
// A statement is what you send when money is late, so it has one job: leave no
// room to argue about the number. Two shapes are used in practice and they
// answer different questions:
//
//   • **Activity** (balance forward) — opening balance, every movement in the
//     period, closing balance. This is the audit view: it reconciles to the
//     previous statement and shows what happened.
//
//   • **Open item** — only the documents still unpaid, each with its age. This
//     is the collections view: nobody chasing a debt wants to read six months
//     of settled invoices to find the two that matter.
//
// Both are built from the documents, not the ledger, because that is what the
// customer has in their hand. And they have to agree: a statement run from
// inception to today must close on exactly the total of its own open items. If
// those two disagree, a payment has been recorded against nothing, and the
// number in the letter is wrong. `reconcile` checks it and the tests assert it.

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

/** Statuses that mean the document never really existed. */
export const DEAD_STATUSES = ['cancelled', 'void', 'draft']

const isLive = (d) => d && !DEAD_STATUSES.includes(d.status)

/**
 * Every movement on a party's account, oldest first.
 *
 * A sale is a debit to the customer and a purchase is a credit to the supplier,
 * so `debit − credit` is always "what they owe us" for a customer and "what we
 * owe them" for a supplier. Keeping that sign convention consistent is what
 * lets one running-balance routine serve both.
 */
export function buildEntries(kind, entityId, docs = {}) {
  const { invoices = [], creditNotes = [], purchases = [], debitNotes = [] } = docs
  const out = []
  if (!entityId) return out

  if (kind === 'customer') {
    invoices.filter((i) => i.customerId === entityId && isLive(i)).forEach((inv) => {
      out.push({
        date: inv.date, kind: 'invoice', label: 'Sales Invoice', ref: inv.number,
        docId: inv.id, dueDate: inv.dueDate || inv.date,
        debit: round2(inv.total), credit: 0,
      })
      ;(inv.payments || []).forEach((p, i) => out.push({
        date: p.date, kind: 'payment', label: 'Payment Received',
        ref: p.number || p.reference || '', docId: `${inv.id}:p${i}`, against: inv.number,
        debit: 0, credit: round2(p.amount),
      }))
    })
    creditNotes.filter((c) => c.customerId === entityId && isLive(c)).forEach((cn) => out.push({
      date: cn.date, kind: 'creditNote', label: 'Credit Note', ref: cn.number,
      docId: cn.id, debit: 0, credit: round2(cn.total),
    }))
  } else {
    purchases.filter((p) => p.supplierId === entityId && isLive(p)).forEach((pur) => {
      out.push({
        date: pur.date, kind: 'bill', label: 'Purchase Invoice', ref: pur.number,
        docId: pur.id, dueDate: pur.dueDate || pur.date,
        debit: 0, credit: round2(pur.total),
      })
      ;(pur.payments || []).forEach((p, i) => out.push({
        date: p.date, kind: 'payment', label: 'Payment Made',
        ref: p.number || p.reference || '', docId: `${pur.id}:p${i}`, against: pur.number,
        debit: round2(p.amount), credit: 0,
      }))
    })
    debitNotes.filter((d) => d.supplierId === entityId && isLive(d)).forEach((dn) => out.push({
      date: dn.date, kind: 'debitNote', label: 'Debit Note', ref: dn.number,
      docId: dn.id, debit: round2(dn.total), credit: 0,
    }))
  }

  return out.sort((a, b) =>
    String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.ref || '').localeCompare(String(b.ref || '')))
}

const signedFor = (kind, e) =>
  kind === 'customer' ? num(e.debit) - num(e.credit) : num(e.credit) - num(e.debit)

/** Balance-forward statement for a date range. */
export function activityStatement(kind, entries = [], { start = '', end = '' } = {}) {
  const before = entries.filter((e) => start && String(e.date) < String(start))
  const within = entries.filter((e) =>
    (!start || String(e.date) >= String(start)) && (!end || String(e.date) <= String(end)))

  const opening = round2(before.reduce((s, e) => s + signedFor(kind, e), 0))
  let running = opening
  const rows = within.map((e) => {
    running = round2(running + signedFor(kind, e))
    return { ...e, movement: signedFor(kind, e), balance: running }
  })
  return { opening, rows, closing: round2(running) }
}

/**
 * Documents still outstanding as at a date, each with its age.
 *
 * Age is measured from the due date, not the invoice date — an invoice on 30
 * day terms is not overdue on day two, and a statement that says otherwise
 * gets argued with rather than paid.
 */
export function openItems(kind, docs = {}, entityId, { asAt = '' } = {}) {
  const at = asAt || new Date().toISOString().slice(0, 10)
  const source = kind === 'customer'
    ? (docs.invoices || []).filter((i) => i.customerId === entityId && isLive(i))
    : (docs.purchases || []).filter((p) => p.supplierId === entityId && isLive(p))

  return source
    .filter((d) => String(d.date) <= String(at))
    .map((d) => {
      // Paid *as at* the statement date, not paid today. A statement dated
      // 1 February must not show an invoice as settled by a payment that
      // arrived on the 5th — the customer's copy would disagree with ours and
      // the older statement could never be reproduced. Falls back to the
      // stored total only when a document carries no payment detail.
      const paid = Array.isArray(d.payments)
        ? round2(d.payments.reduce((s, p) => (String(p.date) <= String(at) ? s + num(p.amount) : s), 0))
        : round2(d.amountPaid)
      const outstanding = round2(num(d.total) - paid)
      const due = d.dueDate || d.date
      const days = Math.floor((Date.parse(at) - Date.parse(due)) / 86400000)
      return {
        docId: d.id, ref: d.number, date: d.date, dueDate: due,
        total: round2(d.total), paid, outstanding,
        daysOverdue: Number.isFinite(days) && days > 0 ? days : 0,
      }
    })
    .filter((r) => r.outstanding > 0.004)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

export const DEFAULT_BUCKETS = [30, 60, 90]

/**
 * Aged summary — the part of a statement people actually read.
 * Returns `{ current, d30, d60, d90, total }` style rows plus the bucket edges.
 */
export function agedSummary(items = [], buckets = DEFAULT_BUCKETS) {
  const edges = [...buckets].sort((a, b) => a - b)
  const cells = new Array(edges.length + 1).fill(0)
  items.forEach((r) => {
    const d = num(r.daysOverdue)
    // Not yet due, or due today, sits in "current".
    let slot = 0
    edges.forEach((edge, i) => { if (d >= edge) slot = i + 1 })
    if (d > 0 && slot === 0) slot = 0
    cells[slot] = round2(cells[slot] + num(r.outstanding))
  })
  const labels = ['Current', ...edges.map((e, i) => (i === edges.length - 1 ? `${e}+ days` : `${e}–${edges[i + 1] - 1} days`))]
  return {
    edges,
    labels,
    cells: cells.map(round2),
    total: round2(cells.reduce((s, v) => s + v, 0)),
  }
}

/**
 * Does the activity view agree with the open items?
 *
 * Run from inception to the same date they must be identical. A gap means a
 * payment or credit is recorded against nothing, and the figure being chased
 * is wrong.
 */
export function reconcile(closing, items = []) {
  const open = round2(items.reduce((s, r) => s + num(r.outstanding), 0))
  const difference = round2(num(closing) - open)
  return { ok: Math.abs(difference) < 0.005, closing: round2(closing), open, difference }
}

/** Everything a statement page or print view needs, in one call. */
export function buildStatement(kind, entityId, docs = {}, { start = '', end = '', mode = 'activity', buckets = DEFAULT_BUCKETS } = {}) {
  const entries = buildEntries(kind, entityId, docs)
  const activity = activityStatement(kind, entries, { start, end })
  const items = openItems(kind, docs, entityId, { asAt: end })
  const aged = agedSummary(items, buckets)
  // Reconciliation only means something when the period covers everything: over
  // a narrower window the closing balance legitimately excludes older unpaid
  // documents. "Everything" is not the same as "no start date" — the screen
  // always supplies one, so testing for a blank start made this check dead in
  // practice. What matters is whether the start predates the first document.
  const earliest = entries.reduce((m, e) => (!m || String(e.date) < m ? String(e.date) : m), '')
  const fromInception = !start || !earliest || String(start) <= earliest
  return {
    mode,
    entries,
    ...activity,
    items,
    aged,
    reconciliation: fromInception ? reconcile(activity.closing, items) : null,
    overdueTotal: round2(items.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.outstanding, 0)),
    oldestDays: items.reduce((m, r) => Math.max(m, r.daysOverdue), 0),
  }
}
