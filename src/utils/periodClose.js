// The month-end checklist.
//
// Closing a month is a handful of jobs that are each easy to forget: charge
// depreciation, post what the schedules owe, reconcile the bank, revalue
// foreign-currency balances, clear the approval queue, check the books still
// add up — then lock the period so nothing changes under the reported
// numbers. This works out, from the books themselves, which of those are done
// for a given period end. It posts nothing; the page links to where each job
// is done.

import { runIntegrityCheck } from './integrityCheck'

const inPeriod = (d, from, to) => !!d && d >= from && d <= to

/**
 * @param {object} state   a store snapshot
 * @param {string} from    first day of the period (YYYY-MM-DD)
 * @param {string} to      last day of the period (YYYY-MM-DD)
 * @returns {Array<{ id, label, status: 'done'|'todo'|'na', detail, count?, link }>}
 */
export function periodCloseChecklist(state, { from, to }) {
  const s = state || {}
  const items = []
  // `detail` is an English template with {n} / {d} placeholders, so the page
  // can translate it and fill the numbers in afterwards.
  const add = (id, label, status, detail, link, count, extra = {}) => items.push({ id, label, status, detail, link, count, params: { n: count, ...extra } })

  // 1. Depreciation: every active straight-line asset bought by the period
  //    end should carry a charge dated inside the period.
  const assets = (s.fixedAssets || []).filter((a) => a.status === 'active' && a.purchaseDate && a.purchaseDate <= to
    && (a.depreciationMethod || 'straight_line') === 'straight_line'
    && (a.accumulatedDepreciation || 0) < (a.purchaseCost || 0) - (a.salvageValue || 0) - 0.005)
  const charged = new Set((s.assetDepreciations || []).filter((d) => inPeriod(d.date, from, to)).map((d) => d.assetId))
  const owed = assets.filter((a) => !charged.has(a.id))
  if (!assets.length) add('depreciation', 'Depreciation charged', 'na', 'No assets to depreciate.', '/fixed-assets')
  else add('depreciation', 'Depreciation charged', owed.length ? 'todo' : 'done',
    owed.length ? '{n} asset(s) have no charge in this period.' : 'Every active asset is charged.', '/fixed-assets', owed.length)

  // 2. Recurring schedules due by the period end.
  const due = [
    ...(s.recurringInvoices || []).map((r) => ({ ...r, kind: 'invoice' })),
    ...(s.recurringJournals || []).map((r) => ({ ...r, kind: 'journal' })),
    ...(s.recurringExpenses || []).map((r) => ({ ...r, kind: 'expense' })),
  ].filter((r) => (r.status || 'active') === 'active' && r.nextDate && r.nextDate <= to)
  add('recurring', 'Recurring items posted', due.length ? 'todo' : 'done',
    due.length ? '{n} schedule(s) are due on or before the period end.' : 'Nothing due.', '/recurring-journals', due.length)

  // 3. Bank reconciliation: bank lines up to the period end not ticked off.
  const recon = new Set(s.reconciliations || [])
  const banks = (s.bankAccounts || []).filter((b) => b.type !== 'cash' && b.accountId)
  let open = 0
  banks.forEach((b) => {
    ;(s.journalEntries || []).forEach((je) => {
      if (!je.date || je.date > to) return
      if (!(je.lines || []).some((l) => l.accountId === b.accountId)) return
      if (!recon.has(`${b.id}::${je.id}`) && !recon.has(`${b.accountId}::${je.id}`)) open++
    })
  })
  if (!banks.length) add('bank', 'Bank reconciled', 'na', 'No bank accounts.', '/reconciliation')
  else add('bank', 'Bank reconciled', open ? 'todo' : 'done',
    open ? '{n} bank line(s) up to the period end are not reconciled.' : 'All bank lines are reconciled.', '/reconciliation', open)

  // 4. FX revaluation: needed only if anything is held in a foreign currency.
  const base = s.settings?.company?.currency
  const foreign = (s.invoices || []).some((i) => i.currency && i.currency !== base && i.status !== 'void' && (i.total || 0) - (i.amountPaid || 0) > 0.005)
    || (s.purchases || []).some((p) => p.currency && p.currency !== base && p.status !== 'void' && (p.total || 0) - (p.amountPaid || 0) > 0.005)
    || (s.accounts || []).some((a) => a.currency && a.currency !== base)
  const revalued = (s.fxRevaluations || []).some((r) => inPeriod(r.date, from, to))
  if (!foreign) add('fx', 'Foreign currency revalued', 'na', 'No foreign-currency balances.', '/revaluation')
  else add('fx', 'Foreign currency revalued', revalued ? 'done' : 'todo',
    revalued ? 'Revaluation posted in this period.' : 'Foreign-currency balances have not been revalued at the period end.', '/revaluation')

  // 5. Approvals waiting.
  const pending = (s.approvalRequests || []).filter((r) => r.status === 'pending').length
    + (s.stockAdjustments || []).filter((a) => a.status === 'pending').length
    + (s.expenseClaims || []).filter((c) => c.status === 'pending').length
  add('approvals', 'Nothing waiting for approval', pending ? 'todo' : 'done',
    pending ? '{n} request(s), adjustment(s) or claim(s) are waiting.' : 'The approval queue is empty.', '/approvals', pending)

  // 6. The books add up.
  const integrity = runIntegrityCheck(s)
  add('integrity', 'Integrity check passes', integrity.ok ? 'done' : 'todo',
    integrity.ok ? 'All {p} checks pass.' : '{n} check(s) fail — see Settings → Integrity check.', '/settings', integrity.failed, { p: integrity.passed })

  // 7. Locked.
  const lock = s.settings?.accounting?.lockDate || ''
  add('lock', 'Period locked', lock && lock >= to ? 'done' : 'todo',
    lock && lock >= to ? 'Locked through {d}.' : 'Lock the period once everything above is done.', '/settings', undefined, { d: lock })

  return items
}

/** First and last day of the month containing `iso` (YYYY-MM-DD). */
export function monthBounds(iso) {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}
