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

// Sum a document's line subtotals grouped by VAT category. Falls back to a
// document-level classification when a record has no line items.
export function vatBreakdown(docs) {
  const out = { standard: 0, zero: 0, exempt: 0 }
  docs.forEach((d) => {
    const lines = d.items || []
    if (lines.length === 0) {
      const cat = (Number(d.taxAmount) || 0) > 0 ? 'standard' : 'zero'
      out[cat] += d.subtotal || 0
      return
    }
    lines.forEach((l) => {
      const cat = lineVatCategory(l)
      out[cat === 'exempt' ? 'exempt' : cat === 'zero' ? 'zero' : 'standard'] += l.subtotal || 0
    })
  })
  return out
}
