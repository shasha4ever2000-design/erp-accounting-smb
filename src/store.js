import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'

const DEFAULT_ACCOUNTS = [
  // === ASSETS ===
  { id: 'acc-cash',    code: '1001', name: 'Cash on Hand',            type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-bank1',  code: '1002', name: 'Main Bank Account',        type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-ar',     code: '1100', name: 'Accounts Receivable',      type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-vatin',  code: '1300', name: 'Tax Receivable (Input)',    type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-inv',    code: '1400', name: 'Inventory',                 type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-prepaid',code: '1500', name: 'Prepaid Expenses',          type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-fixed',  code: '1600', name: 'Fixed Assets',             type: 'asset',     subtype: 'non_current', isSystem: false },
  { id: 'acc-depr',   code: '1610', name: 'Accumulated Depreciation', type: 'asset',     subtype: 'non_current', isSystem: false },
  // === LIABILITIES ===
  { id: 'acc-ap',     code: '2001', name: 'Accounts Payable',         type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-vatout', code: '2100', name: 'Tax Payable (Output)',      type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-accrued',code: '2200', name: 'Accrued Expenses',         type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-loan',   code: '2300', name: 'Bank Loan',                type: 'liability', subtype: 'non_current', isSystem: false },
  // === EQUITY ===
  { id: 'acc-capital', code: '3001', name: "Owner's Capital",         type: 'equity',    subtype: 'equity',      isSystem: false },
  { id: 'acc-retained',code: '3002', name: 'Retained Earnings',       type: 'equity',    subtype: 'equity',      isSystem: true  },
  { id: 'acc-drawings',code: '3003', name: "Owner's Drawings",        type: 'equity',    subtype: 'equity',      isSystem: false },
  // === REVENUE ===
  { id: 'acc-sales',  code: '4001', name: 'Sales Revenue',            type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-svc',    code: '4002', name: 'Service Revenue',          type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-otherinc',code: '4003', name: 'Other Income',            type: 'revenue',   subtype: 'revenue',     isSystem: false },
  // === EXPENSES ===
  { id: 'acc-cogs',   code: '5001', name: 'Cost of Goods Sold',       type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-salary', code: '5002', name: 'Salaries & Wages',         type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-rent',   code: '5003', name: 'Rent Expense',             type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-util',   code: '5004', name: 'Utilities',                type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-admin',  code: '5005', name: 'General & Administrative', type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-mkt',    code: '5006', name: 'Marketing & Advertising',  type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-depexp', code: '5007', name: 'Depreciation Expense',     type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-interest',code:'5008', name: 'Interest Expense',         type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-misc',   code: '5009', name: 'Miscellaneous Expense',    type: 'expense',   subtype: 'expense',     isSystem: false },
]

function nextNum(prefix, n) {
  return `${prefix}${String(n).padStart(4, '0')}`
}

export const useStore = create(
  persist(
    (set, get) => ({
      // ─── SETTINGS ────────────────────────────────────────────────
      settings: {
        company: {
          name: 'My Company',
          address: '',
          phone: '',
          email: '',
          taxId: '',
          currency: 'USD',
          currencySymbol: '$',
          fiscalYearStart: '01',
        },
        tax: { enabled: false, rate: 15, name: 'VAT' },
        invoice:  { prefix: 'INV-', next: 1, notes: 'Thank you for your business!', dueDays: 30 },
        purchase: { prefix: 'PUR-', next: 1 },
        journal:  { prefix: 'JE-',  next: 1 },
        receipt:  { prefix: 'REC-', next: 1 },
        payment:  { prefix: 'PAY-', next: 1 },
      },

      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      updateCompany: (patch) =>
        set((s) => ({ settings: { ...s.settings, company: { ...s.settings.company, ...patch } } })),

      updateTax: (patch) =>
        set((s) => ({ settings: { ...s.settings, tax: { ...s.settings.tax, ...patch } } })),

      updateInvoiceSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, invoice: { ...s.settings.invoice, ...patch } } })),

      // ─── ACCOUNTS ────────────────────────────────────────────────
      accounts: DEFAULT_ACCOUNTS,

      addAccount: (a) =>
        set((s) => ({ accounts: [...s.accounts, { ...a, id: uuid() }] })),

      updateAccount: (id, patch) =>
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),

      deleteAccount: (id) =>
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) })),

      // ─── CUSTOMERS ───────────────────────────────────────────────
      customers: [],

      addCustomer: (c) =>
        set((s) => ({ customers: [...s.customers, { ...c, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateCustomer: (id, patch) =>
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      deleteCustomer: (id) =>
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) })),

      // ─── SUPPLIERS ───────────────────────────────────────────────
      suppliers: [],

      addSupplier: (sup) =>
        set((s) => ({ suppliers: [...s.suppliers, { ...sup, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateSupplier: (id, patch) =>
        set((s) => ({ suppliers: s.suppliers.map((sup) => (sup.id === id ? { ...sup, ...patch } : sup)) })),

      deleteSupplier: (id) =>
        set((s) => ({ suppliers: s.suppliers.filter((sup) => sup.id !== id) })),

      // ─── INVENTORY ITEMS ─────────────────────────────────────────
      inventoryItems: [],

      addInventoryItem: (item) =>
        set((s) => ({ inventoryItems: [...s.inventoryItems, { ...item, id: uuid() }] })),

      updateInventoryItem: (id, patch) =>
        set((s) => ({ inventoryItems: s.inventoryItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

      deleteInventoryItem: (id) =>
        set((s) => ({ inventoryItems: s.inventoryItems.filter((i) => i.id !== id) })),

      // ─── JOURNAL ENTRIES (core) ──────────────────────────────────
      journalEntries: [],

      _createJE: (entry) => {
        const s = get()
        const { prefix, next } = s.settings.journal
        const number = nextNum(prefix, next)
        const newJE = { ...entry, id: uuid(), number, createdAt: new Date().toISOString() }
        set((st) => ({
          journalEntries: [...st.journalEntries, newJE],
          settings: {
            ...st.settings,
            journal: { ...st.settings.journal, next: st.settings.journal.next + 1 },
          },
        }))
        return newJE
      },

      addJournalEntry: (entry) => {
        const s = get()
        const { prefix, next } = s.settings.journal
        const number = nextNum(prefix, next)
        const newJE = { ...entry, id: uuid(), number, type: entry.type || 'manual', createdAt: new Date().toISOString() }
        set((st) => ({
          journalEntries: [...st.journalEntries, newJE],
          settings: {
            ...st.settings,
            journal: { ...st.settings.journal, next: st.settings.journal.next + 1 },
          },
        }))
        return newJE
      },

      updateJournalEntry: (id, patch) =>
        set((s) => ({ journalEntries: s.journalEntries.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),

      deleteJournalEntry: (id) =>
        set((s) => ({ journalEntries: s.journalEntries.filter((j) => j.id !== id) })),

      // ─── SALES INVOICES ──────────────────────────────────────────
      invoices: [],

      addInvoice: (invoice) => {
        const s = get()
        const { prefix, next } = s.settings.invoice
        const number = nextNum(prefix, next)

        // Build journal entry lines
        const lines = []
        // Dr Accounts Receivable
        lines.push({ accountId: 'acc-ar', debit: invoice.total, credit: 0, description: `Invoice ${number}` })
        // Cr Revenue per line
        const revenueMap = {}
        invoice.items.forEach((item) => {
          const acc = item.accountId || 'acc-sales'
          revenueMap[acc] = (revenueMap[acc] || 0) + item.subtotal
        })
        Object.entries(revenueMap).forEach(([accId, amount]) =>
          lines.push({ accountId: accId, debit: 0, credit: amount, description: `Revenue – ${number}` })
        )
        // Cr Tax payable
        if (invoice.taxAmount > 0)
          lines.push({ accountId: 'acc-vatout', debit: 0, credit: invoice.taxAmount, description: 'Output Tax' })

        const je = get().addJournalEntry({
          date: invoice.date,
          description: `Sales Invoice ${number} – ${invoice.customerName || ''}`,
          reference: number,
          type: 'invoice',
          lines,
        })

        const newInvoice = {
          ...invoice,
          id: uuid(),
          number,
          status: 'sent',
          amountPaid: 0,
          payments: [],
          journalEntryId: je.id,
          createdAt: new Date().toISOString(),
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
          reference: number,
          type: 'receipt',
          lines: [
            { accountId: payment.bankAccountId, debit: payment.amount, credit: 0, description: `Receipt for ${invoice.number}` },
            { accountId: 'acc-ar', debit: 0, credit: payment.amount, description: `Receipt for ${invoice.number}` },
          ],
        })

        set((st) => ({
          invoices: st.invoices.map((i) =>
            i.id === invoiceId
              ? {
                  ...i,
                  amountPaid: newAmountPaid,
                  status,
                  payments: [...(i.payments || []), { ...payment, id: uuid(), number, journalEntryId: je.id }],
                }
              : i
          ),
          settings: { ...st.settings, receipt: { ...st.settings.receipt, next: next + 1 } },
        }))
      },

      updateInvoice: (id, patch) =>
        set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

      deleteInvoice: (id) =>
        set((s) => {
          const inv = s.invoices.find((i) => i.id === id)
          return {
            invoices: s.invoices.filter((i) => i.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== inv?.journalEntryId),
          }
        }),

      // ─── PURCHASE INVOICES ────────────────────────────────────────
      purchases: [],

      addPurchase: (purchase) => {
        const s = get()
        const { prefix, next } = s.settings.purchase
        const number = nextNum(prefix, next)

        const lines = []
        // Dr Expense / Inventory per line
        const expMap = {}
        purchase.items.forEach((item) => {
          const acc = item.accountId || 'acc-admin'
          expMap[acc] = (expMap[acc] || 0) + item.subtotal
        })
        Object.entries(expMap).forEach(([accId, amount]) =>
          lines.push({ accountId: accId, debit: amount, credit: 0, description: `Purchase – ${number}` })
        )
        // Dr Input Tax
        if (purchase.taxAmount > 0)
          lines.push({ accountId: 'acc-vatin', debit: purchase.taxAmount, credit: 0, description: 'Input Tax' })
        // Cr Accounts Payable
        lines.push({ accountId: 'acc-ap', debit: 0, credit: purchase.total, description: `Purchase ${number}` })

        const je = get().addJournalEntry({
          date: purchase.date,
          description: `Purchase Invoice ${number} – ${purchase.supplierName || ''}`,
          reference: number,
          type: 'purchase',
          lines,
        })

        const newPurchase = {
          ...purchase,
          id: uuid(),
          number,
          status: 'received',
          amountPaid: 0,
          payments: [],
          journalEntryId: je.id,
          createdAt: new Date().toISOString(),
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
          reference: number,
          type: 'payment_out',
          lines: [
            { accountId: 'acc-ap', debit: payment.amount, credit: 0, description: `Payment for ${purchase.number}` },
            { accountId: payment.bankAccountId, debit: 0, credit: payment.amount, description: `Payment for ${purchase.number}` },
          ],
        })

        set((st) => ({
          purchases: st.purchases.map((p) =>
            p.id === purchaseId
              ? {
                  ...p,
                  amountPaid: newAmountPaid,
                  status,
                  payments: [...(p.payments || []), { ...payment, id: uuid(), number, journalEntryId: je.id }],
                }
              : p
          ),
          settings: { ...st.settings, payment: { ...st.settings.payment, next: next + 1 } },
        }))
      },

      updatePurchase: (id, patch) =>
        set((s) => ({ purchases: s.purchases.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      deletePurchase: (id) =>
        set((s) => {
          const pur = s.purchases.find((p) => p.id === id)
          return {
            purchases: s.purchases.filter((p) => p.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== pur?.journalEntryId),
          }
        }),

      // ─── DIRECT BANK TRANSACTIONS ────────────────────────────────
      bankTransactions: [],

      addBankTransaction: (tx) => {
        const lines =
          tx.type === 'money_in'
            ? [
                { accountId: tx.bankAccountId, debit: tx.amount, credit: 0, description: tx.description },
                { accountId: tx.accountId, debit: 0, credit: tx.amount, description: tx.description },
              ]
            : [
                { accountId: tx.accountId, debit: tx.amount, credit: 0, description: tx.description },
                { accountId: tx.bankAccountId, debit: 0, credit: tx.amount, description: tx.description },
              ]

        const je = get().addJournalEntry({
          date: tx.date,
          description: tx.description,
          reference: tx.reference || '',
          type: tx.type,
          lines,
        })

        set((s) => ({
          bankTransactions: [
            ...s.bankTransactions,
            { ...tx, id: uuid(), journalEntryId: je.id, createdAt: new Date().toISOString() },
          ],
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

      // ─── COMPUTED: Account Balance ────────────────────────────────
      getAccountBalance: (accountId, startDate, endDate) => {
        const s = get()
        const account = s.accounts.find((a) => a.id === accountId)
        if (!account) return 0

        let dr = 0, cr = 0
        s.journalEntries.forEach((je) => {
          if (startDate && je.date < startDate) return
          if (endDate && je.date > endDate) return
          je.lines.forEach((line) => {
            if (line.accountId === accountId) {
              dr += line.debit || 0
              cr += line.credit || 0
            }
          })
        })

        return ['asset', 'expense'].includes(account.type) ? dr - cr : cr - dr
      },

      getAllBalances: (startDate, endDate) => {
        const s = get()
        const balances = {}
        s.accounts.forEach((a) => {
          balances[a.id] = { dr: 0, cr: 0 }
        })

        s.journalEntries.forEach((je) => {
          if (startDate && je.date < startDate) return
          if (endDate && je.date > endDate) return
          je.lines.forEach((line) => {
            if (!balances[line.accountId]) balances[line.accountId] = { dr: 0, cr: 0 }
            balances[line.accountId].dr += line.debit || 0
            balances[line.accountId].cr += line.credit || 0
          })
        })

        return balances
      },
    }),
    { name: 'erp-v1', version: 2 }
  )
)
