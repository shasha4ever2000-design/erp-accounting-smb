import { describe, it, expect } from 'vitest'
import { buildNotifications, visibleNotifications } from '../src/utils/notifications'

const base = {
  settings: { company: { currencySymbol: 'SAR' }, approvals: {}, accounting: { lockDate: '' } },
  invoices: [
    { id: 'i1', number: 'INV-1', status: 'sent', total: 100, amountPaid: 0, dueDate: '2026-09-01' },
    { id: 'i2', number: 'INV-2', status: 'paid', total: 100, amountPaid: 100, dueDate: '2026-09-01' },
    { id: 'i3', number: 'INV-3', status: 'void', total: 100, amountPaid: 0, dueDate: '2026-09-01' },
    { id: 'i4', number: 'INV-4', status: 'sent', total: 100, amountPaid: 0, dueDate: '2026-12-01' },
    { id: 'i5', number: 'INV-5', status: 'sent', total: 100, amountPaid: 0, dueDate: '2026-09-02' },
  ],
  creditNotes: [{ id: 'cn', invoiceId: 'i5', total: 100, status: 'issued' }],
  purchases: [
    { id: 'p1', number: 'B-1', status: 'received', total: 50, amountPaid: 0, dueDate: '2026-09-20' },
    { id: 'p2', number: 'B-2', status: 'received', total: 50, amountPaid: 0, dueDate: '2026-09-28' },
  ],
  debitNotes: [],
  inventoryItems: [
    { id: 'a', name: 'Paper', quantity: 2, reorderLevel: 5 },
    { id: 'b', name: 'Consulting', type: 'service', quantity: 0, reorderLevel: 1 },
    { id: 'c', name: 'Pens', quantity: 50, reorderLevel: 5 },
  ],
  journalEntries: [{ id: 'j', date: '2026-08-15' }],
}
const today = '2026-09-25'
const kinds = (list) => list.map((n) => n.kind)

describe('notifications', () => {
  it('finds overdue invoices (net of returns), bills due, low stock and an open month', () => {
    const list = buildNotifications(base, { today })
    expect(kinds(list)).toEqual(['invoices-overdue', 'bills-overdue', 'bills-due', 'low-stock', 'month-open'])
    const inv = list[0]
    expect(inv.count).toBe(1)
    expect(inv.body).toContain('INV-1')
    expect(list.find((n) => n.kind === 'low-stock').body).toBe('Paper (2)')
  })

  it("leaves out what the user's role can't see", () => {
    const list = buildNotifications(base, { today, role: 'sales' })
    expect(kinds(list)).toEqual(['invoices-overdue', 'low-stock'])
    expect(kinds(buildNotifications(base, { today, role: 'hr' }))).toEqual([])
  })

  it('stops nagging about the month once it is locked', () => {
    const locked = { ...base, settings: { ...base.settings, accounting: { lockDate: '2026-08-31' } } }
    expect(kinds(buildNotifications(locked, { today }))).not.toContain('month-open')
  })

  it('a dismissed notification comes back when something new joins it', () => {
    const first = buildNotifications(base, { today })
    const dismissed = { [first[0].id]: 'x' }
    expect(visibleNotifications(first, { dismissed }).list.map((n) => n.kind)).not.toContain('invoices-overdue')
    const more = { ...base, invoices: [...base.invoices, { id: 'i9', number: 'INV-9', status: 'sent', total: 5, amountPaid: 0, dueDate: '2026-09-10' }] }
    const again = buildNotifications(more, { today })
    expect(visibleNotifications(again, { dismissed }).list.map((n) => n.kind)).toContain('invoices-overdue')
  })

  it('counts only what the user has not opened the bell to see', () => {
    const list = buildNotifications(base, { today })
    expect(visibleNotifications(list, { seen: { [list[0].id]: 'x' } }).unseen).toBe(list.length - 1)
  })
})
