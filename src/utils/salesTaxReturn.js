// US-style sales tax report: tax is collected on sales to the final consumer
// and remitted to the state/local authority — there is no input-tax recovery
// on purchases the way there is under VAT/GST. So this report only looks at
// the sales side: taxable sales, exempt sales, and tax collected.
//
// Known limitation: if tax was recorded on a purchase (e.g. paid sales tax on
// a non-resale item), this app still posts it to the generic Tax Receivable
// account like a VAT system would — a sales-tax business should book that as
// a cost instead. Flagged here rather than silently misreporting it.

import { vatBreakdown } from './vat'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const active = (docs, from, to) => (docs || []).filter((d) => d.status !== 'cancelled' && d.status !== 'void' && d.date && d.date >= from && d.date <= to)

export function buildSalesTaxReturn({ invoices, creditNotes }, { from, to }) {
  const inv = active(invoices, from, to)
  const cn = active(creditNotes, from, to)
  const sales = vatBreakdown(inv)
  const salesAdj = vatBreakdown(cn)

  const taxable = r2(sales.standard - salesAdj.standard)
  const exempt = r2(sales.zero + sales.exempt - salesAdj.zero - salesAdj.exempt)
  const collected = r2(inv.reduce((s, d) => s + (Number(d.taxAmount) || 0), 0) - cn.reduce((s, d) => s + (Number(d.taxAmount) || 0), 0))

  return { taxable, exempt, totalSales: r2(taxable + exempt), collected }
}
