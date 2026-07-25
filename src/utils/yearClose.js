// Year-end close helpers. This app follows the computed-retained-earnings
// model (like Manager.io): profit rolls into equity automatically on the
// balance sheet, so closing a fiscal year never posts a closing journal.
// "Closing" = verify the year's books, record the result, and lock the period.
// All functions are pure over plain data so they are unit-testable.

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (y, m) => new Date(y, m, 0).getDate() // m is 1-based

/**
 * Bounds of the fiscal year *ending* in `endYear`.
 * fyStartMonth is 1-based ('01' = January ⇒ FY equals the calendar year).
 */
export function fiscalYearBounds(fyStartMonth, endYear) {
  const m = Number(fyStartMonth) || 1
  if (m === 1) return { label: `FY ${endYear}`, start: `${endYear}-01-01`, end: `${endYear}-12-31` }
  const endMonth = m - 1
  return {
    label: `FY ${endYear}`,
    start: `${endYear - 1}-${pad(m)}-01`,
    end: `${endYear}-${pad(endMonth)}-${lastDay(endYear, endMonth)}`,
  }
}

/** The fiscal years (ascending) that contain any journal activity. */
export function listFiscalYears(journalEntries, fyStartMonth) {
  const years = new Set()
  ;(journalEntries || []).forEach((je) => {
    if (!je.date) return
    const y = Number(je.date.slice(0, 4))
    const b = fiscalYearBounds(fyStartMonth, y)
    // A date after this FY's end belongs to the FY ending next year.
    years.add(je.date <= b.end ? y : y + 1)
  })
  return [...years].sort().map((y) => fiscalYearBounds(fyStartMonth, y))
}

/**
 * Pre-close review checks for a fiscal year. Returns [{ id, label, ok, count }].
 * These are warnings, not blockers — the accountant decides.
 */
export function preCloseChecks({ journalEntries, stockAdjustments, expenseClaims, payrollRuns, workOrders }, { start, end }) {
  const inFy = (d) => d && d >= start && d <= end
  const checks = []

  let unbalanced = 0
  ;(journalEntries || []).forEach((je) => {
    if (!inFy(je.date)) return
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    if (Math.abs(dr - cr) > 0.02) unbalanced++
  })
  checks.push({ id: 'balanced', label: 'All journal entries balance', ok: unbalanced === 0, count: unbalanced })

  const pendingAdj = (stockAdjustments || []).filter((a) => a.status === 'pending' && inFy(a.date)).length
  checks.push({ id: 'adjustments', label: 'No stock adjustments awaiting approval', ok: pendingAdj === 0, count: pendingAdj })

  const pendingClaims = (expenseClaims || []).filter((c) => c.status === 'pending' && inFy(c.date)).length
  checks.push({ id: 'claims', label: 'No expense claims awaiting approval', ok: pendingClaims === 0, count: pendingClaims })

  const draftPayroll = (payrollRuns || []).filter((r) => r.status === 'draft' && inFy(r.payDate || r.createdAt?.slice(0, 10))).length
  checks.push({ id: 'payroll', label: 'No draft payroll runs', ok: draftPayroll === 0, count: draftPayroll })

  const openWOs = (workOrders || []).filter((w) => ['draft', 'in_progress'].includes(w.status) && inFy(w.createdAt?.slice(0, 10))).length
  checks.push({ id: 'workorders', label: 'No open work orders started in the year', ok: openWOs === 0, count: openWOs })

  // Outstanding VAT as of year end (control-account movement net of settlements).
  let vat = 0
  ;(journalEntries || []).forEach((je) => {
    if (!je.date || je.date > end) return
    je.lines.forEach((l) => {
      if (l.accountId === 'acc-vatout') vat += (l.credit || 0) - (l.debit || 0)
      if (l.accountId === 'acc-vatin') vat -= (l.debit || 0) - (l.credit || 0)
    })
  })
  vat = Math.round(vat * 100) / 100
  checks.push({ id: 'vat', label: 'VAT settled through year end', ok: Math.abs(vat) < 0.02, count: vat })

  return checks
}

/**
 * P&L summary + retained-earnings roll-forward for a fiscal year.
 * `movement(accountTypeFilter, from, to)` is injected so the caller can reuse
 * its balance computation.
 */
export function yearSummary(accounts, journalEntries, { start, end }) {
  const typeOf = Object.fromEntries((accounts || []).map((a) => [a.id, a.type]))
  let revenue = 0, expenses = 0, openingRE = 0
  ;(journalEntries || []).forEach((je) => {
    if (!je.date || je.date > end) return
    const inFy = je.date >= start
    je.lines.forEach((l) => {
      const ty = typeOf[l.accountId]
      if (ty === 'revenue') { const v = (l.credit || 0) - (l.debit || 0); if (inFy) revenue += v; else openingRE += v }
      if (ty === 'expense') { const v = (l.debit || 0) - (l.credit || 0); if (inFy) expenses += v; else openingRE -= v }
    })
  })
  const r2 = (n) => Math.round(n * 100) / 100
  revenue = r2(revenue); expenses = r2(expenses); openingRE = r2(openingRE)
  const netIncome = r2(revenue - expenses)
  return { revenue, expenses, netIncome, openingRE, closingRE: r2(openingRE + netIncome) }
}
