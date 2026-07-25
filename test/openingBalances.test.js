import { describe, it, expect } from 'vitest'
import {
  sideFor, receivablesTotal, payablesTotal, inventoryTotal,
  buildOpeningEntry, openingSummary, validateOpening, docDateWarnings,
  OBE_ACCOUNT, DERIVED_ACCOUNTS,
} from '../src/utils/openingBalances.js'

const bal = (lines) => {
  const d = lines.reduce((s, l) => s + l.debit, 0)
  const c = lines.reduce((s, l) => s + l.credit, 0)
  return Math.round((d - c) * 100) / 100
}
const lineFor = (lines, id) => lines.find((l) => l.accountId === id)

describe('sideFor — respects each account type\'s natural side', () => {
  it('puts a positive asset or expense on the debit side', () => {
    expect(sideFor('asset', 500)).toEqual({ debit: 500, credit: 0 })
    expect(sideFor('expense', 500)).toEqual({ debit: 500, credit: 0 })
  })
  it('puts a positive liability, equity or revenue on the credit side', () => {
    expect(sideFor('liability', 500)).toEqual({ debit: 0, credit: 500 })
    expect(sideFor('equity', 500)).toEqual({ debit: 0, credit: 500 })
    expect(sideFor('revenue', 500)).toEqual({ debit: 0, credit: 500 })
  })
  it('flips a negative balance — an overdrawn bank account is a credit', () => {
    expect(sideFor('asset', -500)).toEqual({ debit: 0, credit: 500 })
    expect(sideFor('liability', -500)).toEqual({ debit: 500, credit: 0 })
  })
  it('treats zero, blank and garbage as nothing to post', () => {
    expect(sideFor('asset', 0)).toEqual({ debit: 0, credit: 0 })
    expect(sideFor('asset', '')).toEqual({ debit: 0, credit: 0 })
    expect(sideFor('asset', 'abc')).toEqual({ debit: 0, credit: 0 })
  })
  it('rounds to two decimals', () => {
    expect(sideFor('asset', 10.005)).toEqual({ debit: 10.01, credit: 0 })
  })
})

describe('subledger totals', () => {
  it('sums open invoices, bills and stock at cost', () => {
    expect(receivablesTotal([{ amount: 100 }, { amount: 250.5 }])).toBe(350.5)
    expect(payablesTotal([{ amount: 80 }, { amount: 20 }])).toBe(100)
    expect(inventoryTotal([{ quantity: 10, unitCost: 5.5 }, { quantity: 3, unitCost: 2 }])).toBe(61)
  })
  it('handles empty and malformed rows without producing NaN', () => {
    expect(receivablesTotal()).toBe(0)
    expect(inventoryTotal([{ quantity: 'x', unitCost: 5 }])).toBe(0)
  })
})

describe('buildOpeningEntry — the entry always balances', () => {
  it('balances a simple cash-and-capital opening', () => {
    const e = buildOpeningEntry({
      accounts: [
        { accountId: 'acc-bank1', type: 'asset', amount: 50000 },
        { accountId: 'acc-capital', type: 'equity', amount: 50000 },
      ],
    })
    expect(bal(e.lines)).toBe(0)
    expect(e.plug).toBe(0)
    expect(lineFor(e.lines, OBE_ACCOUNT)).toBeUndefined()   // nothing to plug
  })

  it('parks an unexplained surplus in Opening Balance Equity as a credit', () => {
    // 50,000 of assets and no stated capital: equity must be 50,000.
    const e = buildOpeningEntry({ accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 50000 }] })
    expect(e.plug).toBe(50000)
    expect(lineFor(e.lines, OBE_ACCOUNT)).toMatchObject({ debit: 0, credit: 50000 })
    expect(bal(e.lines)).toBe(0)
  })

  it('parks an unexplained shortfall as a debit', () => {
    const e = buildOpeningEntry({ accounts: [{ accountId: 'acc-loan', type: 'liability', amount: 20000 }] })
    expect(e.plug).toBe(-20000)
    expect(lineFor(e.lines, OBE_ACCOUNT)).toMatchObject({ debit: 20000, credit: 0 })
    expect(bal(e.lines)).toBe(0)
  })

  it('balances a full migration: cash, receivables, payables, stock and capital', () => {
    const e = buildOpeningEntry({
      accounts: [
        { accountId: 'acc-bank1', type: 'asset', amount: 40000 },
        { accountId: 'acc-capital', type: 'equity', amount: 60000 },
      ],
      customers: [{ number: 'INV-100', amount: 12000 }, { number: 'INV-101', amount: 3000 }],
      suppliers: [{ number: 'BILL-9', amount: 7000 }],
      items: [{ quantity: 100, unitCost: 120 }],
    })
    expect(e.ar).toBe(15000)
    expect(e.ap).toBe(7000)
    expect(e.inventory).toBe(12000)
    // 40,000 + 15,000 + 12,000 = 67,000 debits; 60,000 + 7,000 = 67,000 credits
    expect(e.plug).toBe(0)
    expect(bal(e.lines)).toBe(0)
  })
})

describe('buildOpeningEntry — control accounts come from the detail, never typed', () => {
  it('derives receivables, payables and inventory from their subledgers', () => {
    const e = buildOpeningEntry({
      customers: [{ number: 'INV-1', amount: 500 }],
      suppliers: [{ number: 'B-1', amount: 200 }],
      items: [{ quantity: 4, unitCost: 25 }],
    })
    expect(lineFor(e.lines, 'acc-ar')).toMatchObject({ debit: 500, credit: 0 })
    expect(lineFor(e.lines, 'acc-ap')).toMatchObject({ debit: 0, credit: 200 })
    expect(lineFor(e.lines, 'acc-inv')).toMatchObject({ debit: 100, credit: 0 })
  })

  it('refuses a typed-in control account rather than double-counting it', () => {
    // Entering AR by hand *and* listing the invoices would post 1,500 of
    // receivables where only 500 exist.
    const e = buildOpeningEntry({
      accounts: [{ accountId: 'acc-ar', type: 'asset', amount: 1000 }],
      customers: [{ number: 'INV-1', amount: 500 }],
    }, { accountName: () => 'Accounts Receivable' })
    expect(lineFor(e.lines, 'acc-ar').debit).toBe(500)
    expect(e.warnings.join(' ')).toMatch(/Accounts Receivable/)
    expect(bal(e.lines)).toBe(0)
  })

  it('names every derived account so the UI can lock the right rows', () => {
    expect(Object.keys(DERIVED_ACCOUNTS).sort()).toEqual(['acc-ap', 'acc-ar', 'acc-inv'])
  })

  it('omits a control line entirely when its subledger is empty', () => {
    const e = buildOpeningEntry({ accounts: [{ accountId: 'acc-bank1', type: 'asset', amount: 100 }] })
    expect(lineFor(e.lines, 'acc-ar')).toBeUndefined()
    expect(lineFor(e.lines, 'acc-inv')).toBeUndefined()
  })
})

describe('openingSummary — tells the user which side is short', () => {
  it('reports a balanced migration', () => {
    expect(openingSummary({ plug: 0 }).balanced).toBe(true)
  })
  it('says capital or liabilities are missing when assets exceed the rest', () => {
    const s = openingSummary({ plug: 5000 })
    expect(s.balanced).toBe(false)
    expect(s.message).toMatch(/capital, loans or liabilities/)
  })
  it('says assets are missing when liabilities exceed the rest', () => {
    expect(openingSummary({ plug: -5000 }).message).toMatch(/missing assets/)
  })
  it('treats a sub-cent difference as balanced', () => {
    expect(openingSummary({ plug: 0.004 }).balanced).toBe(true)
  })
})

describe('validateOpening', () => {
  const good = { date: '2026-07-01', customers: [{ number: 'INV-1', amount: 100 }] }

  it('passes a well-formed migration', () => {
    expect(validateOpening(good)).toEqual([])
  })
  it('requires a valid cutover date', () => {
    expect(validateOpening({ ...good, date: '' }).join(' ')).toMatch(/cutover date/i)
    expect(validateOpening({ ...good, date: '01/07/2026' }).join(' ')).toMatch(/cutover date/i)
  })
  it('refuses a cutover inside a locked period', () => {
    expect(validateOpening(good, { lockDate: '2026-12-31' }).join(' ')).toMatch(/locked/i)
    expect(validateOpening(good, { lockDate: '2026-01-01' })).toEqual([])
  })
  it('requires a document number, or a later payment can never be matched to it', () => {
    expect(validateOpening({ ...good, customers: [{ amount: 100 }] }).join(' ')).toMatch(/document number/i)
  })
  it('requires an amount', () => {
    expect(validateOpening({ ...good, customers: [{ number: 'INV-1', amount: 0 }] }).join(' ')).toMatch(/no amount/i)
  })
  it('refuses a negative invoice — that is a credit note, not an opening balance', () => {
    expect(validateOpening({ ...good, customers: [{ number: 'INV-1', amount: -50 }] }).join(' ')).toMatch(/credit note/i)
  })
  it('refuses negative stock or negative cost', () => {
    expect(validateOpening({ date: '2026-07-01', items: [{ itemName: 'Widget', quantity: -1, unitCost: 5 }] }).join(' ')).toMatch(/negative/i)
    expect(validateOpening({ date: '2026-07-01', items: [{ itemName: 'Widget', quantity: 1, unitCost: -5 }] }).join(' ')).toMatch(/negative/i)
  })
  it('validates bills the same way as invoices', () => {
    expect(validateOpening({ date: '2026-07-01', suppliers: [{ amount: 100 }] }).join(' ')).toMatch(/document number/i)
  })
})

describe('docDateWarnings', () => {
  it('flags a document dated after the cutover — that is a real transaction', () => {
    const w = docDateWarnings({
      date: '2026-07-01',
      customers: [{ number: 'INV-1', date: '2026-08-15' }],
    })
    expect(w.join(' ')).toMatch(/after the cutover/)
  })
  it('stays quiet for documents dated before the cutover', () => {
    expect(docDateWarnings({ date: '2026-07-01', customers: [{ number: 'INV-1', date: '2026-06-15' }] })).toEqual([])
  })
  it('stays quiet with no cutover date set yet', () => {
    expect(docDateWarnings({ customers: [{ number: 'INV-1', date: '2026-08-15' }] })).toEqual([])
  })
})
