import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { DEFAULT_GROUPS, buildTree, withTotals } from '../src/utils/accountTree.js'

const g = () => useStore.getState()
const groupNamed = (name) => g().accountGroups.find((x) => x.name === name)

// Each test starts from the shipped tree so one test's restructure cannot
// change what the next one sees.
beforeEach(() => useStore.setState({ accountGroups: DEFAULT_GROUPS.map((x) => ({ ...x })) }))

describe('the chart ships as a tree', () => {
  it('starts with the default groups', () => {
    expect(g().accountGroups.length).toBe(DEFAULT_GROUPS.length)
  })

  it('gives every stock account a group', () => {
    g().accounts.forEach((a) => expect(a.groupId, `${a.code} ${a.name}`).toBeTruthy())
  })

  it('never puts an account in a group of another type', () => {
    const by = Object.fromEntries(g().accountGroups.map((x) => [x.id, x]))
    g().accounts.forEach((a) => {
      const grp = by[a.groupId]
      if (grp) expect(grp.type, `${a.name} in ${grp.name}`).toBe(a.type)
    })
  })

  it('leaves no account stranded outside the tree', () => {
    const { accounts, accountGroups } = g()
    const types = ['asset', 'liability', 'equity', 'revenue', 'expense']
    types.forEach((t) => expect(buildTree(accountGroups, accounts, t).ungrouped, t).toEqual([]))
  })
})

describe('addAccountGroup', () => {
  it('creates a group and returns its id', () => {
    const id = g().addAccountGroup({ name: 'Digital Assets', type: 'asset', parentId: 'grp-nca' })
    expect(groupNamed('Digital Assets').id).toBe(id)
    expect(groupNamed('Digital Assets').parentId).toBe('grp-nca')
  })

  it('refuses a parent of a different type', () => {
    expect(() => g().addAccountGroup({ name: 'Wrong', type: 'revenue', parentId: 'grp-ca' }))
      .toThrow(/GROUP_INVALID/)
  })

  it('refuses a duplicate name within the same type', () => {
    expect(() => g().addAccountGroup({ name: 'Current Assets', type: 'asset' })).toThrow(/GROUP_INVALID/)
  })

  it('refuses a group with no name', () => {
    expect(() => g().addAccountGroup({ name: '   ', type: 'asset' })).toThrow(/GROUP_INVALID/)
  })

  it('writes the creation to the activity log', () => {
    g().addAccountGroup({ name: 'Logged Group', type: 'expense' })
    expect(g().auditLog[g().auditLog.length - 1].action).toMatch(/Created account group/)
  })
})

describe('updateAccountGroup', () => {
  it('renames a group', () => {
    g().updateAccountGroup('grp-ca', { name: 'Short-Term Assets' })
    expect(groupNamed('Short-Term Assets')).toBeTruthy()
  })

  it('validates the merged result, not the patch — a bare rename is not a half-built group', () => {
    expect(() => g().updateAccountGroup('grp-ca', { name: 'Renamed Fine' })).not.toThrow()
  })

  it('refuses a move that would put a group inside its own subgroup', () => {
    // grp-cash sits under grp-ca; moving grp-ca under grp-cash would loop.
    expect(() => g().updateAccountGroup('grp-ca', { parentId: 'grp-cash' })).toThrow(/GROUP_INVALID/)
  })

  it('refuses a group becoming its own parent', () => {
    expect(() => g().updateAccountGroup('grp-ca', { parentId: 'grp-ca' })).toThrow(/GROUP_INVALID/)
  })

  it('refuses an unknown group', () => {
    expect(() => g().updateAccountGroup('nope', { name: 'x' })).toThrow(/GROUP_NOT_FOUND/)
  })

  it('allows a legitimate re-parent', () => {
    g().updateAccountGroup('grp-stock', { parentId: null })
    expect(groupNamed('Inventory').parentId).toBeNull()
  })
})

describe('deleteAccountGroup', () => {
  it('lifts accounts and subgroups to the parent rather than orphaning them', () => {
    const before = g().accounts.filter((a) => a.groupId === 'grp-cash').map((a) => a.id)
    expect(before.length).toBeGreaterThan(0)

    const res = g().deleteAccountGroup('grp-cash')

    expect(g().accountGroups.find((x) => x.id === 'grp-cash')).toBeUndefined()
    before.forEach((id) => expect(g().accounts.find((a) => a.id === id).groupId).toBe('grp-ca'))
    expect(res.movedAccounts).toBe(before.length)
  })

  it('ungroups accounts when a root group goes, so they still show under their type', () => {
    g().deleteAccountGroup('grp-eq')
    const equity = g().accounts.filter((a) => a.type === 'equity')
    equity.forEach((a) => expect(a.groupId).toBe(''))

    const tree = buildTree(g().accountGroups, g().accounts, 'equity')
    expect(tree.ungrouped.length).toBe(equity.length)
  })

  it('never loses an account from the type total, whatever the tree looks like', () => {
    const total = (type) => {
      const t = withTotals(buildTree(g().accountGroups, g().accounts, type), () => ({ balance: 1 }))
      return t.totals.balance
    }
    const before = total('asset')
    g().deleteAccountGroup('grp-cash')
    g().deleteAccountGroup('grp-ca')
    expect(total('asset')).toBe(before)
  })

  it('does nothing for an id that is not there', () => {
    const before = g().accountGroups.length
    expect(g().deleteAccountGroup('ghost')).toBeUndefined()
    expect(g().accountGroups.length).toBe(before)
  })
})

describe('moveAccountToGroup', () => {
  const cash = () => g().accounts.find((a) => a.id === 'acc-cash')

  it('moves an account into another group of the same type', () => {
    g().moveAccountToGroup('acc-cash', 'grp-othca')
    expect(cash().groupId).toBe('grp-othca')
  })

  it('refuses a group of a different type', () => {
    expect(() => g().moveAccountToGroup('acc-cash', 'grp-rev')).toThrow(/GROUP_TYPE_MISMATCH/)
  })

  it('allows clearing the group', () => {
    g().moveAccountToGroup('acc-cash', '')
    expect(cash().groupId).toBe('')
    g().moveAccountToGroup('acc-cash', 'grp-cash')
  })

  it('refuses an unknown account or group', () => {
    expect(() => g().moveAccountToGroup('nope', 'grp-ca')).toThrow(/ACCOUNT_NOT_FOUND/)
    expect(() => g().moveAccountToGroup('acc-cash', 'ghost')).toThrow(/GROUP_NOT_FOUND/)
  })
})

describe('new accounts land somewhere sensible', () => {
  it('gives a new account a group without being told', () => {
    g().addAccount({ code: '9901', name: 'Test Expense', type: 'expense', subtype: 'expense' })
    const created = g().accounts.find((a) => a.name === 'Test Expense')
    expect(created.groupId).toBe('grp-opex')
  })

  it('honours an explicit group', () => {
    g().addAccount({ code: '9902', name: 'Test COGS', type: 'expense', subtype: 'expense', groupId: 'grp-cos' })
    expect(g().accounts.find((a) => a.name === 'Test COGS').groupId).toBe('grp-cos')
  })
})

describe('restoreDefaultGroups', () => {
  it('puts a restructured chart back to the shipped layout', () => {
    g().deleteAccountGroup('grp-cash')
    g().deleteAccountGroup('grp-stock')

    g().restoreDefaultGroups()

    expect(g().accountGroups.find((x) => x.id === 'grp-cash')).toBeTruthy()
    expect(g().accounts.find((a) => a.id === 'acc-cash').groupId).toBe('grp-cash')
  })

  it('keeps groups the user added', () => {
    const id = g().addAccountGroup({ name: 'Mine', type: 'asset' })
    g().restoreDefaultGroups()
    expect(g().accountGroups.find((x) => x.id === id)).toBeTruthy()
  })
})
