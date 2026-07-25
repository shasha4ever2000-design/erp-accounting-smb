import { describe, it, expect } from 'vitest'
import {
  CONTROL_KINDS, KIND_LIST, fieldFor, defaultFor, isControlAccount, controlAccountsFor,
  resolveControl, isStale, validateControlAccount, usageOf, breakdown, reclassLines,
} from '../src/utils/controlAccounts.js'

const AR = { id: 'acc-ar', code: '1100', name: 'Accounts Receivable', type: 'asset' }
const AR_EXPORT = { id: 'acc-ar-exp', code: '1110', name: 'Receivables — Export', type: 'asset', controlFor: 'customers' }
const AP = { id: 'acc-ap', code: '2001', name: 'Accounts Payable', type: 'liability' }
const AP_INTER = { id: 'acc-ap-ic', code: '2010', name: 'Payables — Intercompany', type: 'liability', controlFor: 'suppliers' }
const BANK = { id: 'acc-bank1', code: '1002', name: 'Bank', type: 'asset' }
const ACCOUNTS = [AR, AR_EXPORT, AP, AP_INTER, BANK]

describe('the kinds themselves', () => {
  it('covers customers, suppliers and inventory', () => {
    expect(KIND_LIST).toEqual(['customers', 'suppliers', 'inventoryItems'])
  })

  it('puts receivables and inventory on the asset side, payables on the liability side', () => {
    expect(CONTROL_KINDS.customers.accountType).toBe('asset')
    expect(CONTROL_KINDS.inventoryItems.accountType).toBe('asset')
    expect(CONTROL_KINDS.suppliers.accountType).toBe('liability')
  })

  it('keeps the field inventory items already used', () => {
    // Items carried inventoryAccountId long before control accounts existed;
    // renaming it would orphan every existing item's setting.
    expect(fieldFor('inventoryItems')).toBe('inventoryAccountId')
    expect(fieldFor('customers')).toBe('controlAccountId')
  })
})

describe('isControlAccount', () => {
  it('always accepts the built-in default', () => {
    expect(isControlAccount(AR, 'customers')).toBe(true)
    expect(isControlAccount(AP, 'suppliers')).toBe(true)
  })
  it('accepts an account nominated for that kind', () => {
    expect(isControlAccount(AR_EXPORT, 'customers')).toBe(true)
  })
  it('refuses one nominated for a different kind', () => {
    expect(isControlAccount(AP_INTER, 'customers')).toBe(false)
  })
  it('refuses an ordinary account and a missing one', () => {
    expect(isControlAccount(BANK, 'customers')).toBe(false)
    expect(isControlAccount(null, 'customers')).toBe(false)
  })
})

describe('controlAccountsFor', () => {
  it('lists the default first, then the rest by code', () => {
    expect(controlAccountsFor(ACCOUNTS, 'customers').map((a) => a.id)).toEqual(['acc-ar', 'acc-ar-exp'])
  })
  it('never mixes kinds', () => {
    expect(controlAccountsFor(ACCOUNTS, 'suppliers').map((a) => a.id)).toEqual(['acc-ap', 'acc-ap-ic'])
  })
  it('returns the default alone when nothing has been nominated', () => {
    expect(controlAccountsFor([AR, BANK], 'customers').map((a) => a.id)).toEqual(['acc-ar'])
  })
})

describe('resolveControl — the rule that keeps postings safe', () => {
  it('uses the default when nothing is set', () => {
    expect(resolveControl({}, 'customers', ACCOUNTS)).toBe('acc-ar')
    expect(resolveControl(null, 'customers', ACCOUNTS)).toBe('acc-ar')
  })

  it('uses a properly nominated account', () => {
    expect(resolveControl({ controlAccountId: 'acc-ar-exp' }, 'customers', ACCOUNTS)).toBe('acc-ar-exp')
  })

  it('falls back when the account was deleted', () => {
    expect(resolveControl({ controlAccountId: 'gone' }, 'customers', ACCOUNTS)).toBe('acc-ar')
  })

  it('falls back when the account is no longer a control account', () => {
    // Someone un-nominated it; receivables must not keep posting there.
    const demoted = ACCOUNTS.map((a) => (a.id === 'acc-ar-exp' ? { ...a, controlFor: '' } : a))
    expect(resolveControl({ controlAccountId: 'acc-ar-exp' }, 'customers', demoted)).toBe('acc-ar')
  })

  it('falls back when the account belongs to another kind', () => {
    expect(resolveControl({ controlAccountId: 'acc-ap-ic' }, 'customers', ACCOUNTS)).toBe('acc-ar')
  })

  it('falls back when the account type is wrong for the kind', () => {
    // A receivable posted into a liability would land on the wrong side of the
    // balance sheet entirely.
    const wrongType = [...ACCOUNTS, { id: 'acc-odd', name: 'Odd', type: 'liability', controlFor: 'customers' }]
    expect(resolveControl({ controlAccountId: 'acc-odd' }, 'customers', wrongType)).toBe('acc-ar')
  })

  it('reads the item field for inventory', () => {
    const invAccounts = [{ id: 'acc-inv', type: 'asset' }, { id: 'acc-inv-2', type: 'asset', controlFor: 'inventoryItems' }]
    expect(resolveControl({ inventoryAccountId: 'acc-inv-2' }, 'inventoryItems', invAccounts)).toBe('acc-inv-2')
    expect(resolveControl({ controlAccountId: 'acc-inv-2' }, 'inventoryItems', invAccounts)).toBe('acc-inv')
  })
})

describe('isStale', () => {
  it('is quiet when nothing is set or the setting is honoured', () => {
    expect(isStale({}, 'customers', ACCOUNTS)).toBe(false)
    expect(isStale({ controlAccountId: 'acc-ar-exp' }, 'customers', ACCOUNTS)).toBe(false)
  })
  it('flags a pointer that was ignored', () => {
    expect(isStale({ controlAccountId: 'gone' }, 'customers', ACCOUNTS)).toBe(true)
  })
})

describe('validateControlAccount', () => {
  it('accepts an asset for receivables and a liability for payables', () => {
    expect(validateControlAccount({ id: 'x', type: 'asset' }, 'customers').ok).toBe(true)
    expect(validateControlAccount({ id: 'y', type: 'liability' }, 'suppliers').ok).toBe(true)
  })

  it('refuses the wrong side of the balance sheet', () => {
    const r = validateControlAccount({ id: 'y', type: 'liability' }, 'customers')
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/must be an asset/)
  })

  it('refuses an account already serving another kind', () => {
    expect(validateControlAccount(AP_INTER, 'customers').ok).toBe(false)
  })

  it('lets an account keep the kind it already has', () => {
    expect(validateControlAccount(AR_EXPORT, 'customers').ok).toBe(true)
  })

  it('refuses an unknown kind or a missing account', () => {
    expect(validateControlAccount({ type: 'asset' }, 'nonsense').ok).toBe(false)
    expect(validateControlAccount(null, 'customers').ok).toBe(false)
  })
})

describe('usage and breakdown', () => {
  const customers = [
    { id: 'c1' },
    { id: 'c2', controlAccountId: 'acc-ar-exp' },
    { id: 'c3', controlAccountId: 'acc-ar-exp' },
    { id: 'c4', controlAccountId: 'deleted' },   // resolves back to the default
  ]

  it('counts by resolved account, not by stored pointer', () => {
    expect(usageOf(customers, 'customers', 'acc-ar', ACCOUNTS)).toBe(2)
    expect(usageOf(customers, 'customers', 'acc-ar-exp', ACCOUNTS)).toBe(2)
  })

  it('builds a row per control account with its count', () => {
    const rows = breakdown(ACCOUNTS, customers, 'customers')
    expect(rows).toEqual([
      { id: 'acc-ar', code: '1100', name: 'Accounts Receivable', isDefault: true, count: 2 },
      { id: 'acc-ar-exp', code: '1110', name: 'Receivables — Export', isDefault: false, count: 2 },
    ])
  })

  it('accounts for every record exactly once', () => {
    const rows = breakdown(ACCOUNTS, customers, 'customers')
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(customers.length)
  })
})

describe('reclassLines — moving an outstanding balance', () => {
  it('moves a receivable by debiting the new account and crediting the old', () => {
    const lines = reclassLines('customers', {
      fromAccountId: 'acc-ar', toAccountId: 'acc-ar-exp', amount: 1500, name: 'Acme',
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ accountId: 'acc-ar-exp', debit: 1500, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 'acc-ar', debit: 0, credit: 1500 })
  })

  it('balances', () => {
    const lines = reclassLines('customers', { fromAccountId: 'acc-ar', toAccountId: 'acc-ar-exp', amount: 1500 })
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0))
  })

  it('moves a payable the other way round, since it sits as a credit', () => {
    const lines = reclassLines('suppliers', {
      fromAccountId: 'acc-ap', toAccountId: 'acc-ap-ic', amount: 900,
    })
    expect(lines[0]).toMatchObject({ accountId: 'acc-ap-ic', credit: 900, debit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 'acc-ap', debit: 900, credit: 0 })
  })

  it('handles a customer in credit — a negative receivable flips the sides', () => {
    const lines = reclassLines('customers', {
      fromAccountId: 'acc-ar', toAccountId: 'acc-ar-exp', amount: -400,
    })
    expect(lines[0]).toMatchObject({ accountId: 'acc-ar-exp', credit: 400, debit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 'acc-ar', debit: 400, credit: 0 })
  })

  it('produces nothing when there is no balance to move', () => {
    expect(reclassLines('customers', { fromAccountId: 'acc-ar', toAccountId: 'acc-ar-exp', amount: 0 })).toEqual([])
  })

  it('refuses a move to the same account or a missing one', () => {
    expect(() => reclassLines('customers', { fromAccountId: 'acc-ar', toAccountId: 'acc-ar', amount: 10 }))
      .toThrow(/SAME/)
    expect(() => reclassLines('customers', { toAccountId: 'acc-ar-exp', amount: 10 }))
      .toThrow(/REQUIRED/)
  })
})
