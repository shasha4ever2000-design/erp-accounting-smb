import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

// A second receivables account to route some customers through.
const AR2 = { id: 'acc-ar-exp', code: '1110', name: 'Receivables — Export', type: 'asset', subtype: 'current', groupId: 'grp-recv' }
const AP2 = { id: 'acc-ap-ic', code: '2010', name: 'Payables — Intercompany', type: 'liability', subtype: 'current', groupId: 'grp-pay' }

beforeEach(() => {
  useStore.setState((s) => ({
    journalEntries: [],
    customers: [],
    suppliers: [],
    invoices: [],
    purchases: [],
    accounts: [
      ...s.accounts.filter((a) => a.id !== AR2.id && a.id !== AP2.id),
      { ...AR2 }, { ...AP2 },
    ],
  }))
})

const lineOn = (je, accountId) => (je.lines || []).find((l) => l.accountId === accountId)

const makeInvoice = (customerId, customerName, total = 1000) => g().addInvoice({
  customerId, customerName, date: '2026-03-01', dueDate: '2026-04-01',
  items: [{ description: 'x', quantity: 1, unitPrice: total, taxRate: 0, subtotal: total, accountId: 'acc-sales' }],
  subtotal: total, taxAmount: 0, total,
})

describe('the shipped accounts are control accounts', () => {
  it('flags receivables, payables and inventory', () => {
    const by = Object.fromEntries(g().accounts.map((a) => [a.id, a]))
    expect(by['acc-ar'].controlFor).toBe('customers')
    expect(by['acc-ap'].controlFor).toBe('suppliers')
    expect(by['acc-inv'].controlFor).toBe('inventoryItems')
  })

  it('offers only the default until another is nominated', () => {
    // An account merely existing must not make it a control account, or every
    // asset in the chart would show up as somewhere to put receivables.
    expect(g().controlAccountOptions('customers').map((a) => a.id)).toEqual(['acc-ar'])
    g().setAccountControlKind('acc-ar-exp', 'customers')
    expect(g().controlAccountOptions('customers').map((a) => a.id)).toEqual(['acc-ar', 'acc-ar-exp'])
  })
})

describe('nominating an account', () => {
  it('accepts an asset for receivables', () => {
    g().setAccountControlKind('acc-ar-exp', 'customers')
    expect(g().accounts.find((a) => a.id === 'acc-ar-exp').controlFor).toBe('customers')
  })

  it('refuses a liability for receivables — it would land on the wrong side', () => {
    expect(() => g().setAccountControlKind('acc-ap-ic', 'customers')).toThrow(/CONTROL_INVALID/)
  })

  it('refuses to stand an account down while records still point at it', () => {
    g().setAccountControlKind('acc-ar-exp', 'customers')
    g().addCustomer({ name: 'Export Co' })
    const c = last(g().customers)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')

    // Standing it down would silently redirect their postings to the default.
    expect(() => g().setAccountControlKind('acc-ar-exp', '')).toThrow(/CONTROL_IN_USE:1/)
  })

  it('allows standing it down once nothing points at it', () => {
    g().setAccountControlKind('acc-ar-exp', 'customers')
    expect(() => g().setAccountControlKind('acc-ar-exp', '')).not.toThrow()
  })
})

describe('invoices post to the customer\'s control account', () => {
  beforeEach(() => g().setAccountControlKind('acc-ar-exp', 'customers'))

  it('uses the default for an ordinary customer', () => {
    g().addCustomer({ name: 'Local Co' })
    const c = last(g().customers)
    const inv = makeInvoice(c.id, 'Local Co')
    const je = g().journalEntries.find((j) => j.id === inv.journalEntryId) || last(g().journalEntries)
    expect(lineOn(je, 'acc-ar').debit).toBe(1000)
  })

  it('uses the nominated account for a routed customer', () => {
    g().addCustomer({ name: 'Export Co' })
    const c = last(g().customers)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')

    makeInvoice(c.id, 'Export Co', 2500)
    const je = last(g().journalEntries)
    expect(lineOn(je, 'acc-ar-exp').debit).toBe(2500)
    expect(lineOn(je, 'acc-ar')).toBeUndefined()
  })

  it('sends the receipt back to the same account the invoice used', () => {
    g().addCustomer({ name: 'Export Co' })
    const c = last(g().customers)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')
    const inv = makeInvoice(c.id, 'Export Co', 2500)

    g().recordInvoicePayment(inv.id, { amount: 1000, date: '2026-03-15', bankAccountId: 'acc-bank1', method: 'bank' })
    const je = last(g().journalEntries)
    // A receipt crediting a different account from the invoice would leave the
    // debt outstanding on one account and a credit balance on the other.
    expect(lineOn(je, 'acc-ar-exp').credit).toBe(1000)
  })

  it('falls back to the default when the routed account is deleted', () => {
    g().addCustomer({ name: 'Orphan Co' })
    const c = last(g().customers)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')
    useStore.setState((s) => ({ accounts: s.accounts.filter((a) => a.id !== 'acc-ar-exp') }))

    makeInvoice(c.id, 'Orphan Co', 700)
    expect(lineOn(last(g().journalEntries), 'acc-ar').debit).toBe(700)
  })
})

describe('bills post to the supplier\'s control account', () => {
  beforeEach(() => g().setAccountControlKind('acc-ap-ic', 'suppliers'))

  it('uses the nominated account for a routed supplier', () => {
    g().addSupplier({ name: 'Sister Company' })
    const sup = last(g().suppliers)
    g().setRecordControlAccount('suppliers', sup.id, 'acc-ap-ic')

    g().addPurchase({
      supplierId: sup.id, supplierName: 'Sister Company', date: '2026-03-01', dueDate: '2026-04-01',
      items: [{ description: 'y', quantity: 1, unitPrice: 800, taxRate: 0, subtotal: 800, accountId: 'acc-admin' }],
      subtotal: 800, taxAmount: 0, total: 800,
    })
    expect(lineOn(last(g().journalEntries), 'acc-ap-ic').credit).toBe(800)
  })

  it('uses the default for an ordinary supplier', () => {
    g().addSupplier({ name: 'Trade Supplier' })
    const sup = last(g().suppliers)
    g().addPurchase({
      supplierId: sup.id, supplierName: 'Trade Supplier', date: '2026-03-01', dueDate: '2026-04-01',
      items: [{ description: 'y', quantity: 1, unitPrice: 500, taxRate: 0, subtotal: 500, accountId: 'acc-admin' }],
      subtotal: 500, taxAmount: 0, total: 500,
    })
    expect(lineOn(last(g().journalEntries), 'acc-ap').credit).toBe(500)
  })
})

describe('moving a customer who still owes money', () => {
  beforeEach(() => g().setAccountControlKind('acc-ar-exp', 'customers'))

  it('reclassifies the outstanding balance instead of stranding it', () => {
    g().addCustomer({ name: 'Moving Co' })
    const c = last(g().customers)
    makeInvoice(c.id, 'Moving Co', 3000)

    const res = g().setRecordControlAccount('customers', c.id, 'acc-ar-exp', { date: '2026-05-01' })

    expect(res.moved).toBe(3000)
    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    expect(lineOn(je, 'acc-ar-exp').debit).toBe(3000)
    expect(lineOn(je, 'acc-ar').credit).toBe(3000)
  })

  it('leaves the old account at nil and the new one carrying the debt', () => {
    g().addCustomer({ name: 'Moving Co' })
    const c = last(g().customers)
    makeInvoice(c.id, 'Moving Co', 3000)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp', { date: '2026-05-01' })

    const bals = g().getAllBalances()
    const net = (id) => Math.round(((bals[id]?.dr || 0) - (bals[id]?.cr || 0)) * 100) / 100
    expect(net('acc-ar')).toBe(0)
    expect(net('acc-ar-exp')).toBe(3000)
  })

  it('posts nothing when there is no balance to move', () => {
    g().addCustomer({ name: 'Clean Co' })
    const c = last(g().customers)
    const before = g().journalEntries.length

    const res = g().setRecordControlAccount('customers', c.id, 'acc-ar-exp')
    expect(res.moved).toBe(0)
    expect(res.journalEntryId).toBeNull()
    expect(g().journalEntries.length).toBe(before)
  })

  it('moves a supplier balance the other way round', () => {
    g().setAccountControlKind('acc-ap-ic', 'suppliers')
    g().addSupplier({ name: 'Moving Supplier' })
    const sup = last(g().suppliers)
    g().addPurchase({
      supplierId: sup.id, supplierName: 'Moving Supplier', date: '2026-03-01', dueDate: '2026-04-01',
      items: [{ description: 'y', quantity: 1, unitPrice: 1200, taxRate: 0, subtotal: 1200, accountId: 'acc-admin' }],
      subtotal: 1200, taxAmount: 0, total: 1200,
    })

    const res = g().setRecordControlAccount('suppliers', sup.id, 'acc-ap-ic', { date: '2026-05-01' })
    const bals = g().getAllBalances()
    const net = (id) => Math.round(((bals[id]?.cr || 0) - (bals[id]?.dr || 0)) * 100) / 100
    // `moved` reports what was owed, always positive; reclassLines handles
    // the sign, since payables sit as credits.
    expect(res.moved).toBe(1200)
    expect(net('acc-ap')).toBe(0)
    expect(net('acc-ap-ic')).toBe(1200)
  })

  it('keeps the books balanced through the move', () => {
    g().addCustomer({ name: 'Balanced Co' })
    const c = last(g().customers)
    makeInvoice(c.id, 'Balanced Co', 3000)
    g().setRecordControlAccount('customers', c.id, 'acc-ar-exp', { date: '2026-05-01' })

    const bals = g().getAllBalances()
    const totalDr = Object.values(bals).reduce((s, b) => s + b.dr, 0)
    const totalCr = Object.values(bals).reduce((s, b) => s + b.cr, 0)
    expect(Math.round((totalDr - totalCr) * 100) / 100).toBe(0)
  })

  it('refuses a target that is not a control account of that kind', () => {
    g().addCustomer({ name: 'Wrong Co' })
    const c = last(g().customers)
    expect(() => g().setRecordControlAccount('customers', c.id, 'acc-ap-ic')).toThrow(/CONTROL_INVALID/)
  })

  it('refuses an unknown record or kind', () => {
    expect(() => g().setRecordControlAccount('customers', 'ghost', 'acc-ar-exp')).toThrow(/RECORD_NOT_FOUND/)
    expect(() => g().setRecordControlAccount('nonsense', 'x', 'y')).toThrow(/CONTROL_KIND_UNKNOWN/)
  })
})
