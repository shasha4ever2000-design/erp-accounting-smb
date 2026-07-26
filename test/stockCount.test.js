import { describe, it, expect } from 'vitest'
import {
  COUNT_STATUS, qtyOnHand, countableItems, makeLine, buildSheet,
  isCounted, variance, varianceValue, applyCount, clearCount,
  summarise, adjustingLines, validateCount, postingLines, stockChanges,
} from '../src/utils/stockCount.js'

const bolt = { id: 'bolt', code: 'B-1', name: 'Bolt', unit: 'pcs', quantity: 100, costPrice: 2 }
const nut  = { id: 'nut',  code: 'N-1', name: 'Nut',  unit: 'pcs', quantity: 40,  costPrice: 1.5 }
const kit  = { id: 'kit',  code: 'K-1', name: 'Kit',  isKit: true, quantity: 0, costPrice: 0, components: [{ itemId: 'bolt', quantity: 2 }] }
const wh   = { id: 'wh1', code: 'W-1', name: 'Warehoused', quantity: 30, costPrice: 5, stockByWarehouse: { main: 20, spare: 10 } }
const ITEMS = [bolt, nut, kit, wh]

const sheet = () => buildSheet(ITEMS)

describe('qtyOnHand', () => {
  it('reads the total when no warehouse is named', () => {
    expect(qtyOnHand(wh)).toBe(30)
  })
  it('reads one warehouse when named', () => {
    expect(qtyOnHand(wh, 'main')).toBe(20)
    expect(qtyOnHand(wh, 'spare')).toBe(10)
  })
  it('is zero for a warehouse holding none of it', () => {
    expect(qtyOnHand(wh, 'other')).toBe(0)
  })
  it('falls back to the whole quantity for an item with no warehouse map', () => {
    // Predates warehouse tracking; its stock belongs wherever it is counted.
    expect(qtyOnHand(bolt, 'main')).toBe(100)
  })
  it('is zero for nothing', () => {
    expect(qtyOnHand(null)).toBe(0)
  })
})

describe('what can be counted', () => {
  it('excludes kits — they hold no stock', () => {
    expect(countableItems(ITEMS).map((i) => i.id)).toEqual(['bolt', 'nut', 'wh1'])
    expect(makeLine(kit)).toBeNull()
  })

  it('builds a line per stocked item, sorted by code', () => {
    expect(sheet().map((l) => l.code)).toEqual(['B-1', 'N-1', 'W-1'])
  })

  it('can be narrowed to chosen items', () => {
    expect(buildSheet(ITEMS, { itemIds: ['nut'] }).map((l) => l.itemId)).toEqual(['nut'])
  })

  it('freezes the expected quantity when the line is made', () => {
    const line = makeLine(bolt)
    // Later sales must not move this number, or stock that legitimately left
    // during the count would look like a shortage.
    expect(line.expected).toBe(100)
    expect(line.counted).toBeNull()
  })

  it('carries the unit cost for valuing the variance', () => {
    expect(makeLine(bolt).unitCost).toBe(2)
  })
})

describe('an uncounted line is not a zero', () => {
  it('starts uncounted', () => {
    expect(sheet().every((l) => !isCounted(l))).toBe(true)
  })

  it('treats a real zero as a count', () => {
    const lines = applyCount(sheet(), 'bolt', 0)
    expect(isCounted(lines.find((l) => l.itemId === 'bolt'))).toBe(true)
    expect(variance(lines.find((l) => l.itemId === 'bolt'))).toBe(-100)
  })

  it('has no variance while uncounted', () => {
    expect(variance(sheet()[0])).toBeNull()
    expect(varianceValue(sheet()[0])).toBeNull()
  })

  it('clears back to uncounted, not to zero', () => {
    let lines = applyCount(sheet(), 'bolt', 5)
    lines = clearCount(lines, 'bolt')
    expect(lines.find((l) => l.itemId === 'bolt').counted).toBeNull()
    expect(isCounted(lines.find((l) => l.itemId === 'bolt'))).toBe(false)
  })
})

describe('applyCount', () => {
  it('sets a typed total', () => {
    const lines = applyCount(sheet(), 'bolt', 97)
    expect(lines.find((l) => l.itemId === 'bolt').counted).toBe(97)
  })

  it('adds when scanning, so the same box scanned twice counts two', () => {
    let lines = applyCount(sheet(), 'bolt', 1, { mode: 'add', scanned: true })
    lines = applyCount(lines, 'bolt', 1, { mode: 'add', scanned: true })
    const l = lines.find((x) => x.itemId === 'bolt')
    expect(l.counted).toBe(2)
    expect(l.scanned).toBe(true)
  })

  it('replaces when typing, even after scanning', () => {
    let lines = applyCount(sheet(), 'bolt', 3, { mode: 'add', scanned: true })
    lines = applyCount(lines, 'bolt', 50)
    expect(lines.find((l) => l.itemId === 'bolt').counted).toBe(50)
  })

  it('leaves other lines alone', () => {
    const lines = applyCount(sheet(), 'bolt', 5)
    expect(lines.find((l) => l.itemId === 'nut').counted).toBeNull()
  })

  it('records a note when given one', () => {
    const lines = applyCount(sheet(), 'bolt', 5, { note: 'damaged box' })
    expect(lines.find((l) => l.itemId === 'bolt').note).toBe('damaged box')
  })
})

describe('variance and its value', () => {
  it('is positive for a gain and negative for a loss', () => {
    let lines = applyCount(sheet(), 'bolt', 105)
    lines = applyCount(lines, 'nut', 38)
    expect(variance(lines.find((l) => l.itemId === 'bolt'))).toBe(5)
    expect(variance(lines.find((l) => l.itemId === 'nut'))).toBe(-2)
  })

  it('values the variance at the item\'s own cost', () => {
    const lines = applyCount(sheet(), 'bolt', 105)
    expect(varianceValue(lines.find((l) => l.itemId === 'bolt'))).toBe(10)   // 5 × 2
  })

  it('is zero when the count agrees with the books', () => {
    const lines = applyCount(sheet(), 'bolt', 100)
    expect(variance(lines.find((l) => l.itemId === 'bolt'))).toBe(0)
  })
})

describe('summarise', () => {
  it('separates counted, uncounted, gains and losses', () => {
    let lines = applyCount(sheet(), 'bolt', 105)   // +5 → +10
    lines = applyCount(lines, 'nut', 38)           // −2 → −3
    const s = summarise(lines)
    expect(s).toMatchObject({
      total: 3, counted: 2, uncounted: 1, matching: 0,
      gains: 1, losses: 1, gainValue: 10, lossValue: -3, netValue: 7,
    })
  })

  it('counts a matching line as matching, not as a variance', () => {
    const s = summarise(applyCount(sheet(), 'bolt', 100))
    expect(s).toMatchObject({ counted: 1, matching: 1, gains: 0, losses: 0, netValue: 0 })
  })

  it('reports an empty sheet honestly', () => {
    expect(summarise([])).toMatchObject({ total: 0, counted: 0, uncounted: 0, netValue: 0 })
  })
})

describe('adjustingLines — only what actually moves', () => {
  it('skips uncounted and matching lines', () => {
    let lines = applyCount(sheet(), 'bolt', 105)
    lines = applyCount(lines, 'nut', 40)          // matches
    expect(adjustingLines(lines).map((l) => l.itemId)).toEqual(['bolt'])
  })
})

describe('validateCount', () => {
  const open = (lines, extra = {}) => ({ status: COUNT_STATUS.open, date: '2026-07-01', lines, ...extra })

  it('accepts a count with something in it', () => {
    expect(validateCount(open(applyCount(sheet(), 'bolt', 99))).ok).toBe(true)
  })

  it('refuses one already posted', () => {
    const c = open(applyCount(sheet(), 'bolt', 99), { status: COUNT_STATUS.posted })
    expect(validateCount(c).errors).toContain('This count has already been posted.')
  })

  it('refuses one with nothing counted', () => {
    expect(validateCount(open(sheet())).errors).toContain('Nothing has been counted yet.')
  })

  it('refuses a negative count', () => {
    const c = open(applyCount(sheet(), 'bolt', -3))
    expect(validateCount(c).ok).toBe(false)
  })

  it('refuses a date inside a closed period', () => {
    const c = open(applyCount(sheet(), 'bolt', 99))
    expect(validateCount(c, { lockDate: '2026-12-31' }).ok).toBe(false)
  })

  it('warns about uncounted lines without blocking — a partial count is normal', () => {
    const r = validateCount(open(applyCount(sheet(), 'bolt', 99)))
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/never counted/)
    expect(r.warnings.join(' ')).toMatch(/not set to zero/)
  })

  it('warns when posting would change nothing', () => {
    const r = validateCount(open(applyCount(sheet(), 'bolt', 100)))
    expect(r.warnings.join(' ')).toMatch(/change nothing/)
  })

  it('refuses a missing count rather than throwing', () => {
    expect(validateCount(null).ok).toBe(false)
  })
})

describe('postingLines', () => {
  const countWith = (lines) => ({ status: COUNT_STATUS.open, date: '2026-07-01', lines })

  it('debits inventory for a gain and credits the adjustment account', () => {
    const lines = postingLines(countWith(applyCount(sheet(), 'bolt', 105)), ITEMS)
    expect(lines.find((l) => l.accountId === 'acc-inv')).toMatchObject({ debit: 10, credit: 0 })
    expect(lines.find((l) => l.accountId === 'acc-invadj')).toMatchObject({ credit: 10, debit: 0 })
  })

  it('reverses it for a loss', () => {
    const lines = postingLines(countWith(applyCount(sheet(), 'bolt', 90)), ITEMS)
    expect(lines.find((l) => l.accountId === 'acc-inv')).toMatchObject({ credit: 20, debit: 0 })
    expect(lines.find((l) => l.accountId === 'acc-invadj')).toMatchObject({ debit: 20, credit: 0 })
  })

  it('balances', () => {
    let l = applyCount(sheet(), 'bolt', 105)
    l = applyCount(l, 'nut', 30)
    const je = postingLines(countWith(l), ITEMS)
    const dr = je.reduce((s, x) => s + x.debit, 0)
    const cr = je.reduce((s, x) => s + x.credit, 0)
    expect(Math.round((dr - cr) * 100) / 100).toBe(0)
  })

  it('relieves each item\'s own inventory account', () => {
    const items = ITEMS.map((i) => (i.id === 'nut' ? { ...i, inventoryAccountId: 'acc-rawmat' } : i))
    let l = applyCount(buildSheet(items), 'bolt', 105)
    l = applyCount(l, 'nut', 30)
    const je = postingLines(countWith(l), items)
    expect(je.some((x) => x.accountId === 'acc-rawmat')).toBe(true)
    expect(je.some((x) => x.accountId === 'acc-inv')).toBe(true)
  })

  it('produces nothing when nothing moved', () => {
    expect(postingLines(countWith(applyCount(sheet(), 'bolt', 100)), ITEMS)).toEqual([])
    expect(postingLines(countWith(sheet()), ITEMS)).toEqual([])
  })

  it('honours a different adjustment account', () => {
    const je = postingLines(countWith(applyCount(sheet(), 'bolt', 105)), ITEMS, { adjustmentAccountId: 'acc-misc' })
    expect(je.some((l) => l.accountId === 'acc-misc')).toBe(true)
  })
})

describe('stockChanges', () => {
  it('sets each adjusted item to what was counted', () => {
    let l = applyCount(sheet(), 'bolt', 105)
    l = applyCount(l, 'nut', 30)
    expect(stockChanges({ lines: l })).toEqual({ bolt: 105, nut: 30 })
  })

  it('leaves uncounted and matching items out entirely', () => {
    // The whole point: an item nobody counted must not be touched.
    let l = applyCount(sheet(), 'bolt', 100)   // matches
    expect(stockChanges({ lines: l })).toEqual({})
  })
})
