import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/store'
import { asSystem } from '../src/store/guard'
import {
  ACTION_PERMISSIONS, UNGUARDED, READS, ROLES, ROLE_PRESETS, can, permissionsFor, setActorResolver,
  areaForPath, actionForPath, PermissionError,
} from '../src/utils/permissions'

const initial = useStore.getState()
let actor = null

beforeEach(() => {
  useStore.setState(initial, true)
  actor = null
  setActorResolver(() => actor)
})
afterEach(() => setActorResolver(null))

const as = (role, overrides = {}) => { actor = { role, name: role, overrides } }

const sellWidget = () => useStore.getState().addInvoice({
  customerId: 'c1', customerName: 'Acme', date: '2026-09-01', dueDate: '2026-10-01',
  items: [{ id: 'S1', description: 'Consulting', quantity: 1, unitPrice: 100, taxRate: 0, subtotal: 100, accountId: 'acc-sales' }],
  subtotal: 100, taxAmount: 0, total: 100,
})

describe('role presets', () => {
  it('owner and admin can do everything and cannot be narrowed', () => {
    const narrowed = { admin: { sales: [] } }
    expect(can('admin', 'sales', 'delete', narrowed)).toBe(true)
    expect(can('owner', 'settings', 'delete')).toBe(true)
  })

  it('a sales clerk creates invoices but cannot delete them or open payroll', () => {
    expect(can('sales', 'sales', 'create')).toBe(true)
    expect(can('sales', 'sales', 'delete')).toBe(false)
    expect(can('sales', 'hr', 'view')).toBe(false)
  })

  it('a viewer sees but changes nothing, and never sees payroll', () => {
    for (const area of ['sales', 'purchases', 'banking', 'accounting']) {
      expect(can('viewer', area, 'view')).toBe(true)
      expect(can('viewer', area, 'create')).toBe(false)
    }
    expect(can('viewer', 'hr', 'view')).toBe(false)
  })

  it('an owner adjustment replaces the preset for that area only', () => {
    const o = { sales: { sales: ['view', 'create', 'edit', 'delete'] } }
    expect(can('sales', 'sales', 'delete', o)).toBe(true)
    expect(permissionsFor('sales', o).inventory).toEqual(['view'])
  })

  it('every role has a preset', () => {
    ROLES.forEach((r) => expect(ROLE_PRESETS[r.id]).toBeTruthy())
  })
})

describe('store enforcement', () => {
  it('every store function is classified (guarded, background or read-only)', () => {
    const s = useStore.getState()
    const fns = Object.keys(s).filter((k) => typeof s[k] === 'function' && k !== 'setState')
    const missing = fns.filter((k) => !ACTION_PERMISSIONS[k] && !UNGUARDED.has(k) && !READS.has(k))
    expect(missing).toEqual([])
    // and nothing in the lists refers to an action that no longer exists
    expect(Object.keys(ACTION_PERMISSIONS).filter((k) => !fns.includes(k))).toEqual([])
  })

  it('nobody signed in means no restriction (tests, first run)', () => {
    expect(() => sellWidget()).not.toThrow()
  })

  it('a sales clerk records an invoice and a payment — the journal entries inside are allowed', () => {
    as('sales')
    const inv = sellWidget()
    expect(inv?.id).toBeTruthy()
    const res = useStore.getState().recordInvoicePayment(inv.id, { amount: 100, date: '2026-09-02', bankAccountId: 'acc-bank' })
    expect(res.amount).toBe(100)
  })

  it('a sales clerk cannot void or delete an invoice, or post a journal entry directly', () => {
    const inv = sellWidget()
    as('sales')
    expect(() => useStore.getState().voidInvoice(inv.id, 'x')).toThrow(PermissionError)
    expect(() => useStore.getState().deleteInvoice(inv.id)).toThrow(/can't delete or void in Sales/)
    expect(() => useStore.getState().addJournalEntry({ date: '2026-09-01', description: 'x', lines: [] })).toThrow(PermissionError)
    expect(useStore.getState().invoices.find((i) => i.id === inv.id).status).not.toBe('void')
  })

  it('a viewer cannot change anything, but the app can still run its schedules for them', () => {
    as('viewer')
    expect(() => sellWidget()).toThrow(PermissionError)
    expect(() => useStore.getState().runScheduler()).not.toThrow()
    expect(() => asSystem(() => useStore.getState().updateCompany({ name: 'X' }))).not.toThrow()
  })

  it('an HR officer cannot touch sales', () => {
    as('hr')
    expect(() => useStore.getState().addCustomer({ name: 'A' })).toThrow(PermissionError)
  })
})

describe('screens', () => {
  it('maps paths to areas and actions', () => {
    expect(areaForPath('/invoices/abc/edit')).toBe('sales')
    expect(areaForPath('/inventory-control')).toBe('inventory')
    expect(areaForPath('/purchase-orders/new')).toBe('purchases')
    expect(areaForPath('/')).toBe(null)
    expect(actionForPath('/invoices/new')).toBe('create')
    expect(actionForPath('/invoices/1/edit')).toBe('edit')
    expect(actionForPath('/invoices/1')).toBe('view')
  })
})
