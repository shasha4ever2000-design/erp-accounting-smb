// A 13-week rolling cash forecast, built from what the books already know.
//
// Every input here is already in the ledger: invoices carry a due date, bills
// carry a due date, cheques carry the date written on them, and the recurring
// schedules carry their next run date. Nobody has to key a forecast in — the
// question "can I make payroll in six weeks" is answerable from data the system
// captured while doing ordinary bookkeeping.
//
// Three things this module refuses to do, because each one is how a cash
// forecast quietly starts lying:
//
//   1. It never treats an overdue invoice as if it will arrive on time. Money
//      that was due three weeks ago and has not landed is reported separately,
//      not dropped into week 1 to flatter the opening balance.
//   2. It labels every projected amount with how firm it is. An invoice already
//      issued is a different kind of number from an estimate of next month's
//      payroll, and showing them in one undifferentiated total invites a
//      decision the data does not support.
//   3. It mirrors what the system will actually post. Recurring invoices are
//      generated with one month's terms (see `postDueRecurring` in store.js),
//      so the cash is projected on that basis rather than on the generation
//      date — otherwise the forecast and reality drift apart by 30 days.
//
// Pure functions over plain data throughout: no store import, so the whole
// engine is testable without mounting the app.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Certainty tiers, strongest first. Drives both grouping and the UI legend. */
export const CERTAINTY = {
  COMMITTED: 'committed',   // a document exists: issued invoice, received bill, written cheque
  SCHEDULED: 'scheduled',   // a schedule exists and will run: recurring items, leases, transfers
  ESTIMATED: 'estimated',   // derived from standing data: payroll off active headcount
}

export const CERTAINTY_ORDER = [CERTAINTY.COMMITTED, CERTAINTY.SCHEDULED, CERTAINTY.ESTIMATED]

/** The projection sources a user can switch on and off. */
export const SOURCES = [
  { key: 'receivables', label: 'Customer invoices', dir: 'in',  certainty: CERTAINTY.COMMITTED },
  { key: 'chequesIn',   label: 'Cheques received',  dir: 'in',  certainty: CERTAINTY.COMMITTED },
  { key: 'recurringIn', label: 'Recurring invoices', dir: 'in', certainty: CERTAINTY.SCHEDULED },
  { key: 'payables',    label: 'Supplier bills',    dir: 'out', certainty: CERTAINTY.COMMITTED },
  { key: 'chequesOut',  label: 'Cheques issued',    dir: 'out', certainty: CERTAINTY.COMMITTED },
  { key: 'recurringOut',label: 'Recurring expenses', dir: 'out', certainty: CERTAINTY.SCHEDULED },
  { key: 'leases',      label: 'Leases & rent',     dir: 'out', certainty: CERTAINTY.SCHEDULED },
  { key: 'transfers',   label: 'Loan & card payments', dir: 'out', certainty: CERTAINTY.SCHEDULED },
  { key: 'payroll',     label: 'Payroll (estimate)', dir: 'out', certainty: CERTAINTY.ESTIMATED },
]

export const ALL_SOURCES = SOURCES.map((s) => s.key)

/**
 * Move a date forward by one period.
 *
 * Month-based steps preserve the day of month, clamped to the target month's
 * last day, so 31 Jan → 28/29 Feb rather than drifting into March. This is the
 * same rule the store applies when it actually posts a schedule; `store.js`
 * delegates here so the forecast and the posting can never disagree.
 */
export function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14)
  else {
    const add = frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 1
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + add)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, lastDay))
  }
  return d.toISOString().slice(0, 10)
}

/** `days` after an ISO date, as an ISO date. */
export function shiftDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Walk a recurring schedule forward, yielding each run date inside a window.
 *
 * Guarded against a schedule whose frequency the caller does not recognise:
 * if `advanceDate` fails to move the cursor the loop would spin forever, so it
 * stops rather than hanging the page.
 */
export function occurrences(startDate, frequency, { until, endDate = null, cap = 60 } = {}) {
  const out = []
  if (!startDate || !until) return out
  let cursor = startDate
  let guard = 0
  while (cursor <= until && guard < cap) {
    if (endDate && cursor > endDate) break
    out.push(cursor)
    const next = advanceDate(cursor, frequency)
    if (!next || next <= cursor) break   // unknown frequency — refuse to spin
    cursor = next
    guard++
  }
  return out
}

const openAmount = (doc) => r2((Number(doc.total) || 0) - (Number(doc.amountPaid) || 0))

/** A document is still live if it is neither void nor an opening-balance stub. */
const isLive = (doc) => doc && doc.status !== 'void' && !doc.isOpening

/**
 * Every projected cash movement in the window, as a flat signed list.
 *
 * `amount` is positive for money in and negative for money out, so callers can
 * sum without branching. `overdue` marks an item whose due date has already
 * passed — it is kept out of the weekly grid deliberately (see the header).
 */
export function forecastEvents(data = {}, opts = {}) {
  const {
    invoices = [], purchases = [], cheques = [], recurringInvoices = [],
    recurringExpenses = [], leases = [], employees = [], scheduledTransfers = [],
    accounts = [], settings = {},
  } = data

  const from = opts.from
  const until = opts.until
  const include = opts.include || ALL_SOURCES
  const payrollDay = Math.min(Math.max(Number(opts.payrollDay) || 28, 1), 28)
  const on = (key) => include.includes(key)
  const events = []

  const push = (e) => {
    if (!e.date || !Number.isFinite(e.amount) || r2(e.amount) === 0) return
    // Anything genuinely before the window (a schedule that already elapsed) is
    // not a forecast — the ledger already has it, or it is overdue.
    if (e.date > until) return
    events.push({ ...e, amount: r2(e.amount), overdue: e.date < from })
  }

  // ── Committed: money customers already owe us ──
  if (on('receivables')) {
    invoices.filter((i) => isLive(i) && ['sent', 'partial'].includes(i.status)).forEach((i) => {
      push({
        date: i.dueDate || i.date, source: 'receivables', certainty: CERTAINTY.COMMITTED,
        label: i.customerName || 'Customer', ref: i.number, amount: openAmount(i),
      })
    })
  }

  // ── Committed: money we already owe suppliers ──
  if (on('payables')) {
    purchases.filter((p) => isLive(p) && ['received', 'partial'].includes(p.status)).forEach((p) => {
      push({
        date: p.dueDate || p.date, source: 'payables', certainty: CERTAINTY.COMMITTED,
        label: p.supplierName || 'Supplier', ref: p.number, amount: -openAmount(p),
      })
    })
  }

  // ── Committed: cheques, which are dated instruments and the clearest signal
  //    of all — a post-dated cheque is a known amount on a known day. ──
  cheques.filter((c) => c && !['cleared', 'bounced', 'cancelled'].includes(c.status)).forEach((c) => {
    const incoming = c.direction === 'received'
    if (incoming && !on('chequesIn')) return
    if (!incoming && !on('chequesOut')) return
    push({
      date: c.dueDate, source: incoming ? 'chequesIn' : 'chequesOut',
      certainty: CERTAINTY.COMMITTED, label: c.partyName || (incoming ? 'Customer cheque' : 'Supplier cheque'),
      ref: c.number || c.chequeNumber || '', amount: incoming ? Number(c.amount) || 0 : -(Number(c.amount) || 0),
    })
  })

  // ── Scheduled: recurring invoices.
  //    The cash does not arrive when the invoice is generated — the system
  //    issues it on one month's terms, so project the receipt accordingly. ──
  if (on('recurringIn')) {
    recurringInvoices.filter((r) => r && r.status === 'active' && r.nextDate).forEach((r) => {
      // Generation can fall before the window and still land cash inside it.
      occurrences(r.nextDate, r.frequency, { until, endDate: r.endDate, cap: 60 }).forEach((issueDate) => {
        push({
          date: advanceDate(issueDate, 'monthly'), source: 'recurringIn', certainty: CERTAINTY.SCHEDULED,
          label: r.customerName || 'Recurring invoice', ref: r.number, amount: Number(r.total) || 0,
        })
      })
    })
  }

  // ── Scheduled: recurring expenses ──
  if (on('recurringOut')) {
    recurringExpenses.filter((r) => r && r.status !== 'paused' && r.nextDate).forEach((r) => {
      const gross = (Number(r.amount) || 0) * (1 + (Number(r.taxRate) || 0) / 100)
      occurrences(r.nextDate, r.frequency, { until, endDate: r.endDate, cap: 60 }).forEach((d) => {
        push({
          date: d, source: 'recurringOut', certainty: CERTAINTY.SCHEDULED,
          label: r.name || r.supplierName || 'Recurring expense', ref: '', amount: -gross,
        })
      })
    })
  }

  // ── Scheduled: lease and rent commitments ──
  if (on('leases')) {
    leases.filter((l) => l && l.status === 'active' && (Number(l.monthlyRent) || 0) > 0).forEach((l) => {
      // Rent runs monthly from the start date; a lease that began long ago
      // should project from the next due month, not replay its whole history.
      let first = l.startDate || from
      let guard = 0
      while (first < from && guard < 600) { first = advanceDate(first, 'monthly'); guard++ }
      occurrences(first, 'monthly', { until, endDate: l.endDate, cap: 24 }).forEach((d) => {
        push({
          date: d, source: 'leases', certainty: CERTAINTY.SCHEDULED,
          label: l.name || 'Lease', ref: l.number || '', amount: -(Number(l.monthlyRent) || 0),
        })
      })
    })
  }

  // ── Scheduled: transfers that actually leave the cash pool.
  //    A bank-to-bank sweep nets to zero across the business, so counting it
  //    would invent an outflow that never happens. Only a transfer whose
  //    destination is a liability — repaying a loan or a credit card — is a
  //    real reduction in cash. The fee is always real. ──
  if (on('transfers')) {
    const typeOf = (id) => accounts.find((a) => a.id === id)?.type
    scheduledTransfers.filter((s) => s && s.active !== false && s.nextDate).forEach((s) => {
      const repaysDebt = typeOf(s.toAccountId) === 'liability'
      const principal = repaysDebt ? Number(s.amount) || 0 : 0
      const fee = Number(s.fee) || 0
      if (principal + fee <= 0) return
      occurrences(s.nextDate, s.frequency, { until, endDate: s.endDate, cap: 60 }).forEach((d) => {
        push({
          date: d, source: 'transfers', certainty: CERTAINTY.SCHEDULED,
          label: s.reference || (repaysDebt ? 'Debt repayment' : 'Transfer fee'),
          ref: '', amount: -(principal + fee),
        })
      })
    })
  }

  // ── Estimated: payroll.
  //    There is no pay-run schedule in the books, so this is derived from
  //    active headcount and is the softest number in the forecast. It is
  //    tiered as an estimate and can be switched off. ──
  if (on('payroll')) {
    const monthly = employees
      .filter((e) => e && e.status !== 'inactive')
      .reduce((s, e) => s + (Number(e.salary) || 0), 0)
    if (monthly > 0) {
      const firstOfMonth = `${from.slice(0, 7)}-01`
      const seed = `${firstOfMonth.slice(0, 8)}${String(payrollDay).padStart(2, '0')}`
      let d = seed < from ? advanceDate(seed, 'monthly') : seed
      occurrences(d, 'monthly', { until, cap: 12 }).forEach((day) => {
        push({
          date: day, source: 'payroll', certainty: CERTAINTY.ESTIMATED,
          label: 'Payroll', ref: `${employees.filter((e) => e.status !== 'inactive').length} staff`,
          amount: -monthly,
        })
      })
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Bucket the projected events into weeks and run the running cash balance.
 *
 * @param {object} data   ledger slices (see `forecastEvents`)
 * @param {object} opts
 * @param {string} opts.from         ISO date the forecast starts (usually today)
 * @param {number} opts.weeks        how many weeks to project (default 13)
 * @param {number} opts.openingCash  cash + bank balance right now
 * @param {string[]} opts.include    which sources to project
 * @param {boolean} opts.collectOverdue  fold overdue into week 1 (default false)
 */
export function buildForecast(data = {}, opts = {}) {
  const from = opts.from || new Date().toISOString().slice(0, 10)
  const weekCount = Math.max(1, Number(opts.weeks) || 13)
  const openingCash = r2(opts.openingCash)
  const until = shiftDays(from, weekCount * 7 - 1)

  // `transformEvents` is the seam scenario planning hangs off: it rewrites the
  // projected events — delaying collections, scaling revenue, adding a hire —
  // and everything below aggregates them exactly as it aggregates the real
  // ones. A scenario that reimplemented the weekly roll-up would sooner or
  // later disagree with the forecast it claims to be a variation of.
  const raw = forecastEvents(data, { ...opts, from, until })
  const events = typeof opts.transformEvents === 'function'
    ? opts.transformEvents(raw, { from, until })
    : raw
  const overdueEvents = events.filter((e) => e.overdue)
  const futureEvents = events.filter((e) => !e.overdue)

  const sumIn = (list) => r2(list.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0))
  const sumOut = (list) => r2(list.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0))

  const overdue = {
    events: overdueEvents,
    inflows: sumIn(overdueEvents),
    outflows: sumOut(overdueEvents),
    net: r2(sumIn(overdueEvents) - sumOut(overdueEvents)),
  }

  // Overdue money is real but its timing is unknown. It stays out of the
  // running balance unless the user explicitly asks to assume it lands now.
  let running = opts.collectOverdue ? r2(openingCash + overdue.net) : openingCash

  const weeks = []
  for (let i = 0; i < weekCount; i++) {
    const start = shiftDays(from, i * 7)
    const end = shiftDays(from, i * 7 + 6)
    const inWeek = futureEvents.filter((e) => e.date >= start && e.date <= end)
    const inflows = sumIn(inWeek)
    const outflows = sumOut(inWeek)
    const net = r2(inflows - outflows)
    const opening = running
    running = r2(opening + net)
    weeks.push({
      index: i + 1, start, end, events: inWeek,
      inflows, outflows, net, opening, closing: running,
    })
  }

  const lowestWeek = weeks.reduce((lo, w) => (lo === null || w.closing < lo.closing ? w : lo), null)
  const shortfall = weeks.find((w) => w.closing < 0) || null

  return {
    from, until, weeks, openingCash, overdue,
    closingCash: running,
    totalIn: r2(weeks.reduce((s, w) => s + w.inflows, 0)),
    totalOut: r2(weeks.reduce((s, w) => s + w.outflows, 0)),
    netChange: r2(running - (opts.collectOverdue ? r2(openingCash + overdue.net) : openingCash)),
    lowest: lowestWeek ? { week: lowestWeek.index, date: lowestWeek.end, amount: lowestWeek.closing } : null,
    shortfall: shortfall ? { week: shortfall.index, date: shortfall.start, amount: shortfall.closing } : null,
    // How many whole weeks the business stays solvent on this projection.
    // null means it never goes negative inside the window — not that it is
    // safe forever, which is why the UI says "beyond N weeks" rather than "∞".
    runwayWeeks: shortfall ? shortfall.index - 1 : null,
  }
}

/** Totals per source, for the contribution breakdown under the chart. */
export function bySource(forecast) {
  const rows = new Map()
  const add = (e) => {
    const cur = rows.get(e.source) || { source: e.source, inflow: 0, outflow: 0, count: 0 }
    if (e.amount > 0) cur.inflow = r2(cur.inflow + e.amount)
    else cur.outflow = r2(cur.outflow - e.amount)
    cur.count++
    rows.set(e.source, cur)
  }
  forecast.weeks.forEach((w) => w.events.forEach(add))
  const meta = Object.fromEntries(SOURCES.map((s) => [s.key, s]))
  return [...rows.values()]
    .map((r) => ({ ...r, label: meta[r.source]?.label || r.source, certainty: meta[r.source]?.certainty }))
    .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
}
