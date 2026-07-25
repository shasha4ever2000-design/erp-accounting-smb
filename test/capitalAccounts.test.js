import { describe, it, expect } from 'vitest'
import {
  CAPITAL_CONTROL, DEFAULT_SUBACCOUNTS,
  capitalLines, balanceFor, buildSummary, reconcile,
  allocateProfit, profitAllocationLines, movementLines,
  validateCapitalAccount, shareTotal,
} from '../src/utils/capitalAccounts.js'

const SUBS = DEFAULT_SUBACCOUNTS
const partners = [
  { id: 'p1', name: 'Ahmed', share: 60 },
  { id: 'p2', name: 'Sara', share: 40 },
]

const je = (date, lines, extra = {}) => ({ id: `je-${date}-${Math.random()}`, date, lines, ...extra })
const capLine = (capitalAccountId, subaccountId, { debit = 0, credit = 0 } = {}) =>
  ({ accountId: CAPITAL_CONTROL, capitalAccountId, subaccountId, debit, credit })

describe('capitalLines', () => {
  it('picks out only the lines that touch the control account', () => {
    const entries = [je('2026-01-05', [
      { accountId: 'acc-bank1', debit: 1000, credit: 0 },
      capLine('p1', 'cap-sub-funds', { credit: 1000 }),
    ])]
    const lines = capitalLines(entries)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ capitalAccountId: 'p1', subaccountId: 'cap-sub-funds', amount: 1000 })
  })

  it('treats equity as credit-positive, so a drawing is negative', () => {
    const entries = [je('2026-02-01', [capLine('p1', 'cap-sub-draw', { debit: 250 })])]
    expect(capitalLines(entries)[0].amount).toBe(-250)
  })

  it('skips voided entries', () => {
    const entries = [je('2026-01-05', [capLine('p1', 'cap-sub-funds', { credit: 500 })], { void: true })]
    expect(capitalLines(entries)).toHaveLength(0)
  })

  it('filters by date range', () => {
    const entries = [
      je('2025-12-31', [capLine('p1', 'cap-sub-funds', { credit: 100 })]),
      je('2026-06-01', [capLine('p1', 'cap-sub-funds', { credit: 200 })]),
    ]
    expect(capitalLines(entries, { start: '2026-01-01' })).toHaveLength(1)
    expect(capitalLines(entries, { end: '2025-12-31' })).toHaveLength(1)
  })

  it('returns lines oldest first', () => {
    const entries = [
      je('2026-06-01', [capLine('p1', 'cap-sub-funds', { credit: 2 })]),
      je('2026-01-01', [capLine('p1', 'cap-sub-funds', { credit: 1 })]),
    ]
    expect(capitalLines(entries).map((l) => l.date)).toEqual(['2026-01-01', '2026-06-01'])
  })

  it('survives malformed entries rather than throwing', () => {
    expect(() => capitalLines([null, {}, { lines: null }])).not.toThrow()
    expect(capitalLines()).toEqual([])
  })
})

describe('balanceFor', () => {
  const lines = capitalLines([
    je('2026-01-01', [capLine('p1', 'cap-sub-funds', { credit: 5000 })]),
    je('2026-02-01', [capLine('p1', 'cap-sub-draw', { debit: 1200 })]),
    je('2026-03-01', [capLine('p2', 'cap-sub-funds', { credit: 3000 })]),
  ])

  it('nets contributions against drawings', () => {
    expect(balanceFor(lines, 'p1')).toBe(3800)
  })
  it('narrows to one subaccount', () => {
    expect(balanceFor(lines, 'p1', 'cap-sub-draw')).toBe(-1200)
  })
  it('is zero for a partner with no movements', () => {
    expect(balanceFor(lines, 'nobody')).toBe(0)
  })
})

describe('buildSummary', () => {
  const lines = capitalLines([
    je('2026-01-01', [capLine('p1', 'cap-sub-funds', { credit: 5000 })]),
    je('2026-02-01', [capLine('p1', 'cap-sub-draw', { debit: 1200 })]),
    je('2026-03-01', [capLine('p2', 'cap-sub-funds', { credit: 3000 })]),
    je('2026-12-31', [capLine('p1', 'cap-sub-profit', { credit: 600 })]),
    je('2026-12-31', [capLine('p2', 'cap-sub-profit', { credit: 400 })]),
  ])
  const s = buildSummary(partners, SUBS, lines)

  it('gives a row per partner with a cell per subaccount', () => {
    expect(s.rows.map((r) => r.name)).toEqual(['Ahmed', 'Sara'])
    expect(s.rows[0].cells).toEqual({
      'cap-sub-funds': 5000, 'cap-sub-draw': -1200, 'cap-sub-profit': 600,
    })
  })

  it('totals each row', () => {
    expect(s.rows[0].total).toBe(4400)
    expect(s.rows[1].total).toBe(3400)
  })

  it('totals each column and the whole report', () => {
    expect(s.columnTotals['cap-sub-funds']).toBe(8000)
    expect(s.columnTotals['cap-sub-draw']).toBe(-1200)
    expect(s.grandTotal).toBe(7800)
  })

  it('orders columns by sort, not by insertion', () => {
    const shuffled = [SUBS[2], SUBS[0], SUBS[1]]
    expect(buildSummary(partners, shuffled, lines).subaccounts.map((x) => x.id))
      .toEqual(['cap-sub-funds', 'cap-sub-draw', 'cap-sub-profit'])
  })

  it('has no unallocated row when every line names a partner', () => {
    expect(s.unallocated).toBeNull()
  })

  it('surfaces lines that name no partner rather than dropping them', () => {
    // Dropping these would make the report disagree with the balance sheet
    // with nothing on screen to explain the gap.
    const stray = capitalLines([je('2026-04-01', [capLine('', 'cap-sub-funds', { credit: 900 })])])
    const withStray = buildSummary(partners, SUBS, [...lines, ...stray])
    expect(withStray.unallocated.total).toBe(900)
    expect(withStray.grandTotal).toBe(8700)
  })

  it('surfaces a line naming a partner who no longer exists', () => {
    const stray = capitalLines([je('2026-04-01', [capLine('deleted-partner', 'cap-sub-draw', { debit: 50 })])])
    const withStray = buildSummary(partners, SUBS, [...lines, ...stray])
    expect(withStray.unallocated.total).toBe(-50)
  })

  it('keeps a line with a partner but no subaccount against that partner', () => {
    const odd = capitalLines([je('2026-05-01', [capLine('p1', '', { credit: 70 })])])
    const r = buildSummary(partners, SUBS, [...lines, ...odd])
    expect(r.rows[0].uncategorised).toBe(70)
    expect(r.rows[0].total).toBe(4470)
    expect(r.unallocated).toBeNull()
  })

  it('handles a company with no capital accounts yet', () => {
    const empty = buildSummary([], SUBS, [])
    expect(empty.rows).toEqual([])
    expect(empty.grandTotal).toBe(0)
  })
})

describe('reconcile — the subledger must equal the control account', () => {
  const lines = capitalLines([
    je('2026-01-01', [capLine('p1', 'cap-sub-funds', { credit: 5000 })]),
    je('2026-02-01', [capLine('p2', 'cap-sub-funds', { credit: 3000 })]),
  ])
  const s = buildSummary(partners, SUBS, lines)

  it('agrees when every line is attributed', () => {
    const r = reconcile(s, 8000)
    expect(r.ok).toBe(true)
    expect(r.difference).toBe(0)
  })

  it('reports the gap when the control account carries more', () => {
    const r = reconcile(s, 8500)
    expect(r.ok).toBe(false)
    expect(r.difference).toBe(500)
  })

  it('tolerates sub-cent floating point noise', () => {
    expect(reconcile(s, 8000.001).ok).toBe(true)
  })
})

describe('allocateProfit', () => {
  it('splits by share', () => {
    expect(allocateProfit(1000, partners)).toEqual([
      { capitalAccountId: 'p1', name: 'Ahmed', amount: 600 },
      { capitalAccountId: 'p2', name: 'Sara', amount: 400 },
    ])
  })

  it('sums to the profit exactly, with the remainder on the largest share', () => {
    const out = allocateProfit(100, [
      { id: 'a', name: 'A', share: 1 }, { id: 'b', name: 'B', share: 1 }, { id: 'c', name: 'C', share: 1 },
    ])
    expect(out.reduce((s, o) => s + o.amount, 0)).toBe(100)
  })

  it('splits equally when nobody has set a share', () => {
    const out = allocateProfit(500, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    expect(out.map((o) => o.amount)).toEqual([250, 250])
  })

  it('allocates a loss too', () => {
    const out = allocateProfit(-1000, partners)
    expect(out.map((o) => o.amount)).toEqual([-600, -400])
  })

  it('skips inactive partners', () => {
    const out = allocateProfit(1000, [...partners, { id: 'p3', name: 'Gone', share: 50, active: false }])
    expect(out).toHaveLength(2)
    expect(out.reduce((s, o) => s + o.amount, 0)).toBe(1000)
  })

  it('returns zeroes rather than dividing by nothing', () => {
    expect(allocateProfit(0, partners).every((o) => o.amount === 0)).toBe(true)
    expect(allocateProfit(1000, [])).toEqual([])
  })

  it('ignores a negative share rather than inverting the split', () => {
    const out = allocateProfit(300, [{ id: 'a', name: 'A', share: -5 }, { id: 'b', name: 'B', share: 1 }])
    expect(out[0].amount).toBe(0)
    expect(out[1].amount).toBe(300)
  })
})

describe('profitAllocationLines', () => {
  const lines = profitAllocationLines(allocateProfit(1000, partners))

  it('balances', () => {
    const dr = lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(dr).toBe(cr)
    expect(dr).toBe(1000)
  })

  it('debits retained earnings and credits each partner', () => {
    expect(lines[0]).toMatchObject({ accountId: 'acc-retained', debit: 1000 })
    expect(lines.slice(1).every((l) => l.accountId === CAPITAL_CONTROL)).toBe(true)
    expect(lines.slice(1).map((l) => l.credit)).toEqual([600, 400])
  })

  it('tags every partner line with a subaccount, so nothing lands unallocated', () => {
    lines.slice(1).forEach((l) => {
      expect(l.capitalAccountId).toBeTruthy()
      expect(l.subaccountId).toBe('cap-sub-profit')
    })
  })

  it('flips the entry for a loss', () => {
    const loss = profitAllocationLines(allocateProfit(-500, partners))
    expect(loss[0]).toMatchObject({ accountId: 'acc-retained', credit: 500, debit: 0 })
    expect(loss.slice(1).every((l) => l.debit > 0)).toBe(true)
  })

  it('produces nothing when there is nothing to allocate', () => {
    expect(profitAllocationLines([])).toEqual([])
    expect(profitAllocationLines([{ capitalAccountId: 'p1', amount: 0 }])).toEqual([])
  })
})

describe('movementLines', () => {
  it('builds a balanced contribution', () => {
    const lines = movementLines('contribution', {
      capitalAccountId: 'p1', assetAccountId: 'acc-bank1', amount: 5000, name: 'Ahmed',
    })
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(5000)
    expect(lines.reduce((s, l) => s + l.credit, 0)).toBe(5000)
    expect(lines.find((l) => l.accountId === CAPITAL_CONTROL)).toMatchObject({
      capitalAccountId: 'p1', subaccountId: 'cap-sub-funds', credit: 5000,
    })
  })

  it('builds a balanced drawing on the other side', () => {
    const lines = movementLines('drawing', {
      capitalAccountId: 'p1', assetAccountId: 'acc-bank1', amount: 800, name: 'Ahmed',
    })
    expect(lines.find((l) => l.accountId === CAPITAL_CONTROL)).toMatchObject({
      subaccountId: 'cap-sub-draw', debit: 800,
    })
    expect(lines.find((l) => l.accountId === 'acc-bank1')).toMatchObject({ credit: 800 })
  })

  it('refuses an amount that is zero or negative', () => {
    const args = { capitalAccountId: 'p1', assetAccountId: 'acc-bank1' }
    expect(() => movementLines('contribution', { ...args, amount: 0 })).toThrow(/AMOUNT_INVALID/)
    expect(() => movementLines('contribution', { ...args, amount: -5 })).toThrow(/AMOUNT_INVALID/)
  })

  it('refuses a movement that names no partner or no bank account', () => {
    expect(() => movementLines('contribution', { assetAccountId: 'acc-bank1', amount: 10 }))
      .toThrow(/ACCOUNT_REQUIRED/)
    expect(() => movementLines('contribution', { capitalAccountId: 'p1', amount: 10 }))
      .toThrow(/ASSET_REQUIRED/)
  })
})

describe('validateCapitalAccount', () => {
  const existing = [{ id: 'p1', name: 'Ahmed' }]

  it('accepts a sound account', () => {
    expect(validateCapitalAccount({ name: 'Sara', share: 40 }, existing).ok).toBe(true)
  })
  it('needs a name', () => {
    expect(validateCapitalAccount({ name: '  ' }, existing).ok).toBe(false)
  })
  it('refuses a duplicate name but lets one keep its own', () => {
    expect(validateCapitalAccount({ name: 'Ahmed' }, existing).ok).toBe(false)
    expect(validateCapitalAccount({ name: 'Ahmed' }, existing, { id: 'p1' }).ok).toBe(true)
  })
  it('refuses a negative share', () => {
    expect(validateCapitalAccount({ name: 'X', share: -1 }, existing).errors)
      .toContain('A profit share cannot be negative.')
  })
  it('allows an empty share, since the split can be equal', () => {
    expect(validateCapitalAccount({ name: 'X', share: '' }, existing).ok).toBe(true)
  })
})

describe('shareTotal', () => {
  it('adds up the shares so the UI can flag a typo', () => {
    expect(shareTotal(partners)).toBe(100)
    expect(shareTotal([{ share: 60 }, { share: 30 }])).toBe(90)
  })
  it('ignores inactive partners', () => {
    expect(shareTotal([...partners, { share: 25, active: false }])).toBe(100)
  })
})
