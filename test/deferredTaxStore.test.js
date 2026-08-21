// Deferred tax, through the store.
//
// deferredTax.test.js proves the arithmetic and the signs. This proves the
// things that only go wrong once the engine meets real books: that carrying
// amounts are read from the ledger the accounts actually report, that
// assessing repeatedly adjusts the position rather than adding to it, and that
// the sources the app already has — leases, loss allowances, end-of-service —
// arrive with the right sign without anyone wiring them up by hand.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const net = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}

const AS_OF = '2026-12-31'

beforeEach(() => {
  useStore.setState({ journalEntries: [], invoices: [], creditNotes: [], fixedAssets: [], assetDepreciations: [], leases: [] })
  g().updateDeferredTaxSettings({
    enabled: true, ratePct: 20, allowanceRatePct: 25, assetTaxMethod: 'straight_line',
    lossesCarriedForward: 0, recognitionPct: 100, offset: true, manual: [], lastAssessedAt: '',
  })
})

describe('reading the books', () => {
  it('finds the difference on a fixed asset without being told', () => {
    // Bought for 100,000 in 2023. Books say 70,000; capital allowances at 25%
    // straight line for three years say 25,000. The relief was taken early, so
    // there is more tax to come — a liability.
    useStore.setState({
      fixedAssets: [{ id: 'fa1', name: 'Machine', number: 'FA-0001', status: 'active',
        purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000, accumulatedDepreciation: 30000 }],
    })
    const a = g().deferredTaxAssessment(AS_OF)
    const row = a.rows.find((r) => r.label === 'Machine')
    expect(row).toMatchObject({ carrying: 70000, taxBase: 25000, type: 'taxable', deferredTax: 9000 })
    expect(a.presented.liability).toBe(9000)
  })

  it('picks up the loss allowance posted by the IFRS 9 assessment', () => {
    // Not wired together by hand: the allowance is on the ledger, so the
    // difference is on the ledger.
    g().updateEclSettings({ enabled: true, matrix: { current: 0.5, days30: 2, days60: 5, days90: 10, over90: 25 } })
    g().addInvoice({
      customerId: 'c1', customerName: 'Acme', date: '2026-01-01', dueDate: '2026-03-22',
      items: [{ description: 'Work', quantity: 1, price: 10000, subtotal: 10000, accountId: 'acc-sales' }],
      subtotal: 10000, taxAmount: 0, total: 10000,
    })
    g().postEclProvision({ asOf: '2026-06-30' })
    expect(net('acc-ecl')).toBe(-2500)

    const a = g().deferredTaxAssessment(AS_OF)
    const row = a.rows.find((r) => r.source === 'ecl')
    expect(row.type).toBe('deductible')
    expect(row.deferredTax).toBe(-500)
  })

  it('picks up a capitalised lease from both sides', () => {
    // IAS 12 was amended in 2021 precisely so that the right-of-use asset and
    // the lease liability are both recognised rather than netted away.
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-01-01', number: 'JE-1', type: 'lease',
        lines: [
          { accountId: 'acc-rou', debit: 100000, credit: 0 },
          { accountId: 'acc-leasepay', debit: 0, credit: 100000 },
        ],
      }],
    })
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.rows.find((r) => r.source === 'rou_assets')).toMatchObject({ type: 'taxable', deferredTax: 20000 })
    expect(a.rows.find((r) => r.source === 'lease_liabilities')).toMatchObject({ type: 'deductible', deferredTax: -20000 })
    expect(a.net).toBe(0)
  })

  it('nets accumulated depreciation off the right-of-use asset', () => {
    // The contra account carries a credit, so getting its sign wrong here
    // would double the difference rather than cancel it.
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-01-01', number: 'JE-1', type: 'lease',
        lines: [
          { accountId: 'acc-rou', debit: 100000, credit: 0 },
          { accountId: 'acc-roudepr', debit: 0, credit: 30000 },
          { accountId: 'acc-leasepay', debit: 0, credit: 70000 },
        ],
      }],
    })
    expect(g().deferredTaxAssessment(AS_OF).rows.find((r) => r.source === 'rou_assets').carrying).toBe(70000)
  })

  it('picks up the end-of-service provision', () => {
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-01-01', number: 'JE-1', type: 'manual',
        lines: [
          { accountId: 'acc-eosb-exp', debit: 40000, credit: 0 },
          { accountId: 'acc-eosb-prov', debit: 0, credit: 40000 },
        ],
      }],
    })
    const row = g().deferredTaxAssessment(AS_OF).rows.find((r) => r.source === 'eosb')
    expect(row).toMatchObject({ type: 'deductible', deferredTax: -8000 })
  })

  it('says nothing at all about an empty company', () => {
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.rows).toEqual([])
    expect(a.net).toBe(0)
  })
})

describe('posting', () => {
  const machine = () => useStore.setState({
    fixedAssets: [{ id: 'fa1', name: 'Machine', number: 'FA-0001', status: 'active',
      purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000, accumulatedDepreciation: 30000 }],
  })

  it('recognises the liability and charges tax expense', () => {
    machine()
    const je = g().postDeferredTax({ asOf: AS_OF })
    expect(je).toBeTruthy()
    expect(net('acc-dtl')).toBe(-9000)     // a liability, so a credit
    expect(net('acc-taxexp')).toBe(9000)   // an expense, so a debit
  })

  it('does not compound when assessed again with nothing changed', () => {
    // The failure this guards against: twelve monthly assessments turning a
    // 9,000 liability into 108,000, with every entry balancing the whole way.
    machine()
    for (let i = 0; i < 12; i++) g().postDeferredTax({ asOf: AS_OF })
    expect(net('acc-dtl')).toBe(-9000)
    expect(net('acc-taxexp')).toBe(9000)
  })

  it('posts no entry when the position has not moved', () => {
    machine()
    g().postDeferredTax({ asOf: AS_OF })
    const before = g().journalEntries.length
    expect(g().postDeferredTax({ asOf: AS_OF })).toBeNull()
    expect(g().journalEntries).toHaveLength(before)
  })

  it('adjusts when the difference narrows', () => {
    machine()
    g().postDeferredTax({ asOf: AS_OF })
    // A year of book depreciation with no further allowances left to take.
    useStore.setState({
      fixedAssets: [{ ...g().fixedAssets[0], currentBookValue: 60000, accumulatedDepreciation: 40000 }],
    })
    g().postDeferredTax({ asOf: AS_OF })
    expect(net('acc-dtl')).toBe(-7000)     // (60,000 − 25,000) × 20%
  })

  it('releases the position entirely when the difference reverses', () => {
    machine()
    g().postDeferredTax({ asOf: AS_OF })
    useStore.setState({ fixedAssets: [] })
    g().postDeferredTax({ asOf: AS_OF })
    expect(net('acc-dtl')).toBe(0)
    expect(net('acc-taxexp')).toBe(0)
  })

  it('recognises an asset as a credit to tax expense', () => {
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-01-01', number: 'JE-1', type: 'manual',
        lines: [
          { accountId: 'acc-eosb-exp', debit: 40000, credit: 0 },
          { accountId: 'acc-eosb-prov', debit: 0, credit: 40000 },
        ],
      }],
    })
    g().postDeferredTax({ asOf: AS_OF })
    expect(net('acc-dta')).toBe(8000)      // an asset, so a debit
    expect(net('acc-taxexp')).toBe(-8000)  // a credit — it reduces tax expense
  })

  it('keeps every entry balanced', () => {
    machine()
    g().postDeferredTax({ asOf: AS_OF })
    const ok = g().journalEntries.every((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      return Math.abs(dr - cr) < 0.005
    })
    expect(ok).toBe(true)
  })

  it('records when the assessment was last run', () => {
    machine()
    g().postDeferredTax({ asOf: AS_OF })
    expect(g().settings.deferredTax.lastAssessedAt).toBe(AS_OF)
  })

  it('posts nothing when the rate is nil', () => {
    // A tax-free jurisdiction has temporary differences and no deferred tax.
    machine()
    g().updateDeferredTaxSettings({ ratePct: 0 })
    expect(g().postDeferredTax({ asOf: AS_OF })).toBeNull()
  })
})

describe('assets that may not be recoverable', () => {
  const bigLoss = () => g().updateDeferredTaxSettings({ lossesCarriedForward: 1000000, recognitionPct: 0 })

  it('are not recognised, and the amount is disclosed', () => {
    bigLoss()
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.grossAsset).toBe(200000)
    expect(a.recognisedAsset).toBe(0)
    expect(a.unrecognisedAsset).toBe(200000)
    expect(g().postDeferredTax({ asOf: AS_OF })).toBeNull()
  })

  it('are recognised up to the liabilities they can be set against', () => {
    // IAS 12.28 — a liability reversing in the same period is itself the
    // evidence of future taxable profit, so no judgement is needed for that
    // part of the asset.
    useStore.setState({
      fixedAssets: [{ id: 'fa1', name: 'Machine', status: 'active',
        purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000 }],
    })
    bigLoss()
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.grossLiability).toBe(9000)
    expect(a.recognisedAsset).toBe(9000)
    expect(a.net).toBe(0)
    expect(a.unrecognisedAsset).toBe(191000)
  })
})

describe('presentation', () => {
  const both = () => useStore.setState({
    fixedAssets: [{ id: 'fa1', name: 'Machine', status: 'active',
      purchaseCost: 100000, purchaseDate: '2023-01-01', currentBookValue: 70000 }],
    journalEntries: [{
      id: 'je1', date: '2026-01-01', number: 'JE-1', type: 'manual',
      lines: [
        { accountId: 'acc-eosb-exp', debit: 40000, credit: 0 },
        { accountId: 'acc-eosb-prov', debit: 0, credit: 40000 },
      ],
    }],
  })

  it('offsets into a single figure by default', () => {
    both()
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.grossLiability).toBe(9000)
    expect(a.grossAsset).toBe(8000)
    expect(a.presented).toMatchObject({ liability: 1000, asset: 0, offset: true })
  })

  it('shows both sides when there is no right of set-off', () => {
    // IAS 12.74 allows offsetting only with a legally enforceable right and
    // the same taxing authority — a fact about the business, not a default.
    both()
    g().updateDeferredTaxSettings({ offset: false })
    const a = g().deferredTaxAssessment(AS_OF)
    expect(a.presented).toMatchObject({ liability: 9000, asset: 8000, offset: false })
  })

  it('posts both sides gross when not offsetting', () => {
    both()
    g().updateDeferredTaxSettings({ offset: false })
    g().postDeferredTax({ asOf: AS_OF })
    expect(net('acc-dtl')).toBe(-9000)
    expect(net('acc-dta')).toBe(8000)
    expect(net('acc-taxexp')).toBe(1000)
  })
})

describe('the effective rate reconciliation', () => {
  it('explains a charge that is exactly the statutory rate', () => {
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-06-01', number: 'JE-1', type: 'manual',
        lines: [
          { accountId: 'acc-bank1', debit: 100000, credit: 0 },
          { accountId: 'acc-sales', debit: 0, credit: 100000 },
        ],
      }, {
        id: 'je2', date: '2026-06-02', number: 'JE-2', type: 'manual',
        lines: [
          { accountId: 'acc-taxexp', debit: 20000, credit: 0 },
          { accountId: 'acc-bank1', debit: 0, credit: 20000 },
        ],
      }],
    })
    const r = g().taxRateReconciliation('2026-01-01', '2026-12-31')
    expect(r.accountingProfit).toBe(100000)   // tax is excluded from the profit it is charged on
    expect(r.expected).toBe(20000)
    expect(r.totalTax).toBe(20000)
    expect(r.reconciles).toBe(true)
    expect(r.effectiveRate).toBe(20)
  })

  it('does not count tax expense as an expense of the business', () => {
    // Including it would make the reconciliation circular and quietly wrong.
    useStore.setState({
      journalEntries: [{
        id: 'je1', date: '2026-06-01', number: 'JE-1', type: 'manual',
        lines: [
          { accountId: 'acc-bank1', debit: 50000, credit: 0 },
          { accountId: 'acc-sales', debit: 0, credit: 50000 },
        ],
      }, {
        id: 'je2', date: '2026-06-02', number: 'JE-2', type: 'manual',
        lines: [
          { accountId: 'acc-taxexp', debit: 10000, credit: 0 },
          { accountId: 'acc-dtl', debit: 0, credit: 10000 },
        ],
      }],
    })
    expect(g().taxRateReconciliation('2026-01-01', '2026-12-31').accountingProfit).toBe(50000)
  })

  it('survives a period with no activity', () => {
    const r = g().taxRateReconciliation('2026-01-01', '2026-12-31')
    expect(r.accountingProfit).toBe(0)
    expect(r.effectiveRate).toBe(0)
  })
})
