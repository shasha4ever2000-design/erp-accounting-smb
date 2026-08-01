// VAT tax categories for ZATCA / KSA VAT-return classification.
//
// Every sales/purchase line carries a `taxCategory`. The category drives the
// rate charged and, crucially, tells the VAT return which box a net amount
// belongs in — standard-rated, zero-rated, or exempt are reported separately
// on the Saudi VAT return even though the last two both charge 0% VAT.

export const VAT_CATEGORIES = [
  { id: 'standard', label: 'Standard rated', ar: 'خاضع للنسبة الأساسية' },
  { id: 'zero', label: 'Zero-rated', ar: 'خاضع لنسبة صفرية' },
  { id: 'exempt', label: 'Exempt', ar: 'معفى' },
]

export const vatCatLabel = (id) => (VAT_CATEGORIES.find((c) => c.id === id) || VAT_CATEGORIES[0]).label

// The VAT rate a category implies. Standard uses the company's configured
// rate; zero-rated and exempt are always 0%.
export function vatCatRate(catId, standardRate) {
  return catId === 'standard' ? (Number(standardRate) || 0) : 0
}

// Classify a stored line for reporting, tolerant of legacy rows saved before
// tax categories existed: any tax actually charged ⇒ standard-rated, otherwise
// fall back to zero-rated (matching the old "zero-rated / exempt" bucket).
export function lineVatCategory(line) {
  if (line?.taxCategory) return line.taxCategory
  return (Number(line?.taxAmount) || Number(line?.taxRate)) > 0 ? 'standard' : 'zero'
}

const normCat = (cat) => (cat === 'exempt' ? 'exempt' : cat === 'zero' ? 'zero' : 'standard')

/**
 * The taxable base of each document, grouped by VAT category.
 *
 * This has to agree with the VAT actually charged, because the return reports
 * the two side by side and any reader — or auditor — divides one by the other.
 * A line's stored `subtotal` is not that base on its own: a whole-document
 * discount and a shipping charge are both applied above the line level by
 * `invoiceTotals`, and both move the base.
 *
 * Falls back to a document-level classification when a record has no line
 * items. Documents carrying neither a discount nor shipping — credit and debit
 * notes, and anything created before those fields existed — are unaffected.
 */
export function vatBreakdown(docs) {
  const out = { standard: 0, zero: 0, exempt: 0 }
  ;(docs || []).forEach((d) => {
    const lines = d.items || []
    const per = { standard: 0, zero: 0, exempt: 0 }

    if (lines.length === 0) {
      per[(Number(d.taxAmount) || 0) > 0 ? 'standard' : 'zero'] += Number(d.subtotal) || 0
    } else {
      lines.forEach((l) => { per[normCat(lineVatCategory(l))] += Number(l.subtotal) || 0 })
    }

    // A whole-document discount spreads pro-rata across every line, so it
    // scales each category's base by the same factor — which is exactly how
    // invoiceTotals scales the VAT it charges. Leaving it out declared a gross
    // base against a net VAT figure: a 10% discount on a standard-rated
    // invoice reported VAT of 135 against a base of 1000, implying 13.5%.
    const lineNet = per.standard + per.zero + per.exempt
    const discount = Number(d.docDiscountAmount) || 0
    if (discount > 0 && lineNet > 0) {
      const keep = Math.max(0, (lineNet - discount) / lineNet)
      per.standard *= keep; per.zero *= keep; per.exempt *= keep
    }

    // Shipping sits on top of the lines and the document discount never
    // touches it, but it is part of the supply and carries its own VAT, so it
    // belongs in the base. Standard-rated when VAT was charged on it;
    // otherwise it joins the same no-tax-charged bucket lineVatCategory
    // already falls back to.
    const shipping = Number(d.shipping) || 0
    if (shipping > 0) per[d.shippingTaxable ? 'standard' : 'zero'] += shipping

    out.standard += per.standard
    out.zero += per.zero
    out.exempt += per.exempt
  })
  return out
}
