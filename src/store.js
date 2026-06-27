import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { currentCompanyKey } from './boot'
import { useAuth } from './auth'

// Quota-safe storage: never let a full localStorage throw and crash the app.
const safeStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch (e) {
      console.warn('ERP: could not save to local storage (it may be full).', e)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('erp-storage-error'))
      }
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
}

const DEFAULT_ACCOUNTS = [
  // ASSETS – Current
  { id: 'acc-cash',    code: '1001', name: 'Cash on Hand',              type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-bank1',  code: '1002', name: 'Main Bank Account',          type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-ar',     code: '1100', name: 'Accounts Receivable',        type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-vatin',  code: '1300', name: 'Tax Receivable (Input)',      type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-inv',    code: '1400', name: 'Inventory',                   type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-rawmat', code: '1410', name: 'Raw Materials',               type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-wip',    code: '1420', name: 'Work-in-Progress',            type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-fingoods',code:'1430', name: 'Finished Goods',              type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-prepaid',code: '1500', name: 'Prepaid Expenses',            type: 'asset',     subtype: 'current',     isSystem: false },
  // ASSETS – Non-Current
  { id: 'acc-fixed',  code: '1600', name: 'Fixed Assets – Cost',        type: 'asset',     subtype: 'non_current', isSystem: true  },
  { id: 'acc-depr',   code: '1610', name: 'Accumulated Depreciation',   type: 'asset',     subtype: 'non_current', isSystem: true  },
  { id: 'acc-rou',    code: '1620', name: 'Right-of-Use Assets',        type: 'asset',     subtype: 'non_current', isSystem: false },
  // LIABILITIES – Current
  { id: 'acc-ap',     code: '2001', name: 'Accounts Payable',           type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-vatout', code: '2100', name: 'Tax Payable (Output)',        type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-salpay', code: '2200', name: 'Salaries Payable',           type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-paye',   code: '2201', name: 'PAYE Tax Payable',           type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-sspay',  code: '2202', name: 'Social Security Payable',    type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-expclaim',code:'2210', name: 'Employee Expense Claims',    type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-accrued',code: '2300', name: 'Accrued Expenses',           type: 'liability', subtype: 'current',     isSystem: false },
  // LIABILITIES – Non-Current
  { id: 'acc-loan',   code: '2400', name: 'Bank Loan',                  type: 'liability', subtype: 'non_current', isSystem: false },
  { id: 'acc-leasepay',code:'2500', name: 'Lease Liability',            type: 'liability', subtype: 'non_current', isSystem: false },
  // EQUITY
  { id: 'acc-capital', code: '3001', name: "Owner's Capital",           type: 'equity',    subtype: 'equity',      isSystem: false },
  { id: 'acc-retained',code: '3002', name: 'Retained Earnings',         type: 'equity',    subtype: 'equity',      isSystem: true  },
  { id: 'acc-drawings',code: '3003', name: "Owner's Drawings",          type: 'equity',    subtype: 'equity',      isSystem: false },
  // REVENUE
  { id: 'acc-sales',  code: '4001', name: 'Sales Revenue',              type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-svc',    code: '4002', name: 'Service Revenue',            type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-otherinc',code:'4003', name: 'Other Income',               type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-gainloss',code:'4004', name: 'Gain on Asset Disposal',     type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-salesret',code:'4010', name: 'Sales Returns & Allowances', type: 'revenue',   subtype: 'revenue',     isSystem: false },
  // EXPENSES
  { id: 'acc-cogs',   code: '5001', name: 'Cost of Goods Sold',         type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-salary', code: '5002', name: 'Salaries & Wages',           type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-rent',   code: '5003', name: 'Rent Expense',               type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-util',   code: '5004', name: 'Utilities',                  type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-admin',  code: '5005', name: 'General & Administrative',   type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-mkt',    code: '5006', name: 'Marketing & Advertising',    type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-depexp', code: '5007', name: 'Depreciation Expense',       type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-interest',code:'5008', name: 'Interest Expense',           type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-misc',   code: '5009', name: 'Miscellaneous Expense',      type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-invadj', code: '5010', name: 'Inventory Adjustments',      type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-lossdis',code: '5011', name: 'Loss on Asset Disposal',     type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-purret', code: '5012', name: 'Purchase Returns',           type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-mfgcost',code: '5013', name: 'Manufacturing Costs',        type: 'expense',   subtype: 'expense',     isSystem: false },
]

const DEFAULT_BANK_ACCOUNTS = [
  { id: 'ba-cash',  accountId: 'acc-cash',  name: 'Petty Cash',        type: 'cash', bankName: '', accountNumber: '', isDefault: false },
  { id: 'ba-bank1', accountId: 'acc-bank1', name: 'Main Bank Account', type: 'bank', bankName: '', accountNumber: '', isDefault: true  },
]

const DEFAULT_SETTINGS = {
  company: { name: 'My Company', arabicName: '', address: '', phone: '', email: '', taxId: '', currency: 'USD', currencySymbol: '$', fiscalYearStart: '01', logo: '', accentColor: '#2563eb' },
  tax:           { enabled: false, rate: 15, name: 'VAT' },
  zatca:         { enabled: false, vatNumber: '', crNumber: '', showQr: true },
  customFields:  { customer: [], supplier: [] },
  invoice:       { prefix: 'INV-',  next: 1, notes: 'Thank you for your business!', dueDays: 30 },
  purchase:      { prefix: 'PUR-',  next: 1 },
  journal:       { prefix: 'JE-',   next: 1 },
  receipt:       { prefix: 'REC-',  next: 1 },
  payment:       { prefix: 'PAY-',  next: 1 },
  quotation:     { prefix: 'QUO-',  next: 1 },
  purchaseOrder: { prefix: 'PO-',   next: 1 },
  creditNote:    { prefix: 'CN-',   next: 1 },
  debitNote:     { prefix: 'DN-',   next: 1 },
  ai:            { apiKey: '', model: 'claude-haiku-4-5-20251001' },
  payroll:       { prefix: 'PR-',    next: 1 },
  fixedAsset:    { prefix: 'FA-',    next: 1 },
  stockAdj:      { prefix: 'ADJ-',   next: 1 },
  lease:         { prefix: 'LEASE-', next: 1 },
  prepaid:       { prefix: 'PRE-',   next: 1 },
  expenseClaim:  { prefix: 'EXP-',   next: 1 },
  workOrder:     { prefix: 'WO-',    next: 1 },
  project:       { prefix: 'PRJ-',   next: 1 },
  recurring:     { prefix: 'SUB-',   next: 1 },
  delivery:      { prefix: 'DLV-',   next: 1 },
  requisition:   { prefix: 'REQ-',   next: 1 },
  theme:         'light',
}

const DEFAULT_WAREHOUSES = [
  { id: 'wh-main', name: 'Main Warehouse', location: '', isDefault: true },
]

function nextNum(prefix, n) {
  return `${prefix}${String(n).padStart(4, '0')}`
}

export const useStore = create(
  persist(
    (set, get) => ({

      // ─── SETTINGS ──────────────────────────────────────────────────
      settings: DEFAULT_SETTINGS,

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      updateCompany: (patch) =>
        set((s) => ({ settings: { ...s.settings, company: { ...s.settings.company, ...patch } } })),

      updateTax: (patch) =>
        set((s) => ({ settings: { ...s.settings, tax: { ...s.settings.tax, ...patch } } })),

      updateInvoiceSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, invoice: { ...s.settings.invoice, ...patch } } })),

      updateAiSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ai: { ...(s.settings.ai || {}), ...patch } } })),

      updateZatca: (patch) =>
        set((s) => ({ settings: { ...s.settings, zatca: { ...(s.settings.zatca || {}), ...patch } } })),

      updateCustomFields: (patch) =>
        set((s) => ({ settings: { ...s.settings, customFields: { ...(s.settings.customFields || { customer: [], supplier: [] }), ...patch } } })),

      // ─── ACCOUNTS ──────────────────────────────────────────────────
      accounts: DEFAULT_ACCOUNTS,

      addAccount: (a) =>
        set((s) => ({ accounts: [...s.accounts, { ...a, id: uuid() }] })),

      updateAccount: (id, patch) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      deleteAccount: (id) =>
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

      // ─── BANK ACCOUNTS (Cash & Cash Equivalents) ───────────────────
      bankAccounts: DEFAULT_BANK_ACCOUNTS,

      addBankAccount: (ba) => {
        const accId = uuid()
        const baId  = uuid()
        set((st) => {
          const usedCodes = new Set(st.accounts.map((a) => a.code))
          let n = 1003
          while (usedCodes.has(String(n))) n++
          const code = ba.code || String(n)
          return {
            accounts: [...st.accounts, { id: accId, code, name: ba.name, type: 'asset', subtype: 'current', isSystem: false }],
            bankAccounts: [...st.bankAccounts, { id: baId, accountId: accId, name: ba.name, type: ba.type || 'bank', bankName: ba.bankName || '', accountNumber: ba.accountNumber || '', isDefault: false }],
          }
        })
      },

      updateBankAccount: (id, patch) =>
        set((s) => ({ bankAccounts: s.bankAccounts.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

      deleteBankAccount: (id) =>
        set((s) => ({ bankAccounts: s.bankAccounts.filter((b) => b.id !== id) })),

      // ─── CUSTOMERS ─────────────────────────────────────────────────
      customers: [],

      addCustomer: (c) => {
        const newC = { ...c, id: uuid(), createdAt: new Date().toISOString() }
        set((s) => ({ customers: [...s.customers, newC] }))
        return newC
      },

      updateCustomer: (id, patch) =>
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      deleteCustomer: (id) =>
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) })),

      // ─── SUPPLIERS ─────────────────────────────────────────────────
      suppliers: [],

      addSupplier: (sup) =>
        set((s) => ({ suppliers: [...s.suppliers, { ...sup, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateSupplier: (id, patch) =>
        set((s) => ({ suppliers: s.suppliers.map((s2) => (s2.id === id ? { ...s2, ...patch } : s2)) })),

      deleteSupplier: (id) =>
        set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== id) })),

      // ─── INVENTORY ITEMS ───────────────────────────────────────────
      inventoryItems: [],

      addInventoryItem: (item) =>
        set((s) => ({ inventoryItems: [...s.inventoryItems, { ...item, id: uuid() }] })),

      updateInventoryItem: (id, patch) =>
        set((s) => ({ inventoryItems: s.inventoryItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

      deleteInventoryItem: (id) =>
        set((s) => ({ inventoryItems: s.inventoryItems.filter((i) => i.id !== id) })),

      // ─── AUDIT / ACTIVITY LOG ──────────────────────────────────────
      auditLog: [],

      logActivity: (action, detail) => {
        let user = 'System'
        try { user = useAuth.getState().users.find((u) => u.id === useAuth.getState().currentUserId)?.name || 'System' } catch { /* ignore */ }
        const entry = { id: uuid(), ts: new Date().toISOString(), user, action, detail: detail || '' }
        set((st) => ({ auditLog: [...(st.auditLog || []).slice(-999), entry] }))
      },

      clearAuditLog: () => set({ auditLog: [] }),

      // ─── JOURNAL ENTRIES ───────────────────────────────────────────
      journalEntries: [],

      addJournalEntry: (entry) => {
        const s = get()
        const { prefix, next } = s.settings.journal
        const number = nextNum(prefix, next)
        const newJE = { ...entry, id: uuid(), number, type: entry.type || 'manual', createdAt: new Date().toISOString() }
        set((st) => ({
          journalEntries: [...st.journalEntries, newJE],
          settings: { ...st.settings, journal: { ...st.settings.journal, next: st.settings.journal.next + 1 } },
        }))
        get().logActivity('Posted ' + String(newJE.type || 'entry').replace(/_/g, ' '), `${number} · ${entry.description || ''}`.trim())
        return newJE
      },

      updateJournalEntry: (id, patch) =>
        set((s) => ({ journalEntries: s.journalEntries.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),

      deleteJournalEntry: (id) =>
        set((s) => ({ journalEntries: s.journalEntries.filter((j) => j.id !== id) })),

      // ─── SALES INVOICES ────────────────────────────────────────────
      invoices: [],

      addInvoice: (invoice) => {
        const s = get()
        const { prefix, next } = s.settings.invoice
        const number = nextNum(prefix, next)

        const lines = [{ accountId: 'acc-ar', debit: invoice.total, credit: 0, description: `Invoice ${number}` }]
        const revenueMap = {}
        invoice.items.forEach((item) => {
          const acc = item.accountId || 'acc-sales'
          revenueMap[acc] = (revenueMap[acc] || 0) + item.subtotal
        })
        Object.entries(revenueMap).forEach(([accId, amount]) =>
          lines.push({ accountId: accId, debit: 0, credit: amount, description: `Revenue – ${number}` })
        )
        if (invoice.taxAmount > 0)
          lines.push({ accountId: 'acc-vatout', debit: 0, credit: invoice.taxAmount, description: 'Output Tax' })

        const je = get().addJournalEntry({
          date: invoice.date,
          description: `Sales Invoice ${number} – ${invoice.customerName || ''}`,
          reference: number, type: 'invoice', lines,
        })

        const newInvoice = {
          ...invoice, id: uuid(), number, status: 'sent', amountPaid: 0, payments: [],
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        set((st) => ({
          invoices: [...st.invoices, newInvoice],
          settings: { ...st.settings, invoice: { ...st.settings.invoice, next: next + 1 } },
        }))
        return newInvoice
      },

      recordInvoicePayment: (invoiceId, payment) => {
        const s = get()
        const invoice = s.invoices.find((i) => i.id === invoiceId)
        if (!invoice) return
        const { prefix, next } = s.settings.receipt
        const number = nextNum(prefix, next)
        const newAmountPaid = invoice.amountPaid + payment.amount
        const status = newAmountPaid >= invoice.total ? 'paid' : 'partial'
        const je = get().addJournalEntry({
          date: payment.date,
          description: `Receipt ${number} for ${invoice.number}`,
          reference: number, type: 'receipt',
          lines: [
            { accountId: payment.bankAccountId, debit: payment.amount, credit: 0, description: `Receipt for ${invoice.number}` },
            { accountId: 'acc-ar', debit: 0, credit: payment.amount, description: `Receipt for ${invoice.number}` },
          ],
        })
        set((st) => ({
          invoices: st.invoices.map((i) =>
            i.id === invoiceId
              ? { ...i, amountPaid: newAmountPaid, status, payments: [...(i.payments || []), { ...payment, id: uuid(), number, journalEntryId: je.id }] }
              : i
          ),
          settings: { ...st.settings, receipt: { ...st.settings.receipt, next: next + 1 } },
        }))
      },

      updateInvoice: (id, patch) =>
        set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

      deleteInvoice: (id) => {
        const inv = get().invoices.find((i) => i.id === id)
        get().logActivity('Deleted invoice', inv?.number || id)
        set((s) => ({
          invoices: s.invoices.filter((i) => i.id !== id),
          journalEntries: s.journalEntries.filter((j) => j.id !== inv?.journalEntryId),
        }))
      },

      // ─── QUOTATIONS / ESTIMATES ────────────────────────────────────
      quotations: [],

      addQuotation: (q) => {
        const s = get()
        const { prefix, next } = s.settings.quotation
        const number = nextNum(prefix, next)
        const newQ = { ...q, id: uuid(), number, status: 'sent', createdAt: new Date().toISOString() }
        set((st) => ({
          quotations: [...st.quotations, newQ],
          settings: { ...st.settings, quotation: { ...st.settings.quotation, next: next + 1 } },
        }))
        return newQ
      },

      updateQuotation: (id, patch) =>
        set((s) => ({ quotations: s.quotations.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),

      deleteQuotation: (id) =>
        set((s) => ({ quotations: s.quotations.filter((q) => q.id !== id) })),

      convertQuotationToInvoice: (id) => {
        const q = get().quotations.find((x) => x.id === id)
        if (!q || q.status === 'invoiced') return null
        const invoice = get().addInvoice({
          customerId: q.customerId, customerName: q.customerName,
          date: new Date().toISOString().slice(0, 10),
          dueDate: q.expiryDate || new Date().toISOString().slice(0, 10),
          items: q.items, subtotal: q.subtotal, taxAmount: q.taxAmount, total: q.total, notes: q.notes || '',
        })
        get().updateQuotation(id, { status: 'invoiced', invoiceId: invoice.id })
        return invoice
      },

      // ─── CREDIT NOTES (Sales Returns) ──────────────────────────────
      creditNotes: [],

      addCreditNote: (cn) => {
        const s = get()
        const { prefix, next } = s.settings.creditNote
        const number = nextNum(prefix, next)
        const lines = [
          { accountId: 'acc-salesret', debit: cn.subtotal, credit: 0, description: `Credit Note ${number}` },
        ]
        if (cn.taxAmount > 0)
          lines.push({ accountId: 'acc-vatout', debit: cn.taxAmount, credit: 0, description: 'Output Tax reversal' })
        lines.push({ accountId: 'acc-ar', debit: 0, credit: cn.total, description: `CN ${number}` })
        const je = get().addJournalEntry({
          date: cn.date,
          description: `Credit Note ${number} – ${cn.customerName || ''}`,
          reference: number, type: 'credit_note', lines,
        })
        const newCN = { ...cn, id: uuid(), number, status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString() }
        set((st) => ({
          creditNotes: [...st.creditNotes, newCN],
          settings: { ...st.settings, creditNote: { ...st.settings.creditNote, next: next + 1 } },
        }))
        return newCN
      },

      deleteCreditNote: (id) =>
        set((s) => {
          const cn = s.creditNotes.find((c) => c.id === id)
          return {
            creditNotes: s.creditNotes.filter((c) => c.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== cn?.journalEntryId),
          }
        }),

      // ─── PURCHASE ORDERS ───────────────────────────────────────────
      purchaseOrders: [],

      addPurchaseOrder: (po) => {
        const s = get()
        const { prefix, next } = s.settings.purchaseOrder
        const number = nextNum(prefix, next)
        const newPO = { ...po, id: uuid(), number, status: 'sent', createdAt: new Date().toISOString() }
        set((st) => ({
          purchaseOrders: [...st.purchaseOrders, newPO],
          settings: { ...st.settings, purchaseOrder: { ...st.settings.purchaseOrder, next: next + 1 } },
        }))
        return newPO
      },

      updatePurchaseOrder: (id, patch) =>
        set((s) => ({ purchaseOrders: s.purchaseOrders.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      deletePurchaseOrder: (id) =>
        set((s) => ({ purchaseOrders: s.purchaseOrders.filter((p) => p.id !== id) })),

      convertPOToPurchase: (id) => {
        const po = get().purchaseOrders.find((p) => p.id === id)
        if (!po || po.status === 'invoiced') return null
        const purchase = get().addPurchase({
          supplierId: po.supplierId, supplierName: po.supplierName,
          date: new Date().toISOString().slice(0, 10),
          dueDate: po.deliveryDate || new Date().toISOString().slice(0, 10),
          items: po.items, subtotal: po.subtotal, taxAmount: po.taxAmount, total: po.total, notes: po.notes || '',
        })
        get().updatePurchaseOrder(id, { status: 'invoiced', purchaseId: purchase.id })
        return purchase
      },

      // ─── PURCHASE INVOICES ─────────────────────────────────────────
      purchases: [],

      addPurchase: (purchase) => {
        const s = get()
        const { prefix, next } = s.settings.purchase
        const number = nextNum(prefix, next)
        const lines = []
        const expMap = {}
        purchase.items.forEach((item) => {
          const acc = item.accountId || 'acc-admin'
          expMap[acc] = (expMap[acc] || 0) + item.subtotal
        })
        Object.entries(expMap).forEach(([accId, amount]) =>
          lines.push({ accountId: accId, debit: amount, credit: 0, description: `Purchase – ${number}` })
        )
        if (purchase.taxAmount > 0)
          lines.push({ accountId: 'acc-vatin', debit: purchase.taxAmount, credit: 0, description: 'Input Tax' })
        lines.push({ accountId: 'acc-ap', debit: 0, credit: purchase.total, description: `Purchase ${number}` })
        const je = get().addJournalEntry({
          date: purchase.date,
          description: `Purchase Invoice ${number} – ${purchase.supplierName || ''}`,
          reference: number, type: 'purchase', lines,
        })
        const newPurchase = {
          ...purchase, id: uuid(), number, status: 'received', amountPaid: 0, payments: [],
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        set((st) => ({
          purchases: [...st.purchases, newPurchase],
          settings: { ...st.settings, purchase: { ...st.settings.purchase, next: next + 1 } },
        }))
        return newPurchase
      },

      recordPurchasePayment: (purchaseId, payment) => {
        const s = get()
        const purchase = s.purchases.find((p) => p.id === purchaseId)
        if (!purchase) return
        const { prefix, next } = s.settings.payment
        const number = nextNum(prefix, next)
        const newAmountPaid = purchase.amountPaid + payment.amount
        const status = newAmountPaid >= purchase.total ? 'paid' : 'partial'
        const je = get().addJournalEntry({
          date: payment.date,
          description: `Payment ${number} for ${purchase.number}`,
          reference: number, type: 'payment_out',
          lines: [
            { accountId: 'acc-ap', debit: payment.amount, credit: 0, description: `Payment for ${purchase.number}` },
            { accountId: payment.bankAccountId, debit: 0, credit: payment.amount, description: `Payment for ${purchase.number}` },
          ],
        })
        set((st) => ({
          purchases: st.purchases.map((p) =>
            p.id === purchaseId
              ? { ...p, amountPaid: newAmountPaid, status, payments: [...(p.payments || []), { ...payment, id: uuid(), number, journalEntryId: je.id }] }
              : p
          ),
          settings: { ...st.settings, payment: { ...st.settings.payment, next: next + 1 } },
        }))
      },

      updatePurchase: (id, patch) =>
        set((s) => ({ purchases: s.purchases.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      deletePurchase: (id) => {
        const pur = get().purchases.find((p) => p.id === id)
        get().logActivity('Deleted purchase', pur?.number || id)
        set((s) => ({
          purchases: s.purchases.filter((p) => p.id !== id),
          journalEntries: s.journalEntries.filter((j) => j.id !== pur?.journalEntryId),
        }))
      },

      // ─── DEBIT NOTES (Purchase Returns) ────────────────────────────
      debitNotes: [],

      addDebitNote: (dn) => {
        const s = get()
        const { prefix, next } = s.settings.debitNote
        const number = nextNum(prefix, next)
        const lines = [
          { accountId: 'acc-ap',     debit: dn.total,    credit: 0,          description: `Debit Note ${number}` },
          { accountId: 'acc-purret', debit: 0,           credit: dn.subtotal, description: `Purchase Return – ${number}` },
        ]
        if (dn.taxAmount > 0)
          lines.push({ accountId: 'acc-vatin', debit: 0, credit: dn.taxAmount, description: 'Input Tax reversal' })
        const je = get().addJournalEntry({
          date: dn.date,
          description: `Debit Note ${number} – ${dn.supplierName || ''}`,
          reference: number, type: 'debit_note', lines,
        })
        const newDN = { ...dn, id: uuid(), number, status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString() }
        set((st) => ({
          debitNotes: [...st.debitNotes, newDN],
          settings: { ...st.settings, debitNote: { ...st.settings.debitNote, next: next + 1 } },
        }))
        return newDN
      },

      deleteDebitNote: (id) =>
        set((s) => {
          const dn = s.debitNotes.find((d) => d.id === id)
          return {
            debitNotes: s.debitNotes.filter((d) => d.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== dn?.journalEntryId),
          }
        }),

      // ─── DEPARTMENTS ───────────────────────────────────────────────
      departments: [],

      addDepartment: (dept) =>
        set((s) => ({ departments: [...s.departments, { ...dept, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateDepartment: (id, patch) =>
        set((s) => ({ departments: s.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),

      deleteDepartment: (id) =>
        set((s) => ({ departments: s.departments.filter((d) => d.id !== id) })),

      // ─── EMPLOYEES ─────────────────────────────────────────────────
      employees: [],

      addEmployee: (emp) =>
        set((s) => ({ employees: [...s.employees, { ...emp, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateEmployee: (id, patch) =>
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

      deleteEmployee: (id) =>
        set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),

      // ─── PAYROLL RUNS ──────────────────────────────────────────────
      payrollRuns: [],

      addPayrollRun: (run) => {
        const s = get()
        const { prefix, next } = s.settings.payroll
        const number = nextNum(prefix, next)
        const newRun = { ...run, id: uuid(), number, status: 'draft', createdAt: new Date().toISOString() }
        set((st) => ({
          payrollRuns: [...st.payrollRuns, newRun],
          settings: { ...st.settings, payroll: { ...st.settings.payroll, next: next + 1 } },
        }))
        return newRun
      },

      processPayrollRun: (runId) => {
        const run = get().payrollRuns.find((r) => r.id === runId)
        if (!run || run.status === 'processed') return
        const totalGross = run.lines.reduce((a, l) => a + (l.gross || 0), 0)
        const totalTax   = run.lines.reduce((a, l) => a + (l.tax   || 0), 0)
        const totalSS    = run.lines.reduce((a, l) => a + (l.socialSecurity || 0), 0)
        const totalNet   = run.lines.reduce((a, l) => a + (l.net   || 0), 0)
        const lines = [
          { accountId: 'acc-salary', debit: totalGross, credit: 0,        description: `Payroll ${run.number} – Gross` },
          { accountId: 'acc-salpay', debit: 0,          credit: totalNet, description: `Payroll ${run.number} – Net Pay` },
          { accountId: 'acc-paye',   debit: 0,          credit: totalTax, description: `Payroll ${run.number} – PAYE` },
        ]
        if (totalSS > 0)
          lines.push({ accountId: 'acc-sspay', debit: 0, credit: totalSS, description: `Payroll ${run.number} – SS` })
        const je = get().addJournalEntry({
          date: run.payDate,
          description: `Payroll Run ${run.number} – ${run.period}`,
          reference: run.number, type: 'payroll', lines,
        })
        set((st) => ({
          payrollRuns: st.payrollRuns.map((r) =>
            r.id === runId ? { ...r, status: 'processed', journalEntryId: je.id } : r
          ),
        }))
      },

      payPayrollRun: (runId, bankAccountId, payDate) => {
        const run = get().payrollRuns.find((r) => r.id === runId)
        if (!run || run.status !== 'processed' || run.paid) return
        const totalNet = run.lines.reduce((a, l) => a + (l.net || 0), 0)
        const je = get().addJournalEntry({
          date: payDate || run.payDate,
          description: `Payroll Payment ${run.number}`,
          reference: run.number, type: 'payroll_payment',
          lines: [
            { accountId: 'acc-salpay',  debit: totalNet, credit: 0,       description: `Payroll Pmt ${run.number}` },
            { accountId: bankAccountId, debit: 0,        credit: totalNet, description: `Payroll Pmt ${run.number}` },
          ],
        })
        set((st) => ({
          payrollRuns: st.payrollRuns.map((r) =>
            r.id === runId ? { ...r, paid: true, paymentJEId: je.id, paymentDate: payDate } : r
          ),
        }))
      },

      deletePayrollRun: (id) =>
        set((s) => {
          const run = s.payrollRuns.find((r) => r.id === id)
          return {
            payrollRuns: s.payrollRuns.filter((r) => r.id !== id),
            journalEntries: s.journalEntries.filter(
              (j) => j.id !== run?.journalEntryId && j.id !== run?.paymentJEId
            ),
          }
        }),

      // ─── FIXED ASSETS ──────────────────────────────────────────────
      fixedAssets: [],
      assetDepreciations: [],

      addFixedAsset: (asset) => {
        const s = get()
        const { prefix, next } = s.settings.fixedAsset
        const number = nextNum(prefix, next)
        const creditAccId = asset.paymentType === 'credit' ? 'acc-ap' : (asset.bankAccountId || 'acc-bank1')
        const je = get().addJournalEntry({
          date: asset.purchaseDate,
          description: `Asset Purchase: ${asset.name} (${number})`,
          reference: number, type: 'fixed_asset',
          lines: [
            { accountId: 'acc-fixed', debit: asset.purchaseCost, credit: 0,                  description: asset.name },
            { accountId: creditAccId, debit: 0,                  credit: asset.purchaseCost, description: asset.name },
          ],
        })
        const newAsset = {
          ...asset, id: uuid(), number, status: 'active',
          accumulatedDepreciation: 0, currentBookValue: asset.purchaseCost,
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        set((st) => ({
          fixedAssets: [...st.fixedAssets, newAsset],
          settings: { ...st.settings, fixedAsset: { ...st.settings.fixedAsset, next: next + 1 } },
        }))
        return newAsset
      },

      recordDepreciation: (assetId, { date, amount, period }) => {
        const asset = get().fixedAssets.find((a) => a.id === assetId)
        if (!asset || asset.status !== 'active') return
        const je = get().addJournalEntry({
          date,
          description: `Depreciation – ${asset.name} (${period})`,
          reference: asset.number, type: 'depreciation',
          lines: [
            { accountId: 'acc-depexp', debit: amount, credit: 0,      description: `Dep: ${asset.name}` },
            { accountId: 'acc-depr',   debit: 0,      credit: amount, description: `Dep: ${asset.name}` },
          ],
        })
        const newAccDep   = asset.accumulatedDepreciation + amount
        const newBookVal  = asset.purchaseCost - newAccDep
        set((st) => ({
          fixedAssets: st.fixedAssets.map((a) =>
            a.id === assetId ? { ...a, accumulatedDepreciation: newAccDep, currentBookValue: newBookVal } : a
          ),
          assetDepreciations: [...st.assetDepreciations, {
            id: uuid(), assetId, assetName: asset.name, assetNumber: asset.number,
            date, period, amount, journalEntryId: je.id,
          }],
        }))
      },

      disposeAsset: (assetId, { date, proceeds, bankAccountId }) => {
        const asset = get().fixedAssets.find((a) => a.id === assetId)
        if (!asset || asset.status !== 'active') return
        const accDep   = asset.accumulatedDepreciation
        const gainLoss = proceeds - asset.currentBookValue
        const lines = [
          { accountId: 'acc-fixed', debit: 0,      credit: asset.purchaseCost, description: `Dispose: ${asset.name}` },
          { accountId: 'acc-depr',  debit: accDep, credit: 0,                  description: `Dispose: ${asset.name}` },
        ]
        if (proceeds > 0)
          lines.push({ accountId: bankAccountId || 'acc-bank1', debit: proceeds, credit: 0, description: `Proceeds: ${asset.name}` })
        if (gainLoss > 0)
          lines.push({ accountId: 'acc-gainloss', debit: 0,                credit: gainLoss,         description: 'Gain on disposal' })
        else if (gainLoss < 0)
          lines.push({ accountId: 'acc-lossdis',  debit: Math.abs(gainLoss), credit: 0,              description: 'Loss on disposal' })
        const je = get().addJournalEntry({
          date,
          description: `Asset Disposal: ${asset.name} (${asset.number})`,
          reference: asset.number, type: 'asset_disposal', lines,
        })
        set((st) => ({
          fixedAssets: st.fixedAssets.map((a) =>
            a.id === assetId ? { ...a, status: 'disposed', disposalDate: date, disposalProceeds: proceeds, disposalJEId: je.id } : a
          ),
        }))
      },

      deleteFixedAsset: (id) =>
        set((s) => {
          const asset = s.fixedAssets.find((a) => a.id === id)
          return {
            fixedAssets: s.fixedAssets.filter((a) => a.id !== id),
            assetDepreciations: s.assetDepreciations.filter((d) => d.assetId !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== asset?.journalEntryId),
          }
        }),

      // ─── STOCK ADJUSTMENTS ─────────────────────────────────────────
      stockAdjustments: [],

      addStockAdjustment: (adj) => {
        const s = get()
        const { prefix, next } = s.settings.stockAdj
        const number = nextNum(prefix, next)
        const invAccId = adj.inventoryAccountId || 'acc-inv'
        const lines = adj.type === 'increase'
          ? [
              { accountId: invAccId,      debit: adj.totalAmount, credit: 0,              description: adj.reason || 'Stock increase' },
              { accountId: 'acc-invadj',  debit: 0,               credit: adj.totalAmount, description: adj.reason || 'Stock increase' },
            ]
          : [
              { accountId: 'acc-invadj',  debit: adj.totalAmount, credit: 0,              description: adj.reason || 'Stock decrease' },
              { accountId: invAccId,      debit: 0,               credit: adj.totalAmount, description: adj.reason || 'Stock decrease' },
            ]
        const je = get().addJournalEntry({
          date: adj.date,
          description: `Stock Adj ${number} – ${adj.itemName || ''}`,
          reference: number, type: 'stock_adj', lines,
        })
        const qtyChange = adj.type === 'increase' ? adj.quantity : -adj.quantity
        set((st) => ({
          stockAdjustments: [...st.stockAdjustments, { ...adj, id: uuid(), number, journalEntryId: je.id, createdAt: new Date().toISOString() }],
          inventoryItems: st.inventoryItems.map((i) =>
            i.id === adj.itemId ? { ...i, quantity: (i.quantity || 0) + qtyChange } : i
          ),
          settings: { ...st.settings, stockAdj: { ...st.settings.stockAdj, next: next + 1 } },
        }))
      },

      deleteStockAdjustment: (id) =>
        set((s) => {
          const adj = s.stockAdjustments.find((a) => a.id === id)
          const qtyChange = adj ? (adj.type === 'increase' ? -adj.quantity : adj.quantity) : 0
          return {
            stockAdjustments: s.stockAdjustments.filter((a) => a.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== adj?.journalEntryId),
            inventoryItems: s.inventoryItems.map((i) =>
              i.id === adj?.itemId ? { ...i, quantity: (i.quantity || 0) + qtyChange } : i
            ),
          }
        }),

      // ─── PREPAID EXPENSES ──────────────────────────────────────────
      prepaidExpenses: [],

      addPrepaidExpense: (pre) => {
        const s = get()
        const { prefix, next } = s.settings.prepaid
        const number = nextNum(prefix, next)
        const bankAccId = pre.bankAccountId || 'acc-bank1'
        const je = get().addJournalEntry({
          date: pre.startDate,
          description: `Prepaid: ${pre.name} (${number})`,
          reference: number, type: 'prepaid',
          lines: [
            { accountId: 'acc-prepaid', debit: pre.amount,  credit: 0,          description: pre.name },
            { accountId: bankAccId,     debit: 0,           credit: pre.amount, description: pre.name },
          ],
        })
        const newPre = {
          ...pre, id: uuid(), number, amortized: 0, remaining: pre.amount,
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        set((st) => ({
          prepaidExpenses: [...st.prepaidExpenses, newPre],
          settings: { ...st.settings, prepaid: { ...st.settings.prepaid, next: next + 1 } },
        }))
        return newPre
      },

      amortizePrepaid: (id, { date, amount, period }) => {
        const pre = get().prepaidExpenses.find((p) => p.id === id)
        if (!pre) return
        const expAccId = pre.expenseAccountId || 'acc-admin'
        const je = get().addJournalEntry({
          date,
          description: `Amortize Prepaid: ${pre.name} (${period})`,
          reference: pre.number, type: 'prepaid_amort',
          lines: [
            { accountId: expAccId,      debit: amount, credit: 0,      description: `${pre.name} – ${period}` },
            { accountId: 'acc-prepaid', debit: 0,      credit: amount, description: `${pre.name} – ${period}` },
          ],
        })
        const newAmortized = pre.amortized + amount
        const newRemaining = pre.amount - newAmortized
        set((st) => ({
          prepaidExpenses: st.prepaidExpenses.map((p) =>
            p.id === id ? { ...p, amortized: newAmortized, remaining: Math.max(0, newRemaining) } : p
          ),
        }))
        return je
      },

      deletePrepaidExpense: (id) =>
        set((s) => {
          const pre = s.prepaidExpenses.find((p) => p.id === id)
          return {
            prepaidExpenses: s.prepaidExpenses.filter((p) => p.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== pre?.journalEntryId),
          }
        }),

      // ─── LEASES ────────────────────────────────────────────────────
      leases: [],

      addLease: (lease) => {
        const s = get()
        const { prefix, next } = s.settings.lease
        const number = nextNum(prefix, next)
        const newLease = { ...lease, id: uuid(), number, status: 'active', payments: [], createdAt: new Date().toISOString() }
        set((st) => ({
          leases: [...st.leases, newLease],
          settings: { ...st.settings, lease: { ...st.settings.lease, next: next + 1 } },
        }))
        return newLease
      },

      recordLeasePayment: (leaseId, payment) => {
        const lease = get().leases.find((l) => l.id === leaseId)
        if (!lease) return
        const bankAccId = payment.bankAccountId || lease.bankAccountId || 'acc-bank1'
        const expAccId  = payment.expenseAccountId || lease.expenseAccountId || 'acc-rent'
        const je = get().addJournalEntry({
          date: payment.date,
          description: `Lease Payment – ${lease.name} (${payment.period || payment.date})`,
          reference: lease.number, type: 'lease_payment',
          lines: [
            { accountId: expAccId,  debit: payment.amount,  credit: 0,              description: `${lease.name}` },
            { accountId: bankAccId, debit: 0,               credit: payment.amount, description: `${lease.name}` },
          ],
        })
        set((st) => ({
          leases: st.leases.map((l) =>
            l.id === leaseId
              ? { ...l, payments: [...(l.payments || []), { ...payment, id: uuid(), journalEntryId: je.id }] }
              : l
          ),
        }))
        return je
      },

      terminateLease: (id, terminationDate) =>
        set((s) => ({
          leases: s.leases.map((l) => l.id === id ? { ...l, status: 'terminated', terminationDate } : l),
        })),

      deleteLease: (id) =>
        set((s) => ({ leases: s.leases.filter((l) => l.id !== id) })),

      // ─── EXPENSE CLAIMS ────────────────────────────────────────────
      expenseClaims: [],

      addExpenseClaim: (claim) => {
        const s = get()
        const { prefix, next } = s.settings.expenseClaim
        const number = nextNum(prefix, next)
        const newClaim = { ...claim, id: uuid(), number, status: 'pending', createdAt: new Date().toISOString() }
        set((st) => ({
          expenseClaims: [...st.expenseClaims, newClaim],
          settings: { ...st.settings, expenseClaim: { ...st.settings.expenseClaim, next: next + 1 } },
        }))
        return newClaim
      },

      approveExpenseClaim: (id) => {
        const claim = get().expenseClaims.find((c) => c.id === id)
        if (!claim || claim.status !== 'pending') return
        const expAccId = claim.expenseAccountId || 'acc-admin'
        const je = get().addJournalEntry({
          date: claim.date,
          description: `Expense Claim Approved: ${claim.number} – ${claim.employeeName}`,
          reference: claim.number, type: 'expense_claim',
          lines: [
            { accountId: expAccId,       debit: claim.amount, credit: 0,            description: claim.description },
            { accountId: 'acc-expclaim', debit: 0,            credit: claim.amount, description: claim.description },
          ],
        })
        set((st) => ({
          expenseClaims: st.expenseClaims.map((c) =>
            c.id === id ? { ...c, status: 'approved', approvalJEId: je.id } : c
          ),
        }))
      },

      payExpenseClaim: (id, bankAccountId, payDate) => {
        const claim = get().expenseClaims.find((c) => c.id === id)
        if (!claim || claim.status !== 'approved') return
        const bankAccId = bankAccountId || 'acc-bank1'
        const je = get().addJournalEntry({
          date: payDate || claim.date,
          description: `Expense Claim Paid: ${claim.number} – ${claim.employeeName}`,
          reference: claim.number, type: 'expense_claim_payment',
          lines: [
            { accountId: 'acc-expclaim', debit: claim.amount,  credit: 0,            description: claim.description },
            { accountId: bankAccId,      debit: 0,             credit: claim.amount, description: claim.description },
          ],
        })
        set((st) => ({
          expenseClaims: st.expenseClaims.map((c) =>
            c.id === id ? { ...c, status: 'paid', paymentJEId: je.id, paymentDate: payDate } : c
          ),
        }))
      },

      deleteExpenseClaim: (id) =>
        set((s) => {
          const claim = s.expenseClaims.find((c) => c.id === id)
          return {
            expenseClaims: s.expenseClaims.filter((c) => c.id !== id),
            journalEntries: s.journalEntries.filter(
              (j) => j.id !== claim?.approvalJEId && j.id !== claim?.paymentJEId
            ),
          }
        }),

      // ─── BILLS OF MATERIALS ────────────────────────────────────────
      billsOfMaterials: [],

      addBOM: (bom) =>
        set((s) => ({ billsOfMaterials: [...s.billsOfMaterials, { ...bom, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateBOM: (id, patch) =>
        set((s) => ({ billsOfMaterials: s.billsOfMaterials.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),

      deleteBOM: (id) =>
        set((s) => ({ billsOfMaterials: s.billsOfMaterials.filter((b) => b.id !== id) })),

      // ─── WORK ORDERS ───────────────────────────────────────────────
      workOrders: [],

      addWorkOrder: (wo) => {
        const s = get()
        const { prefix, next } = s.settings.workOrder
        const number = nextNum(prefix, next)
        const newWO = { ...wo, id: uuid(), number, status: 'draft', createdAt: new Date().toISOString() }
        set((st) => ({
          workOrders: [...st.workOrders, newWO],
          settings: { ...st.settings, workOrder: { ...st.settings.workOrder, next: next + 1 } },
        }))
        return newWO
      },

      startWorkOrder: (id) =>
        set((s) => ({
          workOrders: s.workOrders.map((w) => w.id === id ? { ...w, status: 'in_progress', startedAt: new Date().toISOString() } : w),
        })),

      completeWorkOrder: (id, completionDate) => {
        const wo = get().workOrders.find((w) => w.id === id)
        if (!wo || wo.status === 'completed') return
        const qty = wo.targetQuantity || 1

        const rawLines = []
        let totalMaterialCost = 0
        ;(wo.components || []).forEach((comp) => {
          const lineAmt = (comp.unitCost || 0) * (comp.quantity || 0) * qty
          totalMaterialCost += lineAmt
          if (lineAmt > 0)
            rawLines.push({ accountId: comp.materialAccountId || 'acc-rawmat', debit: 0, credit: lineAmt, description: comp.name })
        })

        const wipAccId     = wo.wipAccountId     || 'acc-wip'
        const finGoodsAccId = wo.finGoodsAccountId || 'acc-fingoods'

        const lines = [
          { accountId: wipAccId, debit: totalMaterialCost, credit: 0, description: `WO ${wo.number} – Materials to WIP` },
          ...rawLines,
        ]
        const je1 = get().addJournalEntry({
          date: completionDate || new Date().toISOString().slice(0, 10),
          description: `Work Order ${wo.number} – Issue Materials`,
          reference: wo.number, type: 'work_order_issue', lines,
        })
        const je2 = get().addJournalEntry({
          date: completionDate || new Date().toISOString().slice(0, 10),
          description: `Work Order ${wo.number} – Finished Goods`,
          reference: wo.number, type: 'work_order_complete',
          lines: [
            { accountId: finGoodsAccId, debit: totalMaterialCost,  credit: 0,                   description: `Finished: ${wo.outputName}` },
            { accountId: wipAccId,      debit: 0,                  credit: totalMaterialCost, description: `Finished: ${wo.outputName}` },
          ],
        })

        const outputQty = (wo.outputQuantity || 1) * qty
        set((st) => ({
          workOrders: st.workOrders.map((w) =>
            w.id === id ? { ...w, status: 'completed', completedAt: new Date().toISOString(), actualCost: totalMaterialCost, jeIssueId: je1.id, jeCompleteId: je2.id, completionDate } : w
          ),
          inventoryItems: st.inventoryItems.map((item) =>
            item.id === wo.outputItemId ? { ...item, quantity: (item.quantity || 0) + outputQty } : item
          ),
        }))
      },

      deleteWorkOrder: (id) =>
        set((s) => {
          const wo = s.workOrders.find((w) => w.id === id)
          return {
            workOrders: s.workOrders.filter((w) => w.id !== id),
            journalEntries: s.journalEntries.filter(
              (j) => j.id !== wo?.jeIssueId && j.id !== wo?.jeCompleteId
            ),
          }
        }),

      // ─── DIRECT BANK TRANSACTIONS ──────────────────────────────────
      bankTransactions: [],

      addBankTransaction: (tx) => {
        const lines =
          tx.type === 'money_in'
            ? [
                { accountId: tx.bankAccountId, debit: tx.amount, credit: 0,          description: tx.description },
                { accountId: tx.accountId,      debit: 0,         credit: tx.amount, description: tx.description },
              ]
            : [
                { accountId: tx.accountId,      debit: tx.amount, credit: 0,          description: tx.description },
                { accountId: tx.bankAccountId,  debit: 0,         credit: tx.amount, description: tx.description },
              ]
        const je = get().addJournalEntry({
          date: tx.date, description: tx.description, reference: tx.reference || '', type: tx.type,
          projectId: tx.projectId || null, lines,
        })
        set((s) => ({
          bankTransactions: [...s.bankTransactions, { ...tx, id: uuid(), journalEntryId: je.id, createdAt: new Date().toISOString() }],
        }))
      },

      deleteBankTransaction: (id) =>
        set((s) => {
          const tx = s.bankTransactions.find((t) => t.id === id)
          return {
            bankTransactions: s.bankTransactions.filter((t) => t.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== tx?.journalEntryId),
          }
        }),

      // ─── WAREHOUSES & STOCK TRANSFERS ──────────────────────────────
      warehouses: DEFAULT_WAREHOUSES,
      stockTransfers: [],

      addWarehouse: (wh) =>
        set((s) => ({ warehouses: [...s.warehouses, { ...wh, id: uuid(), isDefault: false }] })),

      updateWarehouse: (id, patch) =>
        set((s) => ({ warehouses: s.warehouses.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

      deleteWarehouse: (id) =>
        set((s) => {
          const wh = s.warehouses.find((w) => w.id === id)
          if (wh?.isDefault) return s
          return { warehouses: s.warehouses.filter((w) => w.id !== id) }
        }),

      // returns stock of an item in a warehouse (lazily defaults all stock to the default warehouse)
      getItemStock: (item, warehouseId) => {
        if (!item) return 0
        const defWh = get().warehouses.find((w) => w.isDefault)?.id || 'wh-main'
        const map = item.stockByWarehouse
        if (!map) return warehouseId === defWh ? (item.quantity || 0) : 0
        return map[warehouseId] || 0
      },

      addStockTransfer: ({ itemId, fromWarehouseId, toWarehouseId, quantity, date, notes }) => {
        const qty = Number(quantity) || 0
        if (qty <= 0 || fromWarehouseId === toWarehouseId) return
        set((s) => {
          const defWh = s.warehouses.find((w) => w.isDefault)?.id || 'wh-main'
          return {
            inventoryItems: s.inventoryItems.map((it) => {
              if (it.id !== itemId) return it
              const map = it.stockByWarehouse ? { ...it.stockByWarehouse } : { [defWh]: it.quantity || 0 }
              map[fromWarehouseId] = (map[fromWarehouseId] || 0) - qty
              map[toWarehouseId]   = (map[toWarehouseId]   || 0) + qty
              return { ...it, stockByWarehouse: map }
            }),
            stockTransfers: [...s.stockTransfers, { id: uuid(), itemId, fromWarehouseId, toWarehouseId, quantity: qty, date, notes: notes || '', createdAt: new Date().toISOString() }],
          }
        })
      },

      deleteStockTransfer: (id) =>
        set((s) => {
          const tr = s.stockTransfers.find((t) => t.id === id)
          if (!tr) return s
          return {
            stockTransfers: s.stockTransfers.filter((t) => t.id !== id),
            inventoryItems: s.inventoryItems.map((it) => {
              if (it.id !== tr.itemId || !it.stockByWarehouse) return it
              const map = { ...it.stockByWarehouse }
              map[tr.fromWarehouseId] = (map[tr.fromWarehouseId] || 0) + tr.quantity
              map[tr.toWarehouseId]   = (map[tr.toWarehouseId]   || 0) - tr.quantity
              return { ...it, stockByWarehouse: map }
            }),
          }
        }),

      // ─── RECURRING / SUBSCRIPTION INVOICES ─────────────────────────
      recurringInvoices: [],

      addRecurringInvoice: (rec) => {
        const s = get()
        const { prefix, next } = s.settings.recurring
        const number = nextNum(prefix, next)
        const newRec = { ...rec, id: uuid(), number, status: 'active', generatedCount: 0, lastGenerated: null, createdAt: new Date().toISOString() }
        set((st) => ({
          recurringInvoices: [...st.recurringInvoices, newRec],
          settings: { ...st.settings, recurring: { ...st.settings.recurring, next: next + 1 } },
        }))
        return newRec
      },

      updateRecurringInvoice: (id, patch) =>
        set((s) => ({ recurringInvoices: s.recurringInvoices.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

      deleteRecurringInvoice: (id) =>
        set((s) => ({ recurringInvoices: s.recurringInvoices.filter((r) => r.id !== id) })),

      advanceDate: (dateStr, frequency) => {
        const d = new Date(dateStr)
        if (frequency === 'weekly')      d.setDate(d.getDate() + 7)
        else if (frequency === 'biweekly') d.setDate(d.getDate() + 14)
        else if (frequency === 'monthly')  d.setMonth(d.getMonth() + 1)
        else if (frequency === 'quarterly')d.setMonth(d.getMonth() + 3)
        else if (frequency === 'yearly')   d.setFullYear(d.getFullYear() + 1)
        return d.toISOString().slice(0, 10)
      },

      // Generate real invoices for every active schedule whose nextDate has arrived
      generateDueRecurring: () => {
        const today = new Date().toISOString().slice(0, 10)
        const due = get().recurringInvoices.filter((r) => r.status === 'active' && r.nextDate <= today)
        let created = 0
        due.forEach((r) => {
          let nextDate = r.nextDate
          let count = r.generatedCount || 0
          // catch up on any missed cycles, up to a sane cap
          let guard = 0
          while (nextDate <= today && r.status === 'active' && guard < 60) {
            if (r.endDate && nextDate > r.endDate) break
            const due30 = get().advanceDate(nextDate, 'monthly')
            get().addInvoice({
              customerId: r.customerId, customerName: r.customerName,
              date: nextDate, dueDate: due30,
              items: r.items, subtotal: r.subtotal, taxAmount: r.taxAmount, total: r.total,
              notes: (r.notes ? r.notes + ' ' : '') + `(Recurring ${r.number})`,
            })
            created++
            count++
            nextDate = get().advanceDate(nextDate, r.frequency)
            guard++
          }
          const ended = r.endDate && nextDate > r.endDate
          get().updateRecurringInvoice(r.id, { nextDate, generatedCount: count, lastGenerated: today, status: ended ? 'completed' : 'active' })
        })
        return created
      },

      // ─── PURCHASE REQUISITIONS & APPROVALS ─────────────────────────
      requisitions: [],

      addRequisition: (req) => {
        const s = get()
        const { prefix, next } = s.settings.requisition
        const number = nextNum(prefix, next)
        const newReq = { ...req, id: uuid(), number, status: 'pending', createdAt: new Date().toISOString() }
        set((st) => ({
          requisitions: [...st.requisitions, newReq],
          settings: { ...st.settings, requisition: { ...st.settings.requisition, next: next + 1 } },
        }))
        get().logActivity('Created requisition', `${number} · ${req.requestedBy || ''}`.trim())
        return newReq
      },

      approveRequisition: (id, approver) => {
        const req = get().requisitions.find((r) => r.id === id)
        if (!req || req.status !== 'pending') return
        set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'approved', approvedBy: approver, approvedAt: new Date().toISOString() } : r)) }))
        get().logActivity('Approved requisition', req.number)
      },

      rejectRequisition: (id, approver, reason) => {
        const req = get().requisitions.find((r) => r.id === id)
        if (!req || req.status !== 'pending') return
        set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'rejected', approvedBy: approver, rejectedReason: reason || '', approvedAt: new Date().toISOString() } : r)) }))
        get().logActivity('Rejected requisition', req.number)
      },

      deleteRequisition: (id) =>
        set((s) => ({ requisitions: s.requisitions.filter((r) => r.id !== id) })),

      convertRequisitionToPO: (id) => {
        const req = get().requisitions.find((r) => r.id === id)
        if (!req || req.status !== 'approved') return null
        const items = (req.items || []).map((i) => ({
          description: i.description, quantity: i.quantity || 0, unitPrice: i.estPrice || 0,
          taxRate: 0, subtotal: (i.quantity || 0) * (i.estPrice || 0), accountId: 'acc-admin',
        }))
        const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
        const po = get().addPurchaseOrder({
          supplierId: req.supplierId || null, supplierName: req.supplierName || 'Supplier',
          date: new Date().toISOString().slice(0, 10), deliveryDate: req.neededBy || '',
          items, subtotal, taxAmount: 0, total: subtotal, notes: `From requisition ${req.number}`,
        })
        set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'ordered', purchaseOrderId: po.id } : r)) }))
        get().logActivity('Requisition → PO', `${req.number} → ${po.number}`)
        return po
      },

      // ─── DELIVERY NOTES ────────────────────────────────────────────
      deliveryNotes: [],

      addDeliveryNote: (dn) => {
        const s = get()
        const { prefix, next } = s.settings.delivery
        const number = nextNum(prefix, next)
        const newDN = { ...dn, id: uuid(), number, status: dn.status || 'pending', createdAt: new Date().toISOString() }
        set((st) => ({
          deliveryNotes: [...st.deliveryNotes, newDN],
          settings: { ...st.settings, delivery: { ...st.settings.delivery, next: next + 1 } },
        }))
        return newDN
      },

      updateDeliveryNote: (id, patch) =>
        set((s) => ({ deliveryNotes: s.deliveryNotes.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),

      deleteDeliveryNote: (id) =>
        set((s) => ({ deliveryNotes: s.deliveryNotes.filter((d) => d.id !== id) })),

      // ─── CURRENCIES & EXCHANGE RATES ───────────────────────────────
      // rate = units of this currency per 1 unit of the base (company) currency
      currencies: [],

      addCurrency: (c) =>
        set((s) => {
          if (s.currencies.some((x) => x.code === c.code)) return s
          return { currencies: [...s.currencies, { ...c, id: uuid(), rate: Number(c.rate) || 1, updatedAt: new Date().toISOString() }] }
        }),

      updateCurrency: (id, patch) =>
        set((s) => ({ currencies: s.currencies.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)) })),

      deleteCurrency: (id) =>
        set((s) => ({ currencies: s.currencies.filter((c) => c.id !== id) })),

      // ─── CRM · SALES PIPELINE ──────────────────────────────────────
      leads: [],

      addLead: (lead) =>
        set((s) => ({ leads: [...s.leads, { ...lead, id: uuid(), stage: lead.stage || 'new', createdAt: new Date().toISOString() }] })),

      updateLead: (id, patch) =>
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

      deleteLead: (id) =>
        set((s) => ({ leads: s.leads.filter((l) => l.id !== id) })),

      convertLeadToCustomer: (id) => {
        const lead = get().leads.find((l) => l.id === id)
        if (!lead) return null
        const cust = get().addCustomer({
          name: lead.company || lead.name, email: lead.email || '', phone: lead.phone || '',
          address: lead.address || '', taxId: '', contactPerson: lead.name || '',
        })
        get().updateLead(id, { stage: 'won', convertedCustomerId: cust?.id })
        return cust
      },

      // ─── PROJECTS & JOB COSTING ────────────────────────────────────
      projects: [],

      addProject: (proj) => {
        const s = get()
        const { prefix, next } = s.settings.project
        const number = nextNum(prefix, next)
        const newProj = { ...proj, id: uuid(), number, status: proj.status || 'active', createdAt: new Date().toISOString() }
        set((st) => ({
          projects: [...st.projects, newProj],
          settings: { ...st.settings, project: { ...st.settings.project, next: next + 1 } },
        }))
        return newProj
      },

      updateProject: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          timeEntries: s.timeEntries.filter((t) => t.projectId !== id),
        })),

      // Record project income or cost — posts to the ledger AND tags the project
      recordProjectTransaction: (projectId, tx) => {
        get().addBankTransaction({ ...tx, projectId })
      },

      // ─── TIME TRACKING (billable) ──────────────────────────────────
      timeEntries: [],

      addTimeEntry: (entry) =>
        set((s) => ({ timeEntries: [...s.timeEntries, { ...entry, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateTimeEntry: (id, patch) =>
        set((s) => ({ timeEntries: s.timeEntries.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      deleteTimeEntry: (id) =>
        set((s) => ({ timeEntries: s.timeEntries.filter((t) => t.id !== id) })),

      // ─── BUDGETS (annual, per account) ─────────────────────────────
      budgets: [],

      setBudget: (accountId, year, amount) =>
        set((s) => {
          const existing = s.budgets.find((b) => b.accountId === accountId && b.year === year)
          if (existing)
            return { budgets: s.budgets.map((b) => (b.id === existing.id ? { ...b, amount } : b)) }
          return { budgets: [...s.budgets, { id: uuid(), accountId, year, amount }] }
        }),

      deleteBudget: (id) =>
        set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) })),

      // ─── BANK RECONCILIATION ───────────────────────────────────────
      // marks individual JE lines (by je id + account) as reconciled per statement
      reconciliations: [],

      toggleReconciled: (bankAccountId, journalEntryId) =>
        set((s) => {
          const key = `${bankAccountId}::${journalEntryId}`
          const has = s.reconciliations.includes(key)
          return { reconciliations: has ? s.reconciliations.filter((k) => k !== key) : [...s.reconciliations, key] }
        }),

      // ─── THEME ─────────────────────────────────────────────────────
      setTheme: (theme) =>
        set((s) => ({ settings: { ...s.settings, theme } })),

      // ─── BACKUP / RESTORE ──────────────────────────────────────────
      exportData: () => {
        const s = get()
        const slices = [
          'settings', 'accounts', 'bankAccounts', 'customers', 'suppliers', 'inventoryItems',
          'journalEntries', 'invoices', 'quotations', 'creditNotes', 'purchaseOrders', 'purchases',
          'debitNotes', 'departments', 'employees', 'payrollRuns', 'fixedAssets', 'assetDepreciations',
          'stockAdjustments', 'prepaidExpenses', 'leases', 'expenseClaims', 'billsOfMaterials',
          'workOrders', 'bankTransactions', 'projects', 'timeEntries', 'budgets', 'reconciliations',
          'warehouses', 'stockTransfers', 'recurringInvoices', 'leads',
          'deliveryNotes', 'currencies', 'auditLog', 'requisitions',
        ]
        const out = { _app: 'erp-accounting-smb', _version: 11, _exportedAt: new Date().toISOString() }
        slices.forEach((k) => { out[k] = s[k] })
        return out
      },

      importData: (data) => {
        if (!data || data._app !== 'erp-accounting-smb') throw new Error('Invalid backup file')
        const { _app, _version, _exportedAt, ...slices } = data
        set((s) => ({ ...s, ...slices }))
      },

      resetAllData: () => {
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(currentCompanyKey()) } catch { /* ignore */ }
        if (typeof window !== 'undefined') window.location.reload()
      },

      // ─── COMPUTED ──────────────────────────────────────────────────
      getAccountBalance: (accountId, startDate, endDate) => {
        const s = get()
        const account = s.accounts.find((a) => a.id === accountId)
        if (!account) return 0
        let dr = 0, cr = 0
        s.journalEntries.forEach((je) => {
          if (startDate && je.date < startDate) return
          if (endDate   && je.date > endDate)   return
          je.lines.forEach((line) => {
            if (line.accountId === accountId) { dr += line.debit || 0; cr += line.credit || 0 }
          })
        })
        return ['asset', 'expense'].includes(account.type) ? dr - cr : cr - dr
      },

      getAllBalances: (startDate, endDate) => {
        const s = get()
        const balances = {}
        s.accounts.forEach((a) => { balances[a.id] = { dr: 0, cr: 0 } })
        s.journalEntries.forEach((je) => {
          if (startDate && je.date < startDate) return
          if (endDate   && je.date > endDate)   return
          je.lines.forEach((line) => {
            if (!balances[line.accountId]) balances[line.accountId] = { dr: 0, cr: 0 }
            balances[line.accountId].dr += line.debit  || 0
            balances[line.accountId].cr += line.credit || 0
          })
        })
        return balances
      },
    }),
    {
      name: currentCompanyKey(),
      version: 12,
      storage: createJSONStorage(() => safeStorage),
      migrate: (persisted, version) => {
       try {
        if (version < 4) {
          const existingIds = new Set((persisted.accounts || []).map((a) => a.id))
          const newAccounts = DEFAULT_ACCOUNTS.filter((a) => !existingIds.has(a.id))
          persisted.accounts = [...(persisted.accounts || []), ...newAccounts]

          persisted.settings = {
            ...DEFAULT_SETTINGS,
            ...persisted.settings,
            company: { ...DEFAULT_SETTINGS.company, ...(persisted.settings?.company || {}) },
            tax:     { ...DEFAULT_SETTINGS.tax,     ...(persisted.settings?.tax     || {}) },
          }

          if (!persisted.bankAccounts)       persisted.bankAccounts       = DEFAULT_BANK_ACCOUNTS
          if (!persisted.quotations)         persisted.quotations         = []
          if (!persisted.creditNotes)        persisted.creditNotes        = []
          if (!persisted.purchaseOrders)     persisted.purchaseOrders     = []
          if (!persisted.debitNotes)         persisted.debitNotes         = []
          if (!persisted.departments)        persisted.departments        = []
          if (!persisted.employees)          persisted.employees          = []
          if (!persisted.payrollRuns)        persisted.payrollRuns        = []
          if (!persisted.fixedAssets)        persisted.fixedAssets        = []
          if (!persisted.assetDepreciations) persisted.assetDepreciations = []
          if (!persisted.stockAdjustments)   persisted.stockAdjustments   = []
          if (!persisted.prepaidExpenses)    persisted.prepaidExpenses    = []
          if (!persisted.leases)             persisted.leases             = []
          if (!persisted.expenseClaims)      persisted.expenseClaims      = []
          if (!persisted.billsOfMaterials)   persisted.billsOfMaterials   = []
          if (!persisted.workOrders)         persisted.workOrders         = []
        }
        if (version < 5) {
          persisted.settings = {
            ...persisted.settings,
            project: persisted.settings?.project || { prefix: 'PRJ-', next: 1 },
            theme:   persisted.settings?.theme   || 'light',
          }
          if (!persisted.projects)        persisted.projects        = []
          if (!persisted.timeEntries)     persisted.timeEntries     = []
          if (!persisted.budgets)         persisted.budgets         = []
          if (!persisted.reconciliations) persisted.reconciliations = []
        }
        if (version < 6) {
          persisted.settings = {
            ...persisted.settings,
            recurring: persisted.settings?.recurring || { prefix: 'SUB-', next: 1 },
          }
          if (!persisted.warehouses)        persisted.warehouses        = DEFAULT_WAREHOUSES
          if (!persisted.stockTransfers)    persisted.stockTransfers    = []
          if (!persisted.recurringInvoices) persisted.recurringInvoices = []
        }
        if (version < 7) {
          persisted.settings = {
            ...persisted.settings,
            zatca: persisted.settings?.zatca || { enabled: false, vatNumber: '', crNumber: '', showQr: true },
          }
          if (persisted.settings.company && persisted.settings.company.arabicName === undefined) {
            persisted.settings.company.arabicName = ''
          }
        }
        if (version < 8) {
          if (!persisted.leads) persisted.leads = []
        }
        if (version < 9) {
          persisted.settings = {
            ...persisted.settings,
            delivery: persisted.settings?.delivery || { prefix: 'DLV-', next: 1 },
          }
          if (persisted.settings.company) {
            if (persisted.settings.company.logo === undefined) persisted.settings.company.logo = ''
            if (persisted.settings.company.accentColor === undefined) persisted.settings.company.accentColor = '#2563eb'
          }
          if (!persisted.deliveryNotes) persisted.deliveryNotes = []
          if (!persisted.currencies) persisted.currencies = []
        }
        if (version < 10) {
          if (!persisted.auditLog) persisted.auditLog = []
        }
        if (version < 11) {
          persisted.settings = {
            ...persisted.settings,
            requisition: persisted.settings?.requisition || { prefix: 'REQ-', next: 1 },
          }
          if (!persisted.requisitions) persisted.requisitions = []
        }
        if (version < 12) {
          persisted.settings = {
            ...persisted.settings,
            customFields: persisted.settings?.customFields || { customer: [], supplier: [] },
          }
        }
        return persisted
       } catch (e) {
        console.warn('ERP: data migration issue, continuing with existing data.', e)
        return persisted
       }
      },
    }
  )
)
