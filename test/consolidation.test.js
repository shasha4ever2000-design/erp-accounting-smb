import { describe, it, expect } from 'vitest'
import {
  normaliseName, suggestMappings, intercompanyPositions, reconcilePairs,
  companyTotals, consolidate, LIMITATIONS, LIMITATION_TEXT, FINDING_TEXT,
} from '../src/utils/consolidation'

// Two companies that trade with each other. Parent sells 1,000 to Sub; Sub
// records the same 1,000 as a purchase. Both sides also carry the open
// receivable/payable. Group revenue should be the third party sales only.
const COMPANIES = [
  { id: 'co-p', name: 'Parent Holding' },
  { id: 'co-s', name: 'Sub Trading LLC' },
]

const acc = (id, type) => ({ id, name: id, type })
const ACCOUNTS = [
  acc('acc-ar', 'asset'), acc('acc-bank', 'asset'),
  acc('acc-ap', 'liability'),
  acc('acc-cap', 'equity'),
  acc('acc-sales', 'revenue'),
  acc('acc-cogs', 'expense'),
]

const je = (lines) => ({ id: `je-${Math.random()}`, date: '2025-06-01', lines })

/** A company whose books contain exactly the figures we hand it. */
function bookOf({ revenue = 0, expenses = 0, ar = 0, ap = 0, currency = 'SAR', ...rest }) {
  const lines = []
  if (revenue) lines.push(je([
    { accountId: 'acc-ar', debit: revenue, credit: 0 },
    { accountId: 'acc-sales', debit: 0, credit: revenue },
  ]))
  if (expenses) lines.push(je([
    { accountId: 'acc-cogs', debit: expenses, credit: 0 },
    { accountId: 'acc-ap', debit: 0, credit: expenses },
  ]))
  // Park anything not left outstanding into the bank, so the balance sheet
  // still balances and assets aren't just the receivable.
  const arDiff = revenue - ar
  const apDiff = expenses - ap
  if (arDiff) lines.push(je([
    { accountId: 'acc-bank', debit: arDiff, credit: 0 },
    { accountId: 'acc-ar', debit: 0, credit: arDiff },
  ]))
  if (apDiff) lines.push(je([
    { accountId: 'acc-ap', debit: apDiff, credit: 0 },
    { accountId: 'acc-bank', debit: 0, credit: apDiff },
  ]))
  return {
    accounts: ACCOUNTS,
    journalEntries: lines,
    settings: { company: { currency } },
    customers: [], suppliers: [], invoices: [], purchases: [], creditNotes: [], debitNotes: [],
    ...rest,
  }
}

const inv = (o) => ({ id: o.id, customerId: o.customerId, subtotal: o.subtotal, total: o.total ?? o.subtotal, amountPaid: o.amountPaid || 0, status: o.status || 'sent', ...o })
const bill = (o) => ({ id: o.id, supplierId: o.supplierId, subtotal: o.subtotal, total: o.total ?? o.subtotal, amountPaid: o.amountPaid || 0, status: o.status || 'received', ...o })

/** The standard fixture: parent sells 1,000 to sub, still unpaid. */
function group({ parentExtra = {}, subExtra = {} } = {}) {
  const parent = bookOf({
    revenue: 3000, expenses: 500, ar: 1000, ap: 0,
    customers: [{ id: 'cust-1', name: 'Sub Trading LLC' }],
    invoices: [inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000 })],
    ...parentExtra,
  })
  const sub = bookOf({
    revenue: 2000, expenses: 1400, ar: 0, ap: 1000,
    suppliers: [{ id: 'supp-1', name: 'Parent Holding' }],
    purchases: [bill({ id: 'b1', supplierId: 'supp-1', subtotal: 1000 })],
    ...subExtra,
  })
  return { 'co-p': parent, 'co-s': sub }
}

const MAP = [
  { companyId: 'co-p', partyType: 'customer', partyId: 'cust-1', representsCompanyId: 'co-s' },
  { companyId: 'co-s', partyType: 'supplier', partyId: 'supp-1', representsCompanyId: 'co-p' },
]

describe('normaliseName', () => {
  it('strips legal suffixes and punctuation so the same firm matches itself', () => {
    expect(normaliseName('Sub Trading LLC')).toBe(normaliseName('Sub  Trading, L.L.C.'))
    expect(normaliseName('Al-Noor Est.')).toBe(normaliseName('Al Noor Establishment'))
  })

  it('does not collapse genuinely different names', () => {
    expect(normaliseName('Al-Noor Trading')).not.toBe(normaliseName('Al-Fajr Trading'))
  })

  it('returns empty for nothing, so an unnamed party is never matched', () => {
    expect(normaliseName('')).toBe('')
    expect(normaliseName(null)).toBe('')
    expect(normaliseName('   ')).toBe('')
  })
})

describe('suggestMappings', () => {
  it('finds the sister company hiding in a customer list', () => {
    const out = suggestMappings(COMPANIES, group())
    const fromParent = out.find((m) => m.companyId === 'co-p')
    expect(fromParent).toMatchObject({
      partyType: 'customer', partyId: 'cust-1', representsCompanyId: 'co-s', confidence: 'exact',
    })
  })

  it('finds it in a supplier list too', () => {
    const out = suggestMappings(COMPANIES, group())
    expect(out.find((m) => m.companyId === 'co-s')).toMatchObject({
      partyType: 'supplier', representsCompanyId: 'co-p',
    })
  })

  it('marks a substring hit as partial, not exact', () => {
    const states = group({
      parentExtra: { customers: [{ id: 'cust-1', name: 'Sub Trading LLC Riyadh Branch' }] },
    })
    const hit = suggestMappings(COMPANIES, states).find((m) => m.companyId === 'co-p')
    expect(hit.confidence).toBe('partial')
  })

  it('never suggests a company as a party in its own books', () => {
    const states = group({ parentExtra: { customers: [{ id: 'c9', name: 'Parent Holding' }] } })
    const out = suggestMappings(COMPANIES, states)
    expect(out.filter((m) => m.companyId === 'co-p' && m.representsCompanyId === 'co-p')).toHaveLength(0)
  })

  it('is a suggestion only — it returns rows, it does not confirm anything', () => {
    const out = suggestMappings(COMPANIES, group())
    expect(out.every((m) => m.confirmed === undefined)).toBe(true)
  })

  it('skips companies with no snapshot rather than throwing', () => {
    expect(() => suggestMappings(COMPANIES, { 'co-p': group()['co-p'] })).not.toThrow()
  })
})

describe('intercompanyPositions', () => {
  it('measures trade net of tax, at the subtotal', () => {
    const states = group({
      parentExtra: { invoices: [inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000, total: 1150 })] },
    })
    const [pos] = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(pos.revenue).toBe(1000)     // not 1150 — VAT was never revenue
    expect(pos.receivable).toBe(1150)  // but the debt includes it
  })

  it('ignores parties that were never mapped', () => {
    const states = group({
      parentExtra: {
        customers: [{ id: 'cust-1', name: 'Sub Trading LLC' }, { id: 'cust-2', name: 'Outside Co' }],
        invoices: [
          inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000 }),
          inv({ id: 'i2', customerId: 'cust-2', subtotal: 9000 }),
        ],
      },
    })
    const rows = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(rows).toHaveLength(1)
    expect(rows[0].revenue).toBe(1000)
  })

  it('nets credit notes off both the debt and the sale', () => {
    const states = group({
      parentExtra: {
        creditNotes: [{ id: 'cn1', customerId: 'cust-1', subtotal: 300, total: 300, status: 'issued' }],
      },
    })
    const [pos] = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(pos.revenue).toBe(700)
    expect(pos.receivable).toBe(700)
  })

  it('nets debit notes off the payable and the expense', () => {
    const states = group({
      subExtra: {
        debitNotes: [{ id: 'dn1', supplierId: 'supp-1', subtotal: 250, total: 250, status: 'issued' }],
      },
    })
    const [pos] = intercompanyPositions('co-s', states['co-s'], MAP)
    expect(pos.expense).toBe(750)
    expect(pos.payable).toBe(750)
  })

  it('reduces the receivable by cash already collected but not the revenue', () => {
    const states = group({
      parentExtra: { invoices: [inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000, amountPaid: 600 })] },
    })
    const [pos] = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(pos.receivable).toBe(400)
    expect(pos.revenue).toBe(1000)
  })

  it('excludes void, cancelled, draft and opening documents', () => {
    const states = group({
      parentExtra: {
        invoices: [
          inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000 }),
          inv({ id: 'i2', customerId: 'cust-1', subtotal: 500, status: 'void' }),
          inv({ id: 'i3', customerId: 'cust-1', subtotal: 500, status: 'cancelled' }),
          inv({ id: 'i4', customerId: 'cust-1', subtotal: 500, status: 'draft' }),
          inv({ id: 'i5', customerId: 'cust-1', subtotal: 500, isOpening: true }),
        ],
      },
    })
    const [pos] = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(pos.revenue).toBe(1000)
  })

  it('converts a foreign-currency document at its own rate, as the ledger did', () => {
    const states = group({
      parentExtra: {
        invoices: [inv({ id: 'i1', customerId: 'cust-1', subtotal: 1000, currency: 'USD', exchangeRate: 3.75 })],
      },
    })
    const [pos] = intercompanyPositions('co-p', states['co-p'], MAP)
    expect(pos.revenue).toBe(3750)
    expect(pos.receivable).toBe(3750)
  })

  it('honours an explicitly rejected mapping', () => {
    const rejected = MAP.map((m) => ({ ...m, confirmed: false }))
    expect(intercompanyPositions('co-p', group()['co-p'], rejected)).toHaveLength(0)
  })

  it('returns nothing when no mapping exists at all', () => {
    expect(intercompanyPositions('co-p', group()['co-p'], [])).toHaveLength(0)
  })
})

describe('reconcilePairs', () => {
  const positionsOf = (states, mappings = MAP) => ({
    'co-p': intercompanyPositions('co-p', states['co-p'], mappings),
    'co-s': intercompanyPositions('co-s', states['co-s'], mappings),
  })

  it('agrees when both books tell the same story', () => {
    const pairs = reconcilePairs(positionsOf(group()), COMPANIES)
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ agrees: true, tradeAgrees: true, mappedBothWays: true })
    expect(pairs[0].receivableGap).toBe(0)
  })

  it('reports each pair once, not once per direction', () => {
    expect(reconcilePairs(positionsOf(group()), COMPANIES)).toHaveLength(1)
  })

  it('catches a credit note posted on one side only', () => {
    const states = group({
      parentExtra: { creditNotes: [{ id: 'cn1', customerId: 'cust-1', subtotal: 200, total: 200, status: 'issued' }] },
    })
    const [p] = reconcilePairs(positionsOf(states), COMPANIES)
    expect(p.agrees).toBe(false)
    expect(p.receivableGap).toBe(-200)   // parent says 800, sub still says 1,000
  })

  it('separates the two trade directions instead of netting them', () => {
    // Parent sells 1,000 to Sub; Sub sells 400 back to Parent, and neither
    // matches. Netting would show a 600 gap and hide both.
    const states = group({
      parentExtra: {
        suppliers: [{ id: 'psup', name: 'Sub Trading LLC' }],
        purchases: [bill({ id: 'pb1', supplierId: 'psup', subtotal: 100 })],
      },
      subExtra: {
        customers: [{ id: 'scust', name: 'Parent Holding' }],
        invoices: [inv({ id: 'si1', customerId: 'scust', subtotal: 400 })],
      },
    })
    const mappings = [
      ...MAP,
      { companyId: 'co-p', partyType: 'supplier', partyId: 'psup', representsCompanyId: 'co-s' },
      { companyId: 'co-s', partyType: 'customer', partyId: 'scust', representsCompanyId: 'co-p' },
    ]
    const [p] = reconcilePairs(positionsOf(states, mappings), COMPANIES)
    expect(p.tradeGapAB).toBe(0)     // parent → sub: 1,000 vs 1,000
    expect(p.tradeGapBA).toBe(300)   // sub → parent: 400 sold vs 100 recorded
    expect(p.tradeAgrees).toBe(false)
  })

  it('flags a one-sided mapping rather than calling it a disagreement', () => {
    const oneSided = [MAP[0]]
    const [p] = reconcilePairs(positionsOf(group(), oneSided), COMPANIES)
    expect(p.mappedBothWays).toBe(false)
  })

  it('names the companies, so a finding is readable without ids', () => {
    const [p] = reconcilePairs(positionsOf(group()), COMPANIES)
    expect(p.aName).toBe('Parent Holding')
    expect(p.bName).toBe('Sub Trading LLC')
  })

  it('tolerates a rounding-sized difference', () => {
    const states = group({
      subExtra: { purchases: [bill({ id: 'b1', supplierId: 'supp-1', subtotal: 1000, total: 1000.01 })] },
    })
    const [p] = reconcilePairs(positionsOf(states), COMPANIES)
    expect(p.agrees).toBe(true)
  })
})

describe('companyTotals', () => {
  it('sums each account type at its natural sign', () => {
    const t = companyTotals(bookOf({ revenue: 3000, expenses: 500, ar: 1000 }))
    expect(t.revenue).toBe(3000)
    expect(t.expenses).toBe(500)
    expect(t.net).toBe(2500)
    expect(t.assets).toBe(2500)   // 1,000 still receivable + 1,500 banked
    expect(t.assets - t.liabilities).toBe(t.net)  // nothing distributed yet
  })

  it('leaves an empty company at zero rather than NaN', () => {
    expect(companyTotals({})).toMatchObject({ revenue: 0, expenses: 0, net: 0, assets: 0 })
  })
})

describe('consolidate', () => {
  const run = (over = {}) => consolidate({
    companies: COMPANIES, statesByCompany: group(), mappings: MAP, ...over,
  })

  it('combines every company before eliminating anything', () => {
    const out = run()
    expect(out.combined.revenue).toBe(5000)   // 3,000 + 2,000
    expect(out.combined.expenses).toBe(1900)  // 500 + 1,400
  })

  it('removes the intercompany sale from group revenue and expenses', () => {
    const out = run()
    expect(out.eliminations.revenue).toBe(1000)
    expect(out.eliminations.expenses).toBe(1000)
    expect(out.group.revenue).toBe(4000)
    expect(out.group.expenses).toBe(900)
  })

  it('removes the intercompany debt from group assets and liabilities', () => {
    const out = run()
    expect(out.eliminations.receivables).toBe(1000)
    expect(out.eliminations.payables).toBe(1000)
    expect(out.group.assets).toBe(out.combined.assets - 1000)
    expect(out.group.liabilities).toBe(out.combined.liabilities - 1000)
  })

  it('leaves net profit untouched — which is why the overstatement was invisible', () => {
    const out = run()
    expect(out.group.net).toBe(out.combined.net)
    expect(out.group.net).toBe(r(out.group.revenue - out.group.expenses))
  })
  const r = (n) => Math.round(n * 100) / 100

  it('changes nothing when elimination is switched off', () => {
    const out = run({ eliminate: false })
    expect(out.group.revenue).toBe(out.combined.revenue)
    expect(out.group.assets).toBe(out.combined.assets)
    expect(out.eliminations.revenue).toBe(0)
    // The pairs are still computed, so the findings still appear.
    expect(out.pairs).toHaveLength(1)
  })

  it('changes nothing when no mapping has been confirmed', () => {
    const out = run({ mappings: [] })
    expect(out.group.revenue).toBe(out.combined.revenue)
    expect(out.hasMappings).toBe(false)
    expect(out.pairs).toHaveLength(0)
  })

  it('eliminates at the lower of two disagreeing sides, leaving the remainder visible', () => {
    // Sub only ever recorded 600 of the parent's 1,000 sale.
    const states = group({
      subExtra: {
        purchases: [bill({ id: 'b1', supplierId: 'supp-1', subtotal: 600, total: 600 })],
        expenses: 1400, ap: 600,
      },
    })
    const out = consolidate({ companies: COMPANIES, statesByCompany: states, mappings: MAP })
    expect(out.eliminations.revenue).toBe(600)
    expect(out.eliminations.receivables).toBe(600)
    // 400 of overstatement survives — deliberately, with a finding beside it.
    expect(out.group.revenue).toBe(4400)
    expect(out.findings.some((f) => f.code === 'PAIR_DISAGREES')).toBe(true)
  })

  it('never eliminates more than one of the books contains', () => {
    const states = group({ subExtra: { purchases: [], expenses: 1400, ap: 0 } })
    const out = consolidate({ companies: COMPANIES, statesByCompany: states, mappings: MAP })
    expect(out.eliminations.revenue).toBe(0)
    expect(out.eliminations.receivables).toBe(0)
    expect(out.group.revenue).toBe(out.combined.revenue)
  })

  it('reports a disagreement as a finding with both gaps', () => {
    const states = group({
      parentExtra: { creditNotes: [{ id: 'cn1', customerId: 'cust-1', subtotal: 200, total: 200, status: 'issued' }] },
    })
    const out = consolidate({ companies: COMPANIES, statesByCompany: states, mappings: MAP })
    const f = out.findings.find((x) => x.code === 'PAIR_DISAGREES')
    expect(f).toMatchObject({ aName: 'Parent Holding', bName: 'Sub Trading LLC' })
    expect(f.receivableGap).toBe(-200)
  })

  it('reports a one-sided mapping as a setup problem, not a disagreement', () => {
    const out = run({ mappings: [MAP[0]] })
    expect(out.findings.some((f) => f.code === 'ONE_SIDED_MAPPING')).toBe(true)
    expect(out.findings.some((f) => f.code === 'PAIR_DISAGREES')).toBe(false)
  })

  it('still warns about mixed currencies', () => {
    const states = group()
    states['co-s'].settings.company.currency = 'AED'
    const out = consolidate({ companies: COMPANIES, statesByCompany: states, mappings: MAP })
    expect(out.mixedCurrency).toBe(true)
    expect(out.findings.some((f) => f.code === 'MIXED_CURRENCY')).toBe(true)
  })

  it('marks a company with no snapshot as missing instead of counting it as zero', () => {
    const out = consolidate({
      companies: [...COMPANIES, { id: 'co-x', name: 'Never Opened' }],
      statesByCompany: group(), mappings: MAP,
    })
    expect(out.companyRows.find((r0) => r0.id === 'co-x')).toMatchObject({ missing: true })
    expect(out.combined.revenue).toBe(5000)
  })

  it('carries every limitation, with text for each', () => {
    const out = run()
    expect(out.limitations).toEqual(LIMITATIONS)
    LIMITATIONS.forEach((code) => expect(LIMITATION_TEXT[code]).toBeTruthy())
  })

  it('has text for every finding code it can emit', () => {
    const states = group()
    states['co-s'].settings.company.currency = 'AED'
    const out = consolidate({ companies: COMPANIES, statesByCompany: states, mappings: [MAP[0]] })
    out.findings.forEach((f) => expect(FINDING_TEXT[f.code]).toBeTruthy())
  })

  it('survives an empty group', () => {
    const out = consolidate({})
    expect(out.combined).toMatchObject({ revenue: 0, expenses: 0, net: 0 })
    expect(out.findings).toEqual([])
  })
})
