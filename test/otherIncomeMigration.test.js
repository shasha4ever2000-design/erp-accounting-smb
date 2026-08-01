import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'
import { OTHER_INCOME, DEFAULT_GROUPS } from '../src/utils/accountTree.js'

const migrate = useStore.persist.getOptions().migrate

// Version 32 adds a role to an existing company's Other Income group so the
// income statement can split it out of gross profit. Nothing else moves —
// this is the migration where "changes nothing else" is the whole point,
// because anything that shifted an account's type would change the trial
// balance and the year-end close.

const oldGroups = () =>
  DEFAULT_GROUPS.map(({ role, ...g }) => ({ ...g })) // as persisted before v32: no roles

describe('v32 tags Other Income', () => {
  it('adds the role to a group that lacks it', () => {
    const out = migrate({ accountGroups: oldGroups() }, 31)
    expect(out.accountGroups.find((g) => g.id === 'grp-oi').role).toBe(OTHER_INCOME)
  })

  it('leaves every other group alone', () => {
    const before = oldGroups()
    const out = migrate({ accountGroups: before }, 31)
    out.accountGroups.filter((g) => g.id !== 'grp-oi').forEach((g) => {
      expect(g.role || '').toBe('')
    })
  })

  it('does not touch a role the user already set', () => {
    const groups = oldGroups().map((g) => (g.id === 'grp-oi' ? { ...g, role: 'mine' } : g))
    const out = migrate({ accountGroups: groups }, 31)
    expect(out.accountGroups.find((g) => g.id === 'grp-oi').role).toBe('mine')
  })

  it('is a no-op for a company that deleted or renamed the group', () => {
    const groups = oldGroups().filter((g) => g.id !== 'grp-oi')
    const out = migrate({ accountGroups: groups }, 31)
    expect(out.accountGroups.some((g) => g.role === OTHER_INCOME)).toBe(false)
    expect(out.accountGroups).toHaveLength(groups.length)
  })

  it('survives a persisted state with no groups at all', () => {
    expect(() => migrate({}, 31)).not.toThrow()
    expect(() => migrate({ accountGroups: null }, 31)).not.toThrow()
  })

  it('changes no account, so the trial balance cannot move', () => {
    const accounts = [
      { id: 'acc-sales', type: 'revenue', groupId: 'grp-rev' },
      { id: 'acc-fxreal', type: 'revenue', groupId: 'grp-oi' },
      { id: 'acc-cogs', type: 'expense', groupId: 'grp-cos' },
    ]
    const out = migrate({ accountGroups: oldGroups(), accounts: accounts.map((a) => ({ ...a })) }, 31)
    expect(out.accounts).toEqual(accounts)
    // In particular the FX account is still revenue-typed, so the year-end
    // close goes on sweeping it into retained earnings.
    expect(out.accounts.find((a) => a.id === 'acc-fxreal').type).toBe('revenue')
  })

  it('does not re-run for a company already on 32', () => {
    const groups = oldGroups()
    const out = migrate({ accountGroups: groups }, 32)
    expect(out.accountGroups.find((g) => g.id === 'grp-oi').role).toBeUndefined()
  })
})
