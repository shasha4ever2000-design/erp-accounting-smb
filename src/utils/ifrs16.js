// IFRS 16 lease measurement.
//
// The chart of accounts has carried "Right-of-Use Assets" (1620) and "Lease
// Liability" (2500) since the beginning, but nothing ever posted to either:
// recordLeasePayment books Dr Rent Expense / Cr Bank, which is the old IAS 17
// operating-lease treatment. The accounts looked like IFRS 16 support without
// being it, which is worse than not having them — anyone preparing IFRS
// statements with leases was materially misstated and had no way to tell.
//
// This module does the measurement. It deliberately does not change how
// existing leases post: a lease keeps its current expense treatment unless it
// is explicitly recognised under IFRS 16, because silently re-basing live
// books would be a far worse failure than the gap it fixes.
//
// What the standard requires of a lessee:
//   - At commencement, recognise a liability at the present value of the lease
//     payments not yet made, discounted at the rate implicit in the lease or,
//     when that is not readily determinable, the incremental borrowing rate.
//   - Recognise a right-of-use asset at that liability plus initial direct
//     costs and prepayments, less any lease incentives received.
//   - Afterwards, unwind the liability at amortised cost (interest accretes,
//     payments reduce) and depreciate the asset straight-line over the shorter
//     of the lease term and the asset's useful life.
//   - Short-term (12 months or less) and low-value leases may be kept as a
//     straight-line expense. That exemption is a policy choice, so it is
//     offered rather than assumed.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

export const IN_ADVANCE = 'advance'   // payment at the start of each period (typical rent)
export const IN_ARREARS = 'arrears'   // payment at the end of each period

/** IFRS 16.5 — the short-term exemption threshold, in months. */
export const SHORT_TERM_MONTHS = 12

/**
 * The periodic discount rate for a monthly lease.
 *
 * Taken as the simple annual rate divided by twelve. The standard does not
 * prescribe a compounding convention, and dividing is what lease-accounting
 * practice and the worked examples in the guidance use; compounding the
 * effective rate instead would move every liability by a few tenths of a
 * percent and disagree with the schedules auditors expect to see.
 */
export function monthlyRate(annualRatePct) {
  const a = Number(annualRatePct) || 0
  return a / 100 / 12
}

/**
 * Present value of `n` level payments of `payment` at periodic rate `rate`.
 *
 * A zero rate is not a degenerate case to guard against — it is a real input
 * (an interest-free lease), and the annuity formula divides by the rate, so it
 * is handled explicitly rather than allowed to produce NaN.
 */
export function presentValue(payment, n, rate, timing = IN_ADVANCE) {
  const p = Number(payment) || 0
  const periods = Math.max(0, Math.floor(Number(n) || 0))
  if (!periods || !p) return 0
  if (!rate) return r2(p * periods)
  const annuity = (k) => (1 - Math.pow(1 + rate, -k)) / rate
  // In advance, the first payment happens at commencement and is not
  // discounted at all; the remaining n-1 form an ordinary annuity.
  const pv = timing === IN_ADVANCE ? p * (1 + annuity(periods - 1)) : p * annuity(periods)
  return r2(pv)
}

/**
 * Initial measurement of the lease.
 *
 * @param {object} lease
 * @param {number} lease.payment        amount of each periodic payment
 * @param {number} lease.termMonths     lease term
 * @param {number} lease.annualRate     discount rate, percent per year
 * @param {string} lease.timing         IN_ADVANCE | IN_ARREARS
 * @param {number} lease.initialCosts   initial direct costs (added to the asset)
 * @param {number} lease.prepaid        payments made before commencement
 * @param {number} lease.incentives     incentives received (deducted from the asset)
 */
export function initialMeasurement(lease = {}) {
  const {
    payment = 0, termMonths = 0, annualRate = 0, timing = IN_ADVANCE,
    initialCosts = 0, prepaid = 0, incentives = 0,
  } = lease
  const rate = monthlyRate(annualRate)
  const liability = presentValue(payment, termMonths, rate, timing)
  // IFRS 16.24 — the asset starts from the liability, then picks up costs the
  // lessee incurred to get the asset and gives back any incentive received.
  const rouAsset = r2(liability + (Number(initialCosts) || 0) + (Number(prepaid) || 0) - (Number(incentives) || 0))
  return { liability, rouAsset, rate, timing, termMonths }
}

/**
 * The liability unwind, period by period.
 *
 * The final closing balance is forced to exactly zero. Rounding each period to
 * cents leaves a few cents of drift over a long term, and a lease liability
 * that still shows $0.03 after the last payment is the kind of thing that
 * stops a balance sheet reconciling; the residual is absorbed into the last
 * period's interest, which is where the rounding actually arose.
 */
export function liabilitySchedule(lease = {}) {
  const { liability, rate, timing, termMonths } = initialMeasurement(lease)
  const payment = Number(lease.payment) || 0
  const rows = []
  let opening = liability

  for (let i = 1; i <= termMonths; i++) {
    let interest, closing
    if (timing === IN_ADVANCE) {
      // Payment first, then interest on what is left outstanding.
      const afterPayment = opening - payment
      interest = r2(afterPayment * rate)
      closing = r2(afterPayment + interest)
    } else {
      interest = r2(opening * rate)
      closing = r2(opening + interest - payment)
    }
    const principal = r2(payment - interest)
    rows.push({
      period: i, opening: r2(opening), payment: r2(payment),
      interest: r2(interest), principal, closing: r2(closing),
    })
    opening = closing
  }

  if (rows.length) {
    const last = rows[rows.length - 1]
    if (last.closing !== 0) {
      last.interest = r2(last.interest - last.closing)
      last.principal = r2(last.payment - last.interest)
      last.closing = 0
    }
  }
  return rows
}

/**
 * Straight-line depreciation of the right-of-use asset.
 *
 * Over the shorter of the lease term and the asset's useful life (IFRS 16.32).
 * The final period absorbs the rounding remainder so the asset lands exactly
 * at its residual rather than a few cents above or below it.
 */
export function depreciationSchedule(lease = {}) {
  const { rouAsset } = initialMeasurement(lease)
  const life = Number(lease.usefulLifeMonths) || 0
  const term = Number(lease.termMonths) || 0
  const periods = life > 0 ? Math.min(life, term) : term
  if (!periods || rouAsset <= 0) return []

  const per = r2(rouAsset / periods)
  const rows = []
  let carrying = rouAsset
  for (let i = 1; i <= periods; i++) {
    const charge = i === periods ? r2(carrying) : per
    carrying = r2(carrying - charge)
    rows.push({ period: i, charge, carrying })
  }
  return rows
}

/** Both schedules aligned period by period, which is what the UI shows. */
export function leaseSchedule(lease = {}) {
  const liab = liabilitySchedule(lease)
  const dep = depreciationSchedule(lease)
  const { liability, rouAsset } = initialMeasurement(lease)
  const rows = liab.map((l, i) => ({
    ...l,
    depreciation: dep[i]?.charge ?? 0,
    carryingAmount: dep[i]?.carrying ?? 0,
    // What actually hits the P&L this period under IFRS 16 — front-loaded,
    // because interest is highest when the liability is largest. This is the
    // number that differs most from the old straight-line rent charge.
    periodExpense: r2((dep[i]?.charge ?? 0) + l.interest),
  }))
  return {
    liability, rouAsset, rows,
    totalInterest: r2(liab.reduce((s, r) => s + r.interest, 0)),
    totalPayments: r2(liab.reduce((s, r) => s + r.payment, 0)),
    totalDepreciation: r2(dep.reduce((s, r) => s + r.charge, 0)),
  }
}

/**
 * Whether a lease qualifies for one of the recognition exemptions.
 *
 * Reported rather than applied: IFRS 16.5 makes both a policy election, and an
 * entity that has chosen to capitalise everything is entitled to do so.
 */
export function exemption(lease = {}, { lowValueThreshold = 0 } = {}) {
  const term = Number(lease.termMonths) || 0
  if (term > 0 && term <= SHORT_TERM_MONTHS && !lease.purchaseOption) {
    return { exempt: true, reason: 'short-term', detail: `Term is ${term} months (12 or fewer)` }
  }
  const value = Number(lease.assetValue) || 0
  if (lowValueThreshold > 0 && value > 0 && value <= lowValueThreshold) {
    return { exempt: true, reason: 'low-value', detail: `Underlying asset is worth ${value}` }
  }
  return { exempt: false, reason: null, detail: null }
}

/** Journal lines recognising the lease at commencement. */
export function recognitionLines(lease = {}, accounts = {}) {
  const { liability, rouAsset } = initialMeasurement(lease)
  if (liability <= 0 && rouAsset <= 0) return []
  const rou = accounts.rouAccountId || 'acc-rou'
  const liabAcc = accounts.liabilityAccountId || 'acc-leasepay'
  const bank = accounts.bankAccountId || 'acc-bank1'
  const lines = [{ accountId: rou, debit: rouAsset, credit: 0, description: 'Right-of-use asset' }]
  if (liability > 0) lines.push({ accountId: liabAcc, debit: 0, credit: liability, description: 'Lease liability' })
  // Initial direct costs and prepayments were paid out; incentives came in.
  const cash = r2((Number(lease.initialCosts) || 0) + (Number(lease.prepaid) || 0) - (Number(lease.incentives) || 0))
  if (cash > 0) lines.push({ accountId: bank, debit: 0, credit: cash, description: 'Initial costs and prepayments' })
  else if (cash < 0) lines.push({ accountId: bank, debit: -cash, credit: 0, description: 'Lease incentive received' })
  return lines
}

/**
 * Journal lines for one period: interest, depreciation and the payment.
 *
 * Returns null when the period falls outside the schedule, so a caller that
 * over-runs the term posts nothing rather than an unbalanced entry.
 */
export function periodLines(lease = {}, period, accounts = {}) {
  const { rows } = leaseSchedule(lease)
  const row = rows.find((r) => r.period === period)
  if (!row) return null
  const liabAcc = accounts.liabilityAccountId || 'acc-leasepay'
  const intAcc = accounts.interestAccountId || 'acc-interest'
  const depExp = accounts.depreciationExpenseId || 'acc-depexp'
  const accDep = accounts.accumulatedDepreciationId || 'acc-roudepr'
  const bank = accounts.bankAccountId || 'acc-bank1'

  const lines = []
  if (row.interest > 0) {
    lines.push({ accountId: intAcc, debit: row.interest, credit: 0, description: 'Lease interest' })
    lines.push({ accountId: liabAcc, debit: 0, credit: row.interest, description: 'Lease interest accrued' })
  }
  if (row.payment > 0) {
    lines.push({ accountId: liabAcc, debit: row.payment, credit: 0, description: 'Lease payment' })
    lines.push({ accountId: bank, debit: 0, credit: row.payment, description: 'Lease payment' })
  }
  if (row.depreciation > 0) {
    lines.push({ accountId: depExp, debit: row.depreciation, credit: 0, description: 'Right-of-use depreciation' })
    lines.push({ accountId: accDep, debit: 0, credit: row.depreciation, description: 'Right-of-use depreciation' })
  }
  return { row, lines }
}

/**
 * How IFRS 16 differs from straight-line rent over the life of the lease.
 *
 * Total cost is identical — the standard changes when the expense falls, not
 * how much it is. Showing that plainly is what stops the first year's jump
 * looking like an error.
 */
export function compareToStraightLine(lease = {}) {
  const { rows, totalInterest, totalDepreciation, totalPayments } = leaseSchedule(lease)
  const straightLinePerPeriod = rows.length ? r2(totalPayments / rows.length) : 0
  const firstYear = rows.slice(0, 12)
  return {
    ifrs16Total: r2(totalInterest + totalDepreciation),
    straightLineTotal: totalPayments,
    straightLinePerPeriod,
    firstYearIfrs16: r2(firstYear.reduce((s, r) => s + r.periodExpense, 0)),
    firstYearStraightLine: r2(straightLinePerPeriod * firstYear.length),
  }
}
