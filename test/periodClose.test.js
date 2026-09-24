import { describe, it, expect } from 'vitest'
import { periodCloseChecklist, monthBounds } from '../src/utils/periodClose.js'

const base = {
  settings: { company: { currency: 'SAR' }, accounting: { lockDate: '' } },
  accounts: [{ id: 'acc-bank1', type: 'asset' }, { id: 'acc-sales', type: 'revenue' }],
  bankAccounts: [{ id: 'ba-bank1', accountId: 'acc-bank1', type: 'bank' }],
  journalEntries: [], fixedAssets: [], assetDepreciations: [], reconciliations: [],
}
const P = { from: '2026-08-01', to: '2026-08-31' }
const item = (list, id) => list.find((i) => i.id === id)

describe('month-end checklist', () => {
  it('works out month bounds, leap years included', () => {
    expect(monthBounds('2026-08-15')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthBounds('2028-02-03')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('flags an asset with no charge in the month', () => {
    const s = { ...base, fixedAssets: [{ id: 'a', status: 'active', purchaseDate: '2026-01-01', purchaseCost: 1200, usefulLifeYears: 1 }] }
    expect(item(periodCloseChecklist(s, P), 'depreciation').status).toBe('todo')
    s.assetDepreciations = [{ assetId: 'a', date: '2026-08-31', amount: 100 }]
    expect(item(periodCloseChecklist(s, P), 'depreciation').status).toBe('done')
  })

  it('counts unreconciled bank lines up to the period end only', () => {
    const je = (id, date) => ({ id, date, lines: [{ accountId: 'acc-bank1', debit: 10, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 10 }] })
    const s = { ...base, journalEntries: [je('j1', '2026-08-10'), je('j2', '2026-09-02')] }
    expect(item(periodCloseChecklist(s, P), 'bank').count).toBe(1)
    s.reconciliations = ['ba-bank1::j1']
    expect(item(periodCloseChecklist(s, P), 'bank').status).toBe('done')
  })

  it('needs no FX revaluation without foreign balances, and reports the lock', () => {
    const list = periodCloseChecklist({ ...base, settings: { ...base.settings, accounting: { lockDate: '2026-08-31' } } }, P)
    expect(item(list, 'fx').status).toBe('na')
    expect(item(list, 'lock').status).toBe('done')
  })
})
