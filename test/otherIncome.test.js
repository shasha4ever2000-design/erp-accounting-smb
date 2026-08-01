import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GROUPS, SEED_ASSIGNMENT, OTHER_INCOME, COST_OF_SALES,
  groupIdsWithRole, buildTree, withTotals, findByRole, withoutNode,
} from '../src/utils/accountTree.js'

// Gross profit is trading revenue less cost of sales. An FX movement or a
// gain on selling a van is income, but it is not trading — folding it into
// revenue inflates the margin, and an FX *loss* (a debit to an account that
// is correctly typed revenue) quietly reduces reported sales.
//
// The fix is a role on the Other Income group, not a change of account type:
// the year-end close sweeps every revenue-typed account into retained
// earnings and has to go on doing so.

describe('the shipped chart marks Other Income', () => {
  it('gives the group the role', () => {
    const oi = DEFAULT_GROUPS.find((g) => g.id === 'grp-oi')
    expect(oi.role).toBe(OTHER_INCOME)
  })

  it('has exactly one such group, so the split is unambiguous', () => {
    expect(DEFAULT_GROUPS.filter((g) => g.role === OTHER_INCOME)).toHaveLength(1)
  })

  it('keeps it a revenue group — the close still has to sweep it', () => {
    expect(DEFAULT_GROUPS.find((g) => g.id === 'grp-oi').type).toBe('revenue')
  })

  it('files both FX accounts there, not under operating revenue', () => {
    expect(SEED_ASSIGNMENT['acc-fxgl']).toBe('grp-oi')
    expect(SEED_ASSIGNMENT['acc-fxreal']).toBe('grp-oi')
  })

  it('leaves trading accounts under operating revenue', () => {
    ;['acc-sales', 'acc-svc', 'acc-shipinc'].forEach((id) => {
      expect(SEED_ASSIGNMENT[id]).toBe('grp-rev')
    })
  })

  it('does not collide with the cost-of-sales role', () => {
    expect(OTHER_INCOME).not.toBe(COST_OF_SALES)
  })
})

describe('groupIdsWithRole', () => {
  const groups = [
    { id: 'a', parentId: null, role: OTHER_INCOME },
    { id: 'a1', parentId: 'a' },
    { id: 'a1x', parentId: 'a1' },
    { id: 'b', parentId: null },
    { id: 'b1', parentId: 'b' },
  ]

  it('includes the tagged group', () => {
    expect(groupIdsWithRole(groups, OTHER_INCOME).has('a')).toBe(true)
  })

  it('includes descendants at any depth, since users nest their own', () => {
    const ids = groupIdsWithRole(groups, OTHER_INCOME)
    expect(ids.has('a1')).toBe(true)
    expect(ids.has('a1x')).toBe(true)
  })

  it('excludes unrelated branches', () => {
    const ids = groupIdsWithRole(groups, OTHER_INCOME)
    expect(ids.has('b')).toBe(false)
    expect(ids.has('b1')).toBe(false)
  })

  it('returns nothing when no group carries the role', () => {
    expect(groupIdsWithRole([{ id: 'x', parentId: null }], OTHER_INCOME).size).toBe(0)
  })

  it('tolerates no groups at all', () => {
    expect(groupIdsWithRole(undefined, OTHER_INCOME).size).toBe(0)
    expect(groupIdsWithRole([], OTHER_INCOME).size).toBe(0)
  })
})

describe('splitting other income out of the revenue tree', () => {
  // 10,000 of sales and a 400 FX loss, which is how the bug shows itself.
  const accounts = [
    { id: 'acc-sales', code: '4001', name: 'Sales', type: 'revenue', groupId: 'grp-rev' },
    { id: 'acc-fxreal', code: '4006', name: 'Realized FX', type: 'revenue', groupId: 'grp-oi' },
  ]
  const balances = {
    'acc-sales': { dr: 0, cr: 10000 },
    'acc-fxreal': { dr: 400, cr: 0 }, // a loss
  }

  // Revenue is credit-natured, so its balance is credits less debits — which
  // is what makes an FX loss show up as a negative revenue figure.
  const bal = (id) => { const b = balances[id] || { dr: 0, cr: 0 }; return b.cr - b.dr }
  const revTree = () => {
    const groups = DEFAULT_GROUPS.filter((g) => g.type === 'revenue').map((g) => ({ ...g }))
    return withTotals(buildTree(groups, accounts, 'revenue'), (a) => ({ balance: bal(a.id) }), ['balance'])
  }

  it('the whole tree still nets to 9,600 — nothing is lost', () => {
    expect(revTree().totals.balance).toBeCloseTo(9600, 2)
  })

  it('operating revenue is the full 10,000, undiminished by the FX loss', () => {
    const t = revTree()
    const oi = findByRole(t, OTHER_INCOME)
    expect(oi).toBeTruthy()
    expect(withoutNode(t, oi.id).totals.balance).toBeCloseTo(10000, 2)
  })

  it('other income carries the loss, as a negative', () => {
    const t = revTree()
    expect(findByRole(t, OTHER_INCOME).totals.balance).toBeCloseTo(-400, 2)
  })

  it('gross profit uses operating revenue, so a 6,000 cost gives 40%', () => {
    const t = revTree()
    const operating = withoutNode(t, findByRole(t, OTHER_INCOME).id).totals.balance
    const cos = 6000
    expect(operating - cos).toBeCloseTo(4000, 2)
    expect((operating - cos) / operating).toBeCloseTo(0.4, 6)
    // Before the fix this divided by 9,600 and reported 37.5% — a margin
    // moved by an exchange rate rather than by trading.
  })

  it('net profit is unchanged, because other income is added back below', () => {
    const t = revTree()
    const oi = findByRole(t, OTHER_INCOME)
    const operating = withoutNode(t, oi.id).totals.balance
    const other = oi.totals.balance
    const expenses = 6000
    expect(operating + other - expenses).toBeCloseTo(t.totals.balance - expenses, 2)
  })
})
