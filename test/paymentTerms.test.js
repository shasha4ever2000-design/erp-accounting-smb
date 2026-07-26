import { describe, it, expect } from 'vitest'
import {
  defaultTerms, TERM_PRESETS, presetById, resolveTerms,
  dueDateFor, discountDeadline, describeTerms,
  settlementDiscount, discountLines, purchaseDiscountLines, validateTerms,
} from '../src/utils/paymentTerms.js'

const TWO_TEN_NET_30 = { netDays: 30, discountPct: 2, discountDays: 10 }

// 1,000 net + 150 VAT at 15%.
const invoice = (extra = {}) => ({
  id: 'i1', number: 'INV-1', date: '2026-07-01',
  subtotal: 1000, taxAmount: 150, total: 1150, amountPaid: 0,
  ...extra,
})

describe('presets', () => {
  it('offers the terms people actually use', () => {
    expect(TERM_PRESETS.map((p) => p.id)).toContain('net30')
    expect(presetById('2_10_30')).toMatchObject({ netDays: 30, discountPct: 2, discountDays: 10 })
  })
  it('returns nothing for an unknown preset', () => {
    expect(presetById('nope')).toBeNull()
  })
  it('never ships a preset whose window outlives its term', () => {
    TERM_PRESETS.forEach((p) => {
      if (p.discountDays > 0 && p.netDays > 0) expect(p.discountDays, p.id).toBeLessThanOrEqual(p.netDays)
    })
  })
})

describe('resolveTerms', () => {
  it('falls back when a record says nothing', () => {
    expect(resolveTerms({})).toEqual(defaultTerms())
    expect(resolveTerms(null)).toEqual(defaultTerms())
  })
  it('expands a preset id', () => {
    expect(resolveTerms({ paymentTerms: '2_10_30' })).toEqual(TWO_TEN_NET_30)
  })
  it('takes an explicit object', () => {
    expect(resolveTerms({ paymentTerms: { netDays: 45, discountPct: 1.5, discountDays: 7 } }))
      .toEqual({ netDays: 45, discountPct: 1.5, discountDays: 7 })
  })
  it('uses a supplied fallback over the built-in one', () => {
    expect(resolveTerms({}, { netDays: 60, discountPct: 0, discountDays: 0 }).netDays).toBe(60)
  })
  it('never yields a negative term', () => {
    expect(resolveTerms({ paymentTerms: { netDays: -5, discountPct: -2, discountDays: -1 } }))
      .toEqual({ netDays: 0, discountPct: 0, discountDays: 0 })
  })
})

describe('dates', () => {
  it('sets the due date from the invoice date', () => {
    expect(dueDateFor('2026-07-01', TWO_TEN_NET_30)).toBe('2026-07-31')
    expect(dueDateFor('2026-07-01', { netDays: 0 })).toBe('2026-07-01')
  })
  it('crosses month and year ends correctly', () => {
    expect(dueDateFor('2026-12-20', { netDays: 30 })).toBe('2027-01-19')
    expect(dueDateFor('2028-02-01', { netDays: 30 })).toBe('2028-03-02')  // leap year
  })
  it('gives the discount deadline', () => {
    expect(discountDeadline('2026-07-01', TWO_TEN_NET_30)).toBe('2026-07-11')
  })
  it('has no deadline when there is no discount', () => {
    expect(discountDeadline('2026-07-01', { netDays: 30, discountPct: 0, discountDays: 0 })).toBe('')
  })
  it('survives a malformed date rather than producing NaN', () => {
    expect(dueDateFor('not-a-date', TWO_TEN_NET_30)).toBe('not-a-date')
  })
})

describe('describeTerms', () => {
  it('reads the way trade writes it', () => {
    expect(describeTerms(TWO_TEN_NET_30)).toBe('2/10 net 30')
    expect(describeTerms({ netDays: 30, discountPct: 0, discountDays: 0 })).toBe('Net 30')
    expect(describeTerms({ netDays: 0, discountPct: 0, discountDays: 0 })).toBe('Due on receipt')
  })
})

describe('settlementDiscount — the tax is the part that matters', () => {
  it('takes the discount off the net and reduces the tax in proportion', () => {
    const d = settlementDiscount(invoice(), '2026-07-05', TWO_TEN_NET_30)
    expect(d.eligible).toBe(true)
    expect(d.discountNet).toBe(20)      // 2% of 1,000
    expect(d.discountTax).toBe(3)       // 2% of 150 — the supply is worth less
    expect(d.discountGross).toBe(23)
    expect(d.amountToPay).toBe(1127)    // 1,150 − 23
  })

  it('never discounts the gross and leaves the tax alone', () => {
    // Doing that would overpay VAT and leave the return disagreeing with the
    // sales ledger. 2% of 1,150 is 23, but only 20 of it is net.
    const d = settlementDiscount(invoice(), '2026-07-05', TWO_TEN_NET_30)
    expect(d.discountNet).not.toBe(23)
    expect(d.discountNet + d.discountTax).toBe(d.discountGross)
  })

  it('derives the tax proportionally rather than from a rate', () => {
    // An invoice can carry several rates across its lines; the only figure
    // certainly right is the tax actually charged.
    const mixed = invoice({ subtotal: 1000, taxAmount: 75, total: 1075 })
    const d = settlementDiscount(mixed, '2026-07-05', TWO_TEN_NET_30)
    expect(d.discountNet).toBe(20)
    expect(d.discountTax).toBe(1.5)
  })

  it('reverses tax the invoice actually charged, whatever the company setting now says', () => {
    // The setting governs new documents. This invoice already charged 150 of
    // VAT and that VAT was posted — discounting the gross and leaving it alone
    // would overstate output tax on a supply worth less than billed.
    const d = settlementDiscount(invoice(), '2026-07-05', TWO_TEN_NET_30, { taxEnabled: false })
    expect(d.discountTax).toBe(3)
    expect(d.discountGross).toBe(23)
  })

  it('reverses nothing on an invoice that never charged tax', () => {
    const noTax = invoice({ subtotal: 1000, taxAmount: 0, total: 1000 })
    const d = settlementDiscount(noTax, '2026-07-05', TWO_TEN_NET_30)
    expect(d.discountTax).toBe(0)
    expect(d.discountGross).toBe(20)
  })

  it('finds the tax in the gap when no breakdown was recorded', () => {
    const odd = { date: '2026-07-01', subtotal: 1000, total: 1150, amountPaid: 0 }
    const d = settlementDiscount(odd, '2026-07-05', TWO_TEN_NET_30)
    expect(d.discountTax).toBe(3)
  })

  it('works on a tax-free invoice with no subtotal recorded', () => {
    const d = settlementDiscount({ date: '2026-07-01', total: 500, amountPaid: 0 }, '2026-07-05', TWO_TEN_NET_30)
    expect(d.discountNet).toBe(10)
    expect(d.discountGross).toBe(10)
  })

  it('is available on the last day of the window', () => {
    expect(settlementDiscount(invoice(), '2026-07-11', TWO_TEN_NET_30).eligible).toBe(true)
  })

  it('is gone the day after', () => {
    const d = settlementDiscount(invoice(), '2026-07-12', TWO_TEN_NET_30)
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('window-passed')
    expect(d.amountToPay).toBe(1150)
  })

  it('is not offered when the terms carry no discount', () => {
    const d = settlementDiscount(invoice(), '2026-07-02', { netDays: 30, discountPct: 0, discountDays: 0 })
    expect(d.reason).toBe('no-discount-terms')
  })

  it('is not offered on a part-paid invoice', () => {
    // Pro-rating a discount across instalments leaves fractions attached to an
    // invoice that may never settle.
    const d = settlementDiscount(invoice({ amountPaid: 100 }), '2026-07-05', TWO_TEN_NET_30)
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('partly-paid')
  })

  it('is not offered on an invoice already settled', () => {
    const d = settlementDiscount(invoice({ amountPaid: 1150 }), '2026-07-05', TWO_TEN_NET_30)
    expect(d.reason).toBe('already-settled')
  })

  it('always reports what is payable, eligible or not', () => {
    expect(settlementDiscount(invoice(), '2026-09-01', TWO_TEN_NET_30).amountToPay).toBe(1150)
  })
})

describe('discountLines', () => {
  const d = settlementDiscount(invoice(), '2026-07-05', TWO_TEN_NET_30)

  it('balances', () => {
    const lines = discountLines(d, { reference: 'INV-1' })
    const dr = lines.reduce((s, l) => s + l.debit, 0)
    const cr = lines.reduce((s, l) => s + l.credit, 0)
    expect(round(dr)).toBe(round(cr))
    expect(round(dr)).toBe(23)
  })

  it('credits receivables with the gross, so the invoice settles to nil', () => {
    const lines = discountLines(d)
    expect(lines.find((l) => l.accountId === 'acc-ar').credit).toBe(23)
  })

  it('debits the tax back, not just the discount', () => {
    const lines = discountLines(d)
    expect(lines.find((l) => l.accountId === 'acc-salesdisc').debit).toBe(20)
    expect(lines.find((l) => l.accountId === 'acc-vatout').debit).toBe(3)
  })

  it('omits the tax leg when there is none', () => {
    const noTax = settlementDiscount(invoice({ taxAmount: 0, total: 1000 }), '2026-07-05', TWO_TEN_NET_30)
    expect(discountLines(noTax).some((l) => l.accountId === 'acc-vatout')).toBe(false)
  })

  it('honours custom accounts, so a custom control account still works', () => {
    const lines = discountLines(d, { receivableAccountId: 'acc-ar-exp' })
    expect(lines.find((l) => l.credit === 23).accountId).toBe('acc-ar-exp')
  })

  it('produces nothing when no discount applies', () => {
    expect(discountLines(settlementDiscount(invoice(), '2026-09-01', TWO_TEN_NET_30))).toEqual([])
    expect(discountLines(null)).toEqual([])
  })
})

describe('purchaseDiscountLines — the same on the buying side', () => {
  const d = settlementDiscount(invoice(), '2026-07-05', TWO_TEN_NET_30)

  it('balances and reduces what we owe', () => {
    const lines = purchaseDiscountLines(d, { reference: 'PUR-1' })
    const dr = lines.reduce((s, l) => s + l.debit, 0)
    const cr = lines.reduce((s, l) => s + l.credit, 0)
    expect(round(dr)).toBe(round(cr))
    expect(lines.find((l) => l.accountId === 'acc-ap').debit).toBe(23)
  })

  it('gives back the input tax that is no longer recoverable', () => {
    const lines = purchaseDiscountLines(d)
    expect(lines.find((l) => l.accountId === 'acc-vatin').credit).toBe(3)
  })
})

describe('validateTerms', () => {
  it('accepts ordinary terms', () => {
    expect(validateTerms({ netDays: 30, discountPct: 0, discountDays: 0 }).ok).toBe(true)
    expect(validateTerms(TWO_TEN_NET_30).ok).toBe(true)
  })
  it('refuses half a discount', () => {
    expect(validateTerms({ netDays: 30, discountPct: 2, discountDays: 0 }).ok).toBe(false)
    expect(validateTerms({ netDays: 30, discountPct: 0, discountDays: 10 }).ok).toBe(false)
  })
  it('refuses a window that outlives the term', () => {
    const r = validateTerms({ netDays: 10, discountPct: 2, discountDays: 30 })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/never expire/)
  })
  it('refuses nonsense percentages and lengths', () => {
    expect(validateTerms({ netDays: 30, discountPct: 150, discountDays: 5 }).ok).toBe(false)
    expect(validateTerms({ netDays: 900 }).ok).toBe(false)
  })
})

function round(v) { return Math.round(v * 100) / 100 }
