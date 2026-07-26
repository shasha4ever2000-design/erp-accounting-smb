import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const item = (n) => g().inventoryItems.find((i) => i.name === n)

beforeEach(() => {
  useStore.setState({ inventoryItems: [], stockCounts: [], journalEntries: [], recycleBin: [] })
  g().addInventoryItem({ name: 'Bolt', code: 'B-1', quantity: 100, costPrice: 2, salePrice: 4 })
  g().addInventoryItem({ name: 'Nut', code: 'N-1', quantity: 40, costPrice: 1.5, salePrice: 3 })
  g().addInventoryItem({ name: 'Washer', code: 'W-1', quantity: 250, costPrice: 0.2, salePrice: 0.5 })
})

const openCount = () => g().startStockCount({ date: '2026-07-10' })
const setCount = (count, name, qty) => {
  const id = item(name).id
  g().updateStockCount(count.id, {
    lines: g().stockCounts.find((c) => c.id === count.id).lines
      .map((l) => (l.itemId === id ? { ...l, counted: qty } : l)),
  })
}
const current = (count) => g().stockCounts.find((c) => c.id === count.id)

describe('starting a count', () => {
  it('freezes what the books say right now', () => {
    const c = openCount()
    expect(c.lines).toHaveLength(3)
    expect(c.lines.find((l) => l.name === 'Bolt').expected).toBe(100)
    expect(c.lines.every((l) => l.counted === null)).toBe(true)
  })

  it('keeps the frozen figure even if stock moves afterwards', () => {
    const c = openCount()
    g().updateInventoryItem(item('Bolt').id, { quantity: 80 })
    // Stock that left legitimately during the count must not look like a
    // shortage against a moving target.
    expect(current(c).lines.find((l) => l.name === 'Bolt').expected).toBe(100)
  })

  it('numbers itself and starts open', () => {
    const c = openCount()
    expect(c.number).toMatch(/^SC-/)
    expect(c.status).toBe('open')
  })

  it('excludes kits, which hold no stock', () => {
    g().addInventoryItem({
      name: 'Bundle', code: 'K-1', quantity: 0, costPrice: 0, salePrice: 10,
      isKit: true, components: [{ itemId: item('Bolt').id, quantity: 2 }],
    })
    expect(openCount().lines.some((l) => l.name === 'Bundle')).toBe(false)
  })

  it('refuses when there is nothing to count', () => {
    useStore.setState({ inventoryItems: [] })
    expect(() => g().startStockCount({ date: '2026-07-10' })).toThrow(/COUNT_NO_ITEMS/)
  })
})

describe('posting only touches what was counted', () => {
  it('leaves an uncounted item exactly as it was', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)          // Nut and Washer never counted
    g().postStockCount(c.id)

    // The classic disaster this guards against: a partial count posting
    // everything nobody reached down to zero.
    expect(item('Bolt').quantity).toBe(95)
    expect(item('Nut').quantity).toBe(40)
    expect(item('Washer').quantity).toBe(250)
  })

  it('leaves an item that matched exactly alone', () => {
    const c = openCount()
    setCount(c, 'Nut', 40)
    const res = g().postStockCount(c.id)
    expect(res.adjusted).toBe(0)
    expect(item('Nut').quantity).toBe(40)
  })

  it('treats a counted zero as a real count, and writes the stock off', () => {
    const c = openCount()
    setCount(c, 'Nut', 0)
    g().postStockCount(c.id)
    expect(item('Nut').quantity).toBe(0)
  })
})

describe('the accounting behind a count', () => {
  it('debits inventory and credits adjustments for a gain', () => {
    const c = openCount()
    setCount(c, 'Bolt', 110)         // +10 × 2 = 20
    const res = g().postStockCount(c.id)

    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    expect(je.lines.find((l) => l.accountId === 'acc-inv').debit).toBe(20)
    expect(je.lines.find((l) => l.accountId === 'acc-invadj').credit).toBe(20)
  })

  it('reverses it for a shortage', () => {
    const c = openCount()
    setCount(c, 'Bolt', 90)          // −10 × 2 = −20
    const res = g().postStockCount(c.id)
    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    expect(je.lines.find((l) => l.accountId === 'acc-inv').credit).toBe(20)
    expect(je.lines.find((l) => l.accountId === 'acc-invadj').debit).toBe(20)
  })

  it('nets gains against losses in one entry', () => {
    const c = openCount()
    setCount(c, 'Bolt', 110)         // +20
    setCount(c, 'Nut', 30)           // −15
    const res = g().postStockCount(c.id)
    const je = g().journalEntries.find((j) => j.id === res.journalEntryId)
    expect(je.lines.find((l) => l.accountId === 'acc-invadj').credit).toBe(5)
  })

  it('leaves the books balanced', () => {
    const c = openCount()
    setCount(c, 'Bolt', 110)
    setCount(c, 'Washer', 200)
    g().postStockCount(c.id)
    const bals = g().getAllBalances()
    const dr = Object.values(bals).reduce((s, b) => s + b.dr, 0)
    const cr = Object.values(bals).reduce((s, b) => s + b.cr, 0)
    expect(Math.round((dr - cr) * 100) / 100).toBe(0)
  })

  it('posts no entry at all when nothing moved', () => {
    const c = openCount()
    setCount(c, 'Bolt', 100)
    const before = g().journalEntries.length
    const res = g().postStockCount(c.id)
    expect(res.journalEntryId).toBeNull()
    expect(g().journalEntries.length).toBe(before)
    expect(current(c).status).toBe('posted')
  })
})

describe('a posted count is final', () => {
  it('cannot be posted twice', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)
    g().postStockCount(c.id)
    expect(() => g().postStockCount(c.id)).toThrow(/COUNT_INVALID/)
  })

  it('does not double-adjust when a second post is attempted', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)
    g().postStockCount(c.id)
    try { g().postStockCount(c.id) } catch { /* expected */ }
    expect(item('Bolt').quantity).toBe(95)
  })

  it('ignores edits after posting — its lines are what the adjustment used', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)
    g().postStockCount(c.id)
    setCount(c, 'Bolt', 5)
    expect(current(c).lines.find((l) => l.name === 'Bolt').counted).toBe(95)
  })

  it('cannot be deleted', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)
    g().postStockCount(c.id)
    expect(() => g().deleteStockCount(c.id)).toThrow(/COUNT_POSTED/)
  })

  it('records what it did', () => {
    const c = openCount()
    setCount(c, 'Bolt', 110)
    setCount(c, 'Nut', 30)
    const res = g().postStockCount(c.id)
    expect(res.summary).toMatchObject({ gains: 1, losses: 1, counted: 2, uncounted: 1 })
    expect(current(c).summary.netValue).toBe(5)
  })
})

describe('an open count can be abandoned', () => {
  it('goes to the recycle bin', () => {
    const c = openCount()
    g().deleteStockCount(c.id)
    expect(g().stockCounts.find((x) => x.id === c.id)).toBeUndefined()
    expect(g().recycleBin.some((e) => e.recordId === c.id && e.entity === 'stockCounts')).toBe(true)
  })

  it('changes no stock on the way out', () => {
    const c = openCount()
    setCount(c, 'Bolt', 5)
    g().deleteStockCount(c.id)
    expect(item('Bolt').quantity).toBe(100)
  })
})

describe('period lock', () => {
  it('refuses to post into a closed period', () => {
    const c = openCount()
    setCount(c, 'Bolt', 95)
    useStore.setState((s) => ({ settings: { ...s.settings, accounting: { ...s.settings.accounting, lockDate: '2026-12-31' } } }))
    expect(() => g().postStockCount(c.id)).toThrow(/COUNT_INVALID/)
    expect(item('Bolt').quantity).toBe(100)
    useStore.setState((s) => ({ settings: { ...s.settings, accounting: { ...s.settings.accounting, lockDate: '' } } }))
  })
})

describe('counting one warehouse', () => {
  it('moves the total by that warehouse\'s difference, not by replacing it', () => {
    const id = item('Bolt').id
    g().updateInventoryItem(id, { quantity: 100, stockByWarehouse: { main: 60, spare: 40 } })

    const c = g().startStockCount({ date: '2026-07-10', warehouseId: 'main' })
    const line = c.lines.find((l) => l.itemId === id)
    expect(line.expected).toBe(60)

    g().updateStockCount(c.id, { lines: c.lines.map((l) => (l.itemId === id ? { ...l, counted: 55 } : l)) })
    g().postStockCount(c.id)

    // Counting 'main' says nothing about 'spare'.
    expect(item('Bolt').stockByWarehouse.main).toBe(55)
    expect(item('Bolt').stockByWarehouse.spare).toBe(40)
    expect(item('Bolt').quantity).toBe(95)
  })
})
