// Single source of truth for line-item arithmetic across every sales and
// purchase document (invoices, bills, quotations, purchase orders). Keeping it
// here means a discount is computed identically everywhere, and VAT is always
// charged on the discounted (net) amount — the correct base.
//
// A line's `subtotal` is the NET-of-discount amount, which is what the ledger
// posts as revenue/expense, so the double-entry engine needs no changes.

export function computeLine(line, { taxEnabled = true } = {}) {
  const qty = parseFloat(line?.quantity) || 0
  const price = parseFloat(line?.unitPrice) || 0
  const discPct = Math.min(100, Math.max(0, parseFloat(line?.discount) || 0))
  const rate = taxEnabled ? (parseFloat(line?.taxRate) || 0) : 0

  const gross = Math.round(qty * price * 100) / 100
  const discountAmount = Math.round(gross * (discPct / 100) * 100) / 100
  const subtotal = Math.round((gross - discountAmount) * 100) / 100
  const taxAmount = Math.round(subtotal * (rate / 100) * 100) / 100
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  return { gross, discountAmount, subtotal, taxAmount, total }
}

// Full document math including a whole-document discount and a shipping/freight
// charge. The document discount is a percentage of the net (after line discounts)
// subtotal; because it spreads pro-rata across every line, each line's VAT is
// reduced by the same percentage — so total line VAT simply scales down. Shipping
// is a flat amount that may carry its own VAT.
export function invoiceTotals(items = [], { taxEnabled = true, docDiscountPct = 0, shipping = 0, shippingTaxRate = 0 } = {}) {
  const t = documentTotals(items, { taxEnabled })
  const netSubtotal = t.subtotal
  const dpct = Math.min(100, Math.max(0, Number(docDiscountPct) || 0))
  const docDiscountAmount = Math.round(netSubtotal * (dpct / 100) * 100) / 100
  const afterDoc = Math.round((netSubtotal - docDiscountAmount) * 100) / 100
  const lineVat = Math.round(t.taxAmount * (1 - dpct / 100) * 100) / 100
  const ship = Math.max(0, Number(shipping) || 0)
  const shippingVat = taxEnabled ? Math.round(ship * ((Number(shippingTaxRate) || 0) / 100) * 100) / 100 : 0
  const taxAmount = Math.round((lineVat + shippingVat) * 100) / 100
  const total = Math.round((afterDoc + ship + taxAmount) * 100) / 100
  return { grossSubtotal: t.gross, lineDiscount: t.discount, netSubtotal, docDiscountAmount, afterDoc, shipping: ship, shippingVat, taxAmount, total }
}

// Roll a set of lines up into document totals (all in the document's currency).
export function documentTotals(items = [], opts) {
  return items.reduce(
    (acc, line) => {
      const c = computeLine(line, opts)
      acc.gross += c.gross
      acc.discount += c.discountAmount
      acc.subtotal += c.subtotal
      acc.taxAmount += c.taxAmount
      acc.total += c.total
      return acc
    },
    { gross: 0, discount: 0, subtotal: 0, taxAmount: 0, total: 0 }
  )
}
