// IAS 12 — Income Taxes: deferred tax on temporary differences.
//
// Tax is charged on taxable profit, but the accounts report accounting profit,
// and the two rarely agree in any given year. A machine depreciated over five
// years in the books may attract capital allowances over three; a provision is
// an expense today and a deduction only when it is paid. Those gaps reverse in
// the end — the same money is taxed once — so the tax on them belongs in the
// year the difference arises, not the year it happens to be paid.
//
// That is the whole idea: the *temporary* difference between what an item is
// worth in the books (its carrying amount) and what it is worth to the tax
// authority (its tax base) carries deferred tax with it.
//
// ── The one sign convention ────────────────────────────────────────────
//
// Deferred tax is where implementations get lost, and it is almost always
// signs. Everything here uses one convention, expressed once:
//
//   taxableDifference = carrying − taxBase        for an asset
//   taxableDifference = taxBase − carrying        for a liability
//
//   positive → a TAXABLE difference   → deferred tax LIABILITY
//   negative → a DEDUCTIBLE difference → deferred tax ASSET
//
// So a signed `deferredTax` of +1,000 is a liability and −1,000 is an asset,
// everywhere in this module, with no per-source special cases. Worked through:
//
//   Machine costing 100, book depreciation 20, capital allowances 40.
//   carrying 80, tax base 60 → +20 taxable → a liability. Correct: the relief
//   has been taken early, so more tax falls due later.
//
//   Receivables of 1,000 with a 100 loss allowance the tax authority will not
//   accept until write-off. carrying 900, tax base 1,000 → −100 deductible →
//   an asset. Correct: the relief is still to come.
//
// ── What is deliberately not done ─────────────────────────────────────
//
// Deferred tax is never discounted (IAS 12.53), so there is no rate here but
// the tax rate. Permanent differences — entertaining, fines, exempt income —
// carry no deferred tax by definition and appear only in the effective-rate
// reconciliation at the bottom.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const pct = (n) => (Number(n) || 0) / 100

export const ASSET = 'asset'
export const LIABILITY = 'liability'

/** Where a difference came from — used for grouping and for the disclosure. */
export const SOURCES = {
  FIXED_ASSETS: 'fixed_assets',
  ROU_ASSETS: 'rou_assets',
  LEASE_LIABILITIES: 'lease_liabilities',
  ECL: 'ecl',
  EOSB: 'eosb',
  LOSSES: 'losses',
  MANUAL: 'manual',
}

export const SOURCE_LABELS = {
  [SOURCES.FIXED_ASSETS]: 'Property, plant and equipment',
  [SOURCES.ROU_ASSETS]: 'Right-of-use assets',
  [SOURCES.LEASE_LIABILITIES]: 'Lease liabilities',
  [SOURCES.ECL]: 'Loss allowance on receivables',
  [SOURCES.EOSB]: 'End-of-service provision',
  [SOURCES.LOSSES]: 'Tax losses carried forward',
  [SOURCES.MANUAL]: 'Other differences',
}

/** Tax depreciation methods. Straight line, or the declining balance most
 *  Gulf and North African regimes use for asset groups. */
export const STRAIGHT_LINE = 'straight_line'
export const DECLINING_BALANCE = 'declining_balance'

// ── One difference ─────────────────────────────────────────────────────

/**
 * The signed temporary difference for a single item.
 *
 * @param {object} o
 * @param {number} o.carrying  carrying amount in the financial statements
 * @param {number} o.taxBase   amount the tax authority attributes to it
 * @param {string} o.kind      ASSET or LIABILITY
 * @returns {number} positive = taxable (liability), negative = deductible (asset)
 */
export function taxableDifference({ carrying = 0, taxBase = 0, kind = ASSET } = {}) {
  const c = Number(carrying) || 0
  const b = Number(taxBase) || 0
  return r2(kind === LIABILITY ? b - c : c - b)
}

/** Deferred tax carried by a difference. Same sign convention. */
export const deferredTaxOn = (difference, ratePct) => r2((Number(difference) || 0) * pct(ratePct))

/** Build one row of the schedule. */
export function differenceRow({ source, label, carrying = 0, taxBase = 0, kind = ASSET, ratePct = 0, detail = '' }) {
  const difference = taxableDifference({ carrying, taxBase, kind })
  return {
    source,
    label: label || SOURCE_LABELS[source] || source,
    kind,
    carrying: r2(carrying),
    taxBase: r2(taxBase),
    difference,
    // Named so a reader never has to work out which way round it is.
    type: difference > 0 ? 'taxable' : difference < 0 ? 'deductible' : 'none',
    deferredTax: deferredTaxOn(difference, ratePct),
    detail,
  }
}

// ── Tax base of a fixed asset ──────────────────────────────────────────

/**
 * Written-down value of an asset for tax purposes at a date.
 *
 * The books depreciate on their own schedule; the tax authority allows its
 * own, and the gap between the two is the largest deferred tax item most
 * businesses have. Allowances are taken for whole years elapsed since
 * purchase — a deliberate simplification, since first-year conventions
 * (half-year, mid-quarter, pro-rata) differ by jurisdiction and cannot be
 * guessed. A per-asset `taxWdvOverride` exists for anyone whose regime does
 * something this cannot express.
 */
export function taxWrittenDownValue(asset = {}, { method = DECLINING_BALANCE, allowanceRatePct = 0, asOf } = {}) {
  if (asset.taxWdvOverride != null) return r2(asset.taxWdvOverride)
  const cost = Number(asset.purchaseCost) || 0
  if (cost <= 0) return 0
  // The capital-allowance rate, which has nothing to do with the rate profits
  // are taxed at. Keeping them as separate arguments is not pedantry: passing
  // one where the other belongs produces a schedule that looks entirely
  // plausible and is wrong in every row.
  const rate = pct(asset.allowanceRatePct != null ? asset.allowanceRatePct : allowanceRatePct)
  if (rate <= 0) return r2(cost)

  const start = asset.purchaseDate ? new Date(asset.purchaseDate) : null
  const end = asOf ? new Date(asOf) : new Date()
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return r2(cost)
  const years = Math.max(0, Math.floor((end - start) / (365.25 * 24 * 3600 * 1000)))
  if (years === 0) return r2(cost)

  const m = asset.taxMethod || method
  if (m === STRAIGHT_LINE) return r2(Math.max(0, cost - cost * rate * years))
  // Declining balance never quite reaches zero, which is how these regimes
  // actually work — the pool carries a residue until the asset is disposed of.
  return r2(cost * Math.pow(1 - rate, years))
}

/**
 * One row per depreciable asset still on the books.
 *
 * @param {object} o
 * @param {number} o.ratePct           rate profits are taxed at
 * @param {number} o.allowanceRatePct  rate capital allowances are given at
 */
export function fixedAssetDifferences(assets = [], { ratePct = 0, allowanceRatePct = 0, method = DECLINING_BALANCE, asOf } = {}) {
  return (assets || [])
    .filter((a) => a && a.status !== 'disposed' && (Number(a.purchaseCost) || 0) > 0)
    .map((a) => {
      const carrying = a.currentBookValue != null
        ? Number(a.currentBookValue)
        : (Number(a.purchaseCost) || 0) - (Number(a.accumulatedDepreciation) || 0)
      const taxBase = taxWrittenDownValue(a, { method, allowanceRatePct, asOf })
      return differenceRow({
        source: SOURCES.FIXED_ASSETS,
        label: a.name || a.number || 'Asset',
        carrying, taxBase, kind: ASSET, ratePct,
        detail: a.number || '',
      })
    })
    .filter((r) => r.difference !== 0)
}

// ── Everything the ledger already knows ────────────────────────────────

/**
 * Differences that can be read straight off account balances.
 *
 * Carrying amounts come from the ledger rather than being rebuilt from
 * subledgers, because the ledger is what the financial statements report and
 * therefore what the difference has to be measured against. A reconstruction
 * that disagreed with the balance sheet would produce deferred tax on a
 * balance sheet nobody is publishing.
 *
 * `natural(id)` must return the account's signed natural balance: debits less
 * credits for assets and expenses, credits less debits for everything else.
 * Contra accounts therefore come back negative — accumulated depreciation and
 * the loss allowance are both assets with credit balances — and the arithmetic
 * below relies on that, so carrying amounts are *added* rather than
 * subtracted. Getting this backwards doubles the difference instead of
 * cancelling it.
 *
 * @param {(id: string) => number} natural  signed natural balance of an account
 */
export function ledgerDifferences(natural, { ratePct = 0, accounts = {} } = {}) {
  const id = {
    rou: 'acc-rou', rouDep: 'acc-roudepr', leaseLiability: 'acc-leasepay',
    ecl: 'acc-ecl', eosb: 'acc-eosb-prov', ...accounts,
  }
  const rows = []

  // Right-of-use assets and lease liabilities. Where tax follows the cash rent
  // — the common case, and the reason IAS 12 was amended in 2021 to require
  // both sides to be recognised — each has a tax base of nil. The two are kept
  // as separate rows rather than netted because they reverse on different
  // timetables and the disclosure is expected to show them apart.
  // Accumulated ROU depreciation is a contra-asset, so its natural balance is
  // already negative and adding it is what nets it off.
  const rouCarrying = r2(natural(id.rou) + natural(id.rouDep))
  if (rouCarrying !== 0) {
    rows.push(differenceRow({ source: SOURCES.ROU_ASSETS, carrying: rouCarrying, taxBase: 0, kind: ASSET, ratePct }))
  }
  const leaseLiability = r2(natural(id.leaseLiability))
  if (leaseLiability !== 0) {
    rows.push(differenceRow({ source: SOURCES.LEASE_LIABILITIES, carrying: leaseLiability, taxBase: 0, kind: LIABILITY, ratePct }))
  }

  // The IFRS 9 loss allowance reduces the carrying amount of receivables while
  // the tax authority still sees the full amount owed, until write-off. The
  // allowance is a contra-asset, so its natural balance is negative — and that
  // negative carrying amount against a nil tax base is exactly the deductible
  // difference wanted, with no sign juggling.
  const allowance = r2(natural(id.ecl))
  if (allowance !== 0) {
    rows.push(differenceRow({
      source: SOURCES.ECL,
      carrying: allowance, taxBase: 0, kind: ASSET, ratePct,
      detail: 'Allowance not yet deductible',
    }))
  }

  // End-of-service benefits: an expense when earned, a deduction when paid.
  const eosb = r2(natural(id.eosb))
  if (eosb !== 0) {
    rows.push(differenceRow({ source: SOURCES.EOSB, carrying: eosb, taxBase: 0, kind: LIABILITY, ratePct }))
  }

  return rows
}

/** Unused tax losses, which carry a deferred tax asset of their own. */
export function lossRow(lossesCarriedForward = 0, ratePct = 0) {
  const loss = Math.max(0, Number(lossesCarriedForward) || 0)
  if (loss === 0) return null
  return {
    source: SOURCES.LOSSES,
    label: SOURCE_LABELS[SOURCES.LOSSES],
    kind: ASSET,
    carrying: 0,
    taxBase: r2(loss),
    // A loss is relief still to come, so it behaves as a deductible difference.
    difference: r2(-loss),
    type: 'deductible',
    deferredTax: deferredTaxOn(-loss, ratePct),
    detail: 'Available to offset future taxable profit',
  }
}

/** Rows the user entered by hand, for anything this cannot infer. */
export function manualRows(entries = [], ratePct = 0) {
  return (entries || [])
    .filter((e) => e && (Number(e.carrying) || Number(e.taxBase)))
    .map((e) => differenceRow({
      source: SOURCES.MANUAL,
      label: e.label || 'Other difference',
      carrying: e.carrying, taxBase: e.taxBase,
      kind: e.kind === LIABILITY ? LIABILITY : ASSET,
      ratePct, detail: e.detail || '',
    }))
}

// ── Recoverability ─────────────────────────────────────────────────────

/**
 * How much of the deferred tax asset may actually be recognised.
 *
 * IAS 12.24 allows a deferred tax asset only to the extent that future taxable
 * profit is probable. The order of the test matters and is easy to get wrong:
 * IAS 12.28 says a deferred tax *liability* reversing in the same period is
 * itself evidence of future taxable profit. So the asset is set against
 * liabilities first, without needing any judgement at all, and only the excess
 * is subject to the probability assessment.
 *
 * Getting this backwards — applying a haircut to the whole asset — understates
 * the asset and overstates tax expense in exactly the years a struggling
 * business can least afford it.
 */
export function assessRecoverability({ grossAsset = 0, grossLiability = 0, recognitionPct = 100 } = {}) {
  const asset = Math.abs(r2(grossAsset))
  const liability = Math.abs(r2(grossLiability))
  const coveredByLiabilities = Math.min(asset, liability)
  const excess = r2(asset - coveredByLiabilities)
  const recognisedExcess = r2(excess * pct(Math.max(0, Math.min(100, recognitionPct))))
  const recognised = r2(coveredByLiabilities + recognisedExcess)
  return {
    grossAsset: asset,
    coveredByLiabilities,
    excess,
    recognised,
    unrecognised: r2(asset - recognised),
  }
}

// ── The schedule ───────────────────────────────────────────────────────

/**
 * Build the whole deferred tax position at a date.
 *
 * @param {object} src
 * @param {Array}  src.fixedAssets
 * @param {(id: string) => number} src.natural   natural balance of an account
 * @param {object} o
 * @param {number} o.ratePct          rate profits are taxed at, expected to apply
 *                                   when the differences reverse (IAS 12.47)
 * @param {number} o.allowanceRatePct default capital-allowance rate — a
 *                                   different thing entirely from o.ratePct
 * @param {string} o.assetTaxMethod
 * @param {number} o.lossesCarriedForward
 * @param {number} o.recognitionPct  how much of the excess asset is probable
 * @param {boolean} o.offset         present net (IAS 12.74)
 * @param {Array}  o.manual
 * @param {string} o.asOf
 */
export function buildDeferredTax(src = {}, o = {}) {
  const {
    ratePct = 0, allowanceRatePct = 0, assetTaxMethod = DECLINING_BALANCE,
    lossesCarriedForward = 0, recognitionPct = 100, offset = true,
    manual = [], asOf = '',
  } = o
  const natural = src.natural || (() => 0)

  const rows = [
    ...fixedAssetDifferences(src.fixedAssets || [], { ratePct, allowanceRatePct, method: assetTaxMethod, asOf }),
    ...ledgerDifferences(natural, { ratePct, accounts: src.accountIds }),
    ...manualRows(manual, ratePct),
  ]
  const loss = lossRow(lossesCarriedForward, ratePct)
  if (loss) rows.push(loss)

  // Positive deferred tax is a liability, negative an asset — the one
  // convention, applied at the point it decides what appears on the face of
  // the balance sheet.
  const grossLiability = r2(rows.filter((r) => r.deferredTax > 0).reduce((s, r) => s + r.deferredTax, 0))
  const grossAsset = r2(-rows.filter((r) => r.deferredTax < 0).reduce((s, r) => s + r.deferredTax, 0))

  const recoverability = assessRecoverability({ grossAsset, grossLiability, recognitionPct })
  const recognisedAsset = recoverability.recognised
  const net = r2(grossLiability - recognisedAsset)   // positive = net liability

  return {
    asOf,
    ratePct,
    rows,
    grossAsset,
    grossLiability,
    recognisedAsset,
    unrecognisedAsset: recoverability.unrecognised,
    recoverability,
    net,
    // What actually goes on the balance sheet. Offsetting is permitted only
    // where there is a legally enforceable right to set off current tax and
    // the same taxing authority is involved (IAS 12.74) — which is why it is
    // a setting rather than an assumption.
    presented: offset
      ? { asset: net < 0 ? -net : 0, liability: net > 0 ? net : 0, offset: true }
      : { asset: recognisedAsset, liability: grossLiability, offset: false },
  }
}

// ── Posting ────────────────────────────────────────────────────────────

/**
 * The entry that moves the books from where they are to where the schedule
 * says they should be.
 *
 * Posts the *movement*, never the balance. Re-running an assessment must
 * adjust the carrying amount of deferred tax to the level the schedule
 * requires, not add a second helping of it — every entry balances either way,
 * so nothing else in the system would object while the position doubled each
 * time somebody pressed the button.
 *
 * @param {object} schedule  from buildDeferredTax
 * @param {object} existing  { asset, liability } currently on the ledger
 */
export function movementLines(schedule, existing = {}, accounts = {}) {
  const dtaAcc = accounts.assetAccountId || 'acc-dta'
  const dtlAcc = accounts.liabilityAccountId || 'acc-dtl'
  const expAcc = accounts.expenseAccountId || 'acc-taxexp'

  const targetAsset = r2(schedule?.presented?.asset || 0)
  const targetLiability = r2(schedule?.presented?.liability || 0)
  const haveAsset = r2(existing.asset || 0)
  const haveLiability = r2(existing.liability || 0)

  const dAsset = r2(targetAsset - haveAsset)
  const dLiability = r2(targetLiability - haveLiability)
  if (dAsset === 0 && dLiability === 0) return []

  const lines = []
  if (dAsset > 0) lines.push({ accountId: dtaAcc, debit: dAsset, credit: 0, description: 'Deferred tax asset' })
  else if (dAsset < 0) lines.push({ accountId: dtaAcc, debit: 0, credit: -dAsset, description: 'Deferred tax asset' })
  if (dLiability > 0) lines.push({ accountId: dtlAcc, debit: 0, credit: dLiability, description: 'Deferred tax liability' })
  else if (dLiability < 0) lines.push({ accountId: dtlAcc, debit: -dLiability, credit: 0, description: 'Deferred tax liability' })

  // The balancing figure is the deferred tax charge or credit for the period.
  // Recognising an asset or releasing a liability reduces tax expense; the
  // reverse increases it.
  const charge = r2(dLiability - dAsset)
  if (charge > 0) lines.push({ accountId: expAcc, debit: charge, credit: 0, description: 'Deferred tax charge' })
  else if (charge < 0) lines.push({ accountId: expAcc, debit: 0, credit: -charge, description: 'Deferred tax credit' })

  return lines
}

/** The movement as a single figure, for the disclosure. */
export const deferredCharge = (schedule, existing = {}) =>
  r2((schedule?.presented?.liability || 0) - (existing.liability || 0)
     - ((schedule?.presented?.asset || 0) - (existing.asset || 0)))

// ── Effective tax rate reconciliation (IAS 12.81(c)) ───────────────────

/**
 * Why the tax charge is not simply profit times the tax rate.
 *
 * A required disclosure, and the one an auditor reads first: it is where
 * permanent differences, unrecognised assets and rate changes have to be
 * explained rather than buried. The reconciliation is arithmetically forced to
 * close — any part that cannot be attributed shows as an unexplained residual
 * rather than being quietly absorbed into another line, because a
 * reconciliation that always balances by construction proves nothing.
 */
export function effectiveRateReconciliation({
  accountingProfit = 0, ratePct = 0, currentTax = 0, deferredTax = 0,
  permanentDifferences = 0, unrecognisedAssetMovement = 0, rateChangeEffect = 0,
} = {}) {
  const profit = r2(accountingProfit)
  const expected = r2(profit * pct(ratePct))
  const permanent = r2(permanentDifferences * pct(ratePct))
  const total = r2(currentTax + deferredTax)

  const explained = r2(expected + permanent + unrecognisedAssetMovement + rateChangeEffect)
  const residual = r2(total - explained)

  const lines = [
    { label: 'Tax at the statutory rate', amount: expected },
    { label: 'Effect of permanent differences', amount: permanent },
    { label: 'Deferred tax assets not recognised', amount: r2(unrecognisedAssetMovement) },
    { label: 'Effect of changes in the tax rate', amount: r2(rateChangeEffect) },
    { label: 'Unexplained difference', amount: residual },
  ].filter((l) => l.amount !== 0 || l.label === 'Tax at the statutory rate')

  return {
    accountingProfit: profit,
    statutoryRate: Number(ratePct) || 0,
    expected,
    currentTax: r2(currentTax),
    deferredTax: r2(deferredTax),
    totalTax: total,
    lines,
    residual,
    reconciles: Math.abs(residual) < 0.01,
    // The number readers actually compare between businesses and years.
    effectiveRate: profit === 0 ? 0 : r2((total / profit) * 100),
  }
}
