// One clean, memorable example of every transaction the system can post.
// Round numbers throughout, so the arithmetic in the guide is checkable by eye.
//
// Every example runs through the real store actions, and the journal entries
// it produces are recorded in a manifest that the capture script then
// screenshots one by one.
import { useStore } from '/home/user/erp-accounting-smb/src/store.js'
import { writeFileSync } from 'node:fs'

const DIR = process.env.GUIDE_DIR || '.guide-build'
const g = useStore.getState
const last = (a) => a[a.length - 1]
const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }
const monthEnd = (back = 0) => { const d = new Date(); d.setMonth(d.getMonth() - back + 1, 0); return iso(d) }
const monthLabel = (back = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() - back, 1)
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
}
const monthKey = (back = 0) => { const d = new Date(); d.setMonth(d.getMonth() - back, 1); return iso(d).slice(0, 7) }

const RATE = 15
const vat = (n) => Math.round(n * RATE) / 100

const MANIFEST = []
const problems = []

/**
 * Run one worked example and record whatever journal entries it produced.
 * `expect` is what the guide claims should happen, checked here rather than
 * asserted in prose — a mismatch is a bug in the guide, not a typo.
 */
function example(key, title, fn, { expect } = {}) {
  const before = g().journalEntries.length
  let result
  try { result = fn() } catch (e) { problems.push(`${key}: ${e.message}`); return }
  const made = g().journalEntries.slice(before)
  if (expect != null && made.length !== expect)
    problems.push(`${key}: expected ${expect} journal entr(y/ies), got ${made.length}`)
  MANIFEST.push({
    key, title,
    entries: made.map((je) => ({
      number: je.number, type: je.type, description: je.description,
      total: Math.round(je.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100,
      lines: je.lines.map((l) => ({
        account: g().accounts.find((a) => a.id === l.accountId)?.name || l.accountId,
        debit: l.debit || 0, credit: l.credit || 0,
      })),
    })),
  })
  return result
}

// ── Company ────────────────────────────────────────────────────────
g().updateCompany({
  name: 'Northwind Trading Co.',
  nameAr: 'شركة نورث ويند التجارية',
  email: 'hello@northwind.example', phone: '+966 11 234 5678',
  address: '2140 King Fahd Road, Al Olaya, Riyadh 12214',
  taxNumber: '310123456700003', crNumber: '1010234567',
  currency: 'SAR', currencySymbol: 'SAR',
})
// VAT is off until a region is chosen, and anything that computes its own tax
// (converting an order to a bill, for instance) reads this — not the figures
// typed on a document. A guide that shows 15% on one screen and nothing on the
// next is worse than useless.
g().updateTax({ enabled: true, rate: RATE, name: 'VAT', system: 'vat', country: 'SA' })

// ── Master data (no postings) ──────────────────────────────────────
g().addCustomer({ name: 'Al-Noor Trading Est.', email: 'accounts@alnoor.example', phone: '0501234567', paymentTerms: 30 })
const CUST = last(g().customers)
g().addCustomer({ name: 'Gulf Star LLC', email: 'finance@gulfstar.example', paymentTerms: 30 })
const CUST2 = last(g().customers)
g().addSupplier({ name: 'Riyadh Supplies Co', email: 'sales@riyadhsupplies.example' })
const SUPP = last(g().suppliers)
g().addSupplier({ name: 'Jeddah Import House' })
const SUPP2 = last(g().suppliers)

g().addInventoryItem({ name: 'Office Chair', code: 'CH-01', costPrice: 300, salePrice: 500, quantity: 0, unit: 'ea', type: 'stock' })
const CHAIR = last(g().inventoryItems)
g().addInventoryItem({ name: 'Standing Desk', code: 'DK-02', costPrice: 800, salePrice: 1400, quantity: 0, unit: 'ea', type: 'stock' })
const DESK = last(g().inventoryItems)
g().addInventoryItem({ name: 'Steel sheet 2mm', code: 'RM-STEEL', costPrice: 40, salePrice: 0, quantity: 0, unit: 'sheet', type: 'stock' })
const STEEL = last(g().inventoryItems)
g().addInventoryItem({ name: 'Steel shelving unit', code: 'FG-SHELF', costPrice: 0, salePrice: 600, quantity: 0, unit: 'ea', type: 'stock' })
const SHELF = last(g().inventoryItems)

g().addWarehouse({ name: 'Riyadh Main Store', location: 'Riyadh — Industrial City 2' })
g().addWarehouse({ name: 'Jeddah Branch', location: 'Jeddah — Al Khumrah' })
const WH = g().warehouses

g().addDepartment({ name: 'Operations' })
const DEPT = last(g().departments)

g().addEmployee({
  name: 'Yusuf Haddad', position: 'Sales Manager', status: 'active',
  basicSalary: 8000, housingAllowance: 2000, transportAllowance: 1000, salary: 11000,
  gosiApplicable: true, gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75,
  departmentId: DEPT.id, startDate: daysAgo(700), employmentType: 'full-time', payFrequency: 'monthly',
})
const EMP = last(g().employees)
g().addContract({
  employeeId: EMP.id, startDate: daysAgo(700), type: 'unlimited',
  basic: 8000, housing: 2000, transport: 1000, other: 0,
  workDaysPerWeek: 5, dailyHours: 8, annualLeaveDays: 21, overtimeMultiplier: 1.5,
  gosiApplicable: true, gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75,
})

// ═══════════════════════════════════════════════════════════════════
// SETTING UP
// ═══════════════════════════════════════════════════════════════════

example('capital', 'Owner puts money into the business', () =>
  g().addJournalEntry({
    date: daysAgo(180), type: 'manual', description: 'Owner capital injection',
    lines: [
      { accountId: 'acc-bank1', debit: 500000, credit: 0, description: 'Capital introduced' },
      { accountId: 'acc-capital', debit: 0, credit: 500000, description: 'Capital introduced' },
    ],
  }), { expect: 1 })

// ═══════════════════════════════════════════════════════════════════
// BUYING
// ═══════════════════════════════════════════════════════════════════

example('requisition', 'Someone asks to buy something', () =>
  g().addRequisition({
    requestedBy: 'Omar Farouk', department: 'Operations', date: daysAgo(150), neededBy: daysAgo(140),
    items: [{ description: 'Office Chair', quantity: 100, estPrice: 300 }],
    total: 30000, notes: 'Restock before the season',
  }), { expect: 0 })

example('purchase_quote', 'A supplier quotes a price', () =>
  g().addPurchaseQuote({
    supplierId: SUPP.id, supplierName: SUPP.name, date: daysAgo(148), validUntil: daysAhead(30),
    items: [{ id: 'Q1', description: 'Office Chair', quantity: 100, unitPrice: 300, discount: 0, taxRate: RATE }],
    subtotal: 30000, taxAmount: vat(30000), total: 30000 + vat(30000),
  }), { expect: 0 })

const PO = example('purchase_order', 'You commit to buy — the purchase order', () =>
  g().addPurchaseOrder({
    supplierId: SUPP.id, supplierName: SUPP.name, date: daysAgo(145), expectedDate: daysAgo(135),
    items: [{ id: 'P1', itemId: CHAIR.id, description: 'Office Chair', quantity: 100, unitPrice: 300, discount: 0, taxRate: RATE, accountId: 'acc-inv' }],
    subtotal: 30000, taxAmount: vat(30000), total: 30000 + vat(30000),
  }), { expect: 0 })

example('goods_receipt', 'The goods arrive before the bill does', () =>
  g().receiveGoods(PO.id, { P1: 100 }, { date: daysAgo(138) }), { expect: 1 })

// Billing goods that were already received clears the GRNI liability instead
// of debiting Inventory a second time — the stock came in with the receipt.
// (A bill for goods NOT separately received is a plain purchase invoice, or
// convertPOToPurchase, either of which does debit Inventory.)
const BILL = example('purchase', 'The supplier’s bill arrives for goods already received', () =>
  g().billReceivedPO(PO.id, { P1: 100 }, { date: daysAgo(135), dueDate: daysAgo(105) }),
  { expect: 1 })

example('purchase_payment', 'You pay the supplier', () =>
  g().recordPurchasePayment(BILL.id, { date: daysAgo(105), amount: 30000 + vat(30000), bankAccountId: 'acc-bank1', wht: 0 }),
  { expect: 1 })

example('landed_cost', 'Freight is added to what the stock cost you', () =>
  g().postLandedCost({
    date: daysAgo(134), reference: 'DHL-88231', note: 'Inbound freight on the chair shipment',
    method: 'value', amount: 2000, creditAccountId: 'acc-bank1',
    lines: [{ itemId: CHAIR.id, qty: 100 }],
  }), { expect: 1 })

example('debit_note', 'You send faulty goods back to the supplier', () =>
  g().addDebitNote({
    supplierId: SUPP.id, supplierName: SUPP.name, date: daysAgo(130),
    subtotal: 1500, taxAmount: vat(1500), total: 1500 + vat(1500),
    items: [], reason: '5 chairs arrived damaged',
  }), { expect: 1 })

// ═══════════════════════════════════════════════════════════════════
// SELLING
// ═══════════════════════════════════════════════════════════════════

const QUOTE = example('quotation', 'You quote a customer a price', () =>
  g().addQuotation({
    customerId: CUST.id, customerName: CUST.name, date: daysAgo(120), validUntil: daysAhead(10),
    items: [{ id: 'L1', itemId: CHAIR.id, description: 'Office Chair', quantity: 20, unitPrice: 500, discount: 0, taxRate: RATE, subtotal: 10000 }],
    subtotal: 10000, taxAmount: vat(10000), total: 10000 + vat(10000),
  }), { expect: 0 })

const SO = example('sales_order', 'The customer confirms — the sales order', () =>
  g().addSalesOrder({
    customerId: CUST.id, customerName: CUST.name, date: daysAgo(118), expectedDate: daysAgo(110),
    items: [{ id: 'L1', itemId: CHAIR.id, description: 'Office Chair', quantity: 20, unitPrice: 500, discount: 0, taxRate: RATE, subtotal: 10000, taxAmount: vat(10000), total: 10000 + vat(10000) }],
    subtotal: 10000, taxAmount: vat(10000), total: 10000 + vat(10000),
  }), { expect: 0 })

example('delivery_note', 'The goods go out — the delivery note', () =>
  g().convertSalesOrderToDeliveryNote(SO.id, { L1: 20 }), { expect: 0 })

const INV = example('invoice', 'You invoice the customer', () =>
  g().addInvoice({
    customerId: CUST.id, customerName: CUST.name, date: daysAgo(110), dueDate: daysAgo(80),
    departmentId: DEPT.id,
    items: [{ description: 'Office Chair', quantity: 20, unitPrice: 500, taxRate: RATE, subtotal: 10000, itemId: CHAIR.id, accountId: 'acc-sales' }],
    subtotal: 10000, taxAmount: vat(10000), total: 10000 + vat(10000),
  }), { expect: 2 })   // the invoice, and the cost of sale

example('invoice_payment', 'The customer pays', () =>
  g().recordInvoicePayment(INV.id, { date: daysAgo(85), amount: 10000 + vat(10000), bankAccountId: 'acc-bank1' }),
  { expect: 1 })

example('credit_note', 'The customer returns two chairs', () =>
  g().addCreditNote({
    customerId: CUST.id, customerName: CUST.name, date: daysAgo(80),
    subtotal: 1000, taxAmount: vat(1000), total: 1000 + vat(1000),
    items: [], reason: '2 chairs returned',
  }), { expect: 1 })

example('customer_advance', 'A customer pays a deposit up front', () =>
  g().receiveAdvance({
    customerId: CUST2.id, customerName: CUST2.name, amount: 20000, date: daysAgo(75),
    bankAccountId: 'acc-bank1', reference: 'Deposit against the fit-out order',
  }), { expect: 1 })

// ── Cheques ────────────────────────────────────────────────────────
const CHQ_IN = example('cheque_in', 'A customer pays by post-dated cheque', () =>
  g().addCheque({
    direction: 'received', number: '400218', bankName: 'Al Rajhi Bank', amount: 8000,
    issueDate: daysAgo(70), dueDate: daysAgo(40), partyId: CUST.id, partyName: CUST.name,
    bankAccountId: 'acc-bank1', notes: 'Part settlement',
  }), { expect: 1 })

example('cheque_deposit', 'You deposit that cheque', () =>
  g().setChequeStatus(CHQ_IN.id, 'deposited', { date: daysAgo(42) }), { expect: 0 })

example('cheque_cleared', 'The cheque clears', () =>
  g().setChequeStatus(CHQ_IN.id, 'cleared', { date: daysAgo(40), bankAccountId: 'acc-bank1' }), { expect: 1 })

// ═══════════════════════════════════════════════════════════════════
// STOCK
// ═══════════════════════════════════════════════════════════════════

example('stock_adjustment', 'Stock is damaged and written off', () => {
  // Value it at what the stock actually cost — 300 to buy plus 20 a chair of
  // freight capitalised by the landed cost above.
  const unitCost = g().inventoryItems.find((i) => i.id === CHAIR.id).costPrice
  g().addStockAdjustment({
    itemId: CHAIR.id, itemName: CHAIR.name, type: 'decrease', quantity: 3,
    unitCost, totalAmount: Math.round(unitCost * 3 * 100) / 100,
    reason: 'Damaged in handling', date: daysAgo(60), createdBy: 'u1', createdByName: 'Omar Farouk',
  })
  const adj = last(g().stockAdjustments)
  return g().approveStockAdjustment(adj.id, { id: 'u2', name: 'Layla Mansour' })
}, { expect: 1 })

example('stock_transfer', 'Stock moves between two of your warehouses', () =>
  g().addStockTransfer({
    itemId: CHAIR.id, fromWarehouseId: WH[0].id, toWarehouseId: WH[1].id,
    quantity: 10, date: daysAgo(58), notes: 'Jeddah showroom display',
  }), { expect: 0 })

// ── Manufacturing ──────────────────────────────────────────────────
example('raw_materials', 'You buy raw materials', () =>
  g().addPurchase({
    supplierId: SUPP2.id, supplierName: SUPP2.name, date: daysAgo(56), dueDate: daysAgo(26),
    items: [{ description: 'Steel sheet 2mm', quantity: 500, unitPrice: 40, taxRate: RATE, subtotal: 20000, itemId: STEEL.id, accountId: 'acc-rawmat' }],
    subtotal: 20000, taxAmount: vat(20000), total: 20000 + vat(20000),
  }), { expect: 1 })

example('work_order', 'You make 50 shelving units out of steel', () => {
  const wo = g().addWorkOrder({
    outputItemId: SHELF.id, outputName: SHELF.name, outputQuantity: 1, targetQuantity: 50,
    startDate: daysAgo(54),
    components: [{ itemId: STEEL.id, name: STEEL.name, quantity: 4, unitCost: 40, materialAccountId: 'acc-rawmat' }],
    wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods',
  })
  return g().completeWorkOrder(wo.id, daysAgo(50))
}, { expect: 2 })   // materials into WIP, then WIP into finished goods

// ═══════════════════════════════════════════════════════════════════
// BANKING
// ═══════════════════════════════════════════════════════════════════

example('bank_payment', 'You pay a bill that has no invoice — the electricity', () =>
  g().addBankTransaction({
    type: 'money_out', bankAccountId: 'acc-bank1', accountId: 'acc-util',
    amount: 1800, date: daysAgo(45), description: 'Electricity — SEC', departmentId: DEPT.id,
  }), { expect: 1 })

example('bank_transfer', 'You move money into the petty cash tin', () =>
  g().addBankTransfer({
    fromAccountId: 'acc-bank1', toAccountId: 'acc-cash', amount: 5000, fee: 0,
    date: daysAgo(44), notes: 'Petty cash top-up',
  }), { expect: 1 })

// ═══════════════════════════════════════════════════════════════════
// COSTS THAT SPREAD OVER TIME
// ═══════════════════════════════════════════════════════════════════

const PREPAID = example('prepaid', 'You pay a year of insurance up front', () =>
  g().addPrepaidExpense({
    startDate: daysAgo(40), amount: 24000, months: 12, bankAccountId: 'acc-bank1',
    description: 'Annual vehicle and property insurance', expenseAccountId: 'acc-admin',
  }), { expect: 1 })

example('prepaid_amort', 'One month of that insurance becomes a cost', () =>
  g().amortizePrepaid(PREPAID.id, { date: monthEnd(1), amount: 2000, period: monthLabel(1) }),
  { expect: 1 })

const LEASE = example('lease', 'You take a lease on the showroom', () =>
  g().addLease({
    name: 'Riyadh showroom', landlord: 'Olaya Properties Co.', leaseType: 'operating',
    startDate: daysAgo(365), endDate: daysAhead(365), monthlyRent: 10000,
    bankAccountId: 'acc-bank1', expenseAccountId: 'acc-rent',
  }), { expect: 0 })

example('lease_payment', 'You pay a month’s rent', () =>
  g().recordLeasePayment(LEASE.id, { date: monthEnd(1), amount: 10000, period: monthLabel(1), bankAccountId: 'acc-bank1' }),
  { expect: 1 })

example('expense_claim', 'An employee claims back what they spent', () => {
  g().addExpenseClaim({
    employeeId: EMP.id, employeeName: EMP.name, date: daysAgo(30), amount: 1200,
    category: 'Travel', accountId: 'acc-admin', description: 'Jeddah client visit — flights and taxi', items: [],
  })
  const claim = last(g().expenseClaims)
  g().approveExpenseClaim(claim.id, { id: 'u2', name: 'Layla Mansour' })
  return g().payExpenseClaim(claim.id, 'acc-bank1', daysAgo(28))
}, { expect: 2 })   // the cost when approved, the cash when paid

// ═══════════════════════════════════════════════════════════════════
// FIXED ASSETS
// ═══════════════════════════════════════════════════════════════════

const ASSET = example('fixed_asset', 'You buy a delivery van', () =>
  g().addFixedAsset({
    name: 'Delivery Van — Toyota Hiace', category: 'Vehicles', purchaseDate: daysAgo(90),
    purchaseCost: 120000, salvageValue: 24000, usefulLifeYears: 8,
    depreciationMethod: 'straight_line', paymentType: 'cash', bankAccountId: 'acc-bank1',
  }), { expect: 1 })

example('depreciation', 'A month of depreciation is charged', () =>
  g().runDepreciation({ period: monthLabel(1), date: monthEnd(1) }), { expect: 1 })

// An old printer, bought and depreciated down to a book value of 500. Setup —
// the transaction being documented is the disposal itself.
g().addFixedAsset({
  name: 'Office Printer', category: 'IT Equipment', purchaseDate: daysAgo(1000),
  purchaseCost: 6000, salvageValue: 0, usefulLifeYears: 3,
  depreciationMethod: 'straight_line', paymentType: 'cash', bankAccountId: 'acc-bank1',
})
const PRINTER = last(g().fixedAssets)
g().recordDepreciation(PRINTER.id, { date: daysAgo(30), amount: 5500, period: 'Prior years' })

example('asset_disposal', 'You sell that printer for more than its book value', () =>
  g().disposeAsset(PRINTER.id, { date: daysAgo(20), proceeds: 1000, bankAccountId: 'acc-bank1' }),
  { expect: 1 })   // cost out, depreciation out, cash in, and the gain

// ═══════════════════════════════════════════════════════════════════
// PAYROLL
// ═══════════════════════════════════════════════════════════════════

const ADV = example('employee_advance', 'You lend an employee money against salary', () =>
  g().issueEmployeeAdvance({
    employeeId: EMP.id, employeeName: EMP.name, amount: 3000,
    date: daysAgo(35), bankAccountId: 'acc-bank1', instalment: 1000, notes: 'School fees',
  }), { expect: 1 })

example('payroll_process', 'You run payroll for the month', () => {
  const gosi = Math.round((8000 + 2000) * 0.0975 * 100) / 100
  const gross = 11000
  const run = g().addPayrollRun({
    period: monthLabel(1), periodMonth: monthKey(1), payDate: monthEnd(1),
    lines: [{
      employeeId: EMP.id, employeeName: EMP.name, name: EMP.name,
      basic: 8000, housing: 2000, transport: 1000, other: 0, overtime: 0, gross,
      late: 0, absent: 0, penalty: 0, gosi, tax: 0, loan: 1000,
      gosiEmployer: Math.round((8000 + 2000) * 0.1175 * 100) / 100,
      totalDeductions: gosi + 1000, net: gross - gosi - 1000,
    }],
  })
  g().processPayrollRun(run.id)
  return run
}, { expect: 1 })

example('payroll_paid', 'You pay the staff their net pay', () => {
  const run = last(g().payrollRuns)
  return g().payPayrollRun(run.id, 'acc-bank1', monthEnd(1))
}, { expect: 1 })

example('advance_writeoff', 'An advance you will never get back', () => {
  const a = g().issueEmployeeAdvance({
    employeeId: EMP.id, employeeName: EMP.name, amount: 800,
    date: daysAgo(25), bankAccountId: 'acc-bank1', instalment: 0, notes: 'Left without notice',
  })
  return g().writeOffEmployeeAdvance(a.id, { date: daysAgo(10), reason: 'Left without notice' })
}, { expect: 2 })   // issuing it, then writing it off

// ═══════════════════════════════════════════════════════════════════
// PERIODIC
// ═══════════════════════════════════════════════════════════════════

example('manual_journal', 'You accrue a cost the bill has not arrived for', () =>
  g().addJournalEntry({
    date: monthEnd(1), type: 'manual', description: 'Accrued audit fee',
    lines: [
      { accountId: 'acc-admin', debit: 4000, credit: 0, description: 'Audit fee accrual' },
      { accountId: 'acc-accrued', debit: 0, credit: 4000, description: 'Audit fee accrual' },
    ],
  }), { expect: 1 })

example('recurring_journal', 'A journal that posts itself every month', () => {
  g().addRecurringJournal({
    name: 'Monthly management charge', frequency: 'monthly', nextDate: monthEnd(1),
    lines: [
      { accountId: 'acc-admin', debit: 1500, credit: 0, description: 'Management charge' },
      { accountId: 'acc-accrued', debit: 0, credit: 1500, description: 'Management charge' },
    ],
  })
  return g().postRecurringJournal(last(g().recurringJournals).id, { onDate: monthEnd(1) })
}, { expect: 1 })

// The USD account and its funding are setup, not the transaction being shown.
g().addCurrency({ code: 'USD', name: 'US Dollar', symbol: '$', rate: 0.2667 })
g().addBankAccount({ name: 'USD Account', currency: 'USD', bankName: 'Riyad Bank' })
const USD_ACC = last(g().bankAccounts).accountId
g().addJournalEntry({
  date: daysAgo(15), type: 'manual', description: 'USD account funded — USD 10,000 at 3.75',
  lines: [
    { accountId: USD_ACC, debit: 37500, credit: 0, description: 'USD 10,000 at 3.75' },
    { accountId: 'acc-bank1', debit: 0, credit: 37500, description: 'USD 10,000 at 3.75' },
  ],
})

example('fx_reval', 'A foreign-currency account is restated at today’s rate', () =>
  g().postFxRevaluation({
    date: daysAgo(5), note: 'Month-end revaluation at 3.80',
    entries: [{ accountId: USD_ACC, currency: 'USD', fcBalance: 10000, rate: 3.8, currentBase: 37500, revaluedBase: 38000 }],
  }), { expect: 2 })   // the revaluation, and its automatic reversal the next day


// ── Arabic build ───────────────────────────────────────────────────
// Interface strings translate themselves; the books do not. Rename the chart
// of accounts and the master data so an Arabic reader sees Arabic journal
// entries rather than Arabic headings over English accounts.
const AR = process.env.GUIDE_LANG === 'ar'
let arabicNote = 'english build'
// Descriptions written by this seed (rather than generated by the store) can
// be Arabic too. The store's own templates cannot, from out here.
const DESC_AR = {
  'Owner capital injection': 'ضخّ رأس مال من المالك',
  'Accrued audit fee': 'استحقاق أتعاب المراجعة',
  'USD account funded — USD 10,000 at 3.75': 'تغذية حساب الدولار — 10,000 دولار بسعر 3.75',
}
if (AR) useStore.setState({ journalEntries: g().journalEntries.map((je) => (
  DESC_AR[je.description] ? { ...je, description: DESC_AR[je.description] } : je)) })
if (AR) {
  const { arabize, ACCOUNT_NAMES } = await import(`${DIR}/arabize.mjs`)
  const r = arabize(g, useStore)
  arabicNote = `renamed ${r.renamedAccounts} accounts; still english: ${r.stillEnglish.join(', ') || 'none'}`
  if (typeof MANIFEST !== 'undefined')
    MANIFEST.forEach((e) => e.entries.forEach((je) =>
      je.lines.forEach((l) => { l.account = ACCOUNT_NAMES[l.account] || l.account })))
}
const SUFFIX = AR ? '-ar' : ''

// ── Write out ──────────────────────────────────────────────────────
const s = g()
const data = s.exportData()
writeFileSync(`${DIR}/tx-backup${SUFFIX}.json`, JSON.stringify(data))
writeFileSync(`${DIR}/tx-manifest${SUFFIX}.json`, JSON.stringify(MANIFEST, null, 2))

const report = []
report.push(`examples: ${MANIFEST.length}`)
report.push(`journal entries: ${s.journalEntries.length}`)
const bad = s.journalEntries.filter((je) => {
  const dr = je.lines.reduce((a, l) => a + (l.debit || 0), 0)
  const cr = je.lines.reduce((a, l) => a + (l.credit || 0), 0)
  return Math.round((dr - cr) * 100) / 100 !== 0
})
report.push(`unbalanced: ${bad.length}`)
report.push(arabicNote)
if (problems.length) { report.push('PROBLEMS:'); problems.forEach((p) => report.push('  - ' + p)) }
else report.push('every example produced exactly the entries the guide claims')
writeFileSync(`${DIR}/tx-report${SUFFIX}.txt`, report.join('\n'))
