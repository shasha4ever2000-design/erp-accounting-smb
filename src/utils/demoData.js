// One-click sample company. Seeds a realistic four-month trading story through
// the real store actions (so every posting goes through the double-entry
// engine and all invariants hold): capital, stock purchases, sales in every
// payment state, monthly running costs, a landed cost and a credit note.
// Dates are relative to today so charts and agings always look alive.
//
// Only ever runs on an empty company — it refuses if any books exist.

const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }

export function isCompanyEmpty(s) {
  return (s.journalEntries?.length || 0) === 0 && (s.invoices?.length || 0) === 0 &&
    (s.customers?.length || 0) === 0 && (s.purchases?.length || 0) === 0
}

/**
 * Seed the demo company. `getState` is the zustand store's getState.
 * Returns a summary { customers, invoices, purchases, journalEntries }.
 */
export function seedDemoData(getState) {
  const g = getState
  if (!isCompanyEmpty(g())) throw new Error('DEMO_NOT_EMPTY')
  const last = (a) => a[a.length - 1]

  // ── Opening capital ─────────────────────────────────────────────
  g().addJournalEntry({
    date: daysAgo(120), type: 'manual', description: 'Owner capital injection',
    lines: [
      { accountId: 'acc-bank1', debit: 50000, credit: 0, description: 'Opening capital' },
      { accountId: 'acc-capital', debit: 0, credit: 50000, description: 'Opening capital' },
    ],
  })

  // ── Master data ─────────────────────────────────────────────────
  g().addCustomer({ name: 'Al-Noor Trading Est.', email: 'accounts@alnoor.example', phone: '0501234567' })
  const c1 = last(g().customers)
  g().addCustomer({ name: 'Gulf Star LLC', email: 'finance@gulfstar.example', phone: '0559876543' })
  const c2 = last(g().customers)
  g().addCustomer({ name: 'Desert Rose Café', phone: '0533334444' })
  const c3 = last(g().customers)

  g().addSupplier({ name: 'Riyadh Supplies Co', email: 'sales@riyadhsupplies.example' })
  const s1 = last(g().suppliers)
  g().addSupplier({ name: 'Jeddah Import House' })
  const s2 = last(g().suppliers)

  g().addDepartment({ name: 'Operations' }); const dept = last(g().departments)
  g().addEmployee?.({ name: 'Ahmed Al-Salem', basicSalary: 7000, departmentId: dept.id })
  g().addEmployee?.({ name: 'Sara Hassan', basicSalary: 9500, departmentId: dept.id })

  g().addInventoryItem({ name: 'Office Chair', code: 'CH-01', costPrice: 120, salePrice: 250, quantity: 0, unit: 'ea' })
  const chair = last(g().inventoryItems)
  g().addInventoryItem({ name: 'Standing Desk', code: 'DK-02', costPrice: 400, salePrice: 750, quantity: 0, unit: 'ea' })
  const desk = last(g().inventoryItems)
  g().addInventoryItem({ name: 'Filing Cabinet', code: 'FC-03', costPrice: 150, salePrice: 320, quantity: 0, unit: 'ea' })
  const cabinet = last(g().inventoryItems)

  const rate = Number(g().settings.tax?.rate ?? 15)
  const vat = (n) => Math.round(n * rate) / 100

  // ── Stock in: two purchases (one settled, one on credit) ────────
  const p1 = g().addPurchase({
    supplierId: s1.id, supplierName: s1.name, date: daysAgo(110), dueDate: daysAgo(80), departmentId: dept.id,
    items: [
      { description: 'Office Chair', quantity: 60, unitPrice: 120, taxRate: rate, subtotal: 7200, itemId: chair.id, accountId: 'acc-inv' },
      { description: 'Filing Cabinet', quantity: 25, unitPrice: 150, taxRate: rate, subtotal: 3750, itemId: cabinet.id, accountId: 'acc-inv' },
    ],
    subtotal: 10950, taxAmount: vat(10950), total: 10950 + vat(10950),
  })
  g().recordPurchasePayment(p1.id, { date: daysAgo(100), amount: 10950 + vat(10950), bankAccountId: 'acc-bank1', wht: 0 })

  g().addPurchase({
    supplierId: s2.id, supplierName: s2.name, date: daysAgo(45), dueDate: daysAhead(15), departmentId: dept.id,
    items: [{ description: 'Standing Desk', quantity: 20, unitPrice: 400, taxRate: rate, subtotal: 8000, itemId: desk.id, accountId: 'acc-inv' }],
    subtotal: 8000, taxAmount: vat(8000), total: 8000 + vat(8000),
  })

  // Freight on the desk shipment, capitalised into inventory value.
  try {
    g().postLandedCost?.({
      date: daysAgo(43), reference: 'DHL-88231', method: 'value', amount: 600, creditAccountId: 'acc-bank1',
      lines: [{ itemId: desk.id, qty: 20 }],
    })
  } catch { /* landed cost is optional garnish */ }

  // ── Sales: every payment state the dashboards care about ────────
  const mkInv = (cust, ago, dueIn, items) => {
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    return g().addInvoice({
      customerId: cust.id, customerName: cust.name, date: daysAgo(ago), dueDate: dueIn >= 0 ? daysAhead(dueIn) : daysAgo(-dueIn),
      departmentId: dept.id, items, subtotal, taxAmount: vat(subtotal), total: subtotal + vat(subtotal),
    })
  }
  const line = (item, q, p) => ({ description: item.name, quantity: q, unitPrice: p, taxRate: rate, subtotal: q * p, itemId: item.id, accountId: 'acc-sales' })

  const i1 = mkInv(c1, 95, -65, [line(chair, 20, 250), line(cabinet, 10, 320)])   // paid long ago
  g().recordInvoicePayment(i1.id, { date: daysAgo(85), amount: i1.total, bankAccountId: 'acc-bank1' })

  const i2 = mkInv(c2, 60, -30, [line(chair, 15, 250)])                            // paid
  g().recordInvoicePayment(i2.id, { date: daysAgo(50), amount: i2.total, bankAccountId: 'acc-bank1' })

  const i3 = mkInv(c1, 40, -10, [line(desk, 8, 750)])                              // overdue, partially paid
  g().recordInvoicePayment(i3.id, { date: daysAgo(25), amount: 3000, bankAccountId: 'acc-bank1' })

  mkInv(c3, 12, 18, [line(chair, 6, 250), line(cabinet, 4, 320)])                  // open, not yet due
  mkInv(c2, 5, 25, [line(desk, 5, 750)])                                           // fresh

  // A small return against the first sale.
  g().addCreditNote({
    customerId: c1.id, customerName: c1.name, date: daysAgo(80),
    subtotal: 500, taxAmount: vat(500), total: 500 + vat(500), items: [],
  })

  // ── Running costs: rent + utilities for the last three months ───
  const rent = g().accounts.find((a) => a.type === 'expense' && /rent/i.test(a.name)) || g().accounts.find((a) => a.type === 'expense')
  const util = g().accounts.find((a) => a.type === 'expense' && /utilit/i.test(a.name)) || rent
  ;[75, 45, 15].forEach((ago) => {
    g().addBankTransaction({ type: 'money_out', bankAccountId: 'acc-bank1', accountId: rent.id, amount: 2600, date: daysAgo(ago), description: 'Office rent', departmentId: dept.id })
    g().addBankTransaction({ type: 'money_out', bankAccountId: 'acc-bank1', accountId: util.id, amount: 420, date: daysAgo(ago - 2), description: 'Utilities', departmentId: dept.id })
  })

  // An open quotation in the pipeline.
  g().addQuotation({
    customerId: c3.id, customerName: c3.name, date: daysAgo(3),
    items: [{ description: 'Standing Desk', quantity: 4, unitPrice: 750, subtotal: 3000 }],
    subtotal: 3000, taxAmount: vat(3000), total: 3000 + vat(3000),
  })

  const s = g()
  return { customers: s.customers.length, invoices: s.invoices.length, purchases: s.purchases.length, journalEntries: s.journalEntries.length }
}
