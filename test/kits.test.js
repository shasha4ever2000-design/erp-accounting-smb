import { describe, it, expect } from 'vitest'
import {
  isKit, explode, explodeLines, kitCost, kitAvailability, shortComponents,
  wouldCycle, validateKit, describeKit, MAX_KIT_DEPTH,
} from '../src/utils/kits.js'

const drill   = { id: 'drill', name: 'Drill', quantity: 10, costPrice: 100 }
const battery = { id: 'batt',  name: 'Battery', quantity: 50, costPrice: 20 }
const kase    = { id: 'case',  name: 'Case', quantity: 8, costPrice: 15 }
const bundle  = {
  id: 'bundle', name: 'Starter Bundle', isKit: true, quantity: 0, costPrice: 0,
  components: [{ itemId: 'drill', quantity: 1 }, { itemId: 'batt', quantity: 2 }, { itemId: 'case', quantity: 1 }],
}
const ITEMS = [drill, battery, kase, bundle]

describe('isKit', () => {
  it('needs the flag and at least one component', () => {
    expect(isKit(bundle)).toBe(true)
    expect(isKit(drill)).toBe(false)
    expect(isKit({ isKit: true, components: [] })).toBe(false)
    expect(isKit({ isKit: true })).toBe(false)
    expect(isKit(null)).toBe(false)
  })
})

describe('explode — what actually leaves the shelf', () => {
  it('turns a kit into its components', () => {
    expect(explode(bundle, 1, ITEMS)).toEqual([
      { itemId: 'drill', qty: 1 }, { itemId: 'batt', qty: 2 }, { itemId: 'case', qty: 1 },
    ])
  })

  it('multiplies by the quantity sold', () => {
    const rows = explode(bundle, 3, ITEMS)
    expect(rows.find((r) => r.itemId === 'batt').qty).toBe(6)
    expect(rows.find((r) => r.itemId === 'drill').qty).toBe(3)
  })

  it('leaves an ordinary item exactly as it is', () => {
    expect(explode(drill, 4, ITEMS)).toEqual([{ itemId: 'drill', qty: 4 }])
  })

  it('never returns the kit itself — there is no kit on a shelf', () => {
    expect(explode(bundle, 1, ITEMS).some((r) => r.itemId === 'bundle')).toBe(false)
  })

  it('flattens a kit inside a kit', () => {
    const mega = {
      id: 'mega', isKit: true,
      components: [{ itemId: 'bundle', quantity: 2 }, { itemId: 'case', quantity: 1 }],
    }
    const rows = explode(mega, 1, [...ITEMS, mega])
    expect(rows.find((r) => r.itemId === 'drill').qty).toBe(2)
    expect(rows.find((r) => r.itemId === 'batt').qty).toBe(4)
    // Two cases from the bundles plus the one on the outer kit, merged.
    expect(rows.find((r) => r.itemId === 'case').qty).toBe(3)
  })

  it('merges a component reached down two branches into one row', () => {
    const twin = { id: 'twin', isKit: true, components: [{ itemId: 'batt', quantity: 1 }, { itemId: 'bundle', quantity: 1 }] }
    const rows = explode(twin, 1, [...ITEMS, twin])
    expect(rows.filter((r) => r.itemId === 'batt')).toHaveLength(1)
    expect(rows.find((r) => r.itemId === 'batt').qty).toBe(3)
  })

  it('terminates on a kit that contains itself', () => {
    // Left unguarded this recurses until the stack dies, taking the invoice
    // posting with it.
    const loop = { id: 'loop', isKit: true, components: [{ itemId: 'loop', quantity: 1 }] }
    expect(() => explode(loop, 1, [loop])).not.toThrow()
    expect(explode(loop, 1, [loop])).toEqual([])
  })

  it('terminates on a loop through several kits', () => {
    const a = { id: 'a', isKit: true, components: [{ itemId: 'b', quantity: 1 }] }
    const b = { id: 'b', isKit: true, components: [{ itemId: 'a', quantity: 1 }] }
    expect(() => explode(a, 1, [a, b])).not.toThrow()
  })

  it('skips a component that has been deleted rather than throwing', () => {
    const orphan = { id: 'o', isKit: true, components: [{ itemId: 'gone', quantity: 1 }, { itemId: 'batt', quantity: 1 }] }
    expect(explode(orphan, 1, ITEMS)).toEqual([{ itemId: 'batt', qty: 1 }])
  })

  it('ignores a component with no quantity', () => {
    const odd = { id: 'odd', isKit: true, components: [{ itemId: 'batt', quantity: 0 }, { itemId: 'case', quantity: 1 }] }
    expect(explode(odd, 1, ITEMS)).toEqual([{ itemId: 'case', qty: 1 }])
  })

  it('returns nothing for a zero or negative quantity', () => {
    expect(explode(bundle, 0, ITEMS)).toEqual([])
    expect(explode(bundle, -2, ITEMS)).toEqual([])
    expect(explode(null, 1, ITEMS)).toEqual([])
  })

  it('handles fractional component quantities without drifting', () => {
    const half = { id: 'half', isKit: true, components: [{ itemId: 'batt', quantity: 0.1 }] }
    expect(explode(half, 3, [...ITEMS, half])).toEqual([{ itemId: 'batt', qty: 0.3 }])
  })
})

describe('explodeLines', () => {
  it('rolls a whole document into one issue map', () => {
    const issue = explodeLines(
      [{ itemId: 'bundle', quantity: 2 }, { itemId: 'drill', quantity: 1 }],
      ITEMS
    )
    expect(issue).toEqual({ drill: 3, batt: 4, case: 2 })
  })

  it('ignores lines with no item, no quantity, or an unknown item', () => {
    expect(explodeLines(
      [{ quantity: 5 }, { itemId: 'drill', quantity: 0 }, { itemId: 'ghost', quantity: 2 }],
      ITEMS
    )).toEqual({})
  })

  it('copes with an empty document', () => {
    expect(explodeLines([], ITEMS)).toEqual({})
    expect(explodeLines()).toEqual({})
  })
})

describe('kitCost', () => {
  it('adds up the components at their own average cost', () => {
    // 100 + 2×20 + 15
    expect(kitCost(bundle, ITEMS)).toBe(155)
  })

  it('uses the plain cost for an ordinary item', () => {
    expect(kitCost(drill, ITEMS)).toBe(100)
  })

  it('costs a nested kit through to its stocked parts', () => {
    const mega = { id: 'mega', isKit: true, components: [{ itemId: 'bundle', quantity: 2 }] }
    expect(kitCost(mega, [...ITEMS, mega])).toBe(310)
  })

  it('is zero when every component has gone', () => {
    const orphan = { id: 'o', isKit: true, components: [{ itemId: 'gone', quantity: 1 }] }
    expect(kitCost(orphan, ITEMS)).toBe(0)
  })
})

describe('kitAvailability', () => {
  it('is limited by whichever component runs out first', () => {
    // 10 drills, 50/2 = 25 batteries' worth, 8 cases → 8 kits.
    expect(kitAvailability(bundle, ITEMS)).toBe(8)
  })

  it('reports plain stock for an ordinary item', () => {
    expect(kitAvailability(drill, ITEMS)).toBe(10)
  })

  it('is zero when a component is out of stock', () => {
    const items = ITEMS.map((i) => (i.id === 'case' ? { ...i, quantity: 0 } : i))
    expect(kitAvailability(bundle, items)).toBe(0)
  })

  it('rounds down — half a kit is not sellable', () => {
    const items = ITEMS.map((i) => (i.id === 'batt' ? { ...i, quantity: 5 } : i))
    expect(kitAvailability(bundle, items)).toBe(2)
  })

  it('is zero for a kit whose components have all been deleted', () => {
    expect(kitAvailability({ id: 'x', isKit: true, components: [{ itemId: 'gone', quantity: 1 }] }, ITEMS)).toBe(0)
  })
})

describe('shortComponents', () => {
  it('names what is not there and by how much', () => {
    const short = shortComponents(bundle, 12, ITEMS)
    expect(short.map((s) => s.itemId).sort()).toEqual(['case', 'drill'])
    expect(short.find((s) => s.itemId === 'drill')).toMatchObject({ need: 12, have: 10, short: 2 })
  })

  it('is empty when there is enough of everything', () => {
    expect(shortComponents(bundle, 3, ITEMS)).toEqual([])
  })
})

describe('wouldCycle', () => {
  const a = { id: 'a', isKit: true, components: [{ itemId: 'b', quantity: 1 }] }
  const b = { id: 'b', isKit: true, components: [{ itemId: 'drill', quantity: 1 }] }
  const items = [drill, a, b]

  it('catches an item being put inside itself', () => {
    expect(wouldCycle('a', 'a', items)).toBe(true)
  })
  it('catches a loop one level down', () => {
    // Putting 'a' inside 'b' would close the ring, since b is already in a.
    expect(wouldCycle('b', 'a', items)).toBe(true)
  })
  it('allows an ordinary component', () => {
    expect(wouldCycle('a', 'drill', items)).toBe(false)
  })
  it('says no when either side is missing', () => {
    expect(wouldCycle('', 'a', items)).toBe(false)
    expect(wouldCycle('a', '', items)).toBe(false)
  })
})

describe('validateKit', () => {
  it('accepts a sound kit', () => {
    expect(validateKit('new', [{ itemId: 'drill', quantity: 1 }], ITEMS).ok).toBe(true)
  })

  it('needs at least one component', () => {
    expect(validateKit('new', [], ITEMS).errors).toContain('A kit needs at least one component.')
  })

  it('refuses a kit containing itself', () => {
    expect(validateKit('bundle', [{ itemId: 'bundle', quantity: 1 }], ITEMS).errors)
      .toContain('A kit cannot contain itself.')
  })

  it('refuses a component that would close a loop', () => {
    const outer = { id: 'outer', isKit: true, components: [{ itemId: 'bundle', quantity: 1 }] }
    const r = validateKit('bundle', [{ itemId: 'outer', quantity: 1 }], [...ITEMS, outer])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/loop for ever/)
  })

  it('refuses a zero quantity and a deleted component', () => {
    expect(validateKit('new', [{ itemId: 'drill', quantity: 0 }], ITEMS).ok).toBe(false)
    expect(validateKit('new', [{ itemId: 'gone', quantity: 1 }], ITEMS).errors.join(' ')).toMatch(/no longer exists/)
  })

  it('refuses the same component listed twice', () => {
    const r = validateKit('new', [{ itemId: 'drill', quantity: 1 }, { itemId: 'drill', quantity: 2 }], ITEMS)
    expect(r.errors.join(' ')).toMatch(/listed twice/)
  })
})

describe('describeKit', () => {
  it('reads like a parts list', () => {
    expect(describeKit(bundle, ITEMS)).toBe('1× Drill, 2× Battery, 1× Case')
  })
  it('is empty for an ordinary item', () => {
    expect(describeKit(drill, ITEMS)).toBe('')
  })
})
