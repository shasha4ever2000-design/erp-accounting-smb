import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('void / reversal engine — journal entries', () => {
  const je = g().addJournalEntry({ date: '2026-03-01', type: 'manual', description: 'x', lines: [{ accountId: 'acc-cash', debit: 100, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 100 }] })
  const rev = g().voidJournalEntry(je.id, { date: '2026-03-02', reason: 'error' })

  it('keeps the original entry (immutable ledger)', () => {
    expect(g().journalEntries.some((j) => j.id === je.id)).toBe(true)
  })
  it('posts a reversal with swapped debit/credit', () => {
    expect(rev.lines.find((l) => l.accountId === 'acc-cash').credit).toBe(100)
    expect(rev.lines.find((l) => l.accountId === 'acc-sales').debit).toBe(100)
  })
  it('links original ↔ reversal both ways', () => {
    expect(g().journalEntries.find((j) => j.id === je.id).reversedBy).toBe(rev.id)
    expect(rev.reverses).toBe(je.id)
  })
  it('nets the effect to zero and keeps the TB balanced', () => {
    expect(Math.abs(bal('acc-cash'))).toBeLessThan(0.01)
    expect(tbDiff()).toBeLessThan(0.01)
  })
  it('refuses to void an already-voided entry', () => {
    expect(() => g().voidJournalEntry(je.id, { date: '2026-03-03' })).toThrow('ALREADY_VOID')
  })
  it('refuses to void a reversal entry', () => {
    expect(() => g().voidJournalEntry(rev.id, { date: '2026-03-03' })).toThrow('CANNOT_VOID_REVERSAL')
  })
})

describe('void / reversal engine — a paid invoice with stock', () => {
  g().addCustomer({ name: 'C' }); const c = last(g().customers)
  g().addInventoryItem({ name: 'W', code: 'W', costPrice: 10, salePrice: 25, quantity: 50, unit: 'ea' }); const prod = last(g().inventoryItems)
  const inv = g().addInvoice({ customerId: c.id, customerName: 'C', date: '2026-03-05', dueDate: '2026-04-01', items: [{ description: 'W', quantity: 10, unitPrice: 25, taxRate: 0, subtotal: 250, itemId: prod.id, accountId: 'acc-sales' }], subtotal: 250, taxAmount: 0, total: 250 })
  g().recordInvoicePayment(inv.id, { date: '2026-03-06', amount: 250, bankAccountId: 'acc-bank1' })
  const cashBefore = bal('acc-bank1')
  g().voidInvoice(inv.id, { date: '2026-03-07', reason: 'return' })

  it('marks the invoice void but keeps it in the list', () => {
    expect(g().invoices.find((i) => i.id === inv.id).status).toBe('void')
  })
  it('restores the stock that was issued', () => {
    expect(g().inventoryItems.find((i) => i.id === prod.id).quantity).toBe(50)
  })
  it('nets AR and Sales back to zero and reverses the receipt', () => {
    expect(Math.abs(bal('acc-ar'))).toBeLessThan(0.01)
    expect(Math.abs(bal('acc-sales'))).toBeLessThan(0.01)
    expect(Math.abs(bal('acc-bank1') - (cashBefore - 250))).toBeLessThan(0.01)
  })
  it('keeps the original sale JE in the ledger and the TB balanced', () => {
    expect(g().journalEntries.some((j) => j.id === inv.journalEntryId)).toBe(true)
    expect(tbDiff()).toBeLessThan(0.01)
  })
})
