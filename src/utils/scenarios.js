// Scenario planning.
//
// The cash forecast answers "what happens if things go as expected". The
// questions that actually keep an owner awake are the other ones: can I
// afford to hire someone; what happens if my biggest customer pays a month
// late; what if sales fall a fifth. Those are decisions, and a forecast that
// only models the expected case cannot inform any of them.
//
// A scenario here is a set of levers applied to the projected events, after
// which the ordinary forecast machinery does the rest. Nothing re-implements
// the weekly roll-up, the trough or the runway — a variation that computed
// those differently would eventually contradict the forecast it claims to be
// a variation of.
//
// ── The distinction that makes this honest ───────────────────────────
//
// A fall in sales does not un-sell what has already been invoiced. Money a
// customer already owes is committed: it is affected by *when* they pay, not
// by whether the business wins new work. So a revenue lever moves only the
// estimated and scheduled parts of the projection — recurring invoices,
// pipeline — and leaves receivables alone.
//
// Scaling receivables by a sales lever would be modelling customers refusing
// to pay for goods already delivered, which is a different and much worse
// scenario. Getting this wrong makes every downturn look roughly twice as bad
// as it is, and the business plans for a crisis it is not in.
//
// ── And the caveat that comes with it ────────────────────────────────
//
// A scenario is a projection of a projection. It inherits every assumption
// the base forecast makes and adds more on top. It is a way of asking which
// decisions are survivable, not a prediction — and the UI says so, because a
// number this easy to produce is dangerously easy to believe.

import { shiftDays, CERTAINTY } from './cashForecast'

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Sources that represent work already sold and billed. */
export const COMMITTED_SOURCES = new Set(['receivables', 'payables', 'cheques', 'loans', 'tax'])

/** Sources a change in trading actually moves. */
export const TRADING_INFLOW_SOURCES = new Set(['recurring', 'pipeline'])

export const LEVERS = [
  { key: 'salesChangePct', label: 'Change in sales', unit: '%', min: -100, max: 200, step: 5,
    hint: 'Moves future revenue only. Invoices already raised are money owed, not sales still to win.' },
  { key: 'costChangePct', label: 'Change in costs', unit: '%', min: -100, max: 200, step: 5,
    hint: 'Scales projected outgoings other than committed bills and loan repayments.' },
  { key: 'collectionDelayDays', label: 'Customers pay later by', unit: 'days', min: -60, max: 180, step: 5,
    hint: 'Pushes every expected receipt back. The single most common cause of a cash crisis in a profitable business.' },
  { key: 'overdueRecoveryPct', label: 'Overdue actually collected', unit: '%', min: 0, max: 100, step: 5,
    hint: 'How much of what is already late you expect to see, and it is counted from today.' },
]

export const emptyScenario = () => ({
  name: '',
  salesChangePct: 0,
  costChangePct: 0,
  collectionDelayDays: 0,
  overdueRecoveryPct: null,   // null = leave the base forecast's treatment alone
  oneOffs: [],                // { label, amount (signed), date, recurring, months }
})

/** Ready-made questions worth asking, phrased as the owner would ask them. */
export const PRESETS = [
  { key: 'downturn', name: 'Sales fall by a fifth', patch: { salesChangePct: -20 } },
  { key: 'lateCustomers', name: 'Customers pay 30 days later', patch: { collectionDelayDays: 30 } },
  { key: 'squeeze', name: 'Sales fall and customers pay late', patch: { salesChangePct: -20, collectionDelayDays: 30 } },
  { key: 'costsUp', name: 'Costs rise a tenth', patch: { costChangePct: 10 } },
  { key: 'noOverdue', name: 'None of the overdue money arrives', patch: { overdueRecoveryPct: 0 } },
]

/**
 * Rewrite the projected events according to the levers.
 *
 * Order matters: amounts are scaled before dates are moved, so a delayed
 * receipt is the scaled amount arriving later rather than the original one.
 */
export function applyLevers(events = [], scenario = {}, { from = '' } = {}) {
  const s = { ...emptyScenario(), ...scenario }
  const salesFactor = 1 + (Number(s.salesChangePct) || 0) / 100
  const costFactor = 1 + (Number(s.costChangePct) || 0) / 100
  const delay = Math.round(Number(s.collectionDelayDays) || 0)

  const out = []
  events.forEach((e) => {
    let amount = e.amount
    let date = e.date

    if (e.overdue) {
      // Overdue money is handled by its own lever, and only that one — its
      // timing is already unknown, so delaying it further means nothing.
      if (s.overdueRecoveryPct != null) {
        const keep = Math.max(0, Math.min(100, Number(s.overdueRecoveryPct))) / 100
        amount = r2(amount * keep)
        if (amount === 0) return
      }
      out.push({ ...e, amount })
      return
    }

    if (amount > 0) {
      // Only revenue still to be won moves with a sales lever. See the header:
      // scaling receivables here would model customers refusing to pay.
      if (TRADING_INFLOW_SOURCES.has(e.source) || (!COMMITTED_SOURCES.has(e.source) && e.certainty === CERTAINTY.ESTIMATED)) {
        amount = r2(amount * salesFactor)
      }
      // Getting paid later applies to money coming in from customers, however
      // it was projected — that is what "customers pay later" means.
      if (delay !== 0 && (e.source === 'receivables' || TRADING_INFLOW_SOURCES.has(e.source))) {
        date = shiftDays(date, delay)
      }
    } else if (amount < 0) {
      // A bill already received and a loan repayment already agreed do not
      // move because trading costs rose.
      if (!COMMITTED_SOURCES.has(e.source)) amount = r2(amount * costFactor)
    }

    if (amount === 0) return
    out.push({ ...e, amount, date, shifted: date !== e.date })
  })

  // One-offs the user added: a hire, a machine, a loan drawdown.
  ;(s.oneOffs || []).forEach((o, i) => {
    const amount = r2(Number(o.amount) || 0)
    if (!amount || !o.date) return
    const months = o.recurring ? Math.max(1, Math.round(Number(o.months) || 12)) : 1
    for (let m = 0; m < months; m++) {
      const d = new Date(o.date)
      if (Number.isNaN(d.getTime())) break
      d.setUTCMonth(d.getUTCMonth() + m)
      const date = d.toISOString().slice(0, 10)
      if (from && date < from) continue
      out.push({
        date, amount, source: 'scenario', certainty: CERTAINTY.ESTIMATED,
        label: o.label || 'Scenario item', ref: `SC-${i + 1}`, overdue: false, scenario: true,
      })
    }
  })

  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/** Is any lever actually doing something? */
export const isActive = (scenario = {}) => {
  const s = { ...emptyScenario(), ...scenario }
  return !!(s.salesChangePct || s.costChangePct || s.collectionDelayDays
    || s.overdueRecoveryPct != null || (s.oneOffs || []).length)
}

/**
 * Compare a scenario against the base case.
 *
 * The four figures a decision actually turns on: how much cash is left at the
 * end, how low it gets on the way, whether it goes negative at all, and when.
 * `survives` is the answer to the question being asked.
 */
export function compareForecasts(base, scenario) {
  const closing = r2((scenario?.closingCash || 0) - (base?.closingCash || 0))
  const lowest = r2((scenario?.lowest?.amount || 0) - (base?.lowest?.amount || 0))

  const baseRunway = base?.runwayWeeks
  const scenarioRunway = scenario?.runwayWeeks
  // null runway means it never ran out inside the window — which is better
  // than any number, so it cannot be compared as one.
  let runwayChange = null
  if (baseRunway != null && scenarioRunway != null) runwayChange = scenarioRunway - baseRunway
  else if (baseRunway == null && scenarioRunway != null) runwayChange = 'became_negative'
  else if (baseRunway != null && scenarioRunway == null) runwayChange = 'no_longer_negative'

  return {
    closingChange: closing,
    lowestChange: lowest,
    baseLowest: base?.lowest?.amount ?? null,
    scenarioLowest: scenario?.lowest?.amount ?? null,
    baseRunway,
    scenarioRunway,
    runwayChange,
    survives: !scenario?.shortfall,
    shortfall: scenario?.shortfall || null,
    // Worth stating plainly: a scenario inherits every assumption the base
    // forecast makes, and adds its own on top.
    projectionOfProjection: true,
  }
}

/** Run one scenario through the ordinary forecast machinery. */
export function runScenario(buildForecast, data, opts, scenario) {
  return buildForecast(data, {
    ...opts,
    // The lever owns the overdue treatment when it is set, so the base flag
    // must not also apply it — that would count the same money twice.
    collectOverdue: scenario?.overdueRecoveryPct != null ? true : opts.collectOverdue,
    transformEvents: (events, ctx) => applyLevers(events, scenario, ctx),
  })
}

export const VERDICT = {
  safe: 'This scenario stays in cash throughout.',
  tight: 'This scenario survives, but the buffer gets thin.',
  breaks: 'This scenario runs out of cash.',
}

/** A one-line answer, which is what the question deserves. */
export function verdictOf(forecast, { tightBelow = 0.1 } = {}) {
  if (!forecast) return null
  if (forecast.shortfall) return { key: 'breaks', week: forecast.shortfall.week, date: forecast.shortfall.date }
  const opening = Math.abs(forecast.openingCash) || 1
  const lowest = forecast.lowest?.amount ?? 0
  if (lowest < opening * tightBelow) return { key: 'tight', week: forecast.lowest?.week, amount: lowest }
  return { key: 'safe', week: forecast.lowest?.week, amount: lowest }
}
