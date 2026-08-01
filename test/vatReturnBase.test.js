import { describe, it, expect } from 'vitest'
import { invoiceTotals } from '../src/utils/lineMath.js'
import { buildVatReturn } from '../src/utils/vatReturn.js'
import { vatBreakdown } from '../src/utils/vat.js'

// The VAT return reports a taxable base next to the VAT charged on it, so the
// two have to sit on the same basis: dividing one by the other must give the
// rate back. A whole-document discount and a shipping charge are both applied
// above the line level, and the base used to be taken from line subtotals
// alone — so both moved the VAT without moving the declared base.
//
// The fourth case below is why this survived a long time: a discount and a
// shipping charge of the same size cancel exactly, and the return looks right.

const RATE = 15
const PERIOD = { from: '2026-04-01', to: '2026-06-30' }

const line = (net, taxCategory = 'standard') => ({
  id: 'l' + net, description: 'Goods', quantity: 1, unitPrice: net,
  discount: 0, taxRate: taxCategory === 'standard' ? RATE : 0, taxCategory,
})

// Build a document exactly the way InvoiceForm / PurchaseForm store one.
function doc({ lines, docDiscount = 0, shipping = 0, shippingTaxable = false }) {
  const t = invoiceTotals(lines, {
    taxEnabled: true,
    docDiscountPct: docDiscount,
    shipping,
    shippingTaxRate: shippingTaxable ? RATE : 0,
  })
  const items = lines.map((l) => {
    const gross = l.quantity * l.unitPrice
    return { ...l, subtotal: gross, taxAmount: Math.round(gross * l.taxRate) / 100 }
  })
  return {
    date: '2026-05-15', status: 'paid', items,
    subtotal: t.netSubtotal, taxAmount: t.taxAmount, total: t.total,
    docDiscount, docDiscountAmount: t.docDiscountAmount,
    shipping: t.shipping, shippingTaxable,
  }
}

const salesReturn = (invoices) =>
  buildVatReturn({ invoices, creditNotes: [], purchases: [], debitNotes: [] }, PERIOD)

describe('the declared base reconciles to the VAT charged', () => {
  const cases = [
    { label: 'plain invoice', cfg: { lines: [line(1000)] }, base: 1000, vat: 150 },
    { label: 'whole-document discount of 10%', cfg: { lines: [line(1000)], docDiscount: 10 }, base: 900, vat: 135 },
    { label: 'taxable shipping', cfg: { lines: [line(1000)], shipping: 100, shippingTaxable: true }, base: 1100, vat: 165 },
    { label: 'discount and shipping together', cfg: { lines: [line(1000)], docDiscount: 10, shipping: 100, shippingTaxable: true }, base: 1000, vat: 150 },
  ]

  cases.forEach(({ label, cfg, base, vat }) => {
    it(`${label}: base ${base}, VAT ${vat}`, () => {
      const r = salesReturn([doc(cfg)])
      expect(r.sales.standard.amount).toBeCloseTo(base, 2)
      expect(r.sales.standard.vat).toBeCloseTo(vat, 2)
      // The property that actually matters, stated directly.
      expect(r.sales.standard.vat / r.sales.standard.amount * 100).toBeCloseTo(RATE, 6)
    })
  })
})

describe('the discount is spread across categories, not taken off one', () => {
  it('scales a standard and a zero-rated line by the same factor', () => {
    // 600 standard + 400 zero = 1000; a 10% document discount leaves 540 / 360.
    const r = salesReturn([doc({ lines: [line(600), line(400, 'zero')], docDiscount: 10 })])
    expect(r.sales.standard.amount).toBeCloseTo(540, 2)
    expect(r.sales.zero.amount).toBeCloseTo(360, 2)
    // VAT was only ever charged on the standard part: 600 * 15% * 0.9.
    expect(r.sales.standard.vat).toBeCloseTo(81, 2)
    expect(r.sales.standard.vat / r.sales.standard.amount * 100).toBeCloseTo(RATE, 6)
  })

  it('leaves an exempt line exempt', () => {
    const r = salesReturn([doc({ lines: [line(500), line(500, 'exempt')], docDiscount: 20 })])
    expect(r.sales.standard.amount).toBeCloseTo(400, 2)
    expect(r.sales.exempt.amount).toBeCloseTo(400, 2)
    expect(r.sales.exempt.vat).toBe(0)
  })
})

describe('shipping lands in the right box', () => {
  it('goes to standard-rated when VAT was charged on it', () => {
    const r = salesReturn([doc({ lines: [line(1000)], shipping: 250, shippingTaxable: true })])
    expect(r.sales.standard.amount).toBeCloseTo(1250, 2)
  })

  it('goes to the no-tax bucket when it was not taxed, never to standard', () => {
    const r = salesReturn([doc({ lines: [line(1000)], shipping: 250, shippingTaxable: false })])
    expect(r.sales.standard.amount).toBeCloseTo(1000, 2)
    expect(r.sales.zero.amount).toBeCloseTo(250, 2)
    // Untaxed shipping must not inflate the standard-rated base.
    expect(r.sales.standard.vat / r.sales.standard.amount * 100).toBeCloseTo(RATE, 6)
  })
})

describe('purchases get the same treatment as sales', () => {
  it('reconciles input VAT to the purchase base', () => {
    const r = buildVatReturn(
      { invoices: [], creditNotes: [], purchases: [doc({ lines: [line(2000)], docDiscount: 5, shipping: 300, shippingTaxable: true })], debitNotes: [] },
      PERIOD
    )
    // 2000 less 5% = 1900, plus 300 taxable shipping = 2200.
    expect(r.purchases.standard.amount).toBeCloseTo(2200, 2)
    expect(r.purchases.standard.vat / r.purchases.standard.amount * 100).toBeCloseTo(RATE, 6)
  })
})

describe('documents that predate these fields are untouched', () => {
  it('ignores a missing docDiscountAmount and shipping', () => {
    const legacy = { date: '2026-05-15', status: 'paid', subtotal: 1000, taxAmount: 150, total: 1150, items: [{ ...line(1000), subtotal: 1000, taxAmount: 150 }] }
    expect(vatBreakdown([legacy])).toEqual({ standard: 1000, zero: 0, exempt: 0 })
  })

  it('still classifies a document with no line items at all', () => {
    const noLines = { date: '2026-05-15', status: 'paid', subtotal: 500, taxAmount: 75, total: 575 }
    expect(vatBreakdown([noLines])).toEqual({ standard: 500, zero: 0, exempt: 0 })
  })

  it('credit notes carry neither field, so they behave exactly as before', () => {
    const cn = { date: '2026-05-20', status: 'issued', subtotal: 200, taxAmount: 30, items: [{ ...line(200), subtotal: 200, taxAmount: 30 }] }
    const r = buildVatReturn({ invoices: [doc({ lines: [line(1000)] })], creditNotes: [cn], purchases: [], debitNotes: [] }, PERIOD)
    expect(r.sales.standard.adjustment).toBeCloseTo(-200, 2)
    expect(r.outputVat).toBeCloseTo(120, 2) // 150 charged less 30 credited
  })
})
