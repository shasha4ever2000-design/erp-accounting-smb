// Customer credit control. A customer's exposure is their outstanding
// receivable, valued in base currency (foreign-currency invoices use the rate
// they were booked at), so a credit limit set in base currency is comparable.

export function invoiceOutstandingBase(inv) {
  if (!inv || inv.status === 'void' || inv.status === 'cancelled') return 0
  const rate = Number(inv.exchangeRate) || 1
  const outstandingFc = (inv.total || 0) - (inv.amountPaid || 0)
  return Math.max(0, Math.round(outstandingFc * rate * 100) / 100)
}

/**
 * What this customer currently owes.
 *
 * Credit notes come off: a customer sitting on credits is not exposed for their
 * face value, and counting them anyway refused sales to people who were nowhere
 * near their limit. `creditNotes` is optional so older callers still work, but
 * every caller inside the app passes it.
 */
export function customerExposure(customerId, invoices, excludeId = null, creditNotes = []) {
  if (!customerId) return 0
  const owed = (invoices || []).reduce((s, inv) => {
    if (inv.customerId !== customerId) return s
    if (excludeId && inv.id === excludeId) return s
    return s + invoiceOutstandingBase(inv)
  }, 0)
  const credited = (creditNotes || []).reduce((s, cn) => {
    if (cn.customerId !== customerId) return s
    if (cn.status === 'void' || cn.status === 'cancelled') return s
    return s + (Number(cn.total) || 0) * (Number(cn.exchangeRate) || 1)
  }, 0)
  return Math.round(Math.max(0, owed - credited) * 100) / 100
}

// Credit picture for a customer, optionally including a new base-currency amount
// about to be invoiced.
export function creditStatus(customer, invoices, addingBase = 0, creditNotes = []) {
  const limit = Number(customer?.creditLimit) || 0
  const exposure = customerExposure(customer?.id, invoices, null, creditNotes)
  const projected = Math.round((exposure + (Number(addingBase) || 0)) * 100) / 100
  const hasLimit = limit > 0
  return {
    limit,
    exposure,
    projected,
    hasLimit,
    available: hasLimit ? Math.round((limit - exposure) * 100) / 100 : null,
    over: hasLimit && exposure > limit + 0.005,
    willExceed: hasLimit && projected > limit + 0.005,
  }
}
