import { describe, it, expect } from 'vitest'
import { buildVatReturn, yearQuarters } from '../src/utils/vatReturn.js'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

const period = { from: '2026-04-01', to: '2026-06-30' }

const docs = {
  invoices: [
    // standard-rated sale inside the period
    { date: '2026-05-01', status: 'sent', subtotal: 1000, taxAmount: 150, total: 1150,
      items: [{ subtotal: 1000, taxRate: 15, taxAmount: 150 }] },
    // zero-rated sale (export) inside the period
    { date: '2026-05-10', status: 'paid', subtotal: 400, taxAmount: 0, total: 400,
      items: [{ subtotal: 400, taxRate: 0, taxCategory: 'zero' }] },
    // exempt sale
    { date: '2026-05-12', status: 'paid', subtotal: 200, taxAmount: 0, total: 200,
      items: [{ subtotal: 200, taxRate: 0, taxCategory: 'exempt' }] },
    // outside the period → excluded
    { date: '2026-03-01', status: 'paid', subtotal: 9999, taxAmount: 1499.85, total: 11498.85,
      items: [{ subtotal: 9999, taxRate: 15 }] },
    // voided → excluded
    { date: '2026-05-20', status: 'void', subtotal: 500, taxAmount: 75, total: 575,
      items: [{ subtotal: 500, taxRate: 15 }] },
  ],
  creditNotes: [
    { date: '2026-05-15', status: 'issued', subtotal: 100, taxAmount: 15, total: 115, items: [] },
  ],
  purchases: [
    { date: '2026-04-10', status: 'paid', subtotal: 600, taxAmount: 90, total: 690,
      items: [{ subtotal: 600, taxRate: 15, taxAmount: 90 }] },
    { date: '2026-04-11', status: 'received', subtotal: 300, taxAmount: 0, total: 300,
      items: [{ subtotal: 300, taxRate: 0, taxCategory: 'zero' }] },
  ],
  debitNotes: [
    { date: '2026-04-20', status: 'issued', subtotal: 50, taxAmount: 7.5, total: 57.5, items: [] },
  ],
}

describe('buildVatReturn', () => {
  const ret = buildVatReturn(docs, period)

  it('classifies sales into standard / zero / exempt boxes', () => {
    expect(ret.sales.standard.amount).toBe(1000)
    expect(ret.sales.zero.amount).toBe(400)
    expect(ret.sales.exempt.amount).toBe(200)
    expect(ret.sales.total.amount).toBe(1600)
  })

  it('nets credit notes into the sales adjustment column and output VAT', () => {
    expect(ret.sales.standard.adjustment).toBe(-100)
    expect(ret.outputVat).toBe(135) // 150 − 15
    expect(ret.sales.total.vat).toBe(135)
  })

  it('nets debit notes into the purchases adjustment column and input VAT', () => {
    expect(ret.purchases.standard.amount).toBe(600)
    expect(ret.purchases.standard.adjustment).toBe(-50)
    expect(ret.purchases.zero.amount).toBe(300)
    expect(ret.inputVat).toBe(82.5) // 90 − 7.5
  })

  it('computes net VAT payable', () => {
    expect(ret.netVat).toBe(52.5) // 135 − 82.5
  })

  it('excludes out-of-period and voided documents', () => {
    // The big March invoice and the voided May invoice must not appear anywhere.
    expect(ret.sales.total.amount).toBe(1600)
    expect(ret.outputVat).toBe(135)
  })
})

describe('yearQuarters', () => {
  it('produces correct calendar quarters', () => {
    const q = yearQuarters(2026)
    expect(q).toHaveLength(4)
    expect(q[0]).toMatchObject({ id: 'Q1', from: '2026-01-01', to: '2026-03-31' })
    expect(q[1]).toMatchObject({ id: 'Q2', from: '2026-04-01', to: '2026-06-30' })
    expect(q[3]).toMatchObject({ id: 'Q4', from: '2026-10-01', to: '2026-12-31' })
  })
})

describe('settleVat store action', () => {
  it('posts a balanced settlement JE that zeroes the period VAT and pays the net', () => {
    // Put some VAT on the books: one sale (output 150), one purchase (input 90).
    g().addCustomer({ name: 'C' }); const cust = last(g().customers)
    g().addSupplier({ name: 'S' }); const supp = last(g().suppliers)
    g().addInvoice({ customerId: cust.id, customerName: 'C', date: '2026-05-01', dueDate: '2026-06-01',
      items: [{ description: 'x', quantity: 1, unitPrice: 1000, taxRate: 15, subtotal: 1000 }],
      subtotal: 1000, taxAmount: 150, total: 1150 })
    g().addPurchase({ supplierId: supp.id, supplierName: 'S', date: '2026-05-02', dueDate: '2026-06-02',
      items: [{ description: 'y', quantity: 1, unitPrice: 600, taxRate: 15, subtotal: 600, accountId: 'acc-inv' }],
      subtotal: 600, taxAmount: 90, total: 690 })

    const je = g().settleVat({ date: '2026-07-15', from: '2026-04-01', to: '2026-06-30', bankAccountId: 'acc-bank1', outputVat: 150, inputVat: 90 })
    expect(je.type).toBe('vat_settlement')
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
    expect(dr).toBeCloseTo(cr, 2)
    // Bank credited with the net 60
    const bank = je.lines.find((l) => l.accountId === 'acc-bank1')
    expect(bank.credit).toBe(60)
    // Output VAT account movement nets to zero across the period + settlement
    const bal = g().getAllBalances()
    expect((bal['acc-vatout'].cr - bal['acc-vatout'].dr)).toBeCloseTo(0, 2)
    expect((bal['acc-vatin'].dr - bal['acc-vatin'].cr)).toBeCloseTo(0, 2)
  })

  it('handles a refund period (input > output) by debiting the bank', () => {
    const je = g().settleVat({ date: '2026-07-16', from: '2026-04-01', to: '2026-06-30', bankAccountId: 'acc-bank1', outputVat: 10, inputVat: 25 })
    const bank = je.lines.find((l) => l.accountId === 'acc-bank1')
    expect(bank.debit).toBe(15)
  })

  it('rejects an empty settlement', () => {
    expect(() => g().settleVat({ date: '2026-07-17', from: 'a', to: 'b', bankAccountId: 'acc-bank1', outputVat: 0, inputVat: 0 })).toThrow('VAT_NOTHING_TO_SETTLE')
  })
})
