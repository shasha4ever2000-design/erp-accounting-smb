// What needs someone's attention today, worked out from the books.
//
// Nothing here is stored: every notification is recomputed from the current
// data, so it disappears by itself once the thing is dealt with (the invoice
// is paid, the stock is reordered). What *is* stored is only which ones the
// user has seen or dismissed, keyed by an id that changes when the situation
// changes — dismiss "3 invoices overdue" and a fourth one brings it back.
import { documentDue, isLiveDoc } from './partyBalance'
import { actionableFor } from './approvals'
import { budgetAlerts } from './budgetAlerts'
import { can } from './permissions'
import { fmtMoney } from './formatters'
import { isTerminal } from './cheques'

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A short, stable fingerprint of which records are involved.
function fingerprint(ids) {
  let h = 0
  for (const ch of ids.slice().sort().join('|')) h = (h * 31 + ch.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}

// Returns the wording with {n} left in, so the screen can translate it first.
const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * @param state   the company store's state
 * @param opts    { today: 'YYYY-MM-DD', user, users, role, overrides }
 * @returns       [{ id, kind, count, tone: 'danger'|'warning'|'info', title, body, path }]
 *                 `title` may contain {n}, to be replaced by `count` after translating.
 */
export function buildNotifications(state, { today, user = null, users = [], role = null, overrides } = {}) {
  const allowed = (area) => !role || can(role, area, 'view', overrides)
  const sym = state.settings?.company?.currencySymbol || ''
  const out = []
  const push = (kind, items, make) => {
    if (!items.length) return
    out.push({ id: `${kind}:${fingerprint(items.map((x) => String(x.id)))}`, kind, count: items.length, ...make(items) })
  }

  if (allowed('sales')) {
    const overdue = (state.invoices || []).filter((i) => isLiveDoc(i) && i.status !== 'draft' && i.dueDate && i.dueDate < today
      && documentDue(i, state.creditNotes, 'invoiceId') > 0.005)
    push('invoices-overdue', overdue, (xs) => ({
      tone: 'danger',
      title: plural(xs.length, '{n} invoice is overdue', '{n} invoices are overdue'),
      body: fmtMoney(xs.reduce((s, i) => s + documentDue(i, state.creditNotes, 'invoiceId') * (Number(i.exchangeRate) || 1), 0), sym)
        + ' · ' + xs.slice(0, 3).map((i) => i.number).join(', ') + (xs.length > 3 ? '…' : ''),
      path: '/payment-reminders',
    }))
  }

  if (allowed('purchases')) {
    const soon = addDays(today, 7)
    const bills = (state.purchases || []).filter((p) => isLiveDoc(p) && p.dueDate && p.dueDate <= soon
      && documentDue(p, state.debitNotes, 'purchaseId') > 0.005)
    const late = bills.filter((p) => p.dueDate < today)
    push('bills-overdue', late, (xs) => ({
      tone: 'danger',
      title: plural(xs.length, '{n} supplier bill is overdue', '{n} supplier bills are overdue'),
      body: xs.slice(0, 3).map((p) => `${p.number}${p.supplierName ? ' · ' + p.supplierName : ''}`).join(', ') + (xs.length > 3 ? '…' : ''),
      path: '/purchases',
    }))
    push('bills-due', bills.filter((p) => p.dueDate >= today), (xs) => ({
      tone: 'warning',
      title: plural(xs.length, '{n} supplier bill is due this week', '{n} supplier bills are due this week'),
      body: fmtMoney(xs.reduce((s, p) => s + documentDue(p, state.debitNotes, 'purchaseId') * (Number(p.exchangeRate) || 1), 0), sym),
      path: '/purchases',
    }))
  }

  if (allowed('inventory')) {
    const low = (state.inventoryItems || []).filter((i) => i.type !== 'service' && i.type !== 'kit'
      && (Number(i.reorderLevel) || 0) > 0 && (Number(i.quantity) || 0) <= Number(i.reorderLevel))
    push('low-stock', low, (xs) => ({
      tone: 'warning',
      title: plural(xs.length, '{n} item is low on stock', '{n} items are low on stock'),
      body: xs.slice(0, 3).map((i) => `${i.name} (${Number(i.quantity) || 0})`).join(', ') + (xs.length > 3 ? '…' : ''),
      path: '/inventory',
    }))
  }

  if (user) {
    const waiting = actionableFor(state.approvalRequests, user, state.settings?.approvals, users)
    push('approvals', waiting, (xs) => ({
      tone: 'info',
      title: plural(xs.length, '{n} request is waiting for your approval', '{n} requests are waiting for your approval'),
      body: '',
      path: '/approvals',
    }))
  }

  if (allowed('banking')) {
    const cheques = (state.cheques || []).filter((c) => !isTerminal(c.status)
      && c.dueDate && c.dueDate <= addDays(today, 3))
    push('cheques-due', cheques, (xs) => ({
      tone: 'warning',
      title: plural(xs.length, '{n} cheque is due', '{n} cheques are due'),
      body: xs.slice(0, 3).map((c) => c.number).filter(Boolean).join(', '),
      path: '/cheques',
    }))
  }

  if (allowed('hr')) {
    const until = addDays(today, 30)
    const ending = (state.employmentContracts || []).filter((c) => c.status !== 'terminated' && c.endDate && c.endDate >= today && c.endDate <= until)
    push('contracts-ending', ending, (xs) => ({
      tone: 'info',
      title: plural(xs.length, '{n} employee contract ends within 30 days', '{n} employee contracts end within 30 days'),
      body: '',
      path: '/contracts',
    }))
  }

  if (allowed('accounting')) {
    // Last month still open ten days into this one.
    const [y, m, d] = today.split('-').map(Number)
    const lastMonthEnd = addDays(`${y}-${String(m).padStart(2, '0')}-01`, -1)
    const lock = state.settings?.accounting?.lockDate || ''
    const hasBooks = (state.journalEntries || []).some((je) => je.date && je.date <= lastMonthEnd)
    if (d >= 10 && hasBooks && lock < lastMonthEnd) {
      out.push({
        id: `month-open:${lastMonthEnd}`, kind: 'month-open', count: 1, tone: 'info',
        title: 'Last month is not closed yet',
        body: 'Run the month-end checklist and lock the period so it cannot change.',
        path: '/period-close',
      })
    }

    const year = today.slice(0, 4)
    if ((state.budgets || []).length && typeof state.getAccountBalance === 'function') {
      const over = budgetAlerts({
        accounts: state.accounts || [], budgets: state.budgets, year, asOf: new Date(today + 'T12:00:00'),
        getActual: (id) => state.getAccountBalance(id, `${year}-01-01`, `${year}-12-31`),
      }).filter((a) => a.severity === 'over')
      push('budget-over', over, (xs) => ({
        tone: 'warning',
        title: plural(xs.length, '{n} account is over budget', '{n} accounts are over budget'),
        body: '',
        path: '/budgets',
      }))
    }
  }

  return out
}

/** The notifications still showing, and how many the user hasn't opened the bell to see. */
export function visibleNotifications(all, { dismissed = {}, seen = {} } = {}) {
  const list = all.filter((n) => !dismissed[n.id])
  return { list, unseen: list.filter((n) => !seen[n.id]).length }
}
