// Sales-commission analytics — pure functions, no store/UI dependencies.
//
// Commissions are earned by a sales rep on the invoices they are attributed to
// (invoice.salesRepId). Two industry-standard bases are supported:
//   • 'invoiced'  — earned when the invoice is raised, on the full net amount.
//   • 'collected' — earned only on cash actually received (amountPaid), pro-rated.
//
// Commission is always computed on the NET (pre-tax) value: VAT/output tax is a
// pass-through to the authority and is never commissionable. Void, cancelled and
// draft invoices are excluded.

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

// Net (pre-tax) value of an invoice in base terms used for commission.
function invoiceNet(inv) {
  const total = Number(inv.total) || 0
  const tax = Number(inv.taxAmount) || 0
  return Math.max(0, total - tax)
}

// The commissionable base for one invoice under the chosen basis.
function invoiceBase(inv, basis) {
  const net = invoiceNet(inv)
  if (basis === 'collected') {
    const total = Number(inv.total) || 0
    const paid = Number(inv.amountPaid) || 0
    if (total <= 0) return 0
    // Collected fraction applied to the net (so tax portion of a payment is excluded).
    return round2(net * Math.min(1, paid / total))
  }
  return net // 'invoiced'
}

/**
 * Build a per-rep commission report.
 * @param {Array} invoices   store invoices
 * @param {Array} salesReps  [{ id, name, rate }]  rate = commission %
 * @param {Object} opts      { basis: 'invoiced' | 'collected' }
 * @returns {{ rows, totalBase, totalCommission, unassignedBase }}
 */
export function commissionReport(invoices, salesReps = [], { basis = 'invoiced' } = {}) {
  const active = (invoices || []).filter(
    (i) => i && i.status !== 'void' && i.status !== 'cancelled' && i.status !== 'draft'
  )
  const repById = new Map(salesReps.map((r) => [r.id, r]))

  const acc = new Map() // repId -> { base, count }
  let unassignedBase = 0

  active.forEach((inv) => {
    const base = invoiceBase(inv, basis)
    if (base <= 0) return
    const rep = inv.salesRepId && repById.get(inv.salesRepId)
    if (!rep) { unassignedBase = round2(unassignedBase + base); return }
    const cur = acc.get(rep.id) || { base: 0, count: 0 }
    cur.base = round2(cur.base + base)
    cur.count += 1
    acc.set(rep.id, cur)
  })

  const rows = salesReps
    .map((rep) => {
      const a = acc.get(rep.id) || { base: 0, count: 0 }
      const rate = Number(rep.rate) || 0
      return {
        repId: rep.id,
        name: rep.name,
        rate,
        base: a.base,
        count: a.count,
        commission: round2(a.base * (rate / 100)),
      }
    })
    .sort((x, y) => y.commission - x.commission)

  const totalBase = round2(rows.reduce((s, r) => s + r.base, 0))
  const totalCommission = round2(rows.reduce((s, r) => s + r.commission, 0))

  return { rows, totalBase, totalCommission, unassignedBase: round2(unassignedBase) }
}
