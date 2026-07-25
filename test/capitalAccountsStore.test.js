import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import {
  CAPITAL_CONTROL, capitalLines, buildSummary, reconcile, DEFAULT_SUBACCOUNTS,
} from '../src/utils/capitalAccounts.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

// Each test starts from a clean subledger and ledger so one test's postings
// cannot move another's balances.
beforeEach(() => useStore.setState({
  capitalAccounts: [],
  capitalSubaccounts: DEFAULT_SUBACCOUNTS.map((s) => ({ ...s })),
  journalEntries: [],
  recycleBin: [],
}))

const twoPartners = () => {
  const a = g().addCapitalAccount({ name: 'Ahmed', share: 60 })
  const b = g().addCapitalAccount({ name: 'Sara', share: 40 })
  return { a, b }
}

describe('the control account exists in the chart', () => {
  it('ships as a system equity account inside the equity group', () => {
    const ctl = g().accounts.find((a) => a.id === CAPITAL_CONTROL)
    expect(ctl).toMatchObject({ type: 'equity', isSystem: true, groupId: 'grp-eq' })
  })

  it('starts with no capital accounts, because a sole trader needs none', () => {
    expect(g().capitalAccounts).toEqual([])
  })
})

describe('managing capital accounts', () => {
  it('creates one and returns its id', () => {
    const id = g().addCapitalAccount({ name: 'Ahmed', share: 60 })
    expect(g().capitalAccounts.find((a) => a.id === id)).toMatchObject({ name: 'Ahmed', share: 60, active: true })
  })

  it('refuses a duplicate name', () => {
    g().addCapitalAccount({ name: 'Ahmed' })
    expect(() => g().addCapitalAccount({ name: 'ahmed' })).toThrow(/CAPITAL_INVALID/)
  })

  it('refuses a negative share', () => {
    expect(() => g().addCapitalAccount({ name: 'X', share: -10 })).toThrow(/CAPITAL_INVALID/)
  })

  it('treats a blank share as zero rather than NaN', () => {
    const id = g().addCapitalAccount({ name: 'Blank', share: '' })
    expect(g().capitalAccounts.find((a) => a.id === id).share).toBe(0)
  })

  it('renames without complaining about its own name', () => {
    const id = g().addCapitalAccount({ name: 'Ahmed' })
    expect(() => g().updateCapitalAccount(id, { share: 70 })).not.toThrow()
    expect(g().capitalAccounts.find((a) => a.id === id).share).toBe(70)
  })
})

describe('a capital account with history cannot be deleted', () => {
  it('refuses the delete once money has moved', () => {
    const { a } = twoPartners()
    g().recordCapitalMovement('contribution', {
      capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 5000, date: '2026-01-05',
    })
    // Deleting would leave ledger lines pointing at nothing, and the report
    // would show them as unallocated with no way to put them right.
    expect(() => g().deleteCapitalAccount(a)).toThrow(/CAPITAL_HAS_ACTIVITY/)
  })

  it('allows deleting one that never traded, and bins it', () => {
    const id = g().addCapitalAccount({ name: 'Never Used' })
    g().deleteCapitalAccount(id)
    expect(g().capitalAccounts.find((a) => a.id === id)).toBeUndefined()
    expect(g().recycleBin.some((e) => e.recordId === id)).toBe(true)
  })

  it('offers deactivation as the way to retire an active partner', () => {
    const { a } = twoPartners()
    g().recordCapitalMovement('contribution', {
      capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 100, date: '2026-01-05',
    })
    g().updateCapitalAccount(a, { active: false })
    expect(g().capitalAccounts.find((x) => x.id === a).active).toBe(false)
  })
})

describe('recording contributions and drawings', () => {
  it('posts a balanced contribution against the bank', () => {
    const { a } = twoPartners()
    const je = g().recordCapitalMovement('contribution', {
      capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 5000, date: '2026-01-05',
    })
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(dr).toBe(cr)
    expect(je.lines.find((l) => l.accountId === 'acc-bank1').debit).toBe(5000)
    expect(je.lines.find((l) => l.accountId === CAPITAL_CONTROL))
      .toMatchObject({ capitalAccountId: a, subaccountId: 'cap-sub-funds', credit: 5000 })
  })

  it('posts a drawing the other way round', () => {
    const { a } = twoPartners()
    const je = g().recordCapitalMovement('drawing', {
      capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 800, date: '2026-02-01',
    })
    expect(je.lines.find((l) => l.accountId === CAPITAL_CONTROL))
      .toMatchObject({ subaccountId: 'cap-sub-draw', debit: 800 })
  })

  it('refuses a movement for a partner that does not exist', () => {
    expect(() => g().recordCapitalMovement('contribution', {
      capitalAccountId: 'ghost', assetAccountId: 'acc-bank1', amount: 10, date: '2026-01-01',
    })).toThrow(/CAPITAL_NOT_FOUND/)
  })
})

describe('the ledger refuses an unattributed capital line', () => {
  it('throws rather than letting the subledger drift from the balance sheet', () => {
    expect(() => g().addJournalEntry({
      date: '2026-03-01',
      lines: [
        { accountId: 'acc-bank1', debit: 1000, credit: 0 },
        { accountId: CAPITAL_CONTROL, debit: 0, credit: 1000 },   // no partner named
      ],
    })).toThrow(/CAPITAL_LINE_UNATTRIBUTED/)
  })

  it('accepts the same entry once a partner is named', () => {
    const { a } = twoPartners()
    expect(() => g().addJournalEntry({
      date: '2026-03-01',
      lines: [
        { accountId: 'acc-bank1', debit: 1000, credit: 0 },
        { accountId: CAPITAL_CONTROL, capitalAccountId: a, subaccountId: 'cap-sub-funds', debit: 0, credit: 1000 },
      ],
    })).not.toThrow()
  })

  it('leaves entries that never touch the control account alone', () => {
    expect(() => g().addJournalEntry({
      date: '2026-03-01',
      lines: [
        { accountId: 'acc-bank1', debit: 50, credit: 0 },
        { accountId: 'acc-sales', debit: 0, credit: 50 },
      ],
    })).not.toThrow()
  })
})

describe('allocating profit to partners', () => {
  it('splits by share and balances against retained earnings', () => {
    const { a, b } = twoPartners()
    const je = g().allocateProfitToPartners({ date: '2026-12-31', amount: 10000 })

    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(dr).toBe(cr)
    expect(je.lines.find((l) => l.accountId === 'acc-retained').debit).toBe(10000)

    const lines = capitalLines(g().journalEntries)
    const summary = buildSummary(g().capitalAccounts, g().capitalSubaccounts, lines)
    expect(summary.rows.find((r) => r.id === a).cells['cap-sub-profit']).toBe(6000)
    expect(summary.rows.find((r) => r.id === b).cells['cap-sub-profit']).toBe(4000)
  })

  it('leaves total equity unchanged — profit only changes owner', () => {
    twoPartners()
    const equityBefore = () => {
      const bals = g().getAllBalances()
      return g().accounts.filter((x) => x.type === 'equity').reduce((s, x) => {
        const bl = bals[x.id] || { dr: 0, cr: 0 }
        return s + (bl.cr - bl.dr)
      }, 0)
    }
    const before = equityBefore()
    g().allocateProfitToPartners({ date: '2026-12-31', amount: 10000 })
    expect(equityBefore()).toBeCloseTo(before, 2)
  })

  it('refuses when there are no partners to allocate to', () => {
    expect(() => g().allocateProfitToPartners({ date: '2026-12-31', amount: 100 }))
      .toThrow(/CAPITAL_NO_ACCOUNTS/)
  })

  it('refuses a zero allocation rather than posting an empty entry', () => {
    twoPartners()
    expect(() => g().allocateProfitToPartners({ date: '2026-12-31', amount: 0 }))
      .toThrow(/CAPITAL_NOTHING_TO_ALLOCATE/)
  })

  it('skips a deactivated partner', () => {
    const { a, b } = twoPartners()
    g().updateCapitalAccount(b, { active: false })
    g().allocateProfitToPartners({ date: '2026-12-31', amount: 1000 })
    const summary = buildSummary(g().capitalAccounts, g().capitalSubaccounts, capitalLines(g().journalEntries))
    expect(summary.rows.find((r) => r.id === a).total).toBe(1000)
    expect(summary.rows.find((r) => r.id === b).total).toBe(0)
  })
})

describe('the subledger always equals the control account', () => {
  it('reconciles after a mix of contributions, drawings and profit', () => {
    const { a, b } = twoPartners()
    g().recordCapitalMovement('contribution', { capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 5000, date: '2026-01-05' })
    g().recordCapitalMovement('contribution', { capitalAccountId: b, assetAccountId: 'acc-bank1', amount: 3000, date: '2026-01-06' })
    g().recordCapitalMovement('drawing',      { capitalAccountId: a, assetAccountId: 'acc-bank1', amount: 1200, date: '2026-06-01' })
    g().allocateProfitToPartners({ date: '2026-12-31', amount: 10000 })

    const bal = g().getAllBalances()[CAPITAL_CONTROL] || { dr: 0, cr: 0 }
    const control = bal.cr - bal.dr
    const summary = buildSummary(g().capitalAccounts, g().capitalSubaccounts, capitalLines(g().journalEntries))

    expect(reconcile(summary, control).ok).toBe(true)
    expect(summary.grandTotal).toBe(16800)   // 8000 in − 1200 out + 10000 profit
  })

  it('reconciles when a share split leaves a rounding remainder', () => {
    g().addCapitalAccount({ name: 'A', share: 1 })
    g().addCapitalAccount({ name: 'B', share: 1 })
    g().addCapitalAccount({ name: 'C', share: 1 })
    g().allocateProfitToPartners({ date: '2026-12-31', amount: 100 })

    const bal = g().getAllBalances()[CAPITAL_CONTROL] || { dr: 0, cr: 0 }
    const summary = buildSummary(g().capitalAccounts, g().capitalSubaccounts, capitalLines(g().journalEntries))
    expect(reconcile(summary, bal.cr - bal.dr).ok).toBe(true)
    expect(summary.grandTotal).toBe(100)
  })
})

describe('subaccounts', () => {
  it('ships with the three that matter', () => {
    expect(g().capitalSubaccounts.map((s) => s.name))
      .toEqual(['Funds contributed', 'Drawings', 'Share of profit'])
  })

  it('accepts a custom one', () => {
    const id = g().addCapitalSubaccount('Interest on capital')
    expect(g().capitalSubaccounts.find((s) => s.id === id)).toMatchObject({ name: 'Interest on capital', isSystem: false })
  })

  it('refuses a duplicate or a blank name', () => {
    expect(() => g().addCapitalSubaccount('Drawings')).toThrow(/DUPLICATE/)
    expect(() => g().addCapitalSubaccount('  ')).toThrow(/NAME_REQUIRED/)
  })

  it('protects the three built-in ones from deletion', () => {
    expect(() => g().deleteCapitalSubaccount('cap-sub-draw')).toThrow(/IS_SYSTEM/)
  })

  it('refuses to delete a custom one that has been used', () => {
    const { a } = twoPartners()
    const sub = g().addCapitalSubaccount('Interest on capital')
    g().addJournalEntry({
      date: '2026-04-01',
      lines: [
        { accountId: 'acc-interest', debit: 100, credit: 0 },
        { accountId: CAPITAL_CONTROL, capitalAccountId: a, subaccountId: sub, debit: 0, credit: 100 },
      ],
    })
    expect(() => g().deleteCapitalSubaccount(sub)).toThrow(/HAS_ACTIVITY/)
  })
})
