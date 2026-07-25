import { describe, it, expect, beforeAll } from 'vitest'
import { useStore } from '../src/store.js'

// Exercise every module that posts to the ledger, then assert the core
// double-entry invariants hold across the whole book. Mirrors the manual
// headless sweep, now as a permanent regression guard.
const g = () => useStore.getState()
const last = (a) => a[a.length - 1]

const modules = []
beforeAll(() => {
  const run = (name, fn) => { const before = g().journalEntries.length; fn(); modules.push({ name, jes: g().journalEntries.length - before }) }

  g().addCustomer({ name: 'Cust' }); const cust = last(g().customers)
  g().addSupplier({ name: 'Supp' }); const supp = last(g().suppliers)
  g().addInventoryItem({ name: 'Item', code: 'IT', costPrice: 10, salePrice: 25, quantity: 0, unit: 'ea' }); const item = last(g().inventoryItems)
  g().addDepartment({ name: 'Ops' }); const dept = last(g().departments)

  run('Purchase+receipt', () => { const p = g().addPurchase({ supplierId: supp.id, supplierName: 'Supp', date: '2026-02-01', dueDate: '2026-03-01', departmentId: dept.id, items: [{ description: 'Item', quantity: 100, unitPrice: 12, taxRate: 0, subtotal: 1200, itemId: item.id, accountId: 'acc-inv' }], subtotal: 1200, taxAmount: 0, total: 1200 }); g().recordPurchasePayment(p.id, { date: '2026-02-05', amount: 1200, bankAccountId: 'acc-bank1', wht: 0 }) })
  run('Invoice+COGS+payment', () => { const inv = g().addInvoice({ customerId: cust.id, customerName: 'Cust', date: '2026-03-01', dueDate: '2026-04-01', departmentId: dept.id, items: [{ description: 'Item', quantity: 30, unitPrice: 25, taxRate: 15, subtotal: 750, itemId: item.id, accountId: 'acc-sales' }], subtotal: 750, taxAmount: 112.5, total: 862.5 }); g().recordInvoicePayment(inv.id, { date: '2026-03-05', amount: 862.5, bankAccountId: 'acc-bank1' }) })
  run('Credit Note', () => { g().addCreditNote({ customerId: cust.id, customerName: 'Cust', date: '2026-03-06', subtotal: 100, taxAmount: 0, total: 100, items: [] }) })
  run('Debit Note', () => { g().addDebitNote({ supplierId: supp.id, supplierName: 'Supp', date: '2026-03-06', subtotal: 80, taxAmount: 0, total: 80, items: [] }) })
  run('Quotation', () => { g().addQuotation({ customerId: cust.id, customerName: 'Cust', date: '2026-03-01', items: [{ description: 'x', quantity: 1, unitPrice: 10, subtotal: 10 }], subtotal: 10, taxAmount: 0, total: 10 }) })
  run('Delivery Note', () => { g().addDeliveryNote({ customerId: cust.id, customerName: 'Cust', date: '2026-03-02', items: [{ description: 'x', quantity: 1 }] }) })
  run('Manual JE', () => { g().addJournalEntry({ date: '2026-03-02', type: 'manual', departmentId: dept.id, description: 'accrual', lines: [{ accountId: 'acc-salary', debit: 500, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 500 }] }) })
  run('Bank transaction', () => { g().addBankTransaction({ type: 'money_out', bankAccountId: 'acc-bank1', accountId: g().accounts.find((a) => a.type === 'expense').id, amount: 200, date: '2026-03-03', description: 'util', departmentId: dept.id }) })
  run('Bank transfer', () => { g().addBankTransfer({ fromAccountId: 'acc-bank1', toAccountId: 'acc-cash', amount: 300, fee: 5, date: '2026-03-04' }) })
  run('Prepaid expense', () => { g().addPrepaidExpense({ startDate: '2026-03-01', amount: 600, months: 6, bankAccountId: 'acc-bank1', description: 'insurance' }) })
  run('Fixed asset+depr+dispose', () => { const a = g().addFixedAsset({ name: 'PC', purchaseDate: '2026-01-01', purchaseCost: 2400, salvageValue: 0, usefulLifeYears: 2, depreciationMethod: 'straight_line', paymentType: 'credit' }); g().runDepreciation({ period: 'Jan 2026', date: '2026-01-31' }); g().disposeAsset(a.id, { date: '2026-06-30', proceeds: 2000, bankAccountId: 'acc-bank1' }) })
  run('Stock adjustment SoD', () => { g().addStockAdjustment({ itemId: item.id, itemName: 'Item', type: 'increase', quantity: 5, reason: 'count', date: '2026-03-07', createdBy: 'u1', createdByName: 'U' }); const adj = last(g().stockAdjustments); g().approveStockAdjustment(adj.id, { id: 'u2', name: 'Mgr' }) })
  run('Recurring journal', () => { g().addRecurringJournal({ name: 'Rent', frequency: 'monthly', nextDate: '2026-03-31', lines: [{ accountId: 'acc-salary', debit: 100, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 100 }] }); g().postRecurringJournal(g().recurringJournals[0].id) })
  run('FX revaluation', () => { g().updateAccount('acc-bank1', { currency: 'USD' }); const b = g().getAllBalances()['acc-bank1'] || { dr: 0, cr: 0 }; g().postFxRevaluation({ date: '2026-03-31', entries: [{ accountId: 'acc-bank1', currency: 'USD', fcBalance: 100, rate: 0.25, currentBase: b.dr - b.cr, revaluedBase: 400 }] }) })
  run('Payroll accrue+pay', () => { g().addPayrollRun({ period: '2026-03', payDate: '2026-03-31', lines: [{ employeeId: 'e1', employeeName: 'E', basic: 5000, housing: 0, transport: 0, other: 0, gross: 5000, late: 0, absent: 0, penalty: 0, gosi: 0, tax: 0, totalDeductions: 0, net: 5000 }] }); const rn = last(g().payrollRuns); g().processPayrollRun(rn.id); g().payPayrollRun(rn.id, 'acc-bank1', '2026-04-01') })
  run('Expense claim', () => { g().addExpenseClaim({ employeeName: 'E', date: '2026-03-10', amount: 150, category: 'Travel', accountId: g().accounts.find((a) => a.type === 'expense').id, items: [] }); const c = last(g().expenseClaims); if (g().approveExpenseClaim) g().approveExpenseClaim(c.id, { id: 'u2', name: 'Mgr' }); if (g().payExpenseClaim) g().payExpenseClaim(c.id, 'acc-bank1', '2026-03-12') })
  run('Work order', () => { g().addInventoryItem({ name: 'Steel', code: 'ST', costPrice: 5, salePrice: 0, quantity: 100, unit: 'kg' }); const steel = last(g().inventoryItems); g().addInventoryItem({ name: 'Widget', code: 'WG', costPrice: 0, salePrice: 50, quantity: 0, unit: 'ea' }); const w = last(g().inventoryItems); const wo = g().addWorkOrder({ outputItemId: w.id, outputName: 'Widget', outputQuantity: 1, targetQuantity: 10, components: [{ itemId: steel.id, name: 'Steel', quantity: 2, unitCost: 5, materialAccountId: 'acc-rawmat' }], wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods' }); g().completeWorkOrder(wo.id, '2026-03-15') })
})

describe('accounting invariants after a full module sweep', () => {
  it('exercised every module without error', () => {
    expect(modules.length).toBe(17)
    expect(g().journalEntries.length).toBeGreaterThan(0)
  })

  it('every journal entry balances (debits = credits)', () => {
    const unbalanced = g().journalEntries.filter((je) => {
      const d = je.lines.reduce((s, l) => s + (+l.debit || 0), 0)
      const c = je.lines.reduce((s, l) => s + (+l.credit || 0), 0)
      return Math.abs(d - c) > 0.02
    })
    expect(unbalanced).toEqual([])
  })

  it('the global trial balance nets to zero', () => {
    let d = 0, c = 0
    g().journalEntries.forEach((je) => je.lines.forEach((l) => { d += (+l.debit || 0); c += (+l.credit || 0) }))
    expect(Math.abs(d - c)).toBeLessThan(0.02)
  })

  it('has no journal line pointing at a missing account', () => {
    const ids = new Set(g().accounts.map((a) => a.id))
    const orphans = []
    g().journalEntries.forEach((je) => je.lines.forEach((l) => { if (!ids.has(l.accountId)) orphans.push(`${l.accountId} in ${je.number}`) }))
    expect(orphans).toEqual([])
  })

  it('has no duplicate account codes', () => {
    const seen = new Set(); const dup = []
    g().accounts.forEach((a) => { if (seen.has(a.code)) dup.push(a.code); seen.add(a.code) })
    expect(dup).toEqual([])
  })

  it('satisfies the balance-sheet equation (A = L + E + NI)', () => {
    const bals = g().getAllBalances()
    const nat = (a) => { const b = bals[a.id] || { dr: 0, cr: 0 }; return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
    const sum = (t) => g().accounts.filter((a) => a.type === t).reduce((s, a) => s + nat(a), 0)
    const A = sum('asset'), L = sum('liability'), E = sum('equity'), NI = sum('revenue') - sum('expense')
    expect(Math.abs(A - (L + E + NI))).toBeLessThan(0.02)
  })

  it('produces no NaN balances', () => {
    const nan = Object.values(g().getAllBalances()).filter((b) => Number.isNaN(b.dr) || Number.isNaN(b.cr))
    expect(nan).toEqual([])
  })
})
