import { describe, it, expect } from 'vitest'
import { runIntegrityCheck } from '../src/utils/integrityCheck.js'
import { useStore } from '../src/store.js'
import { seedDemoData } from '../src/utils/demoData.js'

const byId = (res, id) => res.checks.find((c) => c.id === id)

const accounts = [
  { id: 'cash', code: '1001', name: 'Cash', type: 'asset' },
  { id: 'ar', code: '1100', name: 'AR', type: 'asset' },
  { id: 'ap', code: '2000', name: 'AP', type: 'liability' },
  { id: 'cap', code: '3000', name: 'Capital', type: 'equity' },
  { id: 'sales', code: '4000', name: 'Sales', type: 'revenue' },
  { id: 'rent', code: '5000', name: 'Rent', type: 'expense' },
]
const je = (number, date, lines) => ({ id: number, number, date, lines, createdAt: date + 'T00:00:00Z' })

describe('runIntegrityCheck — healthy books', () => {
  const state = {
    accounts,
    journalEntries: [
      je('JE-1', '2026-01-01', [{ accountId: 'cash', debit: 1000, credit: 0 }, { accountId: 'cap', debit: 0, credit: 1000 }]),
      je('JE-2', '2026-02-01', [{ accountId: 'ar', debit: 500, credit: 0 }, { accountId: 'sales', debit: 0, credit: 500 }]),
      je('JE-3', '2026-03-01', [{ accountId: 'rent', debit: 200, credit: 0 }, { accountId: 'cash', debit: 0, credit: 200 }]),
    ],
    inventoryItems: [{ code: 'A', quantity: 5 }],
    invoices: [{ number: 'INV-1', total: 500, amountPaid: 500, status: 'paid' }],
    purchases: [],
    settings: { accounting: {} },
  }

  it('passes every check', () => {
    const res = runIntegrityCheck(state)
    expect(res.ok).toBe(true)
    expect(res.failed).toBe(0)
    expect(res.passed).toBe(res.checks.length)
    res.checks.forEach((c) => expect(c.ok).toBe(true))
  })

  it('reports a timestamp', () => {
    expect(runIntegrityCheck(state).ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('runIntegrityCheck — catches each specific corruption', () => {
  const base = () => ({
    accounts: JSON.parse(JSON.stringify(accounts)),
    journalEntries: [je('JE-1', '2026-01-01', [{ accountId: 'cash', debit: 1000, credit: 0 }, { accountId: 'cap', debit: 0, credit: 1000 }])],
    inventoryItems: [], invoices: [], purchases: [], settings: { accounting: {} },
  })

  it('detects an unbalanced entry, and names it', () => {
    const s = base()
    s.journalEntries.push(je('JE-BAD', '2026-02-01', [{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'sales', debit: 0, credit: 90 }]))
    const res = runIntegrityCheck(s)
    expect(res.ok).toBe(false)
    const c = byId(res, 'entries-balance')
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('JE-BAD')
  })

  it('detects a ledger that does not net to zero', () => {
    const s = base()
    // Balanced per-entry check is bypassed by making one entry internally fine
    // but the overall ledger skewed via a one-sided extra line.
    s.journalEntries.push({ id: 'x', number: 'JE-X', date: '2026-02-01', lines: [{ accountId: 'cash', debit: 50, credit: 0 }] })
    expect(byId(runIntegrityCheck(s), 'ledger-nets-zero').ok).toBe(false)
  })

  it('detects a broken accounting equation', () => {
    const s = base()
    s.journalEntries.push({ id: 'y', number: 'JE-Y', date: '2026-02-01', lines: [{ accountId: 'cash', debit: 75, credit: 0 }] })
    expect(byId(runIntegrityCheck(s), 'accounting-equation').ok).toBe(false)
  })

  it('detects a line pointing at a deleted account', () => {
    const s = base()
    s.journalEntries.push(je('JE-ORPH', '2026-02-01', [{ accountId: 'ghost', debit: 10, credit: 0 }, { accountId: 'cash', debit: 0, credit: 10 }]))
    const c = byId(runIntegrityCheck(s), 'no-orphan-accounts')
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).toContain('ghost')
  })

  it('detects duplicate account codes', () => {
    const s = base()
    s.accounts.push({ id: 'dup', code: '1001', name: 'Cash Copy', type: 'asset' })
    const c = byId(runIntegrityCheck(s), 'unique-account-codes')
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('1001')
  })

  it('detects a NaN amount', () => {
    const s = base()
    s.journalEntries.push({ id: 'n', number: 'JE-NAN', date: '2026-02-01', lines: [{ accountId: 'cash', debit: NaN, credit: 0 }] })
    expect(byId(runIntegrityCheck(s), 'no-bad-numbers').ok).toBe(false)
  })

  it('detects negative stock', () => {
    const s = base()
    s.inventoryItems = [{ code: 'WIDGET', quantity: -3 }]
    const c = byId(runIntegrityCheck(s), 'no-negative-stock')
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('WIDGET')
  })

  it('detects an overpaid invoice but ignores voided ones', () => {
    const s = base()
    s.invoices = [
      { number: 'INV-OVER', total: 100, amountPaid: 150, status: 'paid' },
      { number: 'INV-VOID', total: 100, amountPaid: 150, status: 'void' },
    ]
    const c = byId(runIntegrityCheck(s), 'no-overpayments')
    expect(c.ok).toBe(false)
    expect(c.items).toHaveLength(1)
    expect(c.items[0].ref).toBe('INV-OVER')
  })

  it('detects an entry back-posted into a locked period', () => {
    const s = base()
    s.settings = { accounting: { lockDate: '2026-01-31' } }
    s.journalEntries.push({ id: 'l', number: 'JE-LATE', date: '2026-01-15', lines: [{ accountId: 'cash', debit: 5, credit: 0 }, { accountId: 'cap', debit: 0, credit: 5 }], createdAt: '2026-06-01T00:00:00Z' })
    const c = byId(runIntegrityCheck(s), 'lock-respected')
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('JE-LATE')
  })

  it('passes the lock check when nothing is locked', () => {
    expect(byId(runIntegrityCheck(base()), 'lock-respected').ok).toBe(true)
  })
})

describe('runIntegrityCheck — against real seeded books', () => {
  it('reports the demo company as fully healthy', () => {
    seedDemoData(useStore.getState)
    const res = runIntegrityCheck(useStore.getState())
    if (!res.ok) console.error('failing checks:', res.checks.filter((c) => !c.ok))
    expect(res.ok).toBe(true)
  })
})

describe('runIntegrityCheck — robustness', () => {
  it('does not throw on empty or missing state', () => {
    expect(() => runIntegrityCheck({})).not.toThrow()
    expect(() => runIntegrityCheck(null)).not.toThrow()
    expect(runIntegrityCheck({}).ok).toBe(true)
  })

  it('never mutates the state it inspects', () => {
    const s = { accounts, journalEntries: [je('JE-1', '2026-01-01', [{ accountId: 'cash', debit: 1, credit: 0 }, { accountId: 'cap', debit: 0, credit: 1 }])], settings: {} }
    const snapshot = JSON.stringify(s)
    runIntegrityCheck(s)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('Opening Balance Equity check', () => {
  const je = (lines) => ({ id: 'j1', number: 'JE-1', date: '2026-01-01', lines })
  const run = (state) => runIntegrityCheck(state).checks.find((c) => c.id === 'obe-cleared')

  it('stays quiet when no opening balances were posted', () => {
    expect(run({ journalEntries: [], settings: {} }).ok).toBe(true)
  })

  it('passes when the migration balanced — nothing was parked', () => {
    const c = run({
      settings: { opening: { posted: true } },
      journalEntries: [je([
        { accountId: 'acc-bank1', debit: 100, credit: 0 },
        { accountId: 'acc-capital', debit: 0, credit: 100 },
      ])],
    })
    expect(c.ok).toBe(true)
  })

  it('flags a credit left in Opening Balance Equity and says what is missing', () => {
    const c = run({
      settings: { opening: { posted: true } },
      journalEntries: [je([
        { accountId: 'acc-bank1', debit: 5000, credit: 0 },
        { accountId: 'acc-obe', debit: 0, credit: 5000 },
      ])],
    })
    expect(c.ok).toBe(false)
    expect(c.detail).toMatch(/5000\.00/)
    expect(c.items[0].detail).toMatch(/capital or loans/i)
  })

  it('flags a debit left in Opening Balance Equity', () => {
    const c = run({
      settings: { opening: { posted: true } },
      journalEntries: [je([
        { accountId: 'acc-obe', debit: 3000, credit: 0 },
        { accountId: 'acc-loan', debit: 0, credit: 3000 },
      ])],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).toMatch(/missing assets/i)
  })

  it('clears once the balance is journalled out to real capital', () => {
    const c = run({
      settings: { opening: { posted: true } },
      journalEntries: [
        je([{ accountId: 'acc-bank1', debit: 5000, credit: 0 }, { accountId: 'acc-obe', debit: 0, credit: 5000 }]),
        { id: 'j2', number: 'JE-2', date: '2026-02-01', lines: [
          { accountId: 'acc-obe', debit: 5000, credit: 0 },
          { accountId: 'acc-capital', debit: 0, credit: 5000 },
        ] },
      ],
    })
    expect(c.ok).toBe(true)
  })
})

describe('inventory-subledger check', () => {
  const run = (state) => {
    const res = runIntegrityCheck({ accounts: [{ id: 'acc-inv', name: 'Inventory' }, { id: 'acc-rawmat', name: 'Raw Materials' }], ...state })
    return res.checks.find((c) => c.id === 'inventory-subledger')
  }
  const entry = (lines) => ({ id: 'j1', number: 'JE-1', date: '2026-08-01', lines })

  it('passes when the ledger is worth what the shelf is worth', () => {
    const c = run({
      inventoryItems: [{ id: 'i1', code: 'W1', quantity: 10, costPrice: 100 }],
      journalEntries: [entry([{ accountId: 'acc-inv', debit: 1000, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 1000 }])],
    })
    expect(c.ok).toBe(true)
  })

  it('catches stock that moved without an entry behind it', () => {
    const c = run({
      inventoryItems: [{ id: 'i1', code: 'W1', quantity: 15, costPrice: 100 }],   // 5 arrived unbooked
      journalEntries: [entry([{ accountId: 'acc-inv', debit: 1000, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 1000 }])],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).toMatch(/Stock is worth 500\.00 more/)
  })

  it('catches an entry that posted with no stock behind it', () => {
    const c = run({
      inventoryItems: [{ id: 'i1', code: 'W1', quantity: 10, costPrice: 100 }],
      journalEntries: [entry([{ accountId: 'acc-inv', debit: 1400, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 1400 }])],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).toMatch(/Ledger holds 400\.00 more/)
  })

  it('does not let two accounts cancel each other out', () => {
    // Inventory is 500 short and Raw Materials 500 over: the total is right and
    // both accounts are wrong, which is precisely the failure to report.
    const c = run({
      inventoryItems: [
        { id: 'i1', code: 'W1', quantity: 10, costPrice: 100 },
        { id: 'i2', code: 'R1', quantity: 10, costPrice: 100, inventoryAccountId: 'acc-rawmat' },
      ],
      journalEntries: [entry([
        { accountId: 'acc-inv', debit: 500, credit: 0 },
        { accountId: 'acc-rawmat', debit: 1500, credit: 0 },
        { accountId: 'acc-ap', debit: 0, credit: 2000 },
      ])],
    })
    expect(c.ok).toBe(false)
    expect(c.items).toHaveLength(2)
    expect(c.items.map((i) => i.ref).sort()).toEqual(['Inventory', 'Raw Materials'])
  })

  it('says nothing when there is no stock to reconcile', () => {
    expect(run({ inventoryItems: [], journalEntries: [] }).ok).toBe(true)
    expect(run({ inventoryItems: [{ id: 's1', type: 'service' }], journalEntries: [] }).detail).toMatch(/No stock items/)
  })
})

describe('party-subledger check (AR and AP)', () => {
  const run = (state) => {
    const res = runIntegrityCheck({ accounts: [], customers: [], suppliers: [], ...state })
    return res.checks.find((c) => c.id === 'party-subledgers')
  }
  const je = (lines) => ({ id: 'j1', number: 'JE-1', date: '2026-08-01', lines })

  it('passes when the ledger matches what customers owe', () => {
    expect(run({
      invoices: [{ id: 'i1', number: 'INV-1', customerId: 'c1', total: 920, amountPaid: 0, status: 'sent' }],
      journalEntries: [je([{ accountId: 'acc-ar', debit: 920, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 920 }])],
    }).ok).toBe(true)
  })

  it('passes once a credit note is netted off both sides', () => {
    expect(run({
      invoices: [{ id: 'i1', customerId: 'c1', total: 920, amountPaid: 0, status: 'sent' }],
      creditNotes: [{ id: 'cn1', customerId: 'c1', total: 460, status: 'issued' }],
      journalEntries: [je([
        { accountId: 'acc-ar', debit: 920, credit: 0 },
        { accountId: 'acc-sales', debit: 0, credit: 920 },
        { accountId: 'acc-ar', debit: 0, credit: 460 },
        { accountId: 'acc-salesret', debit: 460, credit: 0 },
      ])],
    }).ok).toBe(true)
  })

  it('catches a receivable the customer list does not know about', () => {
    const c = run({
      invoices: [{ id: 'i1', customerId: 'c1', total: 500, amountPaid: 0, status: 'sent' }],
      journalEntries: [je([{ accountId: 'acc-ar', debit: 920, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 920 }])],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('Accounts Receivable')
    expect(c.items[0].detail).toMatch(/420\.00 apart/)
  })

  it('catches the same break on the payable side', () => {
    const c = run({
      purchases: [{ id: 'p1', supplierId: 's1', total: 1150, amountPaid: 0, status: 'received' }],
      debitNotes: [{ id: 'dn1', supplierId: 's1', total: 345, status: 'issued' }],
      journalEntries: [je([{ accountId: 'acc-ap', debit: 0, credit: 1150 }, { accountId: 'acc-inv', debit: 1150, credit: 0 }])],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].ref).toBe('Accounts Payable')
    expect(c.items[0].detail).toMatch(/345\.00 apart/)
  })

  it('ignores parties moved onto their own control account', () => {
    // Their balance lives elsewhere, so comparing it against the default
    // control account would report a break that is not one.
    expect(run({
      customers: [{ id: 'c1', controlAccountId: 'acc-ar-group' }],
      invoices: [{ id: 'i1', customerId: 'c1', total: 920, amountPaid: 0, status: 'sent' }],
      journalEntries: [je([{ accountId: 'acc-ar-group', debit: 920, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 920 }])],
    }).ok).toBe(true)
  })

  it('does not count voided documents', () => {
    expect(run({
      invoices: [
        { id: 'i1', customerId: 'c1', total: 920, amountPaid: 0, status: 'sent' },
        { id: 'i2', customerId: 'c1', total: 500, amountPaid: 0, status: 'void' },
      ],
      journalEntries: [je([{ accountId: 'acc-ar', debit: 920, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 920 }])],
    }).ok).toBe(true)
  })
})

describe('the inventory check explains itself', () => {
  const run = (state) => runIntegrityCheck({ accounts: [{ id: 'acc-inv', name: 'Inventory' }], ...state })
    .checks.find((c) => c.id === 'inventory-subledger')

  it('names the item whose opening quantity was never journalled', () => {
    // The commonest cause by far, and the one a new user hits on day one.
    const c = run({ inventoryItems: [{ id: 'i1', code: 'SKU-001', quantity: 100, costPrice: 100 }], journalEntries: [] })
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).toMatch(/SKU-001/)
    expect(c.items[0].detail).toMatch(/Opening Balances/)
  })

  it('does not blame opening quantities when the stock has cost layers', () => {
    const c = run({
      inventoryItems: [{ id: 'i1', code: 'SKU-001', quantity: 100, costPrice: 100, costLayers: [{ qty: 100, unitCost: 100 }] }],
      journalEntries: [{ id: 'j1', number: 'JE-1', date: '2026-08-01', lines: [
        { accountId: 'acc-inv', debit: 5000, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 5000 },
      ] }],
    })
    expect(c.ok).toBe(false)
    expect(c.items[0].detail).not.toMatch(/Opening Balances/)
  })
})
