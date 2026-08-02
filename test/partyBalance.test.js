// After a credit note, do the modules agree what the customer owes?
//
// They did not. A credit note credits Accounts Receivable but leaves the
// invoice alone, so anything summing invoices by themselves overstated the debt
// by every credit ever issued. The ledger and the statement were right; the
// customer list, the credit-limit check and the analytics were not — the same
// customer read 920 on one screen and 460 on another, and somebody sitting on
// credits could be refused a sale for a limit they were nowhere near.
//
// These pin every one of those answers to the same number.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { creditStatus } from '../src/utils/credit.js'
import { customerBalance, supplierBalance } from '../src/utils/partyBalance.js'
import { buildStatement } from '../src/utils/statement.js'
import { salesAnalytics, purchaseAnalytics } from '../src/utils/tradeAnalytics.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const r2 = (n) => Math.round(n * 100) / 100
const netOf = (id) => {
  const b = g().getAllBalances()[id] || { dr: 0, cr: 0 }
  return r2(b.dr - b.cr)
}

// The same functions the Customers and Suppliers pages call.
const customersPageBalance = (id) => customerBalance(id, { invoices: g().invoices, creditNotes: g().creditNotes })
const suppliersPageBalance = (id) => supplierBalance(id, { purchases: g().purchases, debitNotes: g().debitNotes })

let cust, supp, item
beforeEach(() => {
  useStore.setState({
    journalEntries: [], invoices: [], purchases: [], creditNotes: [], debitNotes: [],
    inventoryItems: [], customers: [], suppliers: [], stockMovements: [], auditLog: [],
  })
  g().updateTax({ enabled: true, rate: 15, name: 'VAT', system: 'vat' })
  g().addCustomer({ name: 'Acme', creditLimit: 1000 }); cust = last(g().customers)
  g().addSupplier({ name: 'Supplier' }); supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Widget', code: 'W1', costPrice: 100, salePrice: 200, quantity: 100, unit: 'pcs', type: 'stock' })
  item = last(g().inventoryItems)
})

describe('what does this customer owe?', () => {
  it('every module gives the same answer after a credit note', () => {
    const inv = g().addInvoice({
      customerId: cust.id, customerName: cust.name, date: '2026-08-05', dueDate: '2026-09-05',
      items: [{ id: 'S1', itemId: item.id, description: 'Widget', quantity: 4, unitPrice: 200, discount: 0, taxRate: 15, subtotal: 800, taxAmount: 120, total: 920, accountId: 'acc-sales' }],
      subtotal: 800, taxAmount: 120, total: 920,
    })
    g().createSalesReturn(inv.id, { S1: 2 }, { reason: 'faulty' })

    const gl = netOf('acc-ar')
    const page = customersPageBalance(cust.id)
    const st = buildStatement('customer', cust.id,
      { invoices: g().invoices, creditNotes: g().creditNotes, purchases: [], debitNotes: [] },
      { start: '2000-01-01', end: '2030-12-31' })
    const stmt = r2(st.activity?.closing ?? st.closing ?? 0)
    const credit = creditStatus(g().customers[0], g().invoices, 0, g().creditNotes)
    const analytics = r2(salesAnalytics(g().invoices, g().creditNotes).outstanding)

    console.log(`  general ledger (AR)      ${gl}`)
    console.log(`  Customers page balance   ${page}`)
    console.log(`  Statement closing        ${stmt}`)
    console.log(`  credit-limit exposure    ${r2(credit.exposure)}`)
    console.log(`  sales analytics          ${analytics}`)

    expect(page).toBe(gl)
    expect(stmt).toBe(gl)
    expect(r2(credit.exposure)).toBe(gl)
    expect(analytics).toBe(gl)
  })
})

describe('what do we owe this supplier?', () => {
  it('every module gives the same answer after a debit note', () => {
    const p = g().addPurchase({
      supplierId: supp.id, supplierName: supp.name, date: '2026-08-02', dueDate: '2026-09-01',
      items: [{ id: 'P1', itemId: item.id, description: 'Widget', quantity: 10, unitPrice: 100, discount: 0, taxRate: 15, subtotal: 1000, taxAmount: 150, total: 1150, accountId: 'acc-inv' }],
      subtotal: 1000, taxAmount: 150, total: 1150,
    })
    g().createPurchaseReturn(p.id, { P1: 3 }, { reason: 'damaged' })

    const gl = r2(-netOf('acc-ap'))
    const page = suppliersPageBalance(supp.id)
    const st = buildStatement('supplier', supp.id,
      { invoices: [], creditNotes: [], purchases: g().purchases, debitNotes: g().debitNotes },
      { start: '2000-01-01', end: '2030-12-31' })
    const stmt = r2(st.activity?.closing ?? st.closing ?? 0)
    const analytics = r2(purchaseAnalytics(g().purchases, g().debitNotes).payable)

    console.log(`  general ledger (AP)      ${gl}`)
    console.log(`  Suppliers page balance   ${page}`)
    console.log(`  Statement closing        ${stmt}`)
    console.log(`  purchase analytics       ${analytics}`)

    expect(page).toBe(gl)
    expect(stmt).toBe(gl)
    expect(analytics).toBe(gl)
  })
})
