import { describe, it, expect } from 'vitest'
import {
  ABC_THRESHOLDS, CLASS_LABELS, defaultPolicy,
  classifyABC, lastCountedMap, dueForCount, nextBatch, coverage,
} from '../src/utils/cycleCount.js'

const item = (id, qty, cost, extra = {}) => ({ id, code: id, name: id, quantity: qty, costPrice: cost, ...extra })

// One dominant item, a middle one, and a tail — the usual shape.
const ITEMS = [
  item('machine', 1, 40000),   // 40,000
  item('motor', 10, 800),      //  8,000
  item('belt', 200, 5),        //  1,000
  item('washer', 10000, 0.02), //    200
  item('nut', 5000, 0.01),     //     50
]

const posted = (date, itemIds, counted = 1) => ({
  id: `c-${date}`, date, status: 'posted',
  lines: itemIds.map((id) => ({ itemId: id, counted })),
})

describe('classifyABC', () => {
  it('ranks by value, not by quantity', () => {
    const rows = classifyABC(ITEMS)
    expect(rows[0].id).toBe('machine')
    // Ten thousand washers do not outrank one machine.
    expect(rows.findIndex((r) => r.id === 'washer')).toBeGreaterThan(1)
  })

  it('puts the bulk of the value in class A', () => {
    const rows = classifyABC(ITEMS)
    const a = rows.filter((r) => r.cls === 'A')
    expect(a.map((r) => r.id)).toContain('machine')
    const aShare = a.reduce((s, r) => s + r.share, 0)
    expect(aShare).toBeGreaterThan(0.7)
  })

  it('leaves the long tail in C', () => {
    const rows = classifyABC(ITEMS)
    expect(rows[rows.length - 1].cls).toBe('C')
  })

  it('calls everything C when nothing has any value', () => {
    // Marking a valueless catalogue as A would put all of it on a monthly
    // count for no reason at all.
    const rows = classifyABC([item('a', 0, 0), item('b', 0, 0)])
    expect(rows.every((r) => r.cls === 'C')).toBe(true)
  })

  it('excludes kits, which hold no stock', () => {
    const rows = classifyABC([...ITEMS, { id: 'kit', isKit: true, components: [{ itemId: 'belt', quantity: 2 }] }])
    expect(rows.some((r) => r.id === 'kit')).toBe(false)
  })

  it('uses sensible thresholds', () => {
    expect(ABC_THRESHOLDS.A).toBeLessThan(ABC_THRESHOLDS.B)
    expect(Object.keys(CLASS_LABELS).sort()).toEqual(['A', 'B', 'C'])
  })

  it('copes with an empty catalogue', () => {
    expect(classifyABC([])).toEqual([])
  })
})

describe('lastCountedMap — only a posted count is evidence', () => {
  it('records the date of a posted count', () => {
    expect(lastCountedMap([posted('2026-03-01', ['motor'])])).toEqual({ motor: '2026-03-01' })
  })

  it('ignores a count that was started and abandoned', () => {
    // An open sheet proves nothing about what is on the shelf, and treating it
    // as evidence would push the item to the back of the queue for a year.
    const open = { id: 'x', date: '2026-06-01', status: 'open', lines: [{ itemId: 'motor', counted: 5 }] }
    expect(lastCountedMap([open])).toEqual({})
  })

  it('ignores a line nobody actually filled in', () => {
    const sheet = { id: 'y', date: '2026-06-01', status: 'posted', lines: [{ itemId: 'motor', counted: null }] }
    expect(lastCountedMap([sheet])).toEqual({})
  })

  it('keeps the most recent date when an item is counted twice', () => {
    const m = lastCountedMap([posted('2026-01-01', ['motor']), posted('2026-05-01', ['motor'])])
    expect(m.motor).toBe('2026-05-01')
  })

  it('treats a counted zero as a real count', () => {
    expect(lastCountedMap([posted('2026-04-01', ['motor'], 0)]).motor).toBe('2026-04-01')
  })
})

describe('dueForCount', () => {
  const asAt = '2026-07-01'

  it('makes an item never counted due straight away', () => {
    const rows = dueForCount(ITEMS, [], { asAt })
    expect(rows.every((r) => r.due)).toBe(true)
    expect(rows.every((r) => r.neverCounted)).toBe(true)
  })

  it('counts class A far more often than class C', () => {
    const pol = defaultPolicy()
    expect(pol.A).toBeLessThan(pol.B)
    expect(pol.B).toBeLessThan(pol.C)
  })

  it('leaves an item alone until its interval has passed', () => {
    // 'machine' is class A on a 30-day cycle, counted 10 days ago.
    const rows = dueForCount(ITEMS, [posted('2026-06-21', ['machine'])], { asAt })
    expect(rows.find((r) => r.id === 'machine').due).toBe(false)
  })

  it('brings it back once the interval passes', () => {
    const rows = dueForCount(ITEMS, [posted('2026-05-01', ['machine'])], { asAt })
    expect(rows.find((r) => r.id === 'machine').due).toBe(true)
  })

  it('holds a class C item for a year, not a month', () => {
    const rows = dueForCount(ITEMS, [posted('2026-05-01', ['nut'])], { asAt })
    expect(rows.find((r) => r.id === 'nut').due).toBe(false)
  })

  it('puts never-counted items first, then the most overdue', () => {
    const counts = [posted('2020-01-01', ['machine']), posted('2026-06-25', ['motor'])]
    const rows = dueForCount(ITEMS, counts, { asAt })
    expect(rows[0].neverCounted).toBe(true)
    const machine = rows.find((r) => r.id === 'machine')
    expect(machine.daysOverdue).toBeGreaterThan(2000)
  })

  it('honours a custom policy', () => {
    const rows = dueForCount(ITEMS, [posted('2026-06-25', ['machine'])], { asAt, policy: { A: 1 } })
    expect(rows.find((r) => r.id === 'machine').due).toBe(true)
  })

  it('reports how long since each item was counted', () => {
    const rows = dueForCount(ITEMS, [posted('2026-06-01', ['motor'])], { asAt })
    expect(rows.find((r) => r.id === 'motor').daysSince).toBe(30)
  })
})

describe('nextBatch', () => {
  const asAt = '2026-07-01'

  it('caps the list, because four hundred items is not a cycle count', () => {
    const many = Array.from({ length: 100 }, (_, i) => item(`i${i}`, 1, 10))
    const b = nextBatch(many, [], { asAt, limit: 20 })
    expect(b.itemIds).toHaveLength(20)
    expect(b.dueCount).toBe(100)
    expect(b.remaining).toBe(80)
  })

  it('takes the most urgent first', () => {
    const counts = [posted('2026-06-28', ['machine', 'motor', 'belt', 'washer'])]
    const b = nextBatch(ITEMS, counts, { asAt, limit: 2 })
    // Only 'nut' was never counted, so it leads.
    expect(b.itemIds[0]).toBe('nut')
  })

  it('returns nothing when nothing is due', () => {
    const counts = [posted('2026-06-30', ITEMS.map((i) => i.id))]
    const b = nextBatch(ITEMS, counts, { asAt })
    expect(b.itemIds).toEqual([])
    expect(b.dueCount).toBe(0)
  })

  it('values the batch, so its worth is visible before starting', () => {
    const b = nextBatch(ITEMS, [], { asAt, limit: 1 })
    expect(b.value).toBe(40000)
  })

  it('never returns a zero-length cap', () => {
    expect(nextBatch(ITEMS, [], { asAt, limit: 0 }).itemIds.length).toBeGreaterThan(0)
  })
})

describe('coverage', () => {
  const asAt = '2026-07-01'

  it('reports nothing counted on a fresh catalogue', () => {
    const c = coverage(ITEMS, [], { asAt })
    expect(c.counted).toBe(0)
    expect(c.neverCounted).toBe(ITEMS.length)
    expect(c.pctCounted).toBe(0)
  })

  it('tracks progress as counts are posted', () => {
    const c = coverage(ITEMS, [posted('2026-06-30', ['machine', 'motor'])], { asAt })
    expect(c.counted).toBe(2)
    expect(c.pctCounted).toBe(40)
  })

  it('breaks the backlog down by class', () => {
    const c = coverage(ITEMS, [], { asAt })
    expect(c.byClass.A + c.byClass.B + c.byClass.C).toBe(ITEMS.length)
    expect(c.dueValue).toBe(c.totalValue)
  })

  it('handles an empty catalogue without dividing by zero', () => {
    const c = coverage([], [], { asAt })
    expect(c.pctCounted).toBe(0)
    expect(c.total).toBe(0)
  })
})
