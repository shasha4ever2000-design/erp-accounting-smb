import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

beforeEach(() => {
  useStore.setState((s) => ({
    customers: [], suppliers: [], invoices: [], journalEntries: [], inventoryItems: [], stockCounts: [],
    // A VAT-registered company: the tax treatment of the discount is the
    // whole point of this feature, and it is inert with tax switched off.
    settings: {
      ...s.settings,
      terms: { netDays: 30, discountPct: 0, discountDays: 0 },
      tax: { ...s.settings.tax, enabled: true, rate: 15 },
    },
  }))
})

const makeInvoice = (customerId, { date = '2026-07-01', net = 1000, tax = 150 } = {}) => g().addInvoice({
  customerId, customerName: 'Terms Co', date, dueDate: '2026-07-31',
  items: [{ description: 'x', quantity: 1, unitPrice: net, taxRate: 15, subtotal: net, accountId: 'acc-sales' }],
  subtotal: net, taxAmount: tax, total: net + tax,
})

describe('terms resolution', () => {
  it('falls back to the company default', () => {
    g().addCustomer({ name: 'Plain Co' })
    const c = last(g().customers)
    expect(g().termsFor('customer', c.id)).toEqual({ netDays: 30, discountPct: 0, discountDays: 0 })
  })

  it('lets a customer carry their own', () => {
    g().addCustomer({ name: 'Special Co', paymentTerms: '2_10_30' })
    const c = last(g().customers)
    expect(g().termsFor('customer', c.id)).toEqual({ netDays: 30, discountPct: 2, discountDays: 10 })
  })

  it('derives the due date from those terms', () => {
    g().addCustomer({ name: 'Net60 Co', paymentTerms: { netDays: 60, discountPct: 0, discountDays: 0 } })
    const c = last(g().customers)
    expect(g().dueDateFrom('customer', c.id, '2026-07-01')).toBe('2026-08-30')
  })

  it('refuses company terms that make no sense', () => {
    expect(() => g().updatePaymentTerms({ discountPct: 2, discountDays: 0 })).toThrow(/TERMS_INVALID/)
  })
})

describe('settlement discounts', () => {
  const setup = () => {
    g().addCustomer({ name: 'Terms Co', paymentTerms: '2_10_30' })
    const c = last(g().customers)
    return { c, inv: makeInvoice(c.id) }
  }

  it('offers the discount inside the window', () => {
    const { inv } = setup()
    const offer = g().settlementOffer(inv.id, '2026-07-05')
    expect(offer.eligible).toBe(true)
    expect(offer.discountNet).toBe(20)
    expect(offer.discountTax).toBe(3)
    expect(offer.amountToPay).toBe(1127)
  })

  it('withdraws it after the window', () => {
    const { inv } = setup()
    expect(g().settlementOffer(inv.id, '2026-07-20').eligible).toBe(false)
  })

  it('posts a balanced entry that reverses the tax too', () => {
    const { inv } = setup()
    const res = g().postSettlementDiscount(inv.id, '2026-07-05')
    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(Math.round((dr - cr) * 100) / 100).toBe(0)
    expect(je.lines.find((l) => l.accountId === 'acc-salesdisc').debit).toBe(20)
    expect(je.lines.find((l) => l.accountId === 'acc-vatout').debit).toBe(3)
  })

  it('settles the invoice by the gross discount', () => {
    const { inv } = setup()
    g().postSettlementDiscount(inv.id, '2026-07-05')
    expect(g().invoices.find((i) => i.id === inv.id).amountPaid).toBe(23)
  })

  it('routes to the customer\'s own receivables control account', () => {
    useStore.setState((s) => ({
      accounts: [...s.accounts, { id: 'acc-ar-exp', code: '1110', name: 'AR Export', type: 'asset', subtype: 'current', controlFor: 'customers' }],
    }))
    g().addCustomer({ name: 'Export Co', paymentTerms: '2_10_30' })
    const c = last(g().customers)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')
    const inv = makeInvoice(c.id)
    const res = g().postSettlementDiscount(inv.id, '2026-07-05')
    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    expect(je.lines.find((l) => l.credit === 23).accountId).toBe('acc-ar-exp')
  })

  it('refuses when no discount is available', () => {
    g().addCustomer({ name: 'Plain Co' })
    const c = last(g().customers)
    const inv = makeInvoice(c.id)
    expect(() => g().postSettlementDiscount(inv.id, '2026-07-05')).toThrow(/DISCOUNT_NOT_AVAILABLE/)
  })

  it('keeps the books balanced overall', () => {
    const { inv } = setup()
    g().postSettlementDiscount(inv.id, '2026-07-05')
    const bals = g().getAllBalances()
    const dr = Object.values(bals).reduce((s, b) => s + b.dr, 0)
    const cr = Object.values(bals).reduce((s, b) => s + b.cr, 0)
    expect(Math.round((dr - cr) * 100) / 100).toBe(0)
  })
})

describe('cycle counting', () => {
  beforeEach(() => {
    useStore.setState({ inventoryItems: [], stockCounts: [] })
    g().addInventoryItem({ name: 'Machine', code: 'M1', quantity: 1, costPrice: 40000, salePrice: 60000 })
    g().addInventoryItem({ name: 'Motor', code: 'MO1', quantity: 10, costPrice: 800, salePrice: 1200 })
    g().addInventoryItem({ name: 'Nut', code: 'N1', quantity: 5000, costPrice: 0.01, salePrice: 0.05 })
  })

  it('proposes everything on a catalogue never counted', () => {
    const b = g().cycleCountBatch({ asAt: '2026-07-01' })
    expect(b.itemIds).toHaveLength(3)
    expect(b.value).toBeGreaterThan(40000)
  })

  it('starts a stock count containing only the due items', () => {
    const c = g().startCycleCount({ date: '2026-07-01', limit: 2 })
    expect(c.lines).toHaveLength(2)
    expect(c.notes).toMatch(/Cycle count/)
  })

  it('stops proposing an item once its count is posted', () => {
    const c = g().startCycleCount({ date: '2026-07-01' })
    g().updateStockCount(c.id, { lines: c.lines.map((l) => ({ ...l, counted: l.expected })) })
    g().postStockCount(c.id)
    expect(g().cycleCountBatch({ asAt: '2026-07-02' }).itemIds).toEqual([])
  })

  it('brings class A back long before class C', () => {
    const c = g().startCycleCount({ date: '2026-07-01' })
    g().updateStockCount(c.id, { lines: c.lines.map((l) => ({ ...l, counted: l.expected })) })
    g().postStockCount(c.id)
    // 45 days later: the 30-day class-A item is due again, the nut is not.
    const due = g().cycleCountBatch({ asAt: '2026-08-15' })
    const machine = g().inventoryItems.find((i) => i.name === 'Machine')
    const nut = g().inventoryItems.find((i) => i.name === 'Nut')
    expect(due.itemIds).toContain(machine.id)
    expect(due.itemIds).not.toContain(nut.id)
  })

  it('refuses to start when nothing is due', () => {
    const c = g().startCycleCount({ date: '2026-07-01' })
    g().updateStockCount(c.id, { lines: c.lines.map((l) => ({ ...l, counted: l.expected })) })
    g().postStockCount(c.id)
    expect(() => g().startCycleCount({ date: '2026-07-02' })).toThrow(/CYCLE_NOTHING_DUE/)
  })

  it('an abandoned count does not reset the clock', () => {
    const c = g().startCycleCount({ date: '2026-07-01' })
    g().updateStockCount(c.id, { lines: c.lines.map((l) => ({ ...l, counted: l.expected })) })
    g().deleteStockCount(c.id)
    expect(g().cycleCountBatch({ asAt: '2026-07-02' }).itemIds).toHaveLength(3)
  })
})
