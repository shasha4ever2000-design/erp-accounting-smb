// Payment terms and early-settlement discounts.
//
// "2/10 net 30" means: the whole amount is due in 30 days, but take 2% off if
// you pay within 10. It is the oldest cash-flow lever in trade and most small
// systems either ignore it or get its tax treatment wrong.
//
// The tax treatment is the part that matters. When a customer takes a
// settlement discount, the consideration for the supply has genuinely fallen —
// so under Saudi and GCC VAT, and under EU rules, the taxable amount and the
// output tax both come down. A system that discounts the gross invoice and
// leaves the VAT alone has overpaid tax and has a VAT return that does not
// agree with its own sales ledger. So the discount here is always computed on
// the **net** and the tax is reversed in proportion.
//
// The other decision worth stating: a discount is offered only on settlement
// in full within the window. Pro-rating it across part payments is possible in
// principle and a menace in practice — it leaves fractions of a discount
// attached to an invoice that may never be settled, and no two systems agree
// on how to unwind that.

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

/**
 * `netDays`      — whole amount due this many days after the invoice date.
 * `discountPct`  — percentage off for early settlement (0 = none).
 * `discountDays` — the early-settlement window, in days.
 */
export function defaultTerms() {
  return { netDays: 30, discountPct: 0, discountDays: 0 }
}

export const TERM_PRESETS = [
  { id: 'receipt', label: 'Due on receipt',  netDays: 0,  discountPct: 0, discountDays: 0 },
  { id: 'net7',    label: 'Net 7',           netDays: 7,  discountPct: 0, discountDays: 0 },
  { id: 'net14',   label: 'Net 14',          netDays: 14, discountPct: 0, discountDays: 0 },
  { id: 'net30',   label: 'Net 30',          netDays: 30, discountPct: 0, discountDays: 0 },
  { id: 'net60',   label: 'Net 60',          netDays: 60, discountPct: 0, discountDays: 0 },
  { id: 'net90',   label: 'Net 90',          netDays: 90, discountPct: 0, discountDays: 0 },
  { id: '2_10_30', label: '2/10 net 30',     netDays: 30, discountPct: 2, discountDays: 10 },
  { id: '1_10_30', label: '1/10 net 30',     netDays: 30, discountPct: 1, discountDays: 10 },
  { id: '3_15_60', label: '3/15 net 60',     netDays: 60, discountPct: 3, discountDays: 15 },
]

export function presetById(id) {
  return TERM_PRESETS.find((p) => p.id === id) || null
}

/** Normalise whatever a record carries into usable terms. */
export function resolveTerms(record, fallback = null) {
  const base = fallback || defaultTerms()
  const t = record?.paymentTerms
  if (!t) return { ...base }
  if (typeof t === 'string') {
    const preset = presetById(t)
    return preset ? { netDays: preset.netDays, discountPct: preset.discountPct, discountDays: preset.discountDays } : { ...base }
  }
  return {
    netDays: Math.max(0, Math.floor(num(t.netDays ?? base.netDays))),
    discountPct: Math.max(0, num(t.discountPct ?? base.discountPct)),
    discountDays: Math.max(0, Math.floor(num(t.discountDays ?? base.discountDays))),
  }
}

const addDays = (iso, days) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(iso || '')
  d.setUTCDate(d.getUTCDate() + Math.floor(Number(days) || 0))
  return d.toISOString().slice(0, 10)
}

export function dueDateFor(invoiceDate, terms) {
  const t = terms || defaultTerms()
  return addDays(invoiceDate, t.netDays)
}

/** Last day the early-settlement discount can be taken. */
export function discountDeadline(invoiceDate, terms) {
  const t = terms || defaultTerms()
  if (!(t.discountPct > 0) || !(t.discountDays > 0)) return ''
  return addDays(invoiceDate, t.discountDays)
}

/** "2/10 net 30", or just "Net 30" when there is no discount. */
export function describeTerms(terms) {
  const t = terms || defaultTerms()
  const net = t.netDays > 0 ? `Net ${t.netDays}` : 'Due on receipt'
  if (!(t.discountPct > 0) || !(t.discountDays > 0)) return net
  const pct = Number.isInteger(t.discountPct) ? t.discountPct : t.discountPct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${pct}/${t.discountDays} ${net.toLowerCase()}`
}

/**
 * What settling this invoice today would cost, and what the discount is worth.
 *
 * `outstanding` is the gross still owed. The discount is taken off the net and
 * the tax reduced in proportion, because the consideration for the supply has
 * fallen and the VAT follows it.
 *
 * @returns {
 *   eligible, reason, deadline,
 *   discountNet, discountTax, discountGross, amountToPay
 * }
 */
export function settlementDiscount(invoice, payDate, terms, { taxEnabled = true } = {}) {
  const t = terms || defaultTerms()
  const total = round2(invoice?.total)
  const paid = round2(invoice?.amountPaid)
  const outstanding = round2(total - paid)
  const deadline = discountDeadline(invoice?.date, t)

  const none = (reason) => ({
    eligible: false, reason, deadline,
    discountNet: 0, discountTax: 0, discountGross: 0, amountToPay: outstanding,
  })

  if (!(t.discountPct > 0) || !(t.discountDays > 0)) return none('no-discount-terms')
  if (outstanding <= 0.004) return none('already-settled')
  if (paid > 0.004) return none('partly-paid')          // see the header note
  if (!deadline) return none('no-discount-terms')
  if (String(payDate).slice(0, 10) > deadline) return none('window-passed')

  // Split the invoice into net and tax so the discount lands on the right one.
  //
  // The tax comes from the invoice itself, never from the company's tax
  // setting. That setting governs whether *new* documents charge tax; this
  // invoice already exists, and if it charged tax then that tax was posted and
  // has to be unwound in proportion. Gating on the flag meant a company that
  // switched tax off later would discount the gross and leave output VAT
  // overstated on invoices that plainly carried it.
  const net = round2(invoice?.subtotal != null ? invoice.subtotal : total)
  const recorded = round2(invoice?.taxAmount)
  // A document with no tax breakdown at all: fall back to the difference,
  // which is the only other place the tax could be hiding.
  const tax = recorded || (invoice?.subtotal != null ? round2(total - net) : 0)

  const discountNet = round2((net * t.discountPct) / 100)
  // Proportional, not recomputed from a rate: an invoice can carry several tax
  // rates across its lines, and the only figure that is certainly right is the
  // tax actually charged.
  const discountTax = tax > 0 && net > 0 ? round2(tax * (discountNet / net)) : 0
  const discountGross = round2(discountNet + discountTax)

  return {
    eligible: true,
    reason: '',
    deadline,
    discountNet,
    discountTax,
    discountGross,
    amountToPay: round2(outstanding - discountGross),
  }
}

/**
 * Journal lines writing the discount off.
 *
 * Debits the discount to its own account, debits back the output tax that is
 * no longer due, and credits receivables with the gross — which is what makes
 * the invoice settle to nil.
 */
export function discountLines(disc, {
  receivableAccountId = 'acc-ar',
  discountAccountId = 'acc-salesdisc',
  taxAccountId = 'acc-vatout',
  reference = '',
} = {}) {
  if (!disc?.eligible || disc.discountGross <= 0) return []
  const text = `Settlement discount${reference ? ` — ${reference}` : ''}`
  const lines = [{ accountId: discountAccountId, debit: disc.discountNet, credit: 0, description: text }]
  if (disc.discountTax > 0)
    lines.push({ accountId: taxAccountId, debit: disc.discountTax, credit: 0, description: `${text} (tax)` })
  lines.push({ accountId: receivableAccountId, debit: 0, credit: disc.discountGross, description: text })
  return lines
}

/** The same on the buying side: a discount taken reduces what we owe. */
export function purchaseDiscountLines(disc, {
  payableAccountId = 'acc-ap',
  discountAccountId = 'acc-purchdisc',
  taxAccountId = 'acc-vatin',
  reference = '',
} = {}) {
  if (!disc?.eligible || disc.discountGross <= 0) return []
  const text = `Settlement discount taken${reference ? ` — ${reference}` : ''}`
  const lines = [{ accountId: payableAccountId, debit: disc.discountGross, credit: 0, description: text }]
  if (disc.discountTax > 0)
    lines.push({ accountId: taxAccountId, debit: 0, credit: disc.discountTax, description: `${text} (tax)` })
  lines.push({ accountId: discountAccountId, debit: 0, credit: disc.discountNet, description: text })
  return lines
}

/** Check terms before they are saved. */
export function validateTerms(t) {
  const errors = []
  const net = num(t?.netDays)
  const pct = num(t?.discountPct)
  const days = num(t?.discountDays)
  if (net < 0 || net > 365) errors.push('Net days must be between 0 and 365.')
  if (pct < 0 || pct >= 100) errors.push('The discount must be between 0 and 100 percent.')
  if (days < 0 || days > 365) errors.push('The discount window must be between 0 and 365 days.')
  if (pct > 0 && days <= 0) errors.push('A discount needs a window — say how many days.')
  if (days > 0 && pct <= 0) errors.push('A discount window needs a percentage.')
  // A window longer than the term is not wrong so much as pointless: the
  // discount would still be available after the debt fell due.
  if (pct > 0 && days > 0 && net > 0 && days > net)
    errors.push('The discount window is longer than the payment term, so the discount would never expire before the invoice was due.')
  return errors.length ? { ok: false, errors } : { ok: true }
}
