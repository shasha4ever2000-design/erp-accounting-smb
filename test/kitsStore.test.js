import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const byName = (n) => g().inventoryItems.find((i) => i.name === n)

beforeEach(() => {
  useStore.setState({ inventoryItems: [], invoices: [], journalEntries: [], customers: [], recycleBin: [] })
  g().addInventoryItem({ name: 'Drill', code: 'D1', quantity: 10, costPrice: 100, salePrice: 200 })
  g().addInventoryItem({ name: 'Battery', code: 'B1', quantity: 50, costPrice: 20, salePrice: 40 })
  g().addInventoryItem({ name: 'Case', code: 'C1', quantity: 8, costPrice: 15, salePrice: 30 })
})

const makeBundle = () => {
  g().addInventoryItem({
    name: 'Starter Bundle', code: 'KIT1', quantity: 0, costPrice: 0, salePrice: 400,
    isKit: true,
    components: [
      { itemId: byName('Drill').id, quantity: 1 },
      { itemId: byName('Battery').id, quantity: 2 },
      { itemId: byName('Case').id, quantity: 1 },
    ],
  })
  return byName('Starter Bundle')
}

const sellBundle = (qty = 1) => {
  const kit = byName('Starter Bundle')
  g().addCustomer({ name: 'Kit Buyer' })
  const c = last(g().customers)
  return g().addInvoice({
    customerId: c.id, customerName: 'Kit Buyer', date: '2026-04-01', dueDate: '2026-05-01',
    items: [{
      itemId: kit.id, description: 'Starter Bundle', quantity: qty, unitPrice: 400,
      taxRate: 0, subtotal: 400 * qty, accountId: 'acc-sales',
    }],
    subtotal: 400 * qty, taxAmount: 0, total: 400 * qty,
  })
}

describe('saving a kit', () => {
  it('accepts a sound one', () => {
    expect(() => makeBundle()).not.toThrow()
    expect(byName('Starter Bundle').isKit).toBe(true)
  })

  it('refuses a kit that contains itself', () => {
    const kit = makeBundle()
    expect(() => g().updateInventoryItem(kit.id, {
      components: [{ itemId: kit.id, quantity: 1 }],
    })).toThrow(/KIT_INVALID/)
  })

  it('refuses a kit that would close a loop through another kit', () => {
    const kit = makeBundle()
    g().addInventoryItem({
      name: 'Mega Bundle', code: 'KIT2', quantity: 0, costPrice: 0, salePrice: 900,
      isKit: true, components: [{ itemId: kit.id, quantity: 2 }],
    })
    const mega = byName('Mega Bundle')
    expect(() => g().updateInventoryItem(kit.id, {
      components: [{ itemId: mega.id, quantity: 1 }],
    })).toThrow(/KIT_INVALID/)
  })

  it('refuses a kit with no components', () => {
    expect(() => g().addInventoryItem({ name: 'Empty Kit', isKit: true, components: [] }))
      .toThrow(/KIT_INVALID/)
  })

  it('leaves ordinary items unvalidated', () => {
    expect(() => g().addInventoryItem({ name: 'Plain', quantity: 1, costPrice: 1 })).not.toThrow()
  })
})

describe('selling a kit moves the components, not the kit', () => {
  beforeEach(() => makeBundle())

  it('draws each component down by its own quantity', () => {
    sellBundle(2)
    expect(byName('Drill').quantity).toBe(8)      // 10 − 2
    expect(byName('Battery').quantity).toBe(46)   // 50 − 2×2
    expect(byName('Case').quantity).toBe(6)       // 8 − 2
  })

  it('leaves the kit itself at nil — there is no kit on a shelf', () => {
    sellBundle(2)
    expect(byName('Starter Bundle').quantity).toBe(0)
  })

  it('posts cost of sales from the components', () => {
    sellBundle(2)
    // (100 + 2×20 + 15) × 2 = 310
    const cogsJe = g().journalEntries.filter((j) => j.type === 'cogs').pop()
    const dr = cogsJe.lines.filter((l) => l.debit).reduce((s, l) => s + l.debit, 0)
    expect(dr).toBe(310)
  })

  it('keeps the cost entry balanced', () => {
    sellBundle(3)
    const cogsJe = g().journalEntries.filter((j) => j.type === 'cogs').pop()
    const dr = cogsJe.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = cogsJe.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(dr).toBe(cr)
  })

  it('never posts cost for the kit line itself, which has none', () => {
    sellBundle(1)
    const cogsJe = g().journalEntries.filter((j) => j.type === 'cogs').pop()
    // 155, not 0 and not doubled by counting the kit as well as its parts.
    expect(cogsJe.lines.reduce((s, l) => s + (l.debit || 0), 0)).toBe(155)
  })

  it('handles a kit and a loose component on the same invoice', () => {
    const kit = byName('Starter Bundle')
    const drill = byName('Drill')
    g().addCustomer({ name: 'Mixed Buyer' })
    const c = last(g().customers)
    g().addInvoice({
      customerId: c.id, customerName: 'Mixed Buyer', date: '2026-04-01', dueDate: '2026-05-01',
      items: [
        { itemId: kit.id, description: 'Bundle', quantity: 1, unitPrice: 400, taxRate: 0, subtotal: 400, accountId: 'acc-sales' },
        { itemId: drill.id, description: 'Drill', quantity: 2, unitPrice: 200, taxRate: 0, subtotal: 400, accountId: 'acc-sales' },
      ],
      subtotal: 800, taxAmount: 0, total: 800,
    })
    // One drill from the bundle plus two loose.
    expect(byName('Drill').quantity).toBe(7)
  })
})

describe('a nested kit explodes all the way down', () => {
  it('relieves the stocked components of an inner kit', () => {
    const kit = makeBundle()
    g().addInventoryItem({
      name: 'Mega Bundle', code: 'KIT2', quantity: 0, costPrice: 0, salePrice: 900,
      isKit: true, components: [{ itemId: kit.id, quantity: 2 }],
    })
    const mega = byName('Mega Bundle')
    g().addCustomer({ name: 'Mega Buyer' })
    const c = last(g().customers)
    g().addInvoice({
      customerId: c.id, customerName: 'Mega Buyer', date: '2026-04-01', dueDate: '2026-05-01',
      items: [{ itemId: mega.id, description: 'Mega', quantity: 1, unitPrice: 900, taxRate: 0, subtotal: 900, accountId: 'acc-sales' }],
      subtotal: 900, taxAmount: 0, total: 900,
    })
    expect(byName('Drill').quantity).toBe(8)
    expect(byName('Battery').quantity).toBe(46)
    expect(byName('Starter Bundle').quantity).toBe(0)
    expect(byName('Mega Bundle').quantity).toBe(0)
  })
})

describe('the books still balance when kits are sold', () => {
  it('leaves the trial balance square', () => {
    makeBundle()
    sellBundle(2)
    const bals = g().getAllBalances()
    const dr = Object.values(bals).reduce((s, b) => s + b.dr, 0)
    const cr = Object.values(bals).reduce((s, b) => s + b.cr, 0)
    expect(Math.round((dr - cr) * 100) / 100).toBe(0)
  })
})
