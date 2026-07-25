import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const lastLog = () => last(g().auditLog)

describe('audit trail — structured change logging', () => {
  beforeEach(() => {
    useStore.setState({ auditLog: [], customers: [], suppliers: [], inventoryItems: [], employees: [] })
  })

  it('records a field-level diff when a customer is edited', () => {
    g().addCustomer({ name: 'Acme', email: 'old@x.com' })
    const c = last(g().customers)
    useStore.setState({ auditLog: [] })

    g().updateCustomer(c.id, { email: 'new@x.com' })
    const e = lastLog()
    expect(e.action).toBe('Updated customer')
    expect(e.entity).toBe('customer')
    expect(e.entityId).toBe(c.id)
    expect(e.changes).toContainEqual({ field: 'email', from: 'old@x.com', to: 'new@x.com' })
    expect(e.severity).toBe('notable')
    expect(e.user).toBeTruthy()
  })

  it('logs NOTHING when a save changes no audited field — trail stays signal', () => {
    g().addCustomer({ name: 'Acme', email: 'a@x.com' })
    const c = last(g().customers)
    useStore.setState({ auditLog: [] })
    g().updateCustomer(c.id, { email: 'a@x.com' })   // same value
    expect(g().auditLog).toHaveLength(0)
  })

  it('records deletions as critical, naming what was removed', () => {
    g().addCustomer({ name: 'Doomed Co' })
    const c = last(g().customers)
    useStore.setState({ auditLog: [] })
    g().deleteCustomer(c.id)
    const e = lastLog()
    expect(e.action).toBe('Deleted customer')
    expect(e.severity).toBe('critical')
    expect(e.detail).toContain('Doomed Co')
    expect(e.entityId).toBe(c.id)
  })

  it('tracks supplier, account, item and employee edits too', () => {
    g().addSupplier({ name: 'S1' })
    g().updateSupplier(last(g().suppliers).id, { name: 'S1 Renamed' })
    expect(lastLog().action).toBe('Updated supplier')

    g().updateAccount('acc-cash', { name: 'Cash Renamed' })
    expect(lastLog().action).toBe('Updated account')

    g().addInventoryItem({ name: 'Widget', code: 'W1' })
    g().updateInventoryItem(last(g().inventoryItems).id, { name: 'Widget Pro' })
    expect(lastLog().action).toBe('Updated item')

    g().addEmployee({ name: 'Ann' })
    g().updateEmployee(last(g().employees).id, { position: 'Manager' })
    expect(lastLog().action).toBe('Updated employee')
  })

  it('does not log routine trading movement on inventory (cost/qty churn)', () => {
    g().addInventoryItem({ name: 'Widget', code: 'W1', quantity: 0, costPrice: 10 })
    const it = last(g().inventoryItems)
    useStore.setState({ auditLog: [] })
    // A sale/purchase moves these constantly — logging every move is noise.
    g().updateInventoryItem(it.id, { quantity: 50, costPrice: 12 })
    expect(g().auditLog).toHaveLength(0)
  })

  it('never lets a large binary value into the trail', () => {
    g().addCustomer({ name: 'Acme' })
    const c = last(g().customers)
    useStore.setState({ auditLog: [] })
    const bigLogo = 'data:image/png;base64,' + 'A'.repeat(60000)
    g().updateCustomer(c.id, { logo: bigLogo })
    const serialised = JSON.stringify(g().auditLog)
    expect(serialised).not.toContain('AAAA')
    expect(serialised.length).toBeLessThan(2000)
  })

  it('stamps every entry with a user and timestamp', () => {
    g().addCustomer({ name: 'Acme' })
    g().updateCustomer(last(g().customers).id, { phone: '123' })
    const e = lastLog()
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof e.user).toBe('string')
    expect(e.id).toBeTruthy()
  })

  it('remains append-only — clearAuditLog cannot erase history', () => {
    g().addCustomer({ name: 'Acme' })
    g().updateCustomer(last(g().customers).id, { phone: '1' })
    const before = g().auditLog.length
    g().clearAuditLog()
    expect(g().auditLog.length).toBeGreaterThanOrEqual(before)
  })

  it('classifies posting actions as routine', () => {
    useStore.setState({ auditLog: [] })
    g().addJournalEntry({
      date: '2026-05-01', type: 'manual', description: 'test',
      lines: [{ accountId: 'acc-cash', debit: 10, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 10 }],
    })
    expect(lastLog().severity).toBe('routine')
  })
})
