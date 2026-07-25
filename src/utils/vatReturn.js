// ZATCA VAT-return builder. Pure and unit-testable: takes the sales / purchase
// documents for a filing period and produces the box values of the official
// Saudi VAT return form, laid out the way the ZATCA portal asks for them —
// per line: Amount (net sales/purchases), Adjustment (credit / debit notes),
// and the resulting VAT.
//
// Classification uses the same taxCategory logic as the rest of the app
// (standard / zero-rated / exempt via utils/vat.js), so the return always
// agrees with invoices and the input/output VAT ledgers.

import { vatBreakdown } from './vat'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const active = (docs, from, to) =>
  (docs || []).filter((d) => d.status !== 'cancelled' && d.status !== 'void' && d.date && d.date >= from && d.date <= to)

// A credit/debit note reduces the same category its lines belong to. Notes
// with no line items are classified by whether they carried any VAT.
const noteBreakdown = (notes) => vatBreakdown(notes)

const sumVat = (docs) => docs.reduce((s, d) => s + (Number(d.taxAmount) || 0), 0)

/**
 * Build the VAT return for a period.
 * @param {object} data   { invoices, creditNotes, purchases, debitNotes }
 * @param {object} period { from, to }  (ISO dates, inclusive)
 * @returns boxes for the ZATCA form:
 *   sales:     { standard, zero, exempt, total }  each { amount, adjustment, vat }
 *   purchases: { standard, zero, exempt, total }
 *   outputVat, inputVat, netVat  (netVat > 0 ⇒ payable to ZATCA)
 */
export function buildVatReturn({ invoices, creditNotes, purchases, debitNotes }, { from, to }) {
  const inv = active(invoices, from, to)
  const cn = active(creditNotes, from, to)
  const pur = active(purchases, from, to)
  const dn = active(debitNotes, from, to)

  const s = vatBreakdown(inv)
  const sAdj = noteBreakdown(cn)
  const p = vatBreakdown(pur)
  const pAdj = noteBreakdown(dn)

  const outputVat = r2(sumVat(inv) - sumVat(cn))
  const inputVat = r2(sumVat(pur) - sumVat(dn))

  const line = (amount, adjustment, vat) => ({ amount: r2(amount), adjustment: r2(-adjustment), vat: r2(vat) })

  const sales = {
    standard: line(s.standard, sAdj.standard, sumVat(inv) - sumVat(cn)),
    zero: line(s.zero, sAdj.zero, 0),
    exempt: line(s.exempt, sAdj.exempt, 0),
  }
  sales.total = {
    amount: r2(sales.standard.amount + sales.zero.amount + sales.exempt.amount),
    adjustment: r2(sales.standard.adjustment + sales.zero.adjustment + sales.exempt.adjustment),
    vat: outputVat,
  }

  const purch = {
    standard: line(p.standard, pAdj.standard, sumVat(pur) - sumVat(dn)),
    zero: line(p.zero, pAdj.zero, 0),
    exempt: line(p.exempt, pAdj.exempt, 0),
  }
  purch.total = {
    amount: r2(purch.standard.amount + purch.zero.amount + purch.exempt.amount),
    adjustment: r2(purch.standard.adjustment + purch.zero.adjustment + purch.exempt.adjustment),
    vat: inputVat,
  }

  return { sales, purchases: purch, outputVat, inputVat, netVat: r2(outputVat - inputVat) }
}

/** Calendar quarters of a year as { id, label, from, to }. */
export function yearQuarters(year) {
  return [1, 2, 3, 4].map((q) => {
    const m0 = (q - 1) * 3
    const from = `${year}-${String(m0 + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, m0 + 3, 0).getDate()
    const to = `${year}-${String(m0 + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return { id: `Q${q}`, label: `Q${q} ${year}`, from, to }
  })
}
