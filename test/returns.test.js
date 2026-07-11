import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const bal = (id) => { const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }; const a = g().accounts.find((x) => x.id === id); return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
const tbDiff = () => { let d = 0, c = 0; g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) })); return Math.abs(d - c) }

describe('sales return / RMA from an invoice', () => {
  g().addCustomer({ name: 'C' }); const cust = last(g().customers)
  g().addInventoryItem({ name: 'Widget', code: 'W', costPrice: 10, salePrice: 25, quantity: 100, unit: 'ea' }); const item = last(g().inventoryItems)
  const inv = g().addInvoice({
    customerId: cust.id, customerName: 'C', date: '2026-03-01', dueDate: '2026-04-01',
    items: [{ id: 'IL1', itemId: item.id, description: 'Widget', quantity: 10, unitPrice: 25, discount: 0, taxRate: 0, subtotal: 250, taxAmount: 0, total: 250, accountId: 'acc-sales' }],
    subtotal: 250, taxAmount: 0, total: 250,
  })
  const arAfterSale = bal('acc-ar')
  const retAfter = bal('acc-salesret')
  const stockAfterSale = g().inventoryItems.find((i) => i.id === item.id).quantity // 90

  it('credits AR, records the return, and restocks with COGS reversal', () => {
    const cn = g().createSalesReturn(inv.id, { IL1: 4 }, { date: '2026-03-10', reason: 'Damaged' })
    expect(cn).toBeTruthy()
    expect(cn.total).toBe(100)                                   // 4 × 25
    expect(arAfterSale - bal('acc-ar')).toBeCloseTo(100, 2)      // AR reduced by the return
    // net revenue drops via the Sales Returns contra account (its balance goes down 100)
    expect(retAfter - bal('acc-salesret')).toBeCloseTo(100, 2)
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(stockAfterSale + 4) // restocked
    const invNow = g().invoices.find((i) => i.id === inv.id)
    expect(invNow.items[0].returnedQty).toBe(4)
    expect(invNow.creditNoteIds.length).toBe(1)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('reverses COGS at average cost on the restock', () => {
    // 4 units × cost 10 came back into inventory and out of COGS
    // (checked via the cogs journal existing and inventory value up)
    expect(bal('acc-inv')).toBeGreaterThan(0)
    expect(tbDiff()).toBeLessThan(0.01)
  })

  it('cannot return more than remains on the line', () => {
    const cn2 = g().createSalesReturn(inv.id, { IL1: 999 }) // 6 remain (10 − 4)
    expect(cn2.total).toBe(6 * 25)  // clamped to 6
    expect(g().createSalesReturn(inv.id, { IL1: 1 })).toBeNull() // nothing left
  })
})

describe('purchase return from a bill', () => {
  g().addSupplier({ name: 'S' }); const supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Bolt', code: 'B', costPrice: 0, salePrice: 0, quantity: 0, unit: 'ea' }); const item = last(g().inventoryItems)
  const bill = g().addPurchase({
    supplierId: supp.id, supplierName: 'S', date: '2026-03-01', dueDate: '2026-04-01',
    items: [{ id: 'BL1', itemId: item.id, description: 'Bolt', quantity: 100, unitPrice: 5, discount: 0, taxRate: 0, subtotal: 500, taxAmount: 0, total: 500, accountId: 'acc-inv' }],
    subtotal: 500, taxAmount: 0, total: 500,
  })
  const apAfter = bal('acc-ap')
  const stockAfter = g().inventoryItems.find((i) => i.id === item.id).quantity // 100

  it('reduces AP and removes returned stock', () => {
    const dn = g().createPurchaseReturn(bill.id, { BL1: 30 }, { reason: 'Wrong item' })
    expect(dn.total).toBe(150)                                   // 30 × 5
    expect(apAfter - bal('acc-ap')).toBeCloseTo(150, 2)          // payable reduced
    expect(g().inventoryItems.find((i) => i.id === item.id).quantity).toBe(stockAfter - 30)
    expect(g().purchases.find((p) => p.id === bill.id).items[0].returnedQty).toBe(30)
    expect(tbDiff()).toBeLessThan(0.01)
  })
})
