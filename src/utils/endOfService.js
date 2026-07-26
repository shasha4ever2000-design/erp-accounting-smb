// End-of-service benefit (gratuity).
//
// In the GCC an employee accrues a lump sum for every year worked, payable
// when they leave. It is a real liability that grows every month, and a small
// company that ignores it until somebody resigns discovers it owes several
// months' payroll it never provided for. So the point of this file is not the
// leaving-day calculation — it is the accrual that should have been on the
// balance sheet all along.
//
// Two rule sets ship:
//
// **saudi** — Saudi Labour Law, articles 84 and 85. Half a month's wage for
// each of the first five years, a full month for each year after that, on the
// last wage. On resignation the award is scaled: nothing under two years, a
// third from two to five, two thirds from five to ten, the whole award at ten.
// On termination by the employer, or on a fixed term simply ending, the full
// award is due.
//
// **simple** — a flat number of days' wage per year, for companies outside
// that régime who just want a provision. No resignation scaling.
//
// The wage used is basic plus housing (see contributoryWage), which is the
// convention the awards were written around. A company that pays everything as
// "other allowances" will get a smaller award, and analyseSalary says so on
// the contract itself rather than surprising anyone here.

import { contributoryWage, serviceYears } from './contracts'

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const num = (v) => Number(v) || 0

export const EOSB_ACCOUNTS = {
  expense: 'acc-eosb-exp',
  provision: 'acc-eosb-prov',
}

export const LEAVE_REASONS = [
  { id: 'termination', label: 'Ended by the employer' },
  { id: 'resignation', label: 'Resigned' },
  { id: 'expiry',      label: 'Fixed term ended' },
  { id: 'retirement',  label: 'Retirement, death or disability' },
]

export const EOSB_RULES = [
  { id: 'saudi',  label: 'Saudi Labour Law (arts. 84–85)' },
  { id: 'simple', label: 'Flat days per year' },
  { id: 'none',   label: 'No end-of-service benefit' },
]

export function defaultEosbSettings() {
  return { rule: 'none', daysPerYear: 21, wageBasis: 'contributory', accrueMonthly: true }
}

/**
 * The fraction of the full award payable, given why someone left.
 *
 * Only the Saudi régime scales; everywhere else leaving is leaving.
 */
export function entitlementFactor(years, reason, rule = 'saudi') {
  if (rule !== 'saudi') return 1
  if (reason !== 'resignation') return 1        // dismissal, expiry, retirement
  if (years < 2) return 0
  if (years < 5) return 1 / 3
  if (years < 10) return 2 / 3
  return 1
}

/**
 * The full award before any resignation scaling, in months of wage.
 *
 * Saudi: half a month for each of the first five years, a full month after.
 * Partial years count pro rata — article 84 is explicit that they do.
 */
export function awardMonths(years, { rule = 'saudi', daysPerYear = 21 } = {}) {
  const y = Math.max(0, Number(years) || 0)
  if (rule === 'none') return 0
  if (rule === 'simple') return (y * (Number(daysPerYear) || 0)) / 30
  const firstFive = Math.min(y, 5)
  const beyond = Math.max(0, y - 5)
  return firstFive * 0.5 + beyond * 1
}

/**
 * What is owed if this employee left on `asAt`.
 *
 * @returns { years, wage, months, factor, gross, award, reason, rule }
 *   `gross` is the unscaled award, `award` is what is actually payable.
 */
export function eosbAward(contract, {
  serviceStart, asAt, reason = 'termination',
  rule = 'saudi', daysPerYear = 21, wageBasis = 'contributory',
} = {}) {
  const start = serviceStart || contract?.startDate
  const years = serviceYears(start, asAt)
  const wage = wageBasis === 'gross'
    ? round2(['basic', 'housing', 'transport', 'other'].reduce((s, k) => s + num(contract?.[k]), 0))
    : contributoryWage(contract)

  const months = awardMonths(years, { rule, daysPerYear })
  const gross = round2(months * wage)
  const factor = entitlementFactor(years, reason, rule)
  return {
    years: Math.round(years * 100) / 100,
    wage, months: Math.round(months * 1000) / 1000,
    factor, gross,
    award: round2(gross * factor),
    reason, rule,
  }
}

/**
 * The provision that should sit on the balance sheet at a date.
 *
 * Accrued on the assumption the employee stays — that is, at the full award,
 * with no resignation discount. Providing only for the discounted figure would
 * mean a company that dismisses someone suddenly finds the provision short,
 * which defeats the purpose of having one.
 */
export function accruedProvision(contract, { serviceStart, asAt, rule = 'saudi', daysPerYear = 21, wageBasis = 'contributory' } = {}) {
  const a = eosbAward(contract, { serviceStart, asAt, reason: 'termination', rule, daysPerYear, wageBasis })
  return a.gross
}

/**
 * The movement to post for a period: what should be provided at the end, less
 * what is already provided.
 *
 * A pay rise makes this jump, because the whole award is computed on the new
 * wage — that is how these schemes work, and the catch-up belongs in the month
 * the rise happened rather than being spread quietly.
 */
export function accrualFor(contract, {
  serviceStart, from, to, alreadyProvided = 0,
  rule = 'saudi', daysPerYear = 21, wageBasis = 'contributory',
} = {}) {
  const closing = accruedProvision(contract, { serviceStart, asAt: to, rule, daysPerYear, wageBasis })
  const opening = from ? accruedProvision(contract, { serviceStart, asAt: from, rule, daysPerYear, wageBasis }) : 0
  const movement = round2(closing - round2(alreadyProvided))
  return {
    opening, closing,
    periodCharge: round2(closing - opening),
    movement,          // what to post, given what the books already hold
  }
}

/** Roll every employee up into one period charge. */
export function accrualSchedule(rows = [], opts = {}) {
  const lines = rows.map((r) => {
    const a = accrualFor(r.contract, {
      serviceStart: r.serviceStart, from: opts.from, to: opts.to,
      alreadyProvided: r.alreadyProvided || 0,
      rule: opts.rule, daysPerYear: opts.daysPerYear, wageBasis: opts.wageBasis,
    })
    return { employeeId: r.employeeId, employeeName: r.employeeName, ...a }
  })
  return {
    lines,
    total: round2(lines.reduce((s, l) => s + l.movement, 0)),
    closing: round2(lines.reduce((s, l) => s + l.closing, 0)),
  }
}

/**
 * The accrual entry: Dr end-of-service expense, Cr the provision.
 *
 * A negative movement — someone's wage fell, or a leaver was settled — reverses
 * the same two accounts rather than inventing a third.
 */
export function accrualLines(amount, { reference = '', expenseAccountId = EOSB_ACCOUNTS.expense, provisionAccountId = EOSB_ACCOUNTS.provision } = {}) {
  const v = round2(amount)
  if (v === 0) return []
  const text = `End-of-service accrual${reference ? ` — ${reference}` : ''}`
  return v > 0
    ? [
      { accountId: expenseAccountId, debit: v, credit: 0, description: text },
      { accountId: provisionAccountId, debit: 0, credit: v, description: text },
    ]
    : [
      { accountId: provisionAccountId, debit: -v, credit: 0, description: text },
      { accountId: expenseAccountId, debit: 0, credit: -v, description: text },
    ]
}

/**
 * Settling a leaver.
 *
 * The provision built up for this person is released; anything the award
 * exceeds it by is charged to expense now; anything left over is credited
 * back. The balancing credit is the amount actually payable to them.
 */
export function settlementLines(award, provided, {
  reference = '',
  expenseAccountId = EOSB_ACCOUNTS.expense,
  provisionAccountId = EOSB_ACCOUNTS.provision,
  payableAccountId = 'acc-salpay',
} = {}) {
  const due = round2(award)
  const held = round2(provided)
  if (due <= 0 && held <= 0) return []
  const text = `End-of-service settlement${reference ? ` — ${reference}` : ''}`
  const lines = []

  // Release whatever was provided, but never more than was provided.
  if (held > 0) lines.push({ accountId: provisionAccountId, debit: held, credit: 0, description: `${text} (provision released)` })

  const shortfall = round2(due - held)
  if (shortfall > 0) lines.push({ accountId: expenseAccountId, debit: shortfall, credit: 0, description: `${text} (under-provided)` })
  if (shortfall < 0) lines.push({ accountId: expenseAccountId, debit: 0, credit: -shortfall, description: `${text} (over-provided, released)` })

  if (due > 0) lines.push({ accountId: payableAccountId, debit: 0, credit: due, description: text })
  return lines
}

/** A plain-language account of how a figure was reached. */
export function explainAward(a) {
  if (!a || a.rule === 'none') return 'No end-of-service benefit applies.'
  const y = a.years.toFixed(2)
  if (a.rule === 'simple')
    return `${y} years × ${(a.months / (a.years || 1) * 30).toFixed(0)} days a year on a wage of ${a.wage.toFixed(2)} = ${a.gross.toFixed(2)}.`
  const parts = [`${y} years of service on a wage of ${a.wage.toFixed(2)}`]
  parts.push(a.years <= 5
    ? `half a month per year gives ${a.months.toFixed(2)} months`
    : `half a month for the first five years and a full month after gives ${a.months.toFixed(2)} months`)
  parts.push(`a full award of ${a.gross.toFixed(2)}`)
  if (a.factor === 0) parts.push('but a resignation under two years earns nothing')
  else if (a.factor < 1) parts.push(`scaled to ${Math.round(a.factor * 100)}% on resignation, so ${a.award.toFixed(2)} is payable`)
  return `${parts.join(', ')}.`
}
