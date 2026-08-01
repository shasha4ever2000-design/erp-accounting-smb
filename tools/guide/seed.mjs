// Builds a rich demo company by driving the real store actions, then writes
// exportData() to a backup JSON that the app's Settings → Restore can load.
// Everything therefore goes through the real double-entry engine.
import { useStore } from '/home/user/erp-accounting-smb/src/store.js'
import { seedDemoData } from '/home/user/erp-accounting-smb/src/utils/demoData.js'
import { writeFileSync } from 'node:fs'
const DIR = process.env.GUIDE_DIR || '.guide-build'

const g = useStore.getState
const last = (a) => a[a.length - 1]
const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }
const monthStart = (back = 0) => { const d = new Date(); d.setMonth(d.getMonth() - back, 1); return iso(d) }
const monthEnd = (back = 0) => { const d = new Date(); d.setMonth(d.getMonth() - back + 1, 0); return iso(d) }
const monthLabel = (back = 0) => {
  const d = new Date(); d.setMonth(d.getMonth() - back, 1)
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
}
const monthKey = (back = 0) => { const d = new Date(); d.setMonth(d.getMonth() - back, 1); return iso(d).slice(0, 7) }

const REPORT = []
const say = (...a) => REPORT.push(a.join(' '))
const done = []
const fail = []
const step = (name, fn) => {
  try { fn(); done.push(name) }
  catch (e) { fail.push(`${name}: ${e.message}`) }
}

// ── Company identity ───────────────────────────────────────────────
step('company profile', () => {
  g().updateCompany({
    name: 'Northwind Trading Co.',
    nameAr: 'شركة نورث ويند التجارية',
    email: 'hello@northwind.example',
    phone: '+966 11 234 5678',
    address: '2140 King Fahd Road, Al Olaya, Riyadh 12214',
    taxNumber: '310123456700003',
    crNumber: '1010234567',
    currency: 'SAR',
    currencySymbol: 'SAR',
  })
})

// ── The built-in four-month trading story ──────────────────────────
step('sample trading company', () => { seedDemoData(g) })

// ── Capital and a real trading year ────────────────────────────────
// The built-in sample company is deliberately tiny. A guide wants a business
// that looks like a going concern: enough capital to fund the stock, and
// enough sales to show a profit rather than a loss.
step('working capital', () => {
  g().addJournalEntry({
    date: daysAgo(119), type: 'manual', description: 'Additional capital — partner contribution',
    lines: [
      { accountId: 'acc-bank1', debit: 250000, credit: 0, description: 'Partner capital' },
      { accountId: 'acc-capital', debit: 0, credit: 250000, description: 'Partner capital' },
    ],
  })
})

const cust = () => g().customers
const supp = () => g().suppliers
const items = () => g().inventoryItems

const byCode = (code) => g().inventoryItems.find((i) => i.code === code)
const RATE = 15
const vat = (n) => Math.round(n * RATE) / 100

step('stock purchase', () => {
  const chair = byCode('CH-01'), desk = byCode('DK-02'), cab = byCode('FC-03')
  const rows = [
    { it: chair, qty: 700, price: 120 },
    { it: desk,  qty: 300, price: 400 },
    { it: cab,   qty: 150, price: 150 },
  ]
  const sub = rows.reduce((s2, r) => s2 + r.qty * r.price, 0)
  const p = g().addPurchase({
    supplierId: supp()[0].id, supplierName: supp()[0].name, date: daysAgo(100), dueDate: daysAgo(70),
    items: rows.map((r) => ({ description: r.it.name, quantity: r.qty, unitPrice: r.price, taxRate: RATE, subtotal: r.qty * r.price, itemId: r.it.id, accountId: 'acc-inv' })),
    subtotal: sub, taxAmount: vat(sub), total: sub + vat(sub),
  })
  // Part-paid, so Accounts Payable and the supplier ageing have something real.
  g().recordPurchasePayment(p.id, { date: daysAgo(92), amount: 180000, bankAccountId: 'acc-bank1', wht: 0 })
})

step('trading sales', () => {
  const chair = byCode('CH-01'), desk = byCode('DK-02'), cab = byCode('FC-03')
  const line = (it, q, price) => ({ description: it.name, quantity: q, unitPrice: price, taxRate: RATE, subtotal: q * price, itemId: it.id, accountId: 'acc-sales' })
  const sale = (c, ago, dueIn, lines, paid) => {
    const sub = lines.reduce((s2, l) => s2 + l.subtotal, 0)
    const inv = g().addInvoice({
      customerId: c.id, customerName: c.name, date: daysAgo(ago),
      dueDate: dueIn >= 0 ? daysAhead(dueIn) : daysAgo(-dueIn),
      items: lines, subtotal: sub, taxAmount: vat(sub), total: sub + vat(sub),
    })
    if (paid) g().recordInvoicePayment(inv.id, { date: daysAgo(Math.max(1, ago - 12)), amount: inv.total, bankAccountId: 'acc-bank1' })
    return inv
  }
  const [c1, c2, c3] = cust()
  sale(c1, 88, -58, [line(chair, 350, 250)], true)
  sale(c2, 62, -32, [line(desk, 180, 750)], true)
  sale(c3, 36, -6,  [line(cab, 120, 320)], true)
  sale(c1, 16, 14,  [line(desk, 60, 750)], false)
  sale(c2, 6,  24,  [line(chair, 90, 250)], false)
})

// ── Warehouses ─────────────────────────────────────────────────────
step('warehouses', () => {
  g().addWarehouse({ name: 'Riyadh Main Store', location: 'Riyadh — Industrial City 2' })
  g().addWarehouse({ name: 'Jeddah Branch', location: 'Jeddah — Al Khumrah' })
})

// ── HR: departments, employees, contracts, attendance, payroll ─────
step('departments', () => {
  g().addDepartment({ name: 'Sales', code: 'SLS' })
  g().addDepartment({ name: 'Warehouse', code: 'WHS' })
  g().addDepartment({ name: 'Finance', code: 'FIN' })
})

let emps = []
step('employees', () => {
  const deps = g().departments
  const rows = [
    { name: 'Yusuf Haddad', position: 'Sales Manager', basicSalary: 9000, housingAllowance: 2250, transportAllowance: 750, gosiApplicable: true, gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75 },
    { name: 'Layla Mansour', position: 'Accountant', basicSalary: 7000, housingAllowance: 1750, transportAllowance: 600, gosiApplicable: true, gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75 },
    { name: 'Omar Farouk', position: 'Storekeeper', basicSalary: 4500, housingAllowance: 1125, transportAllowance: 500, gosiApplicable: false },
  ]
  rows.forEach((r, i) => {
    g().addEmployee({
      ...r, status: 'active',
      // The list and the payroll KPI read `salary` (gross); the breakdown feeds
      // the contract. Both have to be set.
      salary: r.basicSalary + r.housingAllowance + r.transportAllowance, email: r.name.split(' ')[0].toLowerCase() + '@northwind.example',
      phone: '05' + (50000000 + i * 111111), startDate: daysAgo(600 - i * 90),
      departmentId: deps[i % deps.length]?.id || '', employmentType: 'full-time', payFrequency: 'monthly',
    })
  })
  emps = g().employees.slice(-3)
  // The built-in sample employees predate the salary breakdown; give them a
  // gross figure too so the register does not read zero.
  g().employees.filter((e) => !e.salary && e.basicSalary).forEach((e) => g().updateEmployee(e.id, { salary: e.basicSalary, status: e.status || 'active' }))
})

step('employment contracts', () => {
  emps.forEach((e, i) => g().addContract({
    employeeId: e.id, startDate: daysAgo(600 - i * 90), type: 'unlimited',
    basic: e.basicSalary, housing: e.housingAllowance, transport: e.transportAllowance, other: 0,
    workDaysPerWeek: 5, dailyHours: 8, annualLeaveDays: 21, overtimeMultiplier: 1.5,
    gosiApplicable: !!e.gosiApplicable, gosiEmployeeRate: 9.75, gosiEmployerRate: 11.75,
  }))
})

step('attendance', () => {
  const period = monthKey(1)
  const [y, m] = period.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  emps.forEach((e, idx) => {
    const days = []
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${period}-${String(d).padStart(2, '0')}`
      const dow = new Date(date).getDay()
      if (dow === 5 || dow === 6) { days.push({ date, status: 'weekend' }); continue }
      if (idx === 2 && d === 12) { days.push({ date, status: 'absent' }); continue }
      if (idx === 0 && d === 7) { days.push({ date, status: 'present', overtimeHours: 3 }); continue }
      if (idx === 1 && d === 19) { days.push({ date, status: 'present', lateMinutes: 45 }); continue }
      days.push({ date, status: 'present' })
    }
    g().saveAttendanceSheet(e.id, period, days)
  })
})

step('payroll runs', () => {
  for (const back of [2, 1]) {
    const lines = emps.map((e) => {
      const basic = e.basicSalary, housing = e.housingAllowance, transport = e.transportAllowance
      const gross = basic + housing + transport
      const gosi = e.gosiApplicable ? Math.round((basic + housing) * 0.0975 * 100) / 100 : 0
      return {
        employeeId: e.id, employeeName: e.name, name: e.name,
        basic, housing, transport, other: 0, overtime: 0, gross,
        late: 0, absent: 0, penalty: 0, gosi, tax: 0, loan: 0,
        gosiEmployer: e.gosiApplicable ? Math.round((basic + housing) * 0.1175 * 100) / 100 : 0,
        totalDeductions: gosi, net: gross - gosi,
      }
    })
    const run = g().addPayrollRun({ period: monthLabel(back), periodMonth: monthKey(back), payDate: monthEnd(back), lines })
    g().processPayrollRun(run.id)
    g().payPayrollRun(run.id, 'acc-bank1', monthEnd(back))
  }
})

step('employee advances', () => {
  const adv = g().issueEmployeeAdvance({
    employeeId: emps[2].id, employeeName: emps[2].name, amount: 3000,
    date: daysAgo(75), bankAccountId: 'acc-bank1', instalment: 500,
    notes: 'Advance against salary — school fees',
  })
  g().repayEmployeeAdvance(adv.id, { amount: 500, date: daysAgo(45), bankAccountId: 'acc-bank1' })
  g().issueEmployeeAdvance({
    employeeId: emps[0].id, employeeName: emps[0].name, amount: 1200,
    date: daysAgo(20), bankAccountId: 'acc-bank1', instalment: 400, notes: 'Travel advance',
  })
})

// ── Fixed assets ───────────────────────────────────────────────────
step('fixed assets', () => {
  g().addFixedAsset({ name: 'Delivery Van — Toyota Hiace', category: 'Vehicles', purchaseDate: daysAgo(400), purchaseCost: 92000, salvageValue: 12000, usefulLifeYears: 6, depreciationMethod: 'straight_line', paymentType: 'credit' })
  g().addFixedAsset({ name: 'Warehouse Racking', category: 'Equipment', purchaseDate: daysAgo(300), purchaseCost: 34000, salvageValue: 0, usefulLifeYears: 10, depreciationMethod: 'straight_line', paymentType: 'cash', bankAccountId: 'acc-bank1' })
  g().addFixedAsset({ name: 'Office Laptops (5)', category: 'IT Equipment', purchaseDate: daysAgo(180), purchaseCost: 21000, salvageValue: 1000, usefulLifeYears: 3, depreciationMethod: 'straight_line', paymentType: 'cash', bankAccountId: 'acc-bank1' })
  for (const back of [2, 1]) g().runDepreciation({ period: monthLabel(back), date: monthEnd(back) })
})

// ── Projects & time ────────────────────────────────────────────────
step('projects', () => {
  g().addProject({ name: 'Al-Faisaliah Fit-out', client: 'Al-Noor Trading Est.', budget: 120000, startDate: daysAgo(90), status: 'active', notes: 'Shop fit-out, two phases' })
  g().addProject({ name: 'Annual Maintenance Contract', client: 'Gulf Star LLC', budget: 48000, startDate: daysAgo(200), status: 'active' })
  const p = g().projects[0]
  ;[6, 8, 4, 7].forEach((hours, i) => g().addTimeEntry({
    projectId: p.id, employeeId: emps[i % emps.length].id, employeeName: emps[i % emps.length].name,
    date: daysAgo(20 - i * 3), hours, rate: 180, description: ['Site survey', 'Joinery install', 'Electrical 1st fix', 'Snagging'][i],
  }))
})

// ── Budgets ────────────────────────────────────────────────────────
step('budgets', () => {
  const year = new Date().getFullYear()
  const plan = { 'acc-salary': 380000, 'acc-rent': 120000, 'acc-util': 36000, 'acc-admin': 60000 }
  Object.entries(plan).forEach(([acc, amt]) => { if (g().accounts.some((a) => a.id === acc)) g().setBudget(acc, year, amt) })
})

// ── Prepaid, leases, expense claims ────────────────────────────────
step('prepaid expenses', () => {
  g().addPrepaidExpense({ startDate: monthStart(3), amount: 18000, months: 12, bankAccountId: 'acc-bank1', description: 'Annual vehicle & property insurance', expenseAccountId: 'acc-admin' })
})

step('leases', () => {
  const l = g().addLease({
    name: 'Riyadh showroom', landlord: 'Olaya Properties Co.', leaseType: 'operating',
    startDate: daysAgo(365), endDate: daysAhead(365), monthlyRent: 10000,
    bankAccountId: 'acc-bank1', expenseAccountId: 'acc-rent', notes: 'Annual, paid monthly',
  })
  for (const back of [2, 1]) g().recordLeasePayment(l.id, { date: monthEnd(back), amount: 10000, period: monthLabel(back), bankAccountId: 'acc-bank1' })
})

step('expense claims', () => {
  const exp = g().accounts.find((a) => a.id === 'acc-admin') || g().accounts.find((a) => a.type === 'expense')
  const c1 = g().addExpenseClaim({ employeeId: emps[0].id, employeeName: emps[0].name, date: daysAgo(25), amount: 860, category: 'Travel', accountId: exp.id, description: 'Jeddah client visit — flights & taxi', items: [] })
  const claim1 = c1 || last(g().expenseClaims)
  g().approveExpenseClaim(claim1.id, { id: 'u1', name: 'Layla Mansour' })
  g().payExpenseClaim(claim1.id, 'acc-bank1', daysAgo(18))
  g().addExpenseClaim({ employeeId: emps[1].id, employeeName: emps[1].name, date: daysAgo(6), amount: 320, category: 'Office supplies', accountId: exp.id, description: 'Printer toner and stationery', items: [] })
})

// ── Manufacturing ──────────────────────────────────────────────────
step('manufacturing', () => {
  const steel = g().addInventoryItem({ name: 'Steel sheet 2mm', code: 'RM-STEEL', costPrice: 42, salePrice: 0, quantity: 0, unit: 'sheet', type: 'stock' }) || last(items())
  const paint = g().addInventoryItem({ name: 'Powder coating', code: 'RM-PAINT', costPrice: 18, salePrice: 0, quantity: 0, unit: 'kg', type: 'stock' }) || last(items())
  // Buy the raw materials properly so Raw Materials carries value, not just a
  // quantity — a work order that consumes unbought stock posts a negative.
  const rmSub = 400 * 42 + 200 * 18
  const rmPo = g().addPurchase({
    supplierId: supp()[1]?.id || supp()[0].id, supplierName: supp()[1]?.name || supp()[0].name,
    date: daysAgo(40), dueDate: daysAgo(10),
    items: [
      { description: 'Steel sheet 2mm', quantity: 400, unitPrice: 42, taxRate: 15, subtotal: 400 * 42, itemId: steel.id, accountId: 'acc-rawmat' },
      { description: 'Powder coating', quantity: 200, unitPrice: 18, taxRate: 15, subtotal: 200 * 18, itemId: paint.id, accountId: 'acc-rawmat' },
    ],
    subtotal: rmSub, taxAmount: Math.round(rmSub * 15) / 100, total: rmSub + Math.round(rmSub * 15) / 100,
  })
  g().recordPurchasePayment(rmPo.id, { date: daysAgo(35), amount: rmSub + Math.round(rmSub * 15) / 100, bankAccountId: 'acc-bank1', wht: 0 })
  const shelf = g().addInventoryItem({ name: 'Steel shelving unit', code: 'FG-SHELF', costPrice: 0, salePrice: 340, quantity: 0, unit: 'ea', type: 'stock' }) || last(items())
  g().addBOM({ outputItemId: shelf.id, outputName: shelf.name, outputQuantity: 1, components: [
    { itemId: steel.id, name: steel.name, quantity: 3, unitCost: 42 },
    { itemId: paint.id, name: paint.name, quantity: 0.5, unitCost: 18 },
  ] })
  const wo = g().addWorkOrder({
    outputItemId: shelf.id, outputName: shelf.name, outputQuantity: 1, targetQuantity: 25,
    startDate: daysAgo(30), components: [
      { itemId: steel.id, name: steel.name, quantity: 3, unitCost: 42, materialAccountId: 'acc-rawmat' },
      { itemId: paint.id, name: paint.name, quantity: 0.5, unitCost: 18, materialAccountId: 'acc-rawmat' },
    ],
    wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods',
  })
  g().completeWorkOrder(wo.id, daysAgo(22))
  g().addWorkOrder({
    outputItemId: shelf.id, outputName: shelf.name, outputQuantity: 1, targetQuantity: 40,
    startDate: daysAgo(5), components: [
      { itemId: steel.id, name: steel.name, quantity: 3, unitCost: 42, materialAccountId: 'acc-rawmat' },
      { itemId: paint.id, name: paint.name, quantity: 0.5, unitCost: 18, materialAccountId: 'acc-rawmat' },
    ],
    wipAccountId: 'acc-wip', finGoodsAccountId: 'acc-fingoods',
  })
})

// ── Sales pipeline, orders, delivery notes ─────────────────────────
step('crm leads', () => {
  ;[
    { company: 'Riyadh Hotels Group', contact: 'Hind Al-Otaibi', email: 'hind@rhg.example', value: 85000, stage: 'proposal', source: 'Referral' },
    { company: 'Desert Logistics', contact: 'Faisal Nasser', email: 'faisal@desertlog.example', value: 42000, stage: 'qualified', source: 'Website' },
    { company: 'Najd Interiors', contact: 'Sara Kamal', email: 'sara@najd.example', value: 26000, stage: 'new', source: 'Trade show' },
    { company: 'Coastal Retail', contact: 'Bandar Zahrani', email: 'bandar@coastal.example', value: 61000, stage: 'won', source: 'Cold call' },
  ].forEach((l) => g().addLead(l))
})

step('sales orders', () => {
  const c = cust()[0], it = items()[0]
  const line = { id: 'so1', itemId: it.id, description: it.name, quantity: 12, unitPrice: it.salePrice || 250, discount: 0, taxRate: 15 }
  const sub = line.quantity * line.unitPrice
  const so = g().addSalesOrder({
    customerId: c.id, customerName: c.name, date: daysAgo(12), expectedDate: daysAhead(10),
    items: [{ ...line, subtotal: sub, taxAmount: sub * 0.15, total: sub * 1.15 }],
    subtotal: sub, taxAmount: sub * 0.15, total: sub * 1.15, notes: 'Deliver to Olaya branch',
  })
  g().convertSalesOrderToDeliveryNote(so.id, { so1: 6 })
  const c2 = cust()[1]
  const l2 = { id: 'so2', itemId: items()[1].id, description: items()[1].name, quantity: 30, unitPrice: items()[1].salePrice || 90, discount: 0, taxRate: 15 }
  const s2 = l2.quantity * l2.unitPrice
  g().addSalesOrder({
    customerId: c2.id, customerName: c2.name, date: daysAgo(4), expectedDate: daysAhead(20),
    items: [{ ...l2, subtotal: s2, taxAmount: s2 * 0.15, total: s2 * 1.15 }],
    subtotal: s2, taxAmount: s2 * 0.15, total: s2 * 1.15,
  })
})

// ── Purchasing: requisition → PO → goods receipt ───────────────────
step('requisitions', () => {
  const r = g().addRequisition({
    requestedBy: 'Omar Farouk', department: 'Warehouse', supplierName: supp()[0]?.name || '',
    date: daysAgo(15), neededBy: daysAhead(5), notes: 'Restock before the Eid season',
    items: [
      { description: items()[0].name, quantity: 40, estPrice: 120 },
      { description: 'Packing materials', quantity: 200, estPrice: 4 },
    ],
    total: 40 * 120 + 200 * 4,
  })
  g().approveRequisition(r.id, { id: 'u1', name: 'Layla Mansour' })
})

step('purchase orders', () => {
  const s = supp()[0], it = items()[0]
  const qty = 60, price = it.costPrice || 120
  const po = g().addPurchaseOrder({
    supplierId: s.id, supplierName: s.name, date: daysAgo(18), expectedDate: daysAhead(4),
    items: [{ id: 'P1', itemId: it.id, description: it.name, quantity: qty, unitPrice: price, discount: 0, taxRate: 15, accountId: 'acc-inventory' }],
    subtotal: qty * price, taxAmount: qty * price * 0.15, total: qty * price * 1.15,
  })
  g().receiveGoods(po.id, { P1: 40 }, { date: daysAgo(9) })
  const s2 = supp()[1] || s
  g().addPurchaseOrder({
    supplierId: s2.id, supplierName: s2.name, date: daysAgo(3), expectedDate: daysAhead(14),
    items: [{ id: 'P2', description: 'Shelving brackets', quantity: 150, unitPrice: 22, discount: 0, taxRate: 15, accountId: 'acc-admin' }],
    subtotal: 3300, taxAmount: 495, total: 3795,
  })
})

step('purchase quotes', () => {
  const s = supp()[0]
  g().addPurchaseQuote({
    supplierId: s.id, supplierName: s.name, date: daysAgo(8), validUntil: daysAhead(22),
    items: [{ id: 'Q1', description: 'Forklift — 2.5t, 3-year warranty', quantity: 1, unitPrice: 78000, discount: 0, taxRate: 15 }],
    subtotal: 78000, taxAmount: 11700, total: 89700, notes: 'Includes delivery and operator training',
  })
})

// ── Cheques & customer advances ────────────────────────────────────
step('cheques', () => {
  const c = cust()[0]
  g().addCheque({
    direction: 'received', number: '400218', bankName: 'Al Rajhi Bank', amount: 4000,
    issueDate: daysAgo(10), dueDate: daysAhead(20), partyId: c.id, partyName: c.name,
    bankAccountId: 'acc-bank1', notes: 'Part settlement of INV-0002',
  })
  const s = supp()[0]
  g().addCheque({
    direction: 'issued', number: '900771', bankName: 'Saudi National Bank', amount: 9500,
    issueDate: daysAgo(6), dueDate: daysAhead(24), partyId: s.id, partyName: s.name,
    bankAccountId: 'acc-bank1', notes: 'Against PO-0001',
  })
  const inb = g().cheques.find((c) => c.direction === 'received')
  if (inb) g().setChequeStatus(inb.id, 'deposited', { date: daysAgo(3) })
})

step('customer advances', () => {
  const c = cust()[1]
  g().receiveAdvance({
    customerId: c.id, customerName: c.name, amount: 15000, date: daysAgo(14),
    bankAccountId: 'acc-bank1', reference: 'Deposit for the fit-out order', notes: '30% up front',
  })
})

// ── Recurring ──────────────────────────────────────────────────────
step('recurring', () => {
  const c = cust()[1]
  g().addRecurringInvoice({
    customerId: c.id, customerName: c.name, frequency: 'monthly', nextDate: daysAhead(9),
    items: [{ description: 'Annual maintenance contract — monthly', quantity: 1, unitPrice: 4000, taxRate: 15, subtotal: 4000, taxAmount: 600, total: 4600 }],
    subtotal: 4000, taxAmount: 600, total: 4600,
  })
  g().addRecurringJournal({
    name: 'Depreciation accrual', frequency: 'monthly', nextDate: daysAhead(12),
    lines: [{ accountId: 'acc-admin', debit: 1500, credit: 0 }, { accountId: 'acc-ap', debit: 0, credit: 1500 }],
  })
  g().addRecurringExpense({
    name: 'Internet & telephone', frequency: 'monthly', nextDate: daysAhead(6),
    amount: 890, expenseAccountId: 'acc-util', bankAccountId: 'acc-bank1', supplierName: 'STC Business',
  })
})

// ── Banking extras ─────────────────────────────────────────────────
step('bank transfers & transactions', () => {
  g().addBankTransfer({ fromAccountId: 'acc-bank1', toAccountId: 'acc-cash', amount: 5000, fee: 0, date: daysAgo(21), notes: 'Petty cash top-up' })
  g().addBankTransaction({ type: 'money_out', bankAccountId: 'acc-bank1', accountId: 'acc-util', amount: 1240, date: daysAgo(11), description: 'Electricity — SEC' })
  g().addBankTransaction({ type: 'money_out', bankAccountId: 'acc-bank1', accountId: 'acc-admin', amount: 690, date: daysAgo(5), description: 'Cleaning services' })
})

// ── Stock: count, transfer, adjustment ─────────────────────────────
step('stock movements', () => {
  const whs = g().warehouses
  if (whs.length >= 2) g().addStockTransfer({ itemId: items()[0].id, fromWarehouseId: whs[0].id, toWarehouseId: whs[1].id, quantity: 5, date: daysAgo(7), notes: 'Jeddah showroom display' })
  g().addStockAdjustment({ itemId: items()[1].id, itemName: items()[1].name, type: 'decrease', quantity: 2, reason: 'Damaged in handling', date: daysAgo(13), createdBy: 'u1', createdByName: 'Omar Farouk' })
  const adj = last(g().stockAdjustments)
  g().approveStockAdjustment(adj.id, { id: 'u2', name: 'Layla Mansour' })
  g().startStockCount({ date: daysAgo(2), notes: 'Quarterly count — main store' })
})

// ── Currencies ─────────────────────────────────────────────────────
step('currencies', () => {
  g().addCurrency({ code: 'USD', name: 'US Dollar', symbol: '$', rate: 0.2667 })
  g().addCurrency({ code: 'EUR', name: 'Euro', symbol: '€', rate: 0.2450 })
  g().addCurrency({ code: 'AED', name: 'UAE Dirham', symbol: 'AED', rate: 0.9793 })
})


// ── Arabic build ───────────────────────────────────────────────────
// Interface strings translate themselves; the books do not. Rename the chart
// of accounts and the master data so an Arabic reader sees Arabic journal
// entries rather than Arabic headings over English accounts.
const AR = process.env.GUIDE_LANG === 'ar'
let arabicNote = 'english build'
if (AR) {
  const { arabize, ACCOUNT_NAMES } = await import(`${DIR}/arabize.mjs`)
  const r = arabize(g, useStore)
  arabicNote = `renamed ${r.renamedAccounts} accounts; still english: ${r.stillEnglish.join(', ') || 'none'}`
  if (typeof MANIFEST !== 'undefined')
    MANIFEST.forEach((e) => e.entries.forEach((je) =>
      je.lines.forEach((l) => { l.account = ACCOUNT_NAMES[l.account] || l.account })))
}
const SUFFIX = AR ? '-ar' : ''

// ── Write it out ───────────────────────────────────────────────────
const data = g().exportData()
writeFileSync(`${DIR}/demo-backup${SUFFIX}.json`, JSON.stringify(data))

say('seeded  :', done.length, 'steps')
if (fail.length) { say('FAILED  :'); fail.forEach((f) => say('  -', f)) }
const s = g()
say('counts  :', JSON.stringify({
  accounts: s.accounts.length, customers: s.customers.length, suppliers: s.suppliers.length,
  items: s.inventoryItems.length, invoices: s.invoices.length, purchases: s.purchases.length,
  journalEntries: s.journalEntries.length, employees: s.employees.length, payrollRuns: s.payrollRuns.length,
  fixedAssets: s.fixedAssets.length, projects: s.projects.length, leases: s.leases.length,
  workOrders: s.workOrders.length, salesOrders: s.salesOrders.length, purchaseOrders: s.purchaseOrders.length,
  leads: s.leads.length, cheques: s.cheques.length, employeeAdvances: s.employeeAdvances.length,
  warehouses: s.warehouses.length, expenseClaims: s.expenseClaims.length, budgets: s.budgets.length,
}, null, 0))
// Every entry must balance — the guide must not show broken books.
const bad = s.journalEntries.filter((je) => {
  const dr = je.lines.reduce((a, l) => a + (l.debit || 0), 0)
  const cr = je.lines.reduce((a, l) => a + (l.credit || 0), 0)
  return Math.round((dr - cr) * 100) / 100 !== 0
})
say('unbalanced entries:', bad.length)
say('arabic:', arabicNote)
const bal = s.getAllBalances()
const net = (id) => { const b = bal[id] || { dr: 0, cr: 0 }; return Math.round((b.dr - b.cr) * 100) / 100 }
const sumType = (type) => Math.round(s.accounts.filter((a) => a.type === type)
  .reduce((t, a) => t + net(a.id), 0) * 100) / 100
say('bank    :', net('acc-bank1'))
say('AR      :', net('acc-ar'))
say('AP      :', net('acc-ap'))
say('revenue :', -sumType('revenue'))
say('expenses:', sumType('expense'))
say('profit  :', Math.round((-sumType('revenue') - sumType('expense')) * 100) / 100)
const negatives = ['acc-bank1', 'acc-ar', 'acc-inv', 'acc-rawmat', 'acc-fingoods'].filter((id) => net(id) < 0)
say('negative where it should not be:', negatives.join(', ') || 'none')
writeFileSync(`${DIR}/seed-report${SUFFIX}.txt`, REPORT.join('\n'))
