// IAS 12 deferred tax.
//
// Almost every mistake in deferred tax is a sign. A schedule with the wrong
// sign is not obviously wrong — it balances, it foots, it looks like a
// schedule — and it reports an asset where there is a liability, which moves
// profit in the wrong direction by twice the amount. So most of what follows
// pins the *direction* of each source against a worked example, rather than
// only checking that the arithmetic multiplies.
//
// The other thing worth failing loudly is recoverability. An asset that may
// not be recognised, recognised anyway, flatters a loss-making business
// exactly when it can least afford the correction later.
import { describe, it, expect } from 'vitest'
import {
  taxableDifference, deferredTaxOn, differenceRow, taxWrittenDownValue,
  fixedAssetDifferences, ledgerDifferences, lossRow, manualRows,
  assessRecoverability, buildDeferredTax, movementLines, deferredCharge,
  effectiveRateReconciliation,
  ASSET, LIABILITY, SOURCES, STRAIGHT_LINE, DECLINING_BALANCE,
} from '../src/utils/deferredTax.js'

const RATE = 20   // 20% corporate tax throughout

describe('which way round a difference goes', () => {
  it('an asset worth more in the books than to the tax authority is a liability', () => {
    // Machine costing 100, book depreciation 20, capital allowances 40.
    // Relief has been taken early, so more tax falls due later.
    expect(taxableDifference({ carrying: 80, taxBase: 60, kind: ASSET })).toBe(20)
    expect(deferredTaxOn(20, RATE)).toBe(4)
  })

  it('an asset worth less in the books than to the tax authority is an asset', () => {
    // Receivables of 1,000 carried at 900 after a loss allowance the tax
    // authority will not accept until write-off. The relief is still to come.
    expect(taxableDifference({ carrying: 900, taxBase: 1000, kind: ASSET })).toBe(-100)
    expect(deferredTaxOn(-100, RATE)).toBe(-20)
  })

  it('reverses for a liability', () => {
    // A provision of 500 deductible only when paid.
    expect(taxableDifference({ carrying: 500, taxBase: 0, kind: LIABILITY })).toBe(-500)
    // A liability the tax authority already recognises in full carries nothing.
    expect(taxableDifference({ carrying: 500, taxBase: 500, kind: LIABILITY })).toBe(0)
  })

  it('names the type so nobody has to work out the sign', () => {
    expect(differenceRow({ source: 'x', carrying: 80, taxBase: 60, kind: ASSET, ratePct: RATE }).type).toBe('taxable')
    expect(differenceRow({ source: 'x', carrying: 60, taxBase: 80, kind: ASSET, ratePct: RATE }).type).toBe('deductible')
    expect(differenceRow({ source: 'x', carrying: 60, taxBase: 60, kind: ASSET, ratePct: RATE }).type).toBe('none')
  })
})

describe('the tax base of a fixed asset', () => {
  const asset = { purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000 }

  it('writes down on a declining balance, as most regimes do', () => {
    // 100,000 at 25% for three years: 75,000 → 56,250 → 42,187.50
    const wdv = taxWrittenDownValue(asset, { allowanceRatePct: 25, method: DECLINING_BALANCE, asOf: '2026-01-02' })
    expect(wdv).toBeCloseTo(42187.5, 2)
  })

  it('writes down in equal slices when the regime is straight line', () => {
    const wdv = taxWrittenDownValue(asset, { allowanceRatePct: 25, method: STRAIGHT_LINE, asOf: '2026-01-02' })
    expect(wdv).toBe(25000)   // 100,000 − 3 × 25,000
  })

  it('never takes a straight-line asset below zero', () => {
    const wdv = taxWrittenDownValue(asset, { allowanceRatePct: 25, method: STRAIGHT_LINE, asOf: '2036-01-02' })
    expect(wdv).toBe(0)
  })

  it('leaves a declining-balance pool with a residue, which is how they work', () => {
    // A declining balance approaches zero without reaching it, so the pool
    // carries a shrinking residue until the asset is disposed of. Twenty years
    // at 25% leaves 0.75^20 of cost — small, and deliberately not nil.
    const wdv = taxWrittenDownValue(asset, { allowanceRatePct: 25, method: DECLINING_BALANCE, asOf: '2043-01-02' })
    expect(wdv).toBeGreaterThan(0)
    expect(wdv).toBeCloseTo(100000 * Math.pow(0.75, 20), 2)
    expect(wdv / 100000).toBeLessThan(0.01)
  })

  it('takes no allowance in the year of purchase', () => {
    expect(taxWrittenDownValue(asset, { allowanceRatePct: 25, asOf: '2023-06-01' })).toBe(100000)
  })

  it('lets a jurisdiction this cannot express be overridden outright', () => {
    expect(taxWrittenDownValue({ ...asset, taxWdvOverride: 12345 }, { allowanceRatePct: 25, asOf: '2026-01-02' })).toBe(12345)
  })

  it('honours a per-asset allowance rate', () => {
    const slow = { ...asset, allowanceRatePct: 10 }
    expect(taxWrittenDownValue(slow, { allowanceRatePct: 25, method: STRAIGHT_LINE, asOf: '2026-01-02' })).toBe(70000)
  })

  it('does not confuse the allowance rate with the tax rate', () => {
    // The bug this guards against produces a schedule that looks entirely
    // plausible and is wrong in every row.
    const rows = fixedAssetDifferences([asset], { ratePct: 20, allowanceRatePct: 25, method: STRAIGHT_LINE, asOf: '2026-01-02' })
    expect(rows[0].taxBase).toBe(25000)          // driven by 25%, the allowance rate
    expect(rows[0].difference).toBe(45000)       // 70,000 − 25,000
    expect(rows[0].deferredTax).toBe(9000)       // driven by 20%, the tax rate
  })
})

describe('differences the ledger already knows about', () => {
  // Natural balances: debits less credits for assets and expenses, the other
  // way for everything else — so contra accounts come back negative.
  const ledger = (over = {}) => {
    const b = { 'acc-rou': 0, 'acc-roudepr': 0, 'acc-leasepay': 0, 'acc-ecl': 0, 'acc-eosb-prov': 0, ...over }
    return (id) => b[id] || 0
  }

  it('nets accumulated depreciation off the right-of-use asset', () => {
    // Accumulated depreciation is a contra-asset carrying a credit, so it
    // arrives negative and has to be added. Subtracting it would double the
    // difference instead of cancelling it.
    const rows = ledgerDifferences(ledger({ 'acc-rou': 100000, 'acc-roudepr': -30000 }), { ratePct: RATE })
    const rou = rows.find((r) => r.source === SOURCES.ROU_ASSETS)
    expect(rou.carrying).toBe(70000)
    expect(rou.type).toBe('taxable')
    expect(rou.deferredTax).toBe(14000)
  })

  it('treats the lease liability as a deductible difference', () => {
    const rows = ledgerDifferences(ledger({ 'acc-leasepay': 72000 }), { ratePct: RATE })
    const liab = rows.find((r) => r.source === SOURCES.LEASE_LIABILITIES)
    expect(liab.type).toBe('deductible')
    expect(liab.deferredTax).toBe(-14400)
  })

  it('leaves a capitalised lease with the small net asset it should have', () => {
    // The asset depreciates straight-line while the liability unwinds on
    // interest, so the liability is the larger of the two for most of the
    // term — which is why IAS 12 was amended in 2021 to require both sides.
    const rows = ledgerDifferences(ledger({ 'acc-rou': 100000, 'acc-roudepr': -30000, 'acc-leasepay': 72000 }), { ratePct: RATE })
    const net = rows.reduce((s, r) => s + r.deferredTax, 0)
    expect(net).toBeLessThan(0)
    expect(net).toBeCloseTo(-400, 2)
  })

  it('turns the loss allowance into a deferred tax asset', () => {
    const rows = ledgerDifferences(ledger({ 'acc-ecl': -2500 }), { ratePct: RATE })
    const ecl = rows.find((r) => r.source === SOURCES.ECL)
    expect(ecl.type).toBe('deductible')
    expect(ecl.deferredTax).toBe(-500)
  })

  it('turns the end-of-service provision into a deferred tax asset', () => {
    const rows = ledgerDifferences(ledger({ 'acc-eosb-prov': 40000 }), { ratePct: RATE })
    const eosb = rows.find((r) => r.source === SOURCES.EOSB)
    expect(eosb.type).toBe('deductible')
    expect(eosb.deferredTax).toBe(-8000)
  })

  it('says nothing about accounts with no balance', () => {
    expect(ledgerDifferences(ledger(), { ratePct: RATE })).toEqual([])
  })
})

describe('tax losses carried forward', () => {
  it('carry a deferred tax asset', () => {
    const row = lossRow(500000, RATE)
    expect(row.type).toBe('deductible')
    expect(row.deferredTax).toBe(-100000)
  })

  it('are nothing when there are none', () => {
    expect(lossRow(0, RATE)).toBeNull()
    expect(lossRow(-100, RATE)).toBeNull()
  })
})

describe('recoverability', () => {
  it('sets the asset against liabilities before asking any question', () => {
    // IAS 12.28: a liability reversing in the same period is itself the
    // evidence of future taxable profit. Applying a haircut to the whole
    // asset instead would understate it and overstate tax expense in exactly
    // the years a struggling business can least afford it.
    const r = assessRecoverability({ grossAsset: 100, grossLiability: 60, recognitionPct: 0 })
    expect(r.coveredByLiabilities).toBe(60)
    expect(r.recognised).toBe(60)
    expect(r.unrecognised).toBe(40)
  })

  it('applies the probability judgement only to the excess', () => {
    const r = assessRecoverability({ grossAsset: 100, grossLiability: 60, recognitionPct: 50 })
    expect(r.recognised).toBe(80)      // 60 covered + half of the remaining 40
    expect(r.unrecognised).toBe(20)
  })

  it('recognises the lot when future profit is certain enough', () => {
    expect(assessRecoverability({ grossAsset: 100, grossLiability: 0, recognitionPct: 100 }).recognised).toBe(100)
  })

  it('recognises none of an unsupported asset when profit is not probable', () => {
    const r = assessRecoverability({ grossAsset: 100, grossLiability: 0, recognitionPct: 0 })
    expect(r.recognised).toBe(0)
    expect(r.unrecognised).toBe(100)
  })

  it('refuses a nonsensical recognition percentage', () => {
    expect(assessRecoverability({ grossAsset: 100, grossLiability: 0, recognitionPct: 500 }).recognised).toBe(100)
    expect(assessRecoverability({ grossAsset: 100, grossLiability: 0, recognitionPct: -50 }).recognised).toBe(0)
  })
})

describe('the whole schedule', () => {
  const src = {
    fixedAssets: [{ name: 'Machine', purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000 }],
    natural: (id) => ({ 'acc-ecl': -2500, 'acc-eosb-prov': 40000 }[id] || 0),
  }
  const built = (o = {}) => buildDeferredTax(src, {
    ratePct: RATE, allowanceRatePct: 25, assetTaxMethod: STRAIGHT_LINE, asOf: '2026-01-02', ...o,
  })

  it('brings every source together with the right signs', () => {
    const s = built()
    // Machine: 70,000 − 25,000 = 45,000 taxable → 9,000 liability
    // ECL 2,500 and EOSB 40,000 deductible → 8,500 asset
    expect(s.grossLiability).toBe(9000)
    expect(s.grossAsset).toBe(8500)
    expect(s.net).toBe(500)          // positive = a net liability
  })

  it('presents a single net figure when offsetting is allowed', () => {
    // IAS 12.74 permits it only with a legally enforceable right of set-off
    // and the same taxing authority, which is why it is a setting.
    const s = built({ offset: true })
    expect(s.presented).toMatchObject({ liability: 500, asset: 0, offset: true })
  })

  it('shows both sides gross when it is not', () => {
    const s = built({ offset: false })
    expect(s.presented).toMatchObject({ liability: 9000, asset: 8500, offset: false })
  })

  it('reports the asset it could not recognise rather than dropping it', () => {
    const s = built({ lossesCarriedForward: 1000000, recognitionPct: 0 })
    expect(s.unrecognisedAsset).toBeGreaterThan(0)
    // Covered by the 9,000 liability; everything beyond it is unrecognised.
    expect(s.recognisedAsset).toBe(9000)
    expect(s.presented.liability).toBe(0)
    expect(s.presented.asset).toBe(0)
  })

  it('survives a business with nothing in it', () => {
    const s = buildDeferredTax({ fixedAssets: [], natural: () => 0 }, { ratePct: RATE })
    expect(s.rows).toEqual([])
    expect(s.net).toBe(0)
    expect(s.presented).toMatchObject({ asset: 0, liability: 0 })
  })

  it('carries no deferred tax at all when the rate is nil', () => {
    // A tax-free jurisdiction has temporary differences but no deferred tax.
    const s = built({ ratePct: 0 })
    expect(s.rows.length).toBeGreaterThan(0)
    expect(s.net).toBe(0)
  })

  it('takes rows the user entered for anything it cannot infer', () => {
    const s = built({ manual: [{ label: 'Development costs', carrying: 50000, taxBase: 0, kind: ASSET }] })
    const row = s.rows.find((r) => r.label === 'Development costs')
    expect(row.type).toBe('taxable')
    expect(row.deferredTax).toBe(10000)
  })

  it('ignores empty manual rows', () => {
    expect(manualRows([{ label: 'Nothing' }, null], RATE)).toEqual([])
  })
})

describe('posting the movement', () => {
  const schedule = (asset, liability) => ({ presented: { asset, liability } })

  it('recognises a liability that was not there before', () => {
    const lines = movementLines(schedule(0, 500), { asset: 0, liability: 0 })
    expect(lines).toEqual([
      { accountId: 'acc-dtl', debit: 0, credit: 500, description: 'Deferred tax liability' },
      { accountId: 'acc-taxexp', debit: 500, credit: 0, description: 'Deferred tax charge' },
    ])
  })

  it('recognises an asset as a credit to tax expense', () => {
    const lines = movementLines(schedule(800, 0), { asset: 0, liability: 0 })
    expect(lines).toEqual([
      { accountId: 'acc-dta', debit: 800, credit: 0, description: 'Deferred tax asset' },
      { accountId: 'acc-taxexp', debit: 0, credit: 800, description: 'Deferred tax credit' },
    ])
  })

  it('posts only the movement, never the balance', () => {
    // The failure this guards against: twelve monthly assessments turning a
    // 500 liability into 6,000. Every entry balances either way, so nothing
    // else in the system would object while the position ran away.
    const lines = movementLines(schedule(0, 500), { asset: 0, liability: 400 })
    expect(lines).toEqual([
      { accountId: 'acc-dtl', debit: 0, credit: 100, description: 'Deferred tax liability' },
      { accountId: 'acc-taxexp', debit: 100, credit: 0, description: 'Deferred tax charge' },
    ])
  })

  it('posts nothing at all when the position has not moved', () => {
    expect(movementLines(schedule(0, 500), { asset: 0, liability: 500 })).toEqual([])
  })

  it('releases a liability that has reversed', () => {
    const lines = movementLines(schedule(0, 200), { asset: 0, liability: 500 })
    expect(lines[0]).toMatchObject({ accountId: 'acc-dtl', debit: 300 })
    expect(lines[1]).toMatchObject({ accountId: 'acc-taxexp', credit: 300 })
  })

  it('handles a position that flips from asset to liability', () => {
    const lines = movementLines(schedule(0, 300), { asset: 700, liability: 0 })
    expect(lines.find((l) => l.accountId === 'acc-dta')).toMatchObject({ credit: 700 })
    expect(lines.find((l) => l.accountId === 'acc-dtl')).toMatchObject({ credit: 300 })
    expect(lines.find((l) => l.accountId === 'acc-taxexp')).toMatchObject({ debit: 1000 })
  })

  it('always balances', () => {
    const cases = [[0, 500, 0, 0], [800, 0, 0, 0], [0, 200, 0, 500], [0, 300, 700, 0], [450, 0, 100, 250]]
    cases.forEach(([ta, tl, ha, hl]) => {
      const lines = movementLines(schedule(ta, tl), { asset: ha, liability: hl })
      const dr = lines.reduce((s, l) => s + l.debit, 0)
      const cr = lines.reduce((s, l) => s + l.credit, 0)
      expect(Math.abs(dr - cr)).toBeLessThan(0.005)
    })
  })

  it('reports the charge as one figure for the disclosure', () => {
    expect(deferredCharge(schedule(0, 500), { asset: 0, liability: 400 })).toBe(100)
    expect(deferredCharge(schedule(800, 0), { asset: 0, liability: 0 })).toBe(-800)
  })
})

describe('the effective rate reconciliation', () => {
  it('starts from profit times the statutory rate', () => {
    const r = effectiveRateReconciliation({ accountingProfit: 1000000, ratePct: 20, currentTax: 200000 })
    expect(r.expected).toBe(200000)
    expect(r.reconciles).toBe(true)
    expect(r.effectiveRate).toBe(20)
  })

  it('explains a charge raised by non-deductible spending', () => {
    // Entertaining and fines are permanent differences: they never reverse,
    // so they carry no deferred tax and can only be explained here.
    const r = effectiveRateReconciliation({
      accountingProfit: 1000000, ratePct: 20, currentTax: 210000, permanentDifferences: 50000,
    })
    expect(r.lines.find((l) => /permanent/i.test(l.label)).amount).toBe(10000)
    expect(r.reconciles).toBe(true)
    expect(r.effectiveRate).toBe(21)
  })

  it('explains a charge raised by assets that could not be recognised', () => {
    const r = effectiveRateReconciliation({
      accountingProfit: 100000, ratePct: 20, currentTax: 0, deferredTax: 35000, unrecognisedAssetMovement: 15000,
    })
    expect(r.reconciles).toBe(true)
  })

  it('shows an unexplained residual rather than absorbing it', () => {
    // A reconciliation that always closes by construction proves nothing. If
    // something cannot be attributed, that is the finding.
    const r = effectiveRateReconciliation({ accountingProfit: 1000000, ratePct: 20, currentTax: 275000 })
    expect(r.reconciles).toBe(false)
    expect(r.residual).toBe(75000)
    expect(r.lines.find((l) => /Unexplained/.test(l.label)).amount).toBe(75000)
  })

  it('does not divide by zero on a break-even year', () => {
    const r = effectiveRateReconciliation({ accountingProfit: 0, ratePct: 20, currentTax: 0 })
    expect(r.effectiveRate).toBe(0)
    expect(r.expected).toBe(0)
  })

  it('handles a loss', () => {
    const r = effectiveRateReconciliation({ accountingProfit: -500000, ratePct: 20, deferredTax: -100000 })
    expect(r.expected).toBe(-100000)
    expect(r.totalTax).toBe(-100000)
    expect(r.reconciles).toBe(true)
  })
})
