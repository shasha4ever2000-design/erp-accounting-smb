import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GROUPS, SEED_ASSIGNMENT, COST_OF_SALES, TYPE_ORDER,
  defaultGroupFor, assignDefaultGroups, isDescendant, groupPath, flattenGroups,
  buildTree, withTotals, pruneEmpty, flattenRows, findByRole, withoutNode, findNode,
  validateGroup, deleteGroupPlan, groupUsage,
} from '../src/utils/accountTree.js'

const G = (id, type, parentId = null, extra = {}) => ({ id, name: id, type, parentId, ...extra })
const A = (id, type, groupId = '', extra = {}) => ({ id, name: id, code: id, type, groupId, ...extra })

describe('the shipped default groups', () => {
  it('only uses real account types', () => {
    DEFAULT_GROUPS.forEach((g) => expect(TYPE_ORDER, g.id).toContain(g.type))
  })

  it('never puts a group under a parent of another type', () => {
    const by = Object.fromEntries(DEFAULT_GROUPS.map((g) => [g.id, g]))
    DEFAULT_GROUPS.filter((g) => g.parentId).forEach((g) => {
      expect(by[g.parentId], `${g.id} parent missing`).toBeTruthy()
      expect(by[g.parentId].type, `${g.id} crosses type`).toBe(g.type)
    })
  })

  it('has exactly one cost-of-sales group, so gross profit is unambiguous', () => {
    expect(DEFAULT_GROUPS.filter((g) => g.role === COST_OF_SALES)).toHaveLength(1)
  })

  it('points every seeded account at a group that exists', () => {
    const ids = new Set(DEFAULT_GROUPS.map((g) => g.id))
    Object.entries(SEED_ASSIGNMENT).forEach(([acc, grp]) => {
      expect(ids.has(grp), `${acc} -> ${grp}`).toBe(true)
    })
  })

  it('gives every group a unique id', () => {
    expect(new Set(DEFAULT_GROUPS.map((g) => g.id)).size).toBe(DEFAULT_GROUPS.length)
  })
})

describe('assigning groups to a flat chart', () => {
  it('uses the seed map for a known account', () => {
    const [a] = assignDefaultGroups([{ id: 'acc-cash', type: 'asset', subtype: 'current' }])
    expect(a.groupId).toBe('grp-cash')
  })

  it('falls back to type and subtype for an account the map does not know', () => {
    expect(defaultGroupFor({ type: 'asset', subtype: 'non_current' })).toBe('grp-nca')
    expect(defaultGroupFor({ type: 'liability', subtype: 'current' })).toBe('grp-othcl')
    expect(defaultGroupFor({ type: 'expense' })).toBe('grp-opex')
    expect(defaultGroupFor({ type: 'revenue' })).toBe('grp-rev')
    expect(defaultGroupFor({ type: 'equity' })).toBe('grp-eq')
  })

  it('leaves an account that already has a group alone', () => {
    const [a] = assignDefaultGroups([{ id: 'acc-cash', type: 'asset', groupId: 'grp-mine' }])
    expect(a.groupId).toBe('grp-mine')
  })

  it('assigns every stock account somewhere, so none start ungrouped', () => {
    const assigned = assignDefaultGroups(
      Object.keys(SEED_ASSIGNMENT).map((id) => ({ id, type: 'asset' }))
    )
    assigned.forEach((a) => expect(a.groupId, a.id).toBeTruthy())
  })

  it('survives a null list', () => {
    expect(assignDefaultGroups()).toEqual([])
    expect(defaultGroupFor(null)).toBe('')
  })
})

describe('isDescendant', () => {
  const groups = [G('a', 'asset'), G('b', 'asset', 'a'), G('c', 'asset', 'b'), G('x', 'asset')]

  it('sees a child and a grandchild', () => {
    expect(isDescendant(groups, 'b', 'a')).toBe(true)
    expect(isDescendant(groups, 'c', 'a')).toBe(true)
  })
  it('says no for a sibling, a parent, or itself', () => {
    expect(isDescendant(groups, 'x', 'a')).toBe(false)
    expect(isDescendant(groups, 'a', 'c')).toBe(false)
    expect(isDescendant(groups, 'a', 'a')).toBe(false)
  })
  it('terminates on data that already contains a cycle', () => {
    const looped = [G('p', 'asset', 'q'), G('q', 'asset', 'p')]
    expect(isDescendant(looped, 'p', 'zzz')).toBe(false)
  })
})

describe('groupPath', () => {
  const groups = [G('a', 'asset'), G('b', 'asset', 'a'), G('c', 'asset', 'b')]
  it('reads from the root down', () => {
    expect(groupPath(groups, 'c')).toBe('a › b › c')
    expect(groupPath(groups, 'a')).toBe('a')
  })
  it('returns nothing for an id it does not know', () => {
    expect(groupPath(groups, 'nope')).toBe('')
  })
  it('stops rather than looping on broken data', () => {
    expect(() => groupPath([G('p', 'asset', 'q'), G('q', 'asset', 'p')], 'p')).not.toThrow()
  })
})

describe('flattenGroups', () => {
  const groups = [
    G('a', 'asset', null, { sort: 20 }), G('b', 'asset', null, { sort: 10 }),
    G('a1', 'asset', 'a'), G('r', 'revenue'),
  ]

  it('filters to one type and orders by sort', () => {
    const rows = flattenGroups(groups, 'asset')
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'a1'])
  })
  it('marks depth so a picker can indent', () => {
    expect(flattenGroups(groups, 'asset').find((r) => r.id === 'a1').depth).toBe(1)
  })
  it('treats a group whose parent is missing as a root, rather than hiding it', () => {
    const rows = flattenGroups([G('orphan', 'asset', 'deleted-group')], 'asset')
    expect(rows.map((r) => r.id)).toEqual(['orphan'])
  })
  it('returns everything when no type is given', () => {
    expect(flattenGroups(groups)).toHaveLength(4)
  })
})

describe('buildTree', () => {
  const groups = [G('ca', 'asset'), G('cash', 'asset', 'ca'), G('rev', 'revenue')]
  const accounts = [
    A('bank', 'asset', 'cash'), A('petty', 'asset', 'cash'),
    A('prepaid', 'asset', 'ca'), A('sales', 'revenue', 'rev'),
  ]

  it('nests groups and hangs accounts off the right node', () => {
    const t = buildTree(groups, accounts, 'asset')
    expect(t.groups.map((g) => g.id)).toEqual(['ca'])
    expect(t.groups[0].accounts.map((a) => a.id)).toEqual(['prepaid'])
    expect(t.groups[0].groups[0].accounts.map((a) => a.id)).toEqual(['bank', 'petty'])
  })

  it('keeps accounts of other types out', () => {
    const t = buildTree(groups, accounts, 'asset')
    expect(JSON.stringify(t)).not.toContain('sales')
  })

  it('shows an account with no group rather than dropping it', () => {
    const t = buildTree(groups, [...accounts, A('loose', 'asset')], 'asset')
    expect(t.ungrouped.map((a) => a.id)).toEqual(['loose'])
  })

  it('shows an account whose group was deleted', () => {
    const t = buildTree(groups, [A('stray', 'asset', 'gone')], 'asset')
    expect(t.ungrouped.map((a) => a.id)).toEqual(['stray'])
  })

  it('shows an account pointing at a group of the wrong type', () => {
    // 'rev' is a revenue group; an asset account must not silently vanish.
    const t = buildTree(groups, [A('confused', 'asset', 'rev')], 'asset')
    expect(t.ungrouped.map((a) => a.id)).toEqual(['confused'])
  })

  it('places every account exactly once', () => {
    const t = buildTree(groups, accounts, 'asset')
    const seen = []
    const walk = (n) => { n.accounts.forEach((a) => seen.push(a.id)); n.groups.forEach(walk) }
    t.groups.forEach(walk)
    t.ungrouped.forEach((a) => seen.push(a.id))
    expect(seen.sort()).toEqual(['bank', 'petty', 'prepaid'])
  })

  it('does not hang on a cyclic parent chain', () => {
    const looped = [G('p', 'asset', 'q'), G('q', 'asset', 'p')]
    expect(() => buildTree(looped, [A('x', 'asset', 'p')], 'asset')).not.toThrow()
  })

  it('returns empty structures for a type with nothing in it', () => {
    const t = buildTree([], [], 'equity')
    expect(t).toEqual({ type: 'equity', groups: [], ungrouped: [] })
  })
})

describe('withTotals', () => {
  const groups = [G('ca', 'asset'), G('cash', 'asset', 'ca')]
  const accounts = [A('bank', 'asset', 'cash'), A('petty', 'asset', 'cash'), A('prepaid', 'asset', 'ca')]
  const amounts = { bank: 100, petty: 25, prepaid: 40 }
  const tree = buildTree(groups, accounts, 'asset')

  it('rolls a subgroup up into its parent', () => {
    const d = withTotals(tree, (a) => ({ balance: amounts[a.id] || 0 }))
    expect(d.groups[0].groups[0].totals.balance).toBe(125)
    expect(d.groups[0].totals.balance).toBe(165)
    expect(d.totals.balance).toBe(165)
  })

  it('sums each key independently, so a comparative needs one walk', () => {
    const d = withTotals(tree, (a) => ({ balance: amounts[a.id], prior: 1 }), ['balance', 'prior'])
    expect(d.totals).toEqual({ balance: 165, prior: 3 })
  })

  it('includes ungrouped accounts in the type total', () => {
    const t = buildTree(groups, [...accounts, A('loose', 'asset')], 'asset')
    const d = withTotals(t, (a) => ({ balance: a.id === 'loose' ? 10 : amounts[a.id] || 0 }))
    expect(d.totals.balance).toBe(175)
  })

  it('treats a missing or non-numeric value as zero', () => {
    const d = withTotals(tree, (a) => ({ balance: a.id === 'bank' ? 'oops' : undefined }))
    expect(d.totals.balance).toBe(0)
  })
})

describe('pruneEmpty', () => {
  const groups = [G('ca', 'asset'), G('empty', 'asset', 'ca')]
  const accounts = [A('bank', 'asset', 'ca'), A('dormant', 'asset', 'ca')]
  const decorated = (vals, keys) =>
    withTotals(buildTree(groups, accounts, 'asset'), (a) => vals(a), keys)

  it('drops accounts and groups that are zero everywhere', () => {
    const p = pruneEmpty(decorated((a) => ({ balance: a.id === 'bank' ? 10 : 0 })))
    expect(p.groups[0].accounts.map((a) => a.id)).toEqual(['bank'])
    expect(p.groups[0].groups).toHaveLength(0)
  })

  it('keeps a line that is zero now but moved last period', () => {
    const p = pruneEmpty(
      decorated((a) => ({ balance: 0, prior: a.id === 'dormant' ? 5 : 0 }), ['balance', 'prior']),
      ['balance', 'prior']
    )
    expect(p.groups[0].accounts.map((a) => a.id)).toEqual(['dormant'])
  })

  it('removes a whole branch when nothing in it moved', () => {
    const p = pruneEmpty(decorated(() => ({ balance: 0 })))
    expect(p.groups).toHaveLength(0)
  })
})

describe('flattenRows', () => {
  const groups = [G('ca', 'asset'), G('cash', 'asset', 'ca')]
  const accounts = [A('bank', 'asset', 'cash'), A('prepaid', 'asset', 'ca')]
  const tree = withTotals(buildTree(groups, accounts, 'asset'), () => ({ balance: 1 }))

  it('emits a header, the accounts, nested groups, then a subtotal', () => {
    const rows = flattenRows(tree)
    expect(rows.map((r) => r.kind)).toEqual(['group', 'account', 'group', 'account', 'subtotal', 'subtotal'])
  })

  it('indents by depth', () => {
    const rows = flattenRows(tree)
    expect(rows.find((r) => r.kind === 'account' && r.id === 'bank').depth).toBe(2)
  })

  it('skips the subtotal when it would just repeat a single line', () => {
    const flat = withTotals(buildTree([G('g', 'asset')], [A('one', 'asset', 'g')], 'asset'), () => ({ balance: 1 }))
    expect(flattenRows(flat).map((r) => r.kind)).toEqual(['group', 'account'])
  })

  it('gives the ungrouped bucket its own header', () => {
    const t = withTotals(buildTree(groups, [...accounts, A('loose', 'asset')], 'asset'), () => ({ balance: 1 }))
    const rows = flattenRows(t)
    expect(rows.some((r) => r.kind === 'ungrouped')).toBe(true)
    expect(rows[rows.length - 1].id).toBe('loose')
  })

  it('carries the group total on both the header and the subtotal, so either can display it', () => {
    const rows = flattenRows(tree)
    expect(rows.find((r) => r.kind === 'group').totals.balance).toBe(2)
    expect(rows.filter((r) => r.kind === 'subtotal').pop().totals.balance).toBe(2)
  })
})

describe('roles — splitting cost of sales out of expenses', () => {
  const groups = [G('cos', 'expense', null, { role: COST_OF_SALES }), G('opex', 'expense')]
  const accounts = [A('cogs', 'expense', 'cos'), A('rent', 'expense', 'opex')]
  const tree = withTotals(
    buildTree(groups, accounts, 'expense'),
    (a) => ({ balance: a.id === 'cogs' ? 600 : 150 })
  )

  it('finds the node carrying the role', () => {
    expect(findByRole(tree, COST_OF_SALES).id).toBe('cos')
    expect(findByRole(tree, 'nope')).toBeNull()
  })

  it('finds a role nested below the top level', () => {
    const nested = withTotals(
      buildTree([G('top', 'expense'), G('deep', 'expense', 'top', { role: COST_OF_SALES })], [], 'expense'),
      () => ({ balance: 0 })
    )
    expect(findByRole(nested, COST_OF_SALES).id).toBe('deep')
  })

  it('removes the node and deducts it from the total, so nothing is counted twice', () => {
    const rest = withoutNode(tree, 'cos')
    expect(rest.groups.map((g) => g.id)).toEqual(['opex'])
    expect(rest.totals.balance).toBe(150)
    expect(tree.totals.balance).toBe(750)   // original untouched
  })

  it('finds a node by id at any depth', () => {
    expect(findNode(tree, 'opex').id).toBe('opex')
    expect(findNode(tree, 'missing')).toBeNull()
  })
})

describe('validateGroup', () => {
  const groups = [G('a', 'asset'), G('b', 'asset', 'a'), G('r', 'revenue')]

  it('accepts a sound group', () => {
    expect(validateGroup({ name: 'New', type: 'asset', parentId: 'a' }, groups).ok).toBe(true)
  })

  it('needs a name and a real type', () => {
    expect(validateGroup({ name: '  ', type: 'asset' }, groups).errors).toContain('Give the group a name.')
    expect(validateGroup({ name: 'x', type: 'nonsense' }, groups).errors).toContain('Choose an account type.')
  })

  it('refuses a parent of a different type — that would cross the two statements', () => {
    const r = validateGroup({ name: 'x', type: 'asset', parentId: 'r' }, groups)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/same type/)
  })

  it('refuses a parent that no longer exists', () => {
    expect(validateGroup({ name: 'x', type: 'asset', parentId: 'ghost' }, groups).ok).toBe(false)
  })

  it('refuses a group becoming its own parent', () => {
    const r = validateGroup({ name: 'a', type: 'asset', parentId: 'a' }, groups, { id: 'a' })
    expect(r.errors).toContain('A group cannot be its own parent.')
  })

  it('refuses a move that would put a group inside its own subgroup', () => {
    const r = validateGroup({ name: 'a', type: 'asset', parentId: 'b' }, groups, { id: 'a' })
    expect(r.errors.join(' ')).toMatch(/inside one of its own/)
  })

  it('refuses a duplicate name within a type but allows it across types', () => {
    expect(validateGroup({ name: 'a', type: 'asset' }, groups).ok).toBe(false)
    expect(validateGroup({ name: 'a', type: 'revenue' }, groups).ok).toBe(true)
  })

  it('lets a group keep its own name when edited', () => {
    expect(validateGroup({ name: 'a', type: 'asset' }, groups, { id: 'a' }).ok).toBe(true)
  })
})

describe('deleting a group', () => {
  const groups = [G('parent', 'asset'), G('mid', 'asset', 'parent'), G('leaf', 'asset', 'mid')]
  const accounts = [A('x', 'asset', 'mid'), A('y', 'asset', 'leaf'), A('z', 'asset', 'parent')]

  it('lifts children and accounts to the deleted group\'s parent', () => {
    const plan = deleteGroupPlan(groups, accounts, 'mid')
    expect(plan.groupUpdates).toEqual([{ id: 'leaf', parentId: 'parent' }])
    expect(plan.accountUpdates).toEqual([{ id: 'x', groupId: 'parent' }])
    expect(plan.movedTo).toBe('parent')
  })

  it('ungroups them when a root group goes', () => {
    const plan = deleteGroupPlan(groups, accounts, 'parent')
    expect(plan.groupUpdates).toEqual([{ id: 'mid', parentId: null }])
    expect(plan.accountUpdates).toEqual([{ id: 'z', groupId: '' }])
  })

  it('plans nothing for an id that is not there', () => {
    expect(deleteGroupPlan(groups, accounts, 'ghost')).toEqual({ groupUpdates: [], accountUpdates: [], movedTo: null })
  })

  it('counts what a delete would touch, direct and nested', () => {
    expect(groupUsage(groups, accounts, 'parent')).toEqual({ direct: 1, subgroups: 1, nested: 2, total: 3 })
    expect(groupUsage(groups, accounts, 'leaf')).toEqual({ direct: 1, subgroups: 0, nested: 0, total: 1 })
  })
})
