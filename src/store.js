import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { currentCompanyKey } from './boot'
import { useAuth } from './auth'
import { idbKvStorage } from './utils/idbKvStorage'
import { docFulfillment, defaultSelection, buildConversion } from './utils/fulfillment'
import { allocateLandedCost } from './utils/landedCost'
import { explodeLines, isKit, kitCost, validateKit } from './utils/kits'
import {
  COUNT_STATUS, buildSheet as buildCountSheet, validateCount,
  postingLines as countPostingLines, stockChanges as countStockChanges, summarise as summariseCount,
} from './utils/stockCount'
import { diffRecord, describeChanges, severityFor } from './utils/auditDiff'
import { defaultApprovalSettings, needsApproval, canApprove, amountOf } from './utils/approvals'
import { buildOpeningEntry, validateOpening, OBE_ACCOUNT } from './utils/openingBalances'
import { RECYCLABLE, isRecyclable, makeEntry, canRestore } from './utils/recycleBin'
import { defaultBranding, validateBranding } from './utils/branding'
import { defaultTerms, resolveTerms, dueDateFor, settlementDiscount, discountLines, validateTerms } from './utils/paymentTerms'
import { nextBatch as nextCycleBatch, defaultPolicy as defaultCyclePolicy } from './utils/cycleCount'
import {
  emptyContract, contractFor as contractInForce, serviceStart as serviceStartOf,
  validateContract, grossOf as contractGross, contributoryWage,
} from './utils/contracts'
import {
  defaultEosbSettings, eosbAward, accruedProvision, accrualSchedule,
  accrualLines as eosbAccrualLines, settlementLines as eosbSettlementLines, EOSB_ACCOUNTS,
} from './utils/endOfService'
import { sheetFor, summarise as summariseAttendance, payrollImpact, validateDay, periodOf } from './utils/attendance'
import {
  CF_ENTITIES, newField as newCustomField, normaliseField as normaliseCustomField,
  fieldsFor as customFieldsFor, coerceValues as coerceCustomValues,
  validateField as validateCustomField, migrateLegacy as migrateCustomFieldSettings,
} from './utils/customFields'
import { DEFAULT_GROUPS, assignDefaultGroups, validateGroup, deleteGroupPlan, defaultGroupFor } from './utils/accountTree'
import {
  CAPITAL_CONTROL, DEFAULT_SUBACCOUNTS, validateCapitalAccount,
  movementLines, allocateProfit, profitAllocationLines,
} from './utils/capitalAccounts'
import {
  CONTROL_KINDS, resolveControl, validateControlAccount, controlAccountsFor,
  reclassLines, fieldFor, defaultFor,
} from './utils/controlAccounts'

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
  { id: 'acc-ar',     code: '1100', name: 'Accounts Receivable',        type: 'asset',     subtype: 'current',     isSystem: true, controlFor: 'customers'  },
  { id: 'acc-vatin',  code: '1300', name: 'Tax Receivable (Input)',      type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-inv',    code: '1400', name: 'Inventory',                   type: 'asset',     subtype: 'current',     isSystem: false, controlFor: 'inventoryItems' },
  { id: 'acc-rawmat', code: '1410', name: 'Raw Materials',               type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-wip',    code: '1420', name: 'Work-in-Progress',            type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-fingoods',code:'1430', name: 'Finished Goods',              type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-prepaid',code: '1500', name: 'Prepaid Expenses',            type: 'asset',     subtype: 'current',     isSystem: false },
  // ASSETS – Non-Current
  { id: 'acc-fixed',  code: '1600', name: 'Fixed Assets – Cost',        type: 'asset',     subtype: 'non_current', isSystem: true  },
  { id: 'acc-depr',   code: '1610', name: 'Accumulated Depreciation',   type: 'asset',     subtype: 'non_current', isSystem: true  },
  { id: 'acc-rou',    code: '1620', name: 'Right-of-Use Assets',        type: 'asset',     subtype: 'non_current', isSystem: false },
  // LIABILITIES – Current
  { id: 'acc-ap',     code: '2001', name: 'Accounts Payable',           type: 'liability', subtype: 'current',     isSystem: true, controlFor: 'suppliers'  },
  { id: 'acc-grni',   code: '2050', name: 'Goods Received Not Invoiced', type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-vatout', code: '2100', name: 'Tax Payable (Output)',        type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-wht',    code: '2110', name: 'Withholding Tax Payable',     type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-salpay', code: '2200', name: 'Salaries Payable',           type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-paye',   code: '2201', name: 'PAYE Tax Payable',           type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-sspay',  code: '2202', name: 'Social Security Payable',    type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-eosb-prov', code: '2215', name: 'End-of-Service Provision',  type: 'liability', subtype: 'noncurrent',  isSystem: false },
  { id: 'acc-expclaim',code:'2210', name: 'Employee Expense Claims',    type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-accrued',code: '2300', name: 'Accrued Expenses',           type: 'liability', subtype: 'current',     isSystem: false },
  // LIABILITIES – Non-Current
  { id: 'acc-creditcard',code:'2410', name: 'Credit Card',             type: 'liability', subtype: 'current',     isSystem: false },
  { id: 'acc-loan',   code: '2400', name: 'Bank Loan',                  type: 'liability', subtype: 'non_current', isSystem: false },
  { id: 'acc-leasepay',code:'2500', name: 'Lease Liability',            type: 'liability', subtype: 'non_current', isSystem: false },
  // EQUITY
  { id: 'acc-capital', code: '3001', name: "Owner's Capital",           type: 'equity',    subtype: 'equity',      isSystem: false },
  { id: 'acc-retained',code: '3002', name: 'Retained Earnings',         type: 'equity',    subtype: 'equity',      isSystem: true  },
  { id: 'acc-drawings',code: '3003', name: "Owner's Drawings",          type: 'equity',    subtype: 'equity',      isSystem: false },
  { id: 'acc-capital-ctl', code: '3005', name: 'Capital Accounts',      type: 'equity',    subtype: 'equity',      isSystem: true  },
  { id: 'acc-obe',    code: '3009', name: 'Opening Balance Equity',      type: 'equity',    subtype: 'equity',      isSystem: true  },
  // REVENUE
  { id: 'acc-sales',  code: '4001', name: 'Sales Revenue',              type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-svc',    code: '4002', name: 'Service Revenue',            type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-otherinc',code:'4003', name: 'Other Income',               type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-gainloss',code:'4004', name: 'Gain on Asset Disposal',     type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-fxgl',   code: '4005', name: 'Unrealized FX Gain/(Loss)',  type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-fxreal', code: '4006', name: 'Realized FX Gain/(Loss)',    type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-salesret',code:'4010', name: 'Sales Returns & Allowances', type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-salesdisc',code:'4011',name: 'Sales Discounts',           type: 'revenue',   subtype: 'revenue',     isSystem: false },
  { id: 'acc-shipinc', code: '4020', name: 'Shipping & Delivery Income',type: 'revenue',   subtype: 'revenue',     isSystem: false },
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
  { id: 'acc-bankchg',code: '5014', name: 'Bank Charges',               type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-purchdisc',code:'5030',name: 'Purchase Discounts',        type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-freightin',code:'5031',name: 'Freight-In / Delivery',     type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-gosiemp',code: '5015', name: 'Employer Social Insurance (GOSI)', type: 'expense', subtype: 'expense', isSystem: false },
  { id: 'acc-eosb-exp', code: '5016', name: 'End-of-Service Benefit',          type: 'expense', subtype: 'expense', isSystem: false },
  { id: 'acc-purret', code: '5012', name: 'Purchase Returns',           type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-mfgcost',code: '5013', name: 'Manufacturing Costs',        type: 'expense',   subtype: 'expense',     isSystem: false },
]

const DEFAULT_BANK_ACCOUNTS = [
  { id: 'ba-cash',  accountId: 'acc-cash',  name: 'Petty Cash',        type: 'cash', bankName: '', accountNumber: '', isDefault: false },
  { id: 'ba-bank1', accountId: 'acc-bank1', name: 'Main Bank Account', type: 'bank', bankName: '', accountNumber: '', isDefault: true  },
]

const DEFAULT_SETTINGS = {
  company: { name: 'My Company', arabicName: '', address: '', phone: '', email: '', taxId: '', currency: 'USD', currencySymbol: '$', fiscalYearStart: '01', logo: '', accentColor: '#2563eb' },
  branding:      defaultBranding(),
  terms:         defaultTerms(),
  cycleCount:    { policy: defaultCyclePolicy(), batchSize: 20 },
  tax:           { enabled: false, rate: 15, name: 'VAT', system: 'vat', country: '' },
  zatca:         { enabled: false, vatNumber: '', crNumber: '', showQr: true },
  wht:           { enabled: false, rate: 5, name: 'Withholding Tax' },
  customFields:  Object.fromEntries(CF_ENTITIES.map((e) => [e.id, []])),
  invoice:       { prefix: 'INV-',  next: 1, notes: 'Thank you for your business!', dueDays: 30, bankDetails: '' },
  purchase:      { prefix: 'PUR-',  next: 1 },
  journal:       { prefix: 'JE-',   next: 1 },
  receipt:       { prefix: 'REC-',  next: 1 },
  payment:       { prefix: 'PAY-',  next: 1 },
  quotation:     { prefix: 'QUO-',  next: 1 },
  stockCount:    { prefix: 'SC-',   next: 1 },
  salesOrder:    { prefix: 'SO-',   next: 1 },
  purchaseQuote: { prefix: 'PQ-',   next: 1 },
  purchaseOrder: { prefix: 'PO-',   next: 1 },
  goodsReceipt:  { prefix: 'GRN-',  next: 1 },
  creditNote:    { prefix: 'CN-',   next: 1 },
  debitNote:     { prefix: 'DN-',   next: 1 },
  ai:            { apiKey: '', model: 'claude-haiku-4-5-20251001' },
  accounting:    { lockDate: '', lockedBy: '', lockedAt: '', autoPostRecurring: true }, // period close + auto-post scheduler
  approvals:     defaultApprovalSettings(), // threshold-based maker-checker
  opening:       { date: '', posted: false, journalEntryId: null, postedAt: '', counts: null }, // migration cutover
  payroll:       { prefix: 'PR-',    next: 1 },
  hr:            { eosb: defaultEosbSettings(), restDays: [5, 6], deductLate: false, lateGraceMinutes: 0 },
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

/** Shift an ISO date by whole days. UTC, so a timezone can't move the boundary. */
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
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
        set((s) => ({ settings: { ...s.settings, customFields: { ...(s.settings.customFields || {}), ...patch } } })),

      // Custom field definitions, one list per form.
      //
      // Deliberately no "delete all values" step on removal: the definition
      // goes, the values stay in the records. If the field was removed by
      // mistake — and it will be — recreating it is a rename away from
      // restoring the data, whereas a cascading delete is unrecoverable in a
      // local-first app with no server-side backup.
      customFieldsFor: (entityId) => customFieldsFor(get().settings, entityId),

      addCustomField: (entityId, patch) => {
        const list = customFieldsFor(get().settings, entityId)
        const check = validateCustomField(patch, list)
        if (!check.ok) throw new Error(`CUSTOM_FIELD_INVALID: ${check.errors.join(' ')}`)
        const field = normaliseCustomField({ ...newCustomField(), ...patch, sort: (list.length + 1) * 10 })
        set((s) => ({ settings: { ...s.settings, customFields: {
          ...(s.settings.customFields || {}),
          [entityId]: [...(s.settings.customFields?.[entityId] || []), field],
        } } }))
        get().logActivity('Added custom field', `${field.name} · ${entityId}`)
        return field
      },

      updateCustomField: (entityId, id, patch) => {
        const list = customFieldsFor(get().settings, entityId)
        const current = list.find((f) => f.id === id)
        if (!current) return null
        const merged = { ...current, ...patch, id }
        const check = validateCustomField(merged, list, { id })
        if (!check.ok) throw new Error(`CUSTOM_FIELD_INVALID: ${check.errors.join(' ')}`)
        const field = normaliseCustomField(merged)
        set((s) => ({ settings: { ...s.settings, customFields: {
          ...(s.settings.customFields || {}),
          [entityId]: (s.settings.customFields?.[entityId] || []).map((f) => (f.id === id ? field : f)),
        } } }))
        return field
      },

      deleteCustomField: (entityId, id) => {
        set((s) => ({ settings: { ...s.settings, customFields: {
          ...(s.settings.customFields || {}),
          [entityId]: (s.settings.customFields?.[entityId] || []).filter((f) => f.id !== id),
        } } }))
        get().logActivity('Removed custom field', entityId)
      },

      moveCustomField: (entityId, id, delta) => {
        const list = customFieldsFor(get().settings, entityId)
        const at = list.findIndex((f) => f.id === id)
        const to = at + (delta < 0 ? -1 : 1)
        if (at < 0 || to < 0 || to >= list.length) return
        const next = [...list]
        next.splice(to, 0, next.splice(at, 1)[0])
        set((s) => ({ settings: { ...s.settings, customFields: {
          ...(s.settings.customFields || {}),
          [entityId]: next.map((f, i) => ({ ...f, sort: (i + 1) * 10 })),
        } } }))
      },

      /** Clean a form's custom-field bag against the current definitions. */
      cleanCustomValues: (entityId, values) =>
        coerceCustomValues(customFieldsFor(get().settings, entityId), values),

      updateWht: (patch) =>
        set((s) => ({ settings: { ...s.settings, wht: { ...(s.settings.wht || { enabled: false, rate: 5, name: 'Withholding Tax' }), ...patch } } })),

      updateApprovals: (patch) =>
        set((s) => ({ settings: { ...s.settings, approvals: {
          ...defaultApprovalSettings(), ...(s.settings.approvals || {}), ...patch,
          thresholds: { ...defaultApprovalSettings().thresholds, ...(s.settings.approvals?.thresholds || {}), ...(patch.thresholds || {}) },
        } } })),

      // ─── PERIOD CLOSE / POSTING-DATE LOCK ──────────────────────────
      // A locked period bars any journal posting dated on or before lockDate,
      // preserving the integrity of already-reported/closed periods.
      setPeriodLock: ({ lockDate, lockedBy }) =>
        set((s) => ({ settings: { ...s.settings, accounting: {
          ...(s.settings.accounting || {}), lockDate: lockDate || '',
          lockedBy: lockDate ? (lockedBy || '') : '', lockedAt: lockDate ? new Date().toISOString() : '',
        } } })),

      // ─── YEAR-END CLOSE ────────────────────────────────────────────
      // Record a fiscal year as closed and lock the books through its end.
      // No closing journal is posted: retained earnings is computed on the
      // balance sheet, so profit rolls forward automatically.
      closeFiscalYear: ({ label, start, end, netIncome, by }) =>
        set((s) => {
          const acc = s.settings.accounting || {}
          const closedYears = (acc.closedYears || []).filter((c) => c.label !== label)
          closedYears.push({ label, start, end, netIncome, closedAt: new Date().toISOString(), by: by || '' })
          closedYears.sort((a, b) => a.end.localeCompare(b.end))
          const lockDate = !acc.lockDate || acc.lockDate < end ? end : acc.lockDate
          return { settings: { ...s.settings, accounting: {
            ...acc, closedYears, lockDate, lockedBy: by || acc.lockedBy || '', lockedAt: new Date().toISOString(),
          } } }
        }),

      reopenFiscalYear: (label) =>
        set((s) => {
          const acc = s.settings.accounting || {}
          const target = (acc.closedYears || []).find((c) => c.label === label)
          const closedYears = (acc.closedYears || []).filter((c) => c.label !== label)
          // If the lock sat exactly at this year's end, fall back to the latest
          // remaining closed year (or clear it).
          let lockDate = acc.lockDate
          if (target && acc.lockDate === target.end) {
            lockDate = closedYears.length ? closedYears[closedYears.length - 1].end : ''
          }
          return { settings: { ...s.settings, accounting: { ...acc, closedYears, lockDate } } }
        }),

      // Toggle the boot-time auto-posting of due recurring invoices/journals.
      setAutoPostRecurring: (enabled) =>
        set((s) => ({ settings: { ...s.settings, accounting: {
          ...(s.settings.accounting || {}), autoPostRecurring: !!enabled,
        } } })),

      // true when `date` (YYYY-MM-DD) falls in a closed period
      isDateLocked: (date) => {
        const lock = get().settings?.accounting?.lockDate
        return !!(lock && date && String(date) <= String(lock))
      },

      // ─── ACCOUNTS ──────────────────────────────────────────────────
      accounts: assignDefaultGroups(DEFAULT_ACCOUNTS),

      addAccount: (a) =>
        set((s) => ({
          accounts: [...s.accounts, { ...a, id: uuid(), groupId: a.groupId || defaultGroupFor(a) }],
        })),

      updateAccount: (id, patch) => {
        const before = get().accounts.find((a) => a.id === id)
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
        get().logChange('Updated account', before, get().accounts.find((a) => a.id === id), { entity: 'account' })
      },

      deleteAccount: (id) => {
        get().recycleRecord('accounts', id)
        const gone = get().accounts.find((a) => a.id === id)
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }))
        if (gone) get().logActivity('Deleted account', `${gone.code} – ${gone.name}`, { entity: 'account', entityId: id, entityRef: gone.code })
      },

      // ─── ACCOUNT GROUPS ────────────────────────────────────────────
      // The chart is a tree; groups are the branches. They hold no balance of
      // their own — a group total is always the sum of what is under it, so
      // there is no way for a group and its contents to disagree.
      accountGroups: DEFAULT_GROUPS.map((g) => ({ ...g })),

      addAccountGroup: (g) => {
        const check = validateGroup(g, get().accountGroups)
        if (!check.ok) throw new Error(`GROUP_INVALID:${check.errors.join(' ')}`)
        const id = uuid()
        set((s) => ({
          accountGroups: [...s.accountGroups, {
            id,
            name: String(g.name).trim(),
            code: g.code || '',
            type: g.type,
            parentId: g.parentId || null,
            sort: g.sort ?? 500,
            role: g.role || '',
          }],
        }))
        get().logActivity('Created account group', String(g.name).trim(), { entity: 'accountGroup', entityId: id })
        return id
      },

      updateAccountGroup: (id, patch) => {
        const before = get().accountGroups.find((g) => g.id === id)
        if (!before) throw new Error('GROUP_NOT_FOUND')
        // Validate the merged result, not the patch — a rename alone must not
        // be judged against a half-filled object.
        const check = validateGroup({ ...before, ...patch }, get().accountGroups, { id })
        if (!check.ok) throw new Error(`GROUP_INVALID:${check.errors.join(' ')}`)
        set((s) => ({ accountGroups: s.accountGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
        get().logChange('Updated account group', before, get().accountGroups.find((g) => g.id === id), { entity: 'accountGroup' })
      },

      /**
       * Delete a group and lift everything inside it up one level.
       *
       * Nothing is orphaned: subgroups and accounts re-parent to the deleted
       * group's parent, or become ungrouped at the top of their type. A report
       * that quietly lost a branch because someone tidied a header would be
       * far worse than an untidy chart.
       */
      deleteAccountGroup: (id) => {
        const gone = get().accountGroups.find((g) => g.id === id)
        if (!gone) return
        const plan = deleteGroupPlan(get().accountGroups, get().accounts, id)
        const reparent = Object.fromEntries(plan.groupUpdates.map((u) => [u.id, u.parentId]))
        const regroup = Object.fromEntries(plan.accountUpdates.map((u) => [u.id, u.groupId]))
        set((s) => ({
          accountGroups: s.accountGroups
            .filter((g) => g.id !== id)
            .map((g) => (g.id in reparent ? { ...g, parentId: reparent[g.id] } : g)),
          accounts: s.accounts.map((a) => (a.id in regroup ? { ...a, groupId: regroup[a.id] } : a)),
        }))
        get().logActivity('Deleted account group', gone.name, {
          entity: 'accountGroup', entityId: id, entityRef: gone.code || gone.name,
        })
        return { movedAccounts: plan.accountUpdates.length, movedGroups: plan.groupUpdates.length }
      },

      /** Move an account into a group. Refuses a group of a different type. */
      moveAccountToGroup: (accountId, groupId) => {
        const acc = get().accounts.find((a) => a.id === accountId)
        if (!acc) throw new Error('ACCOUNT_NOT_FOUND')
        if (groupId) {
          const grp = get().accountGroups.find((g) => g.id === groupId)
          if (!grp) throw new Error('GROUP_NOT_FOUND')
          if (grp.type !== acc.type)
            throw new Error('GROUP_TYPE_MISMATCH')
        }
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, groupId: groupId || '' } : a)) }))
      },

      // ─── CONTROL ACCOUNTS ──────────────────────────────────────────
      // Receivables, payables and inventory can each be split across several
      // control accounts. Nothing posts to a record's stored pointer directly —
      // it goes through here, which falls back to the default whenever that
      // pointer no longer names a usable control account. See
      // utils/controlAccounts.js for why that matters.

      /** The account a customer / supplier / item actually posts through. */
      controlAccountFor: (kind, recordId) => {
        const st = get()
        const record = (st[CONTROL_KINDS[kind]?.slice] || []).find((r) => r.id === recordId)
        return resolveControl(record, kind, st.accounts)
      },

      /** Every account usable as a control account of this kind. */
      controlAccountOptions: (kind) => controlAccountsFor(get().accounts, kind),

      /** Nominate an account as a control account, or stand it down. */
      setAccountControlKind: (accountId, kind) => {
        const account = get().accounts.find((a) => a.id === accountId)
        if (!account) throw new Error('ACCOUNT_NOT_FOUND')

        if (!kind) {
          // Standing an account down while records still point at it would
          // silently redirect their postings to the default — the balance
          // sheet would go on balancing while two accounts quietly went wrong.
          const slice = CONTROL_KINDS[account.controlFor]?.slice
          const inUse = slice
            ? (get()[slice] || []).filter((r) => r[fieldFor(account.controlFor)] === accountId).length
            : 0
          if (inUse) throw new Error(`CONTROL_IN_USE:${inUse}`)
          set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, controlFor: '' } : a)) }))
          return
        }

        const check = validateControlAccount(account, kind)
        if (!check.ok) throw new Error(`CONTROL_INVALID:${check.errors.join(' ')}`)
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, controlFor: kind } : a)) }))
        get().logActivity('Made a control account', `${account.code} – ${account.name}`, { entity: 'account', entityId: accountId })
      },

      /**
       * Point a customer, supplier or item at a different control account.
       *
       * An outstanding balance is moved with a reclassification entry rather
       * than by rewriting history. Leaving the old debt where it was while new
       * receipts credit the new account would make both accounts wrong, and
       * the customer's own statement would reconcile to neither.
       */
      setRecordControlAccount: (kind, recordId, accountId, { date } = {}) => {
        const cfg = CONTROL_KINDS[kind]
        if (!cfg) throw new Error('CONTROL_KIND_UNKNOWN')
        const st = get()
        const record = (st[cfg.slice] || []).find((r) => r.id === recordId)
        if (!record) throw new Error('RECORD_NOT_FOUND')

        const from = resolveControl(record, kind, st.accounts)
        const target = accountId || defaultFor(kind)
        if (target !== defaultFor(kind)) {
          const account = st.accounts.find((a) => a.id === target)
          const check = validateControlAccount(account, kind)
          if (!check.ok) throw new Error(`CONTROL_INVALID:${check.errors.join(' ')}`)
        }

        const field = fieldFor(kind)
        if (from === target) {
          set((s) => ({ [cfg.slice]: s[cfg.slice].map((r) => (r.id === recordId ? { ...r, [field]: accountId || '' } : r)) }))
          return { moved: 0, journalEntryId: null }
        }

        // What this record still owes, read from the documents rather than the
        // ledger: invoice and bill postings carry no customer or supplier id,
        // so the ledger cannot be filtered by party. The open document balance
        // is the right figure regardless — it is what the aging reports and
        // customer statements are built from.
        const openDocs = kind === 'customers' ? st.invoices : kind === 'suppliers' ? st.purchases : []
        const partyField = kind === 'customers' ? 'customerId' : 'supplierId'
        let balance = openDocs.reduce((sum, d) => {
          if (d[partyField] !== recordId) return sum
          if (['cancelled', 'void', 'draft'].includes(d.status)) return sum
          return sum + ((+d.total || 0) - (+d.amountPaid || 0))
        }, 0)
        balance = Math.round(balance * 100) / 100

        let entry = null
        if (balance !== 0) {
          // `balance` is what the party owes (or is owed), already expressed in
          // the control account's own natural direction — a receivable as a
          // debit, a payable as a credit. reclassLines works in those same
          // terms, so it is passed through unchanged; negating it here would
          // move payables the wrong way.
          entry = get().addJournalEntry({
            date: date || new Date().toISOString().slice(0, 10),
            description: `Reclassified ${record.name || cfg.noun} to a different control account`,
            type: 'reclass',
            ...(kind === 'customers' ? { customerId: recordId } : {}),
            ...(kind === 'suppliers' ? { supplierId: recordId } : {}),
            lines: reclassLines(kind, {
              fromAccountId: from, toAccountId: target, amount: balance, name: record.name || "",
            }),
          })
        }

        set((s) => ({ [cfg.slice]: s[cfg.slice].map((r) => (r.id === recordId ? { ...r, [field]: accountId || '' } : r)) }))
        return { moved: balance, journalEntryId: entry?.id || null }
      },

      // ─── CAPITAL ACCOUNTS ──────────────────────────────────────────
      // A subledger over acc-capital-ctl, one row per owner or partner. See
      // utils/capitalAccounts.js for why the detail cannot live in the chart
      // of accounts itself.
      capitalAccounts: [],
      capitalSubaccounts: DEFAULT_SUBACCOUNTS.map((s) => ({ ...s })),

      addCapitalAccount: (a) => {
        const check = validateCapitalAccount(a, get().capitalAccounts)
        if (!check.ok) throw new Error(`CAPITAL_INVALID:${check.errors.join(' ')}`)
        const id = uuid()
        set((s) => ({
          capitalAccounts: [...s.capitalAccounts, {
            id,
            name: String(a.name).trim(),
            code: a.code || '',
            share: a.share === '' || a.share == null ? 0 : Number(a.share),
            notes: a.notes || '',
            active: a.active !== false,
            createdAt: new Date().toISOString(),
          }],
        }))
        get().logActivity('Created capital account', String(a.name).trim(), { entity: 'capitalAccount', entityId: id })
        return id
      },

      updateCapitalAccount: (id, patch) => {
        const before = get().capitalAccounts.find((a) => a.id === id)
        if (!before) throw new Error('CAPITAL_NOT_FOUND')
        const check = validateCapitalAccount({ ...before, ...patch }, get().capitalAccounts, { id })
        if (!check.ok) throw new Error(`CAPITAL_INVALID:${check.errors.join(' ')}`)
        set((s) => ({ capitalAccounts: s.capitalAccounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
        get().logChange('Updated capital account', before, get().capitalAccounts.find((a) => a.id === id), { entity: 'capitalAccount' })
      },

      /**
       * A capital account with history cannot be deleted — its ledger lines
       * would point at nothing and the report would show them as unallocated.
       * Deactivating keeps the history readable and takes it out of new
       * pickers and profit splits.
       */
      deleteCapitalAccount: (id) => {
        const used = get().journalEntries.some((je) =>
          (je.lines || []).some((l) => l.capitalAccountId === id))
        if (used) throw new Error('CAPITAL_HAS_ACTIVITY')
        get().recycleRecord('capitalAccounts', id)
        const gone = get().capitalAccounts.find((a) => a.id === id)
        set((s) => ({ capitalAccounts: s.capitalAccounts.filter((a) => a.id !== id) }))
        if (gone) get().logActivity('Deleted capital account', gone.name, { entity: 'capitalAccount', entityId: id })
      },

      addCapitalSubaccount: (name) => {
        const clean = String(name || '').trim()
        if (!clean) throw new Error('CAPITAL_SUB_NAME_REQUIRED')
        const dup = get().capitalSubaccounts.some((s) => s.name.toLowerCase() === clean.toLowerCase())
        if (dup) throw new Error('CAPITAL_SUB_DUPLICATE')
        const id = uuid()
        set((s) => ({
          capitalSubaccounts: [...s.capitalSubaccounts, { id, name: clean, sort: 100 + s.capitalSubaccounts.length, isSystem: false }],
        }))
        return id
      },

      deleteCapitalSubaccount: (id) => {
        const sub = get().capitalSubaccounts.find((s) => s.id === id)
        if (!sub) return
        if (sub.isSystem) throw new Error('CAPITAL_SUB_IS_SYSTEM')
        const used = get().journalEntries.some((je) => (je.lines || []).some((l) => l.subaccountId === id))
        if (used) throw new Error('CAPITAL_SUB_HAS_ACTIVITY')
        set((s) => ({ capitalSubaccounts: s.capitalSubaccounts.filter((x) => x.id !== id) }))
      },

      /**
       * Money in from an owner, or money out to one.
       * `kind` is 'contribution' or 'drawing'.
       */
      recordCapitalMovement: (kind, payload) => {
        const acc = get().capitalAccounts.find((a) => a.id === payload.capitalAccountId)
        if (!acc) throw new Error('CAPITAL_NOT_FOUND')
        const lines = movementLines(kind, { ...payload, name: acc.name })
        const je = get().addJournalEntry({
          date: payload.date,
          description: payload.description || `${kind === 'contribution' ? 'Funds contributed' : 'Drawings'} — ${acc.name}`,
          type: 'capital',
          lines,
        })
        return je
      },

      /**
       * Split a profit between the partners by their shares.
       *
       * Moves profit from retained earnings to each partner's share-of-profit
       * subaccount. Total equity does not change by a cent — the money simply
       * stops being "kept in the business" and becomes "owed to a named owner".
       */
      allocateProfitToPartners: ({ date, amount, description } = {}) => {
        const active = get().capitalAccounts.filter((a) => a.active !== false)
        if (!active.length) throw new Error('CAPITAL_NO_ACCOUNTS')
        const split = allocateProfit(amount, active)
        const lines = profitAllocationLines(split)
        if (!lines.length) throw new Error('CAPITAL_NOTHING_TO_ALLOCATE')
        return get().addJournalEntry({
          date,
          description: description || 'Allocation of profit to partners',
          type: 'capital',
          lines,
        })
      },

      /** Put the tree back to the shipped structure, keeping custom groups. */
      restoreDefaultGroups: () => {
        set((s) => {
          const have = new Set(s.accountGroups.map((g) => g.id))
          const missing = DEFAULT_GROUPS.filter((g) => !have.has(g.id)).map((g) => ({ ...g }))
          return {
            accountGroups: [...s.accountGroups, ...missing],
            accounts: assignDefaultGroups(s.accounts.map((a) => ({ ...a, groupId: '' }))),
          }
        })
        get().logActivity('Restored default account groups', '', { entity: 'accountGroup', severity: 'warning' })
      },

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

      updateCustomer: (id, patch) => {
        const before = get().customers.find((c) => c.id === id)
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
        get().logChange('Updated customer', before, get().customers.find((c) => c.id === id), { entity: 'customer' })
      },

      deleteCustomer: (id) => {
        get().recycleRecord('customers', id)
        const gone = get().customers.find((c) => c.id === id)
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }))
        if (gone) get().logActivity('Deleted customer', gone.name || '', { entity: 'customer', entityId: id, entityRef: gone.name })
      },

      // ─── SUPPLIERS ─────────────────────────────────────────────────
      suppliers: [],

      addSupplier: (sup) =>
        set((s) => ({ suppliers: [...s.suppliers, { ...sup, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateSupplier: (id, patch) => {
        const before = get().suppliers.find((x) => x.id === id)
        set((s) => ({ suppliers: s.suppliers.map((s2) => (s2.id === id ? { ...s2, ...patch } : s2)) }))
        get().logChange('Updated supplier', before, get().suppliers.find((x) => x.id === id), { entity: 'supplier' })
      },

      deleteSupplier: (id) => {
        get().recycleRecord('suppliers', id)
        const gone = get().suppliers.find((x) => x.id === id)
        set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== id) }))
        if (gone) get().logActivity('Deleted supplier', gone.name || '', { entity: 'supplier', entityId: id, entityRef: gone.name })
      },

      // ─── INVENTORY ITEMS ───────────────────────────────────────────
      inventoryItems: [],

      addInventoryItem: (item) => {
        const id = uuid()
        if (item?.isKit) {
          const check = validateKit(id, item.components || [], get().inventoryItems)
          if (!check.ok) throw new Error(`KIT_INVALID:${check.errors.join(' ')}`)
        }
        set((s) => ({ inventoryItems: [...s.inventoryItems, { ...item, id }] }))
        return { id }
      },

      updateInventoryItem: (id, patch) => {
        const before = get().inventoryItems.find((i) => i.id === id)
        // A kit that contains itself would recurse for ever the next time
        // something is sold, so the cycle is refused at save time rather than
        // relied on being caught during a posting.
        const merged = { ...(before || {}), ...patch }
        if (merged.isKit) {
          const check = validateKit(id, merged.components || [], get().inventoryItems)
          if (!check.ok) throw new Error(`KIT_INVALID:${check.errors.join(' ')}`)
        }
        set((s) => ({ inventoryItems: s.inventoryItems.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
        // Cost/quantity move constantly through normal trading; only log the
        // master-data edits a human actually made.
        get().logChange('Updated item', before, get().inventoryItems.find((i) => i.id === id), { entity: 'item', ignore: ['quantity', 'costPrice'] })
      },

      deleteInventoryItem: (id) => {
        get().recycleRecord('inventoryItems', id)
        const gone = get().inventoryItems.find((i) => i.id === id)
        set((s) => ({ inventoryItems: s.inventoryItems.filter((i) => i.id !== id) }))
        if (gone) get().logActivity('Deleted item', `${gone.code || ''} ${gone.name || ''}`.trim(), { entity: 'item', entityId: id, entityRef: gone.code || gone.name })
      },

      // ─── APPROVAL WORKFLOW ─────────────────────────────────────────
      // A request parks the *draft payload* a posting action would have
      // received. Nothing reaches the ledger until someone else approves, at
      // which point the payload is replayed through the ordinary posting path
      // — so an approved bill posts through exactly the same code as any
      // other, VAT, freight, FX and inventory included.
      approvalRequests: [],

      currentUser: () => {
        try {
          const auth = useAuth.getState()
          return auth.users.find((x) => x.id === auth.currentUserId) || null
        } catch { return null }
      },

      allUsers: () => {
        try { return useAuth.getState().users || [] } catch { return [] }
      },

      /** Park a draft for approval. Returns the created request. */
      submitForApproval: (kind, payload, meta = {}) => {
        const u = get().currentUser()
        const req = {
          id: uuid(), kind, payload, status: 'pending',
          amount: amountOf(kind, payload),
          submittedBy: u?.id || null, submittedByName: u?.name || 'Unknown',
          submittedAt: new Date().toISOString(),
          note: meta.note || '',
          decidedBy: null, decidedByName: '', decidedAt: null, decisionReason: '',
          resultId: null, resultRef: '',
        }
        set((st) => ({ approvalRequests: [...(st.approvalRequests || []), req] }))
        get().logActivity('Submitted for approval', `${kind} · ${req.amount}`, {
          entity: 'approval', entityId: req.id, severity: 'notable',
        })
        return req
      },

      /**
       * Approve and post. Replays the payload through the real posting action,
       * bypassing the threshold gate so it cannot loop.
       */
      approveRequest: (id, reason) => {
        const st = get()
        const req = (st.approvalRequests || []).find((r) => r.id === id)
        const user = st.currentUser()
        const check = canApprove(req, user, st.settings?.approvals, get().allUsers())
        if (!check.ok) throw new Error(`APPROVAL_DENIED:${check.reason}`)

        let result = null
        if (req.kind === 'purchase') result = st.addPurchase(req.payload, { approved: true })
        else if (req.kind === 'journal') result = st.addJournalEntry(req.payload, { approved: true })
        else if (req.kind === 'payment') {
          st.recordPurchasePayment(req.payload.purchaseId, req.payload.payment, { approved: true })
          result = { number: req.payload.targetRef || '' }
        }
        else throw new Error(`APPROVAL_UNKNOWN_KIND:${req.kind}`)

        set((s) => ({
          approvalRequests: s.approvalRequests.map((r) =>
            r.id === id ? {
              ...r, status: 'approved',
              decidedBy: user?.id || null, decidedByName: user?.name || '',
              decidedAt: new Date().toISOString(), decisionReason: reason || '',
              resultId: result?.id || null, resultRef: result?.number || '',
            } : r
          ),
        }))
        get().logActivity('Approved ' + req.kind, `${result?.number || ''} · ${req.amount}`.trim(), {
          entity: 'approval', entityId: id, entityRef: result?.number || '', severity: 'notable',
        })
        return result
      },

      rejectRequest: (id, reason) => {
        const st = get()
        const req = (st.approvalRequests || []).find((r) => r.id === id)
        const user = st.currentUser()
        const check = canApprove(req, user, st.settings?.approvals, get().allUsers())
        if (!check.ok) throw new Error(`APPROVAL_DENIED:${check.reason}`)
        set((s) => ({
          approvalRequests: s.approvalRequests.map((r) =>
            r.id === id ? {
              ...r, status: 'rejected',
              decidedBy: user?.id || null, decidedByName: user?.name || '',
              decidedAt: new Date().toISOString(), decisionReason: reason || '',
            } : r
          ),
        }))
        get().logActivity('Rejected ' + req.kind, reason || '', {
          entity: 'approval', entityId: id, severity: 'notable',
        })
      },

      /** The submitter can pull their own request back while it is still pending. */
      withdrawRequest: (id) => {
        const st = get()
        const req = (st.approvalRequests || []).find((r) => r.id === id)
        const user = st.currentUser()
        if (!req || req.status !== 'pending') return
        if (req.submittedBy && user?.id && req.submittedBy !== user.id) return
        set((s) => ({ approvalRequests: s.approvalRequests.filter((r) => r.id !== id) }))
        get().logActivity('Withdrew approval request', req.kind, { entity: 'approval', entityId: id })
      },

      // ─── OPENING BALANCES (migration cutover) ──────────────────────
      // Establishes the position a business is carrying into this system on
      // day one. Receivables, payables and stock arrive as individual open
      // documents rather than lump sums, so aging, statements and stock counts
      // work from the first day instead of showing legacy invoices as new.

      updateOpening: (patch) =>
        set((s) => ({ settings: { ...s.settings, opening: { ...(s.settings.opening || {}), ...patch } } })),

      /**
       * Post the cutover. One balanced journal entry plus the subledger
       * documents it summarises.
       * @throws OPENING_ALREADY_POSTED | OPENING_INVALID:<reasons>
       */
      postOpeningBalances: (input) => {
        const st = get()
        if (st.settings.opening?.posted) throw new Error('OPENING_ALREADY_POSTED')

        const errors = validateOpening(input, { lockDate: st.settings?.accounting?.lockDate })
        if (errors.length) throw new Error(`OPENING_INVALID:${errors.join(' | ')}`)

        const nameOf = (id) => st.accounts.find((a) => a.id === id)?.name || id
        const entry = buildOpeningEntry(input, { accountName: nameOf })
        const { date, customers = [], suppliers = [], items = [] } = input

        const je = get().addJournalEntry({
          date,
          description: `Opening balances as at ${date}`,
          reference: 'OPENING', type: 'opening', lines: entry.lines,
        })

        // Opening documents carry their ORIGINAL numbers — a payment arriving
        // next week has to match what the customer has on their copy. They
        // hold no journal entry of their own; the single opening entry above
        // already put their total into the control account.
        const stamp = new Date().toISOString()
        const openingInvoices = customers.map((c) => ({
          id: uuid(), number: c.number, isOpening: true,
          customerId: c.customerId || '', customerName: c.customerName || '',
          date: c.date || date, dueDate: c.dueDate || c.date || date,
          items: [], subtotal: Number(c.amount) || 0, taxAmount: 0,
          total: Number(c.amount) || 0, amountPaid: 0, payments: [],
          status: 'sent', exchangeRate: 1, baseTotal: Number(c.amount) || 0,
          notes: 'Carried in from your previous system',
          journalEntryId: je.id, createdAt: stamp,
        }))
        const openingBills = suppliers.map((b) => ({
          id: uuid(), number: b.number, isOpening: true,
          supplierId: b.supplierId || '', supplierName: b.supplierName || '',
          date: b.date || date, dueDate: b.dueDate || b.date || date,
          items: [], subtotal: Number(b.amount) || 0, taxAmount: 0,
          total: Number(b.amount) || 0, amountPaid: 0, payments: [],
          status: 'received', exchangeRate: 1, baseTotal: Number(b.amount) || 0,
          notes: 'Carried in from your previous system',
          journalEntryId: je.id, createdAt: stamp,
        }))

        // Stock arrives at the cost you are carrying it in at, blended into
        // any existing quantity with the same weighted-average maths a
        // purchase uses — so a re-migration behaves predictably.
        const openingQty = {}
        items.forEach((it) => {
          const q = Number(it.quantity) || 0
          if (!it.itemId || q <= 0) return
          openingQty[it.itemId] = (openingQty[it.itemId] || 0) + q
        })

        set((s) => ({
          invoices: [...s.invoices, ...openingInvoices],
          purchases: [...s.purchases, ...openingBills],
          inventoryItems: s.inventoryItems.map((it) => {
            const row = items.find((r) => r.itemId === it.id)
            if (!row) return it
            const q = Number(row.quantity) || 0
            const cost = Number(row.unitCost) || 0
            if (q <= 0) return it
            const oldQty = it.quantity || 0
            const newQty = oldQty + q
            const newCost = newQty > 0 ? (oldQty * (it.costPrice || 0) + q * cost) / newQty : cost
            return { ...it, quantity: newQty, costPrice: newCost }
          }),
          settings: { ...s.settings, opening: {
            date, posted: true, journalEntryId: je.id, postedAt: stamp,
            counts: { accounts: entry.lines.length, customers: customers.length, suppliers: suppliers.length, items: items.length },
          } },
        }))

        items.forEach((it) => {
          const q = Number(it.quantity) || 0
          if (!it.itemId || q <= 0) return
          get().logStockMovement({
            itemId: it.itemId, itemName: it.itemName || '', date,
            type: 'opening', qtyChange: q, ref: 'OPENING', note: 'Opening stock',
          })
        })

        get().logActivity('Posted opening balances', `as at ${date}`, {
          entity: 'opening', entityId: je.id, entityRef: je.number, severity: 'critical',
        })
        return { entry, journalEntry: je }
      },

      /**
       * Undo the cutover so it can be re-entered. Refused once anything has
       * been settled against it — reversing then would strand the payment
       * against an invoice that no longer exists.
       * @throws OPENING_NOT_POSTED | OPENING_HAS_ACTIVITY:<n> | PERIOD_LOCKED
       */
      reverseOpeningBalances: () => {
        const st = get()
        const op = st.settings.opening
        if (!op?.posted) throw new Error('OPENING_NOT_POSTED')

        const settled = [
          ...st.invoices.filter((i) => i.isOpening && ((i.amountPaid || 0) > 0 || (i.payments || []).length)),
          ...st.purchases.filter((p) => p.isOpening && ((p.amountPaid || 0) > 0 || (p.payments || []).length)),
        ]
        if (settled.length) throw new Error(`OPENING_HAS_ACTIVITY:${settled.length}`)

        const lock = st.settings?.accounting?.lockDate
        if (lock && op.date && String(op.date) <= String(lock)) throw new Error(`PERIOD_LOCKED:${lock}`)

        // Back the opening quantity out of stock rather than zeroing it —
        // anything received since the cutover is real and must survive.
        const openingMoves = (st.stockMovements || []).filter((m) => m.type === 'opening' && m.ref === 'OPENING')

        set((s) => ({
          journalEntries: s.journalEntries.filter((j) => j.id !== op.journalEntryId),
          invoices: s.invoices.filter((i) => !i.isOpening),
          purchases: s.purchases.filter((p) => !p.isOpening),
          stockMovements: (s.stockMovements || []).filter((m) => !(m.type === 'opening' && m.ref === 'OPENING')),
          inventoryItems: s.inventoryItems.map((it) => {
            const back = openingMoves.filter((m) => m.itemId === it.id).reduce((t, m) => t + (m.qtyChange || 0), 0)
            if (!back) return it
            return { ...it, quantity: Math.max(0, (it.quantity || 0) - back) }
          }),
          settings: { ...s.settings, opening: { date: op.date, posted: false, journalEntryId: null, postedAt: '', counts: null } },
        }))

        get().logActivity('Reversed opening balances', `as at ${op.date}`, {
          entity: 'opening', entityId: op.journalEntryId || '', severity: 'critical',
        })
      },

      // ─── RECYCLE BIN ───────────────────────────────────────────────
      // Covers records whose deletion is pure data loss. Documents that post
      // to the ledger are voided with a reversing entry instead — restoring
      // one of those would post the transaction twice. See utils/recycleBin.
      recycleBin: [],

      /** Snapshot a record just before it is removed. Called by delete actions. */
      recycleRecord: (entity, id) => {
        if (!isRecyclable(entity)) return
        const slice = get()[RECYCLABLE[entity].slice] || []
        const record = slice.find((r) => r.id === id)
        if (!record) return
        const entry = makeEntry(entity, record, { user: get().currentUser() })
        // Cap the bin so a bulk delete cannot grow local storage without
        // bound; the oldest rows fall off first.
        set((s) => ({ recycleBin: [...(s.recycleBin || []).slice(-999), entry] }))
      },

      /**
       * Put a record back where it came from.
       * @throws RESTORE_DENIED:<reason>
       */
      restoreFromBin: (entryId) => {
        const st = get()
        const entry = (st.recycleBin || []).find((e) => e.id === entryId)
        const slice = entry ? (st[RECYCLABLE[entry.entity]?.slice] || []) : []
        const check = canRestore(entry, slice)
        if (!check.ok) throw new Error(`RESTORE_DENIED:${check.reason}`)

        const key = RECYCLABLE[entry.entity].slice
        set((s) => ({
          [key]: [...(s[key] || []), entry.record],
          recycleBin: s.recycleBin.filter((e) => e.id !== entryId),
        }))
        get().logActivity('Restored from recycle bin', `${entry.entity} · ${entry.recordId}`, {
          entity: entry.entity, entityId: entry.recordId, severity: 'notable',
        })
        return entry.record
      },

      /** Remove one entry for good. */
      purgeFromBin: (entryId) => {
        const entry = (get().recycleBin || []).find((e) => e.id === entryId)
        set((s) => ({ recycleBin: s.recycleBin.filter((e) => e.id !== entryId) }))
        if (entry) get().logActivity('Purged from recycle bin', `${entry.entity} · ${entry.recordId}`, {
          entity: entry.entity, entityId: entry.recordId, severity: 'critical',
        })
      },

      /** Empty the bin. @param ids optional subset */
      emptyRecycleBin: (ids) => {
        const n = ids ? ids.length : (get().recycleBin || []).length
        set((s) => ({ recycleBin: ids ? s.recycleBin.filter((e) => !ids.includes(e.id)) : [] }))
        get().logActivity('Emptied recycle bin', `${n} item(s)`, { entity: 'recycleBin', severity: 'critical' })
      },

      // ─── AUDIT / ACTIVITY LOG ──────────────────────────────────────
      auditLog: [],

      logActivity: (action, detail, meta = {}) => {
        let user = 'System', userId = ''
        try {
          const auth = useAuth.getState()
          const u = auth.users.find((x) => x.id === auth.currentUserId)
          user = u?.name || 'System'; userId = u?.id || ''
        } catch { /* ignore */ }
        const entry = {
          id: uuid(), ts: new Date().toISOString(), user, userId,
          action, detail: detail || '',
          // Structured fields make the trail filterable and answer "what
          // exactly changed", which a free-text detail string cannot.
          entity: meta.entity || '', entityId: meta.entityId || '', entityRef: meta.entityRef || '',
          changes: meta.changes || [],
          severity: meta.severity || severityFor(action),
        }
        // Append-only audit trail (retain up to 20k events; never wiped — immutability)
        set((st) => ({ auditLog: [...(st.auditLog || []).slice(-19999), entry] }))
      },

      /**
       * Log an edit with a field-level diff. Silently records nothing when the
       * save changed no audited field, so the trail stays signal, not noise.
       */
      logChange: (action, before, after, meta = {}) => {
        const changes = diffRecord(before, after, { ignore: meta.ignore })
        if (changes.length === 0) return
        get().logActivity(action, describeChanges(changes), {
          ...meta,
          changes,
          entityRef: meta.entityRef || after?.number || after?.name || before?.number || before?.name || '',
          entityId: meta.entityId || after?.id || before?.id || '',
        })
      },

      // Audit trail is immutable — this remains only for API compatibility and no
      // longer erases history (previously wiped the log).
      clearAuditLog: () => { get().logActivity('Audit-log clear requested (ignored — trail is immutable)', ''); },

      // ─── JOURNAL ENTRIES ───────────────────────────────────────────
      journalEntries: [],

      addJournalEntry: (entry, opts = {}) => {
        const s = get()
        // Integrity guards: every entry must be dated and balanced. This stops any
        // caller bug from silently corrupting the ledger / trial balance.
        if (!entry?.date) throw new Error('JE_NO_DATE')
        // Threshold approval applies to *manual* entries only. System-generated
        // entries (an invoice's own posting, a payment, a depreciation run) are
        // consequences of a document that was itself gated, and blocking them
        // here would tear a half-posted document apart.
        if (!opts.approved && (entry.type || 'manual') === 'manual'
            && needsApproval(s.settings?.approvals, 'journal', amountOf('journal', entry))) {
          return { pendingApproval: true, request: get().submitForApproval('journal', entry) }
        }
        const _dr = (entry.lines || []).reduce((t, l) => t + (+l.debit || 0), 0)
        const _cr = (entry.lines || []).reduce((t, l) => t + (+l.credit || 0), 0)
        if (Math.abs(_dr - _cr) > 0.05) throw new Error(`JE_UNBALANCED:${(_dr - _cr).toFixed(2)}`)
        // The capital control account is a subledger: its balance must always
        // be the sum of the partner accounts underneath it. A line that hits it
        // without naming a partner would break that quietly — the balance sheet
        // would still balance while the capital accounts report disagreed with
        // it, and nothing on screen would say why. Refuse it at the door.
        const _stray = (entry.lines || []).find(
          (l) => l?.accountId === CAPITAL_CONTROL && !l?.capitalAccountId
        )
        if (_stray) throw new Error('CAPITAL_LINE_UNATTRIBUTED')
        const lock = s.settings?.accounting?.lockDate
        if (lock && String(entry.date) <= String(lock))
          throw new Error(`PERIOD_LOCKED:${lock}`)
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
        set((s) => {
          const lock = s.settings?.accounting?.lockDate
          const je = s.journalEntries.find((j) => j.id === id)
          // block editing an entry in a closed period, or moving one into it
          if (lock && ((je?.date && String(je.date) <= String(lock)) || (patch?.date && String(patch.date) <= String(lock))))
            throw new Error(`PERIOD_LOCKED:${lock}`)
          const merged = je ? { ...je, ...patch } : null
          // a patch must not unbalance the entry or strip its date
          if (merged) {
            if (!merged.date) throw new Error('JE_NO_DATE')
            const dr = (merged.lines || []).reduce((t, l) => t + (+l.debit || 0), 0)
            const cr = (merged.lines || []).reduce((t, l) => t + (+l.credit || 0), 0)
            if (Math.abs(dr - cr) > 0.05) throw new Error(`JE_UNBALANCED:${(dr - cr).toFixed(2)}`)
          }
          return { journalEntries: s.journalEntries.map((j) => (j.id === id ? merged : j)) }
        }),

      deleteJournalEntry: (id) =>
        set((s) => {
          const lock = s.settings?.accounting?.lockDate
          const je = s.journalEntries.find((j) => j.id === id)
          if (lock && je?.date && String(je.date) <= String(lock))
            throw new Error(`PERIOD_LOCKED:${lock}`)
          return { journalEntries: s.journalEntries.filter((j) => j.id !== id) }
        }),

      // Throws PERIOD_LOCKED if deleting a document would remove any journal entry
      // dated in a closed period. Called by every document delete that cascades JEs.
      assertJEsUnlocked: (...ids) => {
        const lock = get().settings?.accounting?.lockDate
        if (!lock) return
        const wanted = new Set(ids.filter(Boolean))
        if (get().journalEntries.some((j) => wanted.has(j.id) && j.date && String(j.date) <= String(lock)))
          throw new Error(`PERIOD_LOCKED:${lock}`)
      },

      // Void a posted entry by posting a mirror-image reversal instead of deleting
      // it — the original and its reversal both stay in the ledger permanently
      // (immutable audit trail, no numbering gaps). Reversing on an open date is the
      // correct way to undo a closed-period entry, so this works even when the
      // original is locked, as long as the reversal `date` is in an open period.
      voidJournalEntry: (id, { date, reason } = {}) => {
        const je = get().journalEntries.find((j) => j.id === id)
        if (!je) return null
        if (je.reversedBy) throw new Error('ALREADY_VOID')
        if (je.reverses) throw new Error('CANNOT_VOID_REVERSAL')
        const voidDate = date || je.date
        const rev = get().addJournalEntry({
          date: voidDate,
          description: `Reversal of ${je.number}${reason ? ' — ' + reason : ''}`,
          reference: je.number, type: 'reversal', reverses: je.id,
          departmentId: je.departmentId || null,
          lines: (je.lines || []).map((l) => ({
            accountId: l.accountId, debit: l.credit || 0, credit: l.debit || 0,
            description: `Reversal: ${l.description || ''}`,
          })),
        })
        set((s) => ({
          journalEntries: s.journalEntries.map((j) =>
            j.id === id ? { ...j, reversedBy: rev.id, voidReason: reason || '', voidedAt: new Date().toISOString() } : j),
        }))
        get().logActivity('Voided journal entry', `${je.number} reversed by ${rev.number}${reason ? ' · ' + reason : ''}`)
        return rev
      },

      // ─── SALES INVOICES ────────────────────────────────────────────
      invoices: [],

      addInvoice: (invoice) => {
        const s = get()
        const { prefix, next } = s.settings.invoice
        const number = nextNum(prefix, next)

        // Foreign-currency invoices are entered in their own currency; the ledger is
        // always in base currency, so each amount is converted at the invoice's rate
        // (base units per 1 unit of the invoice currency; 1 for base-currency invoices).
        const rate = Number(invoice.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const revenueMap = {}
        invoice.items.forEach((item) => {
          const acc = item.accountId || 'acc-sales'
          revenueMap[acc] = (revenueMap[acc] || 0) + item.subtotal
        })
        const revLines = Object.entries(revenueMap).map(([accId, amount]) =>
          ({ accountId: accId, debit: 0, credit: toBase(amount), description: `Revenue – ${number}` }))
        const vatBase = invoice.taxAmount > 0 ? toBase(invoice.taxAmount) : 0
        // Optional whole-invoice discount (contra-revenue) and shipping charge (income).
        // The form passes taxAmount already net of the discount and inclusive of any
        // shipping VAT, so the ledger just needs the extra debit/credit legs here.
        const docDiscBase = toBase(invoice.docDiscountAmount || 0)
        const shipBase = toBase(invoice.shipping || 0)
        // AR = revenue − doc discount + shipping + VAT (all base), so the entry balances.
        const arBase = Math.round((revLines.reduce((s, l) => s + l.credit, 0) - docDiscBase + shipBase + vatBase) * 100) / 100
        const arAcc = get().controlAccountFor('customers', invoice.customerId)
        const lines = [{ accountId: arAcc, debit: arBase, credit: 0, description: `Invoice ${number}` }, ...revLines]
        if (docDiscBase > 0) lines.push({ accountId: 'acc-salesdisc', debit: docDiscBase, credit: 0, description: 'Invoice discount' })
        if (shipBase > 0) lines.push({ accountId: 'acc-shipinc', debit: 0, credit: shipBase, description: 'Shipping & delivery' })
        if (vatBase > 0)
          lines.push({ accountId: 'acc-vatout', debit: 0, credit: vatBase, description: 'Output Tax' })

        const je = get().addJournalEntry({
          date: invoice.date,
          description: `Sales Invoice ${number} – ${invoice.customerName || ''}`,
          reference: number, type: 'invoice', departmentId: invoice.departmentId || null, lines,
        })

        // Perpetual issue: reduce stock + post COGS at weighted-average cost for tracked lines.
        // COGS/inventory relief respect each item's own COGS and inventory accounts.
        // Kits explode into their components first: a bundle is one line on
        // the invoice but there is no bundle on a shelf, so stock and cost of
        // sales have to follow the parts that actually left it.
        const issue = explodeLines(invoice.items, get().inventoryItems) // itemId -> qty
        const cogsByAcc = {}, invByAcc = {}
        let cogs = 0
        Object.entries(issue).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          if (!it) return
          const amt = q * (it.costPrice || 0)
          cogs += amt
          const cAcc = it.cogsAccountId || 'acc-cogs'
          const iAcc = it.inventoryAccountId || 'acc-inv'
          cogsByAcc[cAcc] = (cogsByAcc[cAcc] || 0) + amt
          invByAcc[iAcc] = (invByAcc[iAcc] || 0) + amt
        })
        let cogsJeId = null
        if (cogs > 0) {
          const cje = get().addJournalEntry({
            date: invoice.date, description: `Cost of Sales – ${number}`, reference: number, type: 'cogs',
            departmentId: invoice.departmentId || null,
            lines: [
              ...Object.entries(cogsByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Cost of goods sold' })),
              ...Object.entries(invByAcc).map(([a, amt]) => ({ accountId: a, debit: 0, credit: amt, description: 'Inventory reduction' })),
            ],
          })
          cogsJeId = cje.id
        }

        const newInvoice = {
          ...invoice, id: uuid(), number, status: 'sent', amountPaid: 0, payments: [],
          exchangeRate: rate, baseTotal: arBase,
          journalEntryId: je.id, cogsJournalEntryId: cogsJeId, createdAt: new Date().toISOString(),
        }
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((st) => ({
          invoices: [...st.invoices, newInvoice],
          inventoryItems: st.inventoryItems.map((it) => {
            const q = issue[it.id]
            if (!q) return it
            const patch = { quantity: (it.quantity || 0) - q }
            if (it.stockByWarehouse) {
              const map = { ...it.stockByWarehouse }
              map[defWh] = (map[defWh] || 0) - q
              patch.stockByWarehouse = map
            }
            return { ...it, ...patch }
          }),
          settings: { ...st.settings, invoice: { ...st.settings.invoice, next: next + 1 } },
        }))
        Object.entries(issue).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: invoice.date, type: 'sale', qtyChange: -q, ref: number, note: `Sold to ${invoice.customerName || 'customer'}` })
        })
        return newInvoice
      },

      recordInvoicePayment: (invoiceId, payment) => {
        const s = get()
        const invoice = s.invoices.find((i) => i.id === invoiceId)
        if (!invoice) return
        // Overpayment guard: never receive more than the outstanding balance, so the
        // AR subledger can't go negative (no advances/unapplied-cash model yet).
        const remaining = Math.max(0, (invoice.total || 0) - (invoice.amountPaid || 0))
        const amount = Math.min(Number(payment.amount) || 0, remaining)
        if (amount <= 0) return
        const { prefix, next } = s.settings.receipt
        const number = nextNum(prefix, next)
        const newAmountPaid = invoice.amountPaid + amount
        const status = newAmountPaid >= invoice.total - 0.005 ? 'paid' : 'partial'
        // Multi-currency settlement: AR was booked at the invoice rate; cash arrives
        // valued at the payment-date rate. The difference is a realized FX gain/loss.
        // (Both rates default to 1, so base-currency receipts post exactly as before.)
        const invRate = Number(invoice.exchangeRate) || 1
        const payRate = Number(payment.exchangeRate) || invRate
        const cashBase = Math.round(amount * payRate * 100) / 100
        const arBase = Math.round(amount * invRate * 100) / 100
        const fx = Math.round((cashBase - arBase) * 100) / 100
        const payLines = [
          { accountId: payment.bankAccountId, debit: cashBase, credit: 0, description: `Receipt for ${invoice.number}` },
          { accountId: get().controlAccountFor('customers', invoice.customerId), debit: 0, credit: arBase, description: `Receipt for ${invoice.number}` },
        ]
        if (fx > 0) payLines.push({ accountId: 'acc-fxreal', debit: 0, credit: fx, description: `Realized FX gain – ${invoice.number}` })
        else if (fx < 0) payLines.push({ accountId: 'acc-fxreal', debit: -fx, credit: 0, description: `Realized FX loss – ${invoice.number}` })
        const je = get().addJournalEntry({
          date: payment.date,
          description: `Receipt ${number} for ${invoice.number}`,
          reference: number, type: 'receipt', lines: payLines,
        })
        set((st) => ({
          invoices: st.invoices.map((i) =>
            i.id === invoiceId
              ? { ...i, amountPaid: newAmountPaid, status, payments: [...(i.payments || []), { ...payment, amount, id: uuid(), number, journalEntryId: je.id }] }
              : i
          ),
          settings: { ...st.settings, receipt: { ...st.settings.receipt, next: next + 1 } },
        }))
      },

      updateInvoice: (id, patch) =>
        set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

      // Void an invoice the audit-safe way (ZATCA forbids deleting issued invoices):
      // reverse its sale, COGS and every receipt via reversal entries, put the stock
      // back, and mark it 'void' — the document stays in the list (no numbering gap).
      voidInvoice: (id, { date, reason } = {}) => {
        const inv = get().invoices.find((i) => i.id === id)
        if (!inv || inv.status === 'void') return
        const voidDate = date || new Date().toISOString().slice(0, 10)
        const jeIds = [inv.journalEntryId, inv.cogsJournalEntryId, ...(inv.payments || []).map((p) => p.journalEntryId)].filter(Boolean)
        jeIds.forEach((jeId) => {
          const je = get().journalEntries.find((j) => j.id === jeId)
          if (je && !je.reversedBy) get().voidJournalEntry(jeId, { date: voidDate, reason: reason || `Void invoice ${inv.number}` })
        })
        const restore = {}
        ;(inv.items || []).forEach((line) => {
          if (!line.itemId) return
          const q = parseFloat(line.quantity) || 0
          if (q > 0) restore[line.itemId] = (restore[line.itemId] || 0) + q
        })
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((s) => ({
          invoices: s.invoices.map((i) => (i.id === id ? { ...i, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString(), amountPaid: 0 } : i)),
          inventoryItems: s.inventoryItems.map((it) => {
            const q = restore[it.id]
            if (!q) return it
            const patch = { quantity: (it.quantity || 0) + q }
            if (it.stockByWarehouse) { const m = { ...it.stockByWarehouse }; m[defWh] = (m[defWh] || 0) + q; patch.stockByWarehouse = m }
            return { ...it, ...patch }
          }),
        }))
        Object.entries(restore).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: q, ref: inv.number, note: 'Invoice voided' })
        })
        get().logActivity('Voided invoice', `${inv.number}${reason ? ' · ' + reason : ''}`)
      },

      deleteInvoice: (id) => {
        const inv = get().invoices.find((i) => i.id === id)
        // every JE this invoice produced: the sale, its COGS, and every receipt
        const payJEs = (inv?.payments || []).map((p) => p.journalEntryId)
        const jeIds = new Set([inv?.journalEntryId, inv?.cogsJournalEntryId, ...payJEs].filter(Boolean))
        get().assertJEsUnlocked(...jeIds)
        get().logActivity('Deleted invoice', inv?.number || id)
        // Restore any stock issued by this invoice's tracked lines.
        const restore = {}
        ;(inv?.items || []).forEach((line) => {
          if (!line.itemId) return
          const q = parseFloat(line.quantity) || 0
          if (q > 0) restore[line.itemId] = (restore[line.itemId] || 0) + q
        })
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((s) => ({
          invoices: s.invoices.filter((i) => i.id !== id),
          journalEntries: s.journalEntries.filter((j) => !jeIds.has(j.id)),
          stockMovements: s.stockMovements.filter((m) => m.ref !== inv?.number),
          inventoryItems: s.inventoryItems.map((it) => {
            const q = restore[it.id]
            if (!q) return it
            const patch = { quantity: (it.quantity || 0) + q }
            if (it.stockByWarehouse) {
              const map = { ...it.stockByWarehouse }
              map[defWh] = (map[defWh] || 0) + q
              patch.stockByWarehouse = map
            }
            return { ...it, ...patch }
          }),
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

      deleteQuotation: (id) => {
        get().recycleRecord('quotations', id)
        return set((s) => ({ quotations: s.quotations.filter((q) => q.id !== id) }))
      },

      // Convert a quotation to an invoice — in full, or partially by passing a
      // { lineId: qty } selection. Each source line tracks how much has been
      // invoiced (invoicedQty), so the remainder stays an open backorder and can
      // be invoiced later. Omitting `selections` invoices everything remaining.
      convertQuotationToInvoice: (id, selections) => {
        const q = get().quotations.find((x) => x.id === id)
        if (!q || q.status === 'invoiced') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(q.items || [], 'invoicedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'invoicedQty', taxEnabled })
        if (items.length === 0) return null
        const invoice = get().addInvoice({
          customerId: q.customerId, customerName: q.customerName,
          date: new Date().toISOString().slice(0, 10),
          dueDate: q.expiryDate || new Date().toISOString().slice(0, 10),
          departmentId: q.departmentId || null,
          currency: q.currency, exchangeRate: q.exchangeRate,
          items, subtotal, taxAmount, total, notes: q.notes || '',
        })
        const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, invoicedQty: (Number(l.invoicedQty) || 0) + applied[l.id] } : l))
        const status = docFulfillment(newItems, 'invoicedQty').status === 'complete' ? 'invoiced' : 'partial'
        get().updateQuotation(id, { items: newItems, status, invoiceId: invoice.id, invoiceIds: [...(q.invoiceIds || []), invoice.id] })
        return invoice
      },

      // ─── PAYMENT TERMS ─────────────────────────────────────────────
      updatePaymentTerms: (patch) => {
        const merged = { ...defaultTerms(), ...get().settings.terms, ...patch }
        const check = validateTerms(merged)
        if (!check.ok) throw new Error(`TERMS_INVALID:${check.errors.join(' ')}`)
        set((s) => ({ settings: { ...s.settings, terms: merged } }))
      },

      /** The terms that apply to a customer or supplier, falling back to company default. */
      termsFor: (kind, partyId) => {
        const st = get()
        const slice = kind === 'customer' ? st.customers : st.suppliers
        const party = (slice || []).find((r) => r.id === partyId)
        return resolveTerms(party, { ...defaultTerms(), ...st.settings.terms })
      },

      /** Due date implied by the party's terms. */
      dueDateFrom: (kind, partyId, date) => dueDateFor(date, get().termsFor(kind, partyId)),

      /** What settling this invoice on `payDate` would cost, and the discount. */
      settlementOffer: (invoiceId, payDate) => {
        const st = get()
        const invoice = st.invoices.find((i) => i.id === invoiceId)
        if (!invoice) return null
        return settlementDiscount(invoice, payDate, st.termsFor('customer', invoice.customerId), {
          taxEnabled: st.settings?.tax?.enabled !== false,
        })
      },

      /**
       * Write off an early-settlement discount.
       *
       * Posted as its own entry rather than folded into the receipt, so the
       * discount and the tax it reverses are both visible in the ledger — and
       * so the receipt still shows the cash that actually arrived.
       */
      postSettlementDiscount: (invoiceId, payDate) => {
        const st = get()
        const invoice = st.invoices.find((i) => i.id === invoiceId)
        if (!invoice) throw new Error('INVOICE_NOT_FOUND')
        const disc = get().settlementOffer(invoiceId, payDate)
        if (!disc?.eligible) throw new Error(`DISCOUNT_NOT_AVAILABLE:${disc?.reason || 'unknown'}`)

        const je = get().addJournalEntry({
          date: payDate,
          description: `Settlement discount — ${invoice.number}`,
          reference: invoice.number,
          type: 'settlement_discount',
          lines: discountLines(disc, {
            receivableAccountId: get().controlAccountFor('customers', invoice.customerId),
            reference: invoice.number,
          }),
        })

        // The discount settles part of the invoice: it is no longer collectable.
        set((s) => ({
          invoices: s.invoices.map((i) => (i.id === invoiceId
            ? {
                ...i,
                amountPaid: Math.round((Number(i.amountPaid) || 0) * 100 + disc.discountGross * 100) / 100,
                settlementDiscount: disc.discountGross,
                settlementDiscountJournalEntryId: je.id,
              }
            : i)),
        }))
        get().logActivity('Allowed settlement discount', `${invoice.number} · ${disc.discountGross}`, {
          entity: 'invoice', entityId: invoiceId, entityRef: invoice.number,
        })
        return { journalEntryId: je.id, ...disc }
      },

      // ─── CYCLE COUNTING ────────────────────────────────────────────
      /** Which items are due a count, and how much they are worth. */
      cycleCountBatch: (opts = {}) => {
        const state = get()
        const cfg = state.settings.cycleCount || {}
        return nextCycleBatch(state.inventoryItems, state.stockCounts || [], {
          policy: cfg.policy, limit: opts.limit ?? cfg.batchSize ?? 20, asAt: opts.asAt,
        })
      },

      /** Start a stock count containing only the items that are due. */
      startCycleCount: ({ date, warehouseId = '', limit } = {}) => {
        const batch = get().cycleCountBatch({ limit, asAt: date })
        if (!batch.itemIds.length) throw new Error('CYCLE_NOTHING_DUE')
        return get().startStockCount({
          date, warehouseId, itemIds: batch.itemIds,
          notes: `Cycle count — ${batch.itemIds.length} item(s) due`,
        })
      },

      // ─── DOCUMENT BRANDING ─────────────────────────────────────────
      updateBranding: (patch) => {
        const check = validateBranding(patch)
        if (!check.ok) throw new Error(`BRANDING_INVALID:${check.errors.join(' ')}`)
        set((s) => ({
          settings: { ...s.settings, branding: { ...defaultBranding(), ...s.settings.branding, ...patch } },
        }))
      },

      /** Per-document overrides, merged rather than replaced. */
      updateDocBranding: (docType, patch) =>
        set((s) => {
          const base = { ...defaultBranding(), ...s.settings.branding }
          return {
            settings: {
              ...s.settings,
              branding: {
                ...base,
                perDoc: { ...(base.perDoc || {}), [docType]: { ...((base.perDoc || {})[docType] || {}), ...patch } },
              },
            },
          }
        }),

      /** Called once the old in-settings logo has been copied to IndexedDB. */
      clearLegacyLogo: () =>
        set((s) => ({ settings: { ...s.settings, company: { ...s.settings.company, logo: '' } } })),

      // ─── STOCK COUNTS ──────────────────────────────────────────────
      // Making the books agree with the shelves. See utils/stockCount.js —
      // nearly all the care in this feature is about what posting must refuse
      // to touch, above all that an uncounted line is never treated as a zero.
      stockCounts: [],

      startStockCount: ({ date, warehouseId = '', itemIds = null, notes = '' } = {}) => {
        const s = get()
        const { prefix, next } = s.settings.stockCount
        const number = nextNum(prefix, next)
        const lines = buildCountSheet(s.inventoryItems, { warehouseId, itemIds })
        if (!lines.length) throw new Error('COUNT_NO_ITEMS')
        const count = {
          id: uuid(), number,
          date: date || new Date().toISOString().slice(0, 10),
          warehouseId, notes,
          status: COUNT_STATUS.open,
          lines,
          startedAt: new Date().toISOString(),
          startedBy: get().currentUser?.()?.name || '',
          journalEntryId: null,
        }
        set((st) => ({
          stockCounts: [...st.stockCounts, count],
          settings: { ...st.settings, stockCount: { ...st.settings.stockCount, next: next + 1 } },
        }))
        get().logActivity('Started stock count', `${number} · ${lines.length} line(s)`, { entity: 'stockCount', entityId: count.id, entityRef: number })
        return count
      },

      updateStockCount: (id, patch) =>
        set((s) => ({
          stockCounts: s.stockCounts.map((c) => {
            if (c.id !== id) return c
            // A posted count is history — its lines are what the adjustment was
            // based on, so they must not drift afterwards.
            if (c.status === COUNT_STATUS.posted) return c
            return { ...c, ...patch }
          }),
        })),

      deleteStockCount: (id) => {
        const c = get().stockCounts.find((x) => x.id === id)
        if (c?.status === COUNT_STATUS.posted) throw new Error('COUNT_POSTED')
        get().recycleRecord('stockCounts', id)
        return set((s) => ({ stockCounts: s.stockCounts.filter((x) => x.id !== id) }))
      },

      /**
       * Post the count: adjust stock to what was found, and book the value
       * difference. Only counted lines that actually differ are touched.
       */
      postStockCount: (id) => {
        const st = get()
        const count = st.stockCounts.find((c) => c.id === id)
        const check = validateCount(count, { lockDate: st.settings?.accounting?.lockDate })
        if (!check.ok) throw new Error(`COUNT_INVALID:${check.errors.join(' ')}`)

        const lines = countPostingLines(count, st.inventoryItems)
        const changes = countStockChanges(count)
        const summary = summariseCount(count.lines || [])

        let je = null
        if (lines.length) {
          je = get().addJournalEntry({
            date: count.date,
            description: `Stock count ${count.number}`,
            reference: count.number,
            type: 'stock_count',
            lines,
          })
        }

        const wh = count.warehouseId
        set((s) => ({
          inventoryItems: s.inventoryItems.map((it) => {
            if (!(it.id in changes)) return it
            const target = changes[it.id]
            const patch = { quantity: target }
            if (wh && it.stockByWarehouse) {
              const map = { ...it.stockByWarehouse }
              const before = Number(map[wh]) || 0
              map[wh] = target
              // Counting one warehouse says nothing about the others, so the
              // total moves by this warehouse's delta rather than being
              // replaced by its count.
              patch.quantity = Math.round(((Number(it.quantity) || 0) + (target - before)) * 1e6) / 1e6
              patch.stockByWarehouse = map
            }
            return { ...it, ...patch }
          }),
          stockCounts: s.stockCounts.map((c) => (c.id === id
            ? { ...c, status: COUNT_STATUS.posted, postedAt: new Date().toISOString(), journalEntryId: je?.id || null, summary }
            : c)),
        }))

        get().logActivity(
          'Posted stock count',
          `${count.number} · ${summary.gains} up, ${summary.losses} down`,
          { entity: 'stockCount', entityId: id, entityRef: count.number, severity: summary.netValue === 0 ? 'info' : 'warning' }
        )
        return { journalEntryId: je?.id || null, summary, adjusted: Object.keys(changes).length }
      },

      // ─── SALES ORDERS ──────────────────────────────────────────────
      // A confirmed order that has not been delivered or invoiced yet.
      //
      // It posts nothing. A customer agreeing to buy is not a sale — revenue
      // is earned when the goods go out or the invoice is raised, and booking
      // it earlier would overstate both income and receivables. The value of
      // the document is that it holds the commitment: what is owed to the
      // customer, what is still to ship, and what is left to bill.
      salesOrders: [],

      addSalesOrder: (o) => {
        const s = get()
        const { prefix, next } = s.settings.salesOrder
        const number = nextNum(prefix, next)
        const newSO = { ...o, id: uuid(), number, status: o.status || 'open', createdAt: new Date().toISOString() }
        set((st) => ({
          salesOrders: [...st.salesOrders, newSO],
          settings: { ...st.settings, salesOrder: { ...st.settings.salesOrder, next: next + 1 } },
        }))
        get().logActivity('Created sales order', `${number} · ${o.customerName || ''}`.trim(), { entity: 'salesOrder', entityId: newSO.id, entityRef: number })
        return newSO
      },

      updateSalesOrder: (id, patch) =>
        set((s) => ({ salesOrders: s.salesOrders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

      deleteSalesOrder: (id) => {
        get().recycleRecord('salesOrders', id)
        return set((s) => ({ salesOrders: s.salesOrders.filter((o) => o.id !== id) }))
      },

      /** Quotation → sales order, in full or partially. */
      convertQuotationToSalesOrder: (id, selections) => {
        const q = get().quotations.find((x) => x.id === id)
        if (!q) return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(q.items || [], 'orderedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'orderedQty', taxEnabled })
        if (items.length === 0) return null
        const order = get().addSalesOrder({
          customerId: q.customerId, customerName: q.customerName,
          quotationId: q.id,
          date: new Date().toISOString().slice(0, 10),
          expectedDate: q.expiryDate || '',
          departmentId: q.departmentId || null,
          currency: q.currency, exchangeRate: q.exchangeRate,
          items, subtotal, taxAmount, total, notes: q.notes || '',
        })
        const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, orderedQty: (Number(l.orderedQty) || 0) + applied[l.id] } : l))
        const status = docFulfillment(newItems, 'orderedQty').status === 'complete' ? 'ordered' : q.status
        get().updateQuotation(id, { items: newItems, status, salesOrderId: order.id })
        return order
      },

      /** Sales order → invoice. Each line remembers how much has been billed. */
      convertSalesOrderToInvoice: (id, selections) => {
        const o = get().salesOrders.find((x) => x.id === id)
        if (!o || o.status === 'invoiced') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(o.items || [], 'invoicedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(o.items || [], sel, { key: 'invoicedQty', taxEnabled })
        if (items.length === 0) return null
        const invoice = get().addInvoice({
          customerId: o.customerId, customerName: o.customerName,
          salesOrderId: o.id,
          date: new Date().toISOString().slice(0, 10),
          dueDate: o.expectedDate || new Date().toISOString().slice(0, 10),
          departmentId: o.departmentId || null,
          currency: o.currency, exchangeRate: o.exchangeRate,
          items, subtotal, taxAmount, total, notes: o.notes || '',
        })
        const newItems = (o.items || []).map((l) => (applied[l.id] ? { ...l, invoicedQty: (Number(l.invoicedQty) || 0) + applied[l.id] } : l))
        const done = docFulfillment(newItems, 'invoicedQty').status === 'complete'
        get().updateSalesOrder(id, {
          items: newItems,
          status: done ? 'invoiced' : 'partial',
          invoiceIds: [...(o.invoiceIds || []), invoice.id],
        })
        return invoice
      },

      /** Sales order → delivery note, tracked separately from billing. */
      convertSalesOrderToDeliveryNote: (id, selections) => {
        const o = get().salesOrders.find((x) => x.id === id)
        if (!o) return null
        const sel = selections || defaultSelection(o.items || [], 'deliveredQty')
        const { items, applied } = buildConversion(o.items || [], sel, { key: 'deliveredQty', taxEnabled: false })
        if (items.length === 0) return null
        const dn = get().addDeliveryNote({
          customerId: o.customerId, customerName: o.customerName,
          salesOrderId: o.id,
          date: new Date().toISOString().slice(0, 10),
          items, notes: o.notes || '',
        })
        const newItems = (o.items || []).map((l) => (applied[l.id] ? { ...l, deliveredQty: (Number(l.deliveredQty) || 0) + applied[l.id] } : l))
        get().updateSalesOrder(id, {
          items: newItems,
          deliveryNoteIds: [...(o.deliveryNoteIds || []), dn.id],
        })
        return dn
      },

      // ─── PURCHASE QUOTES (supplier offers) ─────────────────────────
      // What a supplier says they will charge, before anything is committed.
      // Also posts nothing: asking three suppliers for a price creates no
      // liability, and only the one that turns into a purchase order does.
      purchaseQuotes: [],

      addPurchaseQuote: (q) => {
        const s = get()
        const { prefix, next } = s.settings.purchaseQuote
        const number = nextNum(prefix, next)
        const newQ = { ...q, id: uuid(), number, status: q.status || 'open', createdAt: new Date().toISOString() }
        set((st) => ({
          purchaseQuotes: [...st.purchaseQuotes, newQ],
          settings: { ...st.settings, purchaseQuote: { ...st.settings.purchaseQuote, next: next + 1 } },
        }))
        get().logActivity('Recorded purchase quote', `${number} · ${q.supplierName || ''}`.trim(), { entity: 'purchaseQuote', entityId: newQ.id, entityRef: number })
        return newQ
      },

      updatePurchaseQuote: (id, patch) =>
        set((s) => ({ purchaseQuotes: s.purchaseQuotes.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),

      deletePurchaseQuote: (id) => {
        get().recycleRecord('purchaseQuotes', id)
        return set((s) => ({ purchaseQuotes: s.purchaseQuotes.filter((q) => q.id !== id) }))
      },

      /** Purchase quote → purchase order. */
      convertPurchaseQuoteToOrder: (id, selections) => {
        const q = get().purchaseQuotes.find((x) => x.id === id)
        if (!q || q.status === 'ordered') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(q.items || [], 'orderedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'orderedQty', taxEnabled })
        if (items.length === 0) return null
        const po = get().addPurchaseOrder({
          supplierId: q.supplierId, supplierName: q.supplierName,
          purchaseQuoteId: q.id,
          date: new Date().toISOString().slice(0, 10),
          expectedDate: q.validUntil || '',
          currency: q.currency, exchangeRate: q.exchangeRate,
          items, subtotal, taxAmount, total, notes: q.notes || '',
        })
        const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, orderedQty: (Number(l.orderedQty) || 0) + applied[l.id] } : l))
        const done = docFulfillment(newItems, 'orderedQty').status === 'complete'
        get().updatePurchaseQuote(id, { items: newItems, status: done ? 'ordered' : 'partial', purchaseOrderId: po.id })
        return po
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
        lines.push({ accountId: get().controlAccountFor('customers', cn.customerId), debit: 0, credit: cn.total, description: `CN ${number}` })
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

      // Sales return (RMA): raise a credit note FROM an invoice by picking the
      // quantities coming back. Reverses the sale proportionally (Dr Sales
      // Returns + Dr output VAT, Cr AR), and for stocked lines puts the goods
      // back and reverses COGS at current average cost. Tracks returnedQty so a
      // line can't be over-returned.
      createSalesReturn: (invoiceId, selections, { date, reason } = {}) => {
        const inv = get().invoices.find((i) => i.id === invoiceId)
        if (!inv || inv.status === 'void') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(inv.items || [], 'returnedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(inv.items || [], sel, { key: 'returnedQty', taxEnabled })
        if (items.length === 0) return null
        const rate = Number(inv.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const rDate = date || new Date().toISOString().slice(0, 10)
        const { prefix, next } = get().settings.creditNote
        const number = nextNum(prefix, next)

        const netBase = items.reduce((s, l) => s + toBase(l.subtotal), 0)
        const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
        const arBase = Math.round((netBase + vatBase) * 100) / 100
        const lines = [{ accountId: 'acc-salesret', debit: netBase, credit: 0, description: `Credit Note ${number}` }]
        if (vatBase > 0) lines.push({ accountId: 'acc-vatout', debit: vatBase, credit: 0, description: 'Output Tax reversal' })
        lines.push({ accountId: get().controlAccountFor('customers', inv.customerId), debit: 0, credit: arBase, description: `Credit Note ${number} for ${inv.number}` })
        const je = get().addJournalEntry({ date: rDate, description: `Sales Return ${number} – ${inv.customerName || ''}`, reference: number, type: 'credit_note', departmentId: inv.departmentId || null, lines })

        // Restock returned stock + reverse COGS at current average cost.
        const cogsByAcc = {}, invByAcc = {}, restock = {}
        let cogs = 0
        // A returned kit puts its components back, not the kit — the same
        // explosion the sale used, so what comes back matches what went out.
        Object.entries(explodeLines(items, get().inventoryItems)).forEach(([itemId, qty]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId); if (!it) return
          restock[itemId] = (restock[itemId] || 0) + qty
          const amt = Math.round(qty * (it.costPrice || 0) * 100) / 100
          if (amt <= 0) return
          cogs += amt
          const cAcc = it.cogsAccountId || 'acc-cogs', iAcc = it.inventoryAccountId || 'acc-inv'
          invByAcc[iAcc] = (invByAcc[iAcc] || 0) + amt
          cogsByAcc[cAcc] = (cogsByAcc[cAcc] || 0) + amt
        })
        let cogsJeId = null
        if (cogs > 0) {
          const cje = get().addJournalEntry({
            date: rDate, description: `Restock – Return ${number}`, reference: number, type: 'cogs',
            departmentId: inv.departmentId || null,
            lines: [
              ...Object.entries(invByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Inventory returned' })),
              ...Object.entries(cogsByAcc).map(([a, amt]) => ({ accountId: a, debit: 0, credit: amt, description: 'COGS reversal' })),
            ],
          })
          cogsJeId = cje.id
        }
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((st) => ({ inventoryItems: st.inventoryItems.map((it) => {
          const q = restock[it.id]; if (!q) return it
          const patch = { quantity: (it.quantity || 0) + q }
          if (it.stockByWarehouse) { const m = { ...it.stockByWarehouse }; m[defWh] = (m[defWh] || 0) + q; patch.stockByWarehouse = m }
          return { ...it, ...patch }
        }) }))
        Object.entries(restock).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: rDate, type: 'return', qtyChange: q, ref: number, note: `Return from ${inv.customerName || 'customer'}` })
        })

        const cn = {
          id: uuid(), number, invoiceId, invoiceNumber: inv.number,
          customerId: inv.customerId, customerName: inv.customerName, date: rDate, reason: reason || '',
          currency: inv.currency, exchangeRate: rate, items, subtotal, taxAmount, total,
          status: 'issued', journalEntryId: je.id, cogsJournalEntryId: cogsJeId, createdAt: new Date().toISOString(),
        }
        const newItems = (inv.items || []).map((l) => (applied[l.id] ? { ...l, returnedQty: (Number(l.returnedQty) || 0) + applied[l.id] } : l))
        set((st) => ({
          creditNotes: [...st.creditNotes, cn],
          invoices: st.invoices.map((i) => (i.id === invoiceId ? { ...i, items: newItems, creditNoteIds: [...(i.creditNoteIds || []), cn.id] } : i)),
          settings: { ...st.settings, creditNote: { ...st.settings.creditNote, next: next + 1 } },
        }))
        get().logActivity('Sales return', `${number} · ${inv.number}`)
        return cn
      },

      // Purchase return: raise a debit note FROM a bill. Reverses the purchase
      // proportionally (Dr AP, Cr input VAT, Cr Inventory/Expense) and removes
      // the returned stock. Tracks returnedQty on the bill lines.
      createPurchaseReturn: (purchaseId, selections, { date, reason } = {}) => {
        const pur = get().purchases.find((p) => p.id === purchaseId)
        if (!pur || pur.status === 'void') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(pur.items || [], 'returnedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(pur.items || [], sel, { key: 'returnedQty', taxEnabled })
        if (items.length === 0) return null
        const rate = Number(pur.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const rDate = date || new Date().toISOString().slice(0, 10)
        const { prefix, next } = get().settings.debitNote
        const number = nextNum(prefix, next)

        const creditByAcc = {}, remove = {}
        items.forEach((l) => {
          const acc = l.itemId ? (get().inventoryItems.find((i) => i.id === l.itemId)?.inventoryAccountId || 'acc-inv') : (l.accountId || 'acc-admin')
          creditByAcc[acc] = (creditByAcc[acc] || 0) + toBase(l.subtotal)
          if (l.itemId) remove[l.itemId] = (remove[l.itemId] || 0) + l.quantity
        })
        const netBase = Object.values(creditByAcc).reduce((s, v) => s + v, 0)
        const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
        const apBase = Math.round((netBase + vatBase) * 100) / 100
        const lines = [{ accountId: get().controlAccountFor('suppliers', pur.supplierId), debit: apBase, credit: 0, description: `Debit Note ${number} for ${pur.number}` }]
        if (vatBase > 0) lines.push({ accountId: 'acc-vatin', debit: 0, credit: vatBase, description: 'Input Tax reversal' })
        Object.entries(creditByAcc).forEach(([a, amt]) => lines.push({ accountId: a, debit: 0, credit: amt, description: 'Goods returned' }))
        const je = get().addJournalEntry({ date: rDate, description: `Purchase Return ${number} – ${pur.supplierName || ''}`, reference: number, type: 'debit_note', departmentId: pur.departmentId || null, lines })

        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((st) => ({ inventoryItems: st.inventoryItems.map((it) => {
          const q = remove[it.id]; if (!q) return it
          const patch = { quantity: (it.quantity || 0) - q }
          if (it.stockByWarehouse) { const m = { ...it.stockByWarehouse }; m[defWh] = (m[defWh] || 0) - q; patch.stockByWarehouse = m }
          return { ...it, ...patch }
        }) }))
        Object.entries(remove).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: rDate, type: 'return', qtyChange: -q, ref: number, note: `Return to ${pur.supplierName || 'supplier'}` })
        })

        const dn = {
          id: uuid(), number, purchaseId, purchaseNumber: pur.number,
          supplierId: pur.supplierId, supplierName: pur.supplierName, date: rDate, reason: reason || '',
          currency: pur.currency, exchangeRate: rate, items, subtotal, taxAmount, total,
          status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        const newItems = (pur.items || []).map((l) => (applied[l.id] ? { ...l, returnedQty: (Number(l.returnedQty) || 0) + applied[l.id] } : l))
        set((st) => ({
          debitNotes: [...st.debitNotes, dn],
          purchases: st.purchases.map((p) => (p.id === purchaseId ? { ...p, items: newItems, debitNoteIds: [...(p.debitNoteIds || []), dn.id] } : p)),
          settings: { ...st.settings, debitNote: { ...st.settings.debitNote, next: next + 1 } },
        }))
        get().logActivity('Purchase return', `${number} · ${pur.number}`)
        return dn
      },

      deleteCreditNote: (id) =>
        set((s) => {
          const cn = s.creditNotes.find((c) => c.id === id)
          get().assertJEsUnlocked(cn?.journalEntryId)
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

      deletePurchaseOrder: (id) => {
        get().recycleRecord('purchaseOrders', id)
        return set((s) => ({ purchaseOrders: s.purchaseOrders.filter((p) => p.id !== id) }))
      },

      // Receive/bill a purchase order — in full, or partially via a { lineId:
      // qty } selection. Each line tracks receivedQty, so undelivered quantities
      // remain open. Omitting `selections` bills everything remaining.
      convertPOToPurchase: (id, selections) => {
        const po = get().purchaseOrders.find((p) => p.id === id)
        if (!po || po.status === 'invoiced') return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(po.items || [], 'receivedQty')
        const { items, applied, subtotal, taxAmount, total } = buildConversion(po.items || [], sel, { key: 'receivedQty', taxEnabled })
        if (items.length === 0) return null
        const purchase = get().addPurchase({
          supplierId: po.supplierId, supplierName: po.supplierName,
          date: new Date().toISOString().slice(0, 10),
          dueDate: po.deliveryDate || new Date().toISOString().slice(0, 10),
          departmentId: po.departmentId || null,
          currency: po.currency, exchangeRate: po.exchangeRate,
          items, subtotal, taxAmount, total, notes: po.notes || '',
        })
        // Direct path receives and bills together, so both counters advance.
        const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, receivedQty: (Number(l.receivedQty) || 0) + applied[l.id], billedQty: (Number(l.billedQty) || 0) + applied[l.id] } : l))
        const status = docFulfillment(newItems, 'billedQty').status === 'complete' ? 'invoiced' : 'partial'
        get().updatePurchaseOrder(id, { items: newItems, status, purchaseId: purchase.id, purchaseIds: [...(po.purchaseIds || []), purchase.id] })
        return purchase
      },

      // ─── GOODS RECEIPTS (GRN) + 3-WAY MATCH ────────────────────────
      // Procure-to-pay separates the physical receipt of goods from the vendor
      // bill. A GRN records what arrived: it puts stock in and accrues the cost
      // to "Goods Received Not Invoiced" (GRNI). The later bill clears GRNI into
      // Accounts Payable. Comparing PO ↔ GRN ↔ Bill quantities is the 3-way match.
      goodsReceipts: [],

      receiveGoods: (poId, selections, { date } = {}) => {
        const po = get().purchaseOrders.find((p) => p.id === poId)
        if (!po) return null
        const taxEnabled = get().settings?.tax?.enabled !== false
        const sel = selections || defaultSelection(po.items || [], 'receivedQty')
        const { items, applied } = buildConversion(po.items || [], sel, { key: 'receivedQty', taxEnabled })
        if (items.length === 0) return null
        const rate = Number(po.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const recvDate = date || new Date().toISOString().slice(0, 10)
        const { prefix, next } = get().settings.goodsReceipt

        // JE: Dr inventory (stock) / expense (non-stock) at cost, Cr GRNI accrual.
        const debitByAcc = {}
        const recv = {} // itemId -> { qty, cost(base) }
        items.forEach((l) => {
          const acc = l.itemId ? (get().inventoryItems.find((i) => i.id === l.itemId)?.inventoryAccountId || 'acc-inv') : (l.accountId || 'acc-admin')
          const amt = toBase(l.subtotal)
          debitByAcc[acc] = (debitByAcc[acc] || 0) + amt
          if (l.itemId) { recv[l.itemId] = recv[l.itemId] || { qty: 0, cost: 0 }; recv[l.itemId].qty += l.quantity; recv[l.itemId].cost += amt }
        })
        const netBase = Object.values(debitByAcc).reduce((s, v) => s + v, 0)
        const lines = [
          ...Object.entries(debitByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Goods received' })),
          { accountId: 'acc-grni', debit: 0, credit: netBase, description: 'Goods received not invoiced' },
        ]
        const number = nextNum(prefix, next)
        const je = get().addJournalEntry({ date: recvDate, description: `Goods Receipt ${number} – ${po.supplierName || ''}`, reference: number, type: 'goods_receipt', lines })

        // Perpetual receipt into stock (weighted-average, base cost).
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((st) => ({
          inventoryItems: st.inventoryItems.map((it) => {
            const u = recv[it.id]; if (!u) return it
            const oldQty = it.quantity || 0, newQty = oldQty + u.qty
            const newCost = newQty > 0 ? (oldQty * (it.costPrice || 0) + u.cost) / newQty : (it.costPrice || 0)
            const patch = { quantity: newQty, costPrice: newCost }
            if (it.stockByWarehouse) { const m = { ...it.stockByWarehouse }; m[defWh] = (m[defWh] || 0) + u.qty; patch.stockByWarehouse = m }
            return { ...it, ...patch }
          }),
          settings: { ...st.settings, goodsReceipt: { ...st.settings.goodsReceipt, next: next + 1 } },
        }))
        Object.entries(recv).forEach(([itemId, u]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: recvDate, type: 'purchase', qtyChange: u.qty, ref: number, note: `GRN from ${po.supplierName || 'supplier'}` })
        })

        const grn = { id: uuid(), number, poId, poNumber: po.number, supplierId: po.supplierId, supplierName: po.supplierName, date: recvDate, items, journalEntryId: je.id, createdAt: new Date().toISOString() }
        const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, receivedQty: (Number(l.receivedQty) || 0) + applied[l.id] } : l))
        const fullyBilled = docFulfillment(newItems, 'billedQty').status === 'complete'
        set((st) => ({ goodsReceipts: [...st.goodsReceipts, grn] }))
        get().updatePurchaseOrder(poId, { items: newItems, status: fullyBilled ? 'invoiced' : 'partial', grnIds: [...(po.grnIds || []), grn.id] })
        get().logActivity('Received goods', `${number} · ${po.number}`)
        return grn
      },

      // Bill the received-but-not-yet-billed quantities of a PO: Dr GRNI + input
      // VAT, Cr AP. No stock movement (the GRN already received it).
      billReceivedPO: (poId, selections, { date, dueDate } = {}) => {
        const po = get().purchaseOrders.find((p) => p.id === poId)
        if (!po) return null
        const rate = Number(po.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const taxEnabled = get().settings?.tax?.enabled !== false
        // Clamp each line to what's received but not billed.
        const billable = {}
        ;(po.items || []).forEach((l) => {
          const cap = Math.max(0, (Number(l.receivedQty) || 0) - (Number(l.billedQty) || 0))
          const want = selections ? (Number(selections[l.id]) || 0) : cap
          const q = Math.min(want, cap)
          if (q > 1e-9) billable[l.id] = q
        })
        const { items, applied, subtotal, taxAmount, total } = buildConversion(po.items || [], billable, { key: 'billedQty', taxEnabled })
        if (items.length === 0) return null

        const netBase = items.reduce((s, l) => s + toBase(l.subtotal), 0)
        const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
        const apBase = Math.round((netBase + vatBase) * 100) / 100
        const lines = [{ accountId: 'acc-grni', debit: netBase, credit: 0, description: 'Clear GRNI' }]
        if (vatBase > 0) lines.push({ accountId: 'acc-vatin', debit: vatBase, credit: 0, description: 'Input Tax' })
        lines.push({ accountId: get().controlAccountFor('suppliers', po.supplierId), debit: 0, credit: apBase, description: `Bill for ${po.number}` })

        const { prefix, next } = get().settings.purchase
        const number = nextNum(prefix, next)
        const billDate = date || new Date().toISOString().slice(0, 10)
        const je = get().addJournalEntry({ date: billDate, description: `Purchase Invoice ${number} – ${po.supplierName || ''}`, reference: number, type: 'purchase', departmentId: po.departmentId || null, lines })

        const newPurchase = {
          id: uuid(), number, supplierId: po.supplierId, supplierName: po.supplierName,
          date: billDate, dueDate: dueDate || po.deliveryDate || billDate,
          departmentId: po.departmentId || null, currency: po.currency, exchangeRate: rate,
          items, subtotal, taxAmount, total, baseTotal: apBase, notes: `From ${po.number} (GRNI)`,
          status: 'received', amountPaid: 0, payments: [], journalEntryId: je.id, poId, fromGrni: true,
          createdAt: new Date().toISOString(),
        }
        set((st) => ({ purchases: [...st.purchases, newPurchase], settings: { ...st.settings, purchase: { ...st.settings.purchase, next: next + 1 } } }))

        const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, billedQty: (Number(l.billedQty) || 0) + applied[l.id] } : l))
        const status = docFulfillment(newItems, 'billedQty').status === 'complete' ? 'invoiced' : 'partial'
        get().updatePurchaseOrder(poId, { items: newItems, status, purchaseId: newPurchase.id, purchaseIds: [...(po.purchaseIds || []), newPurchase.id] })
        get().logActivity('Billed received goods', `${number} · ${po.number}`)
        return newPurchase
      },

      // ─── PURCHASE INVOICES ─────────────────────────────────────────
      purchases: [],

      addPurchase: (purchase, opts = {}) => {
        const s = get()
        if (!opts.approved && needsApproval(s.settings?.approvals, 'purchase', amountOf('purchase', purchase))) {
          return { pendingApproval: true, request: get().submitForApproval('purchase', purchase) }
        }
        const { prefix, next } = s.settings.purchase
        const number = nextNum(prefix, next)
        // Foreign-currency bills are entered in their own currency; convert every
        // amount to base at the bill's rate (1 for base-currency bills) for the ledger.
        const rate = Number(purchase.exchangeRate) || 1
        const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
        const expMap = {}
        purchase.items.forEach((item) => {
          const acc = item.accountId || 'acc-admin'
          expMap[acc] = (expMap[acc] || 0) + item.subtotal
        })
        const expLines = Object.entries(expMap).map(([accId, amount]) =>
          ({ accountId: accId, debit: toBase(amount), credit: 0, description: `Purchase – ${number}` }))
        const vatBase = purchase.taxAmount > 0 ? toBase(purchase.taxAmount) : 0
        // Optional whole-bill discount (contra-expense credit) and freight-in charge (added cost).
        const docDiscBase = toBase(purchase.docDiscountAmount || 0)
        const freightBase = toBase(purchase.shipping || 0)
        const lines = [...expLines]
        if (vatBase > 0)
          lines.push({ accountId: 'acc-vatin', debit: vatBase, credit: 0, description: 'Input Tax' })
        if (docDiscBase > 0) lines.push({ accountId: 'acc-purchdisc', debit: 0, credit: docDiscBase, description: 'Bill discount' })
        if (freightBase > 0) lines.push({ accountId: 'acc-freightin', debit: freightBase, credit: 0, description: 'Freight-in' })
        // AP = expenses − discount + freight + VAT (all base), so the entry balances.
        const apBase = Math.round((expLines.reduce((s, l) => s + l.debit, 0) - docDiscBase + freightBase + vatBase) * 100) / 100
        lines.push({ accountId: get().controlAccountFor('suppliers', purchase.supplierId), debit: 0, credit: apBase, description: `Purchase ${number}` })
        const je = get().addJournalEntry({
          date: purchase.date,
          description: `Purchase Invoice ${number} – ${purchase.supplierName || ''}`,
          reference: number, type: 'purchase', departmentId: purchase.departmentId || null, lines,
        })
        const newPurchase = {
          ...purchase, id: uuid(), number, status: 'received', amountPaid: 0, payments: [],
          exchangeRate: rate, baseTotal: apBase,
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }

        // Perpetual inventory: receive tracked lines into stock at weighted-average cost.
        const recv = {} // itemId -> { qty, cost }
        purchase.items.forEach((line) => {
          if (!line.itemId) return
          const q = parseFloat(line.quantity) || 0
          if (q <= 0) return
          recv[line.itemId] = recv[line.itemId] || { qty: 0, cost: 0 }
          recv[line.itemId].qty += q
          // Weighted-average cost is held in base currency, so convert FC line costs.
          recv[line.itemId].cost += toBase(line.subtotal || 0)
        })
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((st) => ({
          purchases: [...st.purchases, newPurchase],
          inventoryItems: st.inventoryItems.map((it) => {
            const u = recv[it.id]
            if (!u) return it
            const oldQty = it.quantity || 0
            const newQty = oldQty + u.qty
            const newCost = newQty > 0 ? (oldQty * (it.costPrice || 0) + u.cost) / newQty : (it.costPrice || 0)
            const patch = { quantity: newQty, costPrice: newCost }
            if (it.stockByWarehouse) {
              const map = { ...it.stockByWarehouse }
              map[defWh] = (map[defWh] || 0) + u.qty
              patch.stockByWarehouse = map
            }
            return { ...it, ...patch }
          }),
          settings: { ...st.settings, purchase: { ...st.settings.purchase, next: next + 1 } },
        }))
        // Movement ledger entries for each received item.
        Object.entries(recv).forEach(([itemId, u]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: purchase.date, type: 'purchase', qtyChange: u.qty, ref: number, note: `Received from ${purchase.supplierName || 'supplier'}` })
        })
        return newPurchase
      },

      recordPurchasePayment: (purchaseId, payment, opts = {}) => {
        const s = get()
        const purchase = s.purchases.find((p) => p.id === purchaseId)
        if (!purchase) return
        // Overpayment guard: never pay more than the outstanding balance (keeps AP ≥ 0)
        const remaining = Math.max(0, (purchase.total || 0) - (purchase.amountPaid || 0))
        const amount = Math.min(Number(payment.amount) || 0, remaining)
        if (amount <= 0) return
        // Money leaving the business is the sharpest edge of all — gate it on the
        // capped amount, so an overpayment attempt can't clear a lower threshold.
        if (!opts.approved && needsApproval(s.settings?.approvals, 'payment', amount)) {
          return { pendingApproval: true, request: get().submitForApproval('payment', { purchaseId, payment: { ...payment, amount }, targetRef: purchase.number }) }
        }
        const { prefix, next } = s.settings.payment
        const number = nextNum(prefix, next)
        const newAmountPaid = purchase.amountPaid + amount
        const status = newAmountPaid >= purchase.total - 0.005 ? 'paid' : 'partial'
        const wht = Math.max(0, Math.min(amount, Number(payment.wht) || 0))
        const netCash = amount - wht
        // Multi-currency settlement: AP and WHT are relieved at the bill's rate; cash
        // leaves at the payment-date rate. The difference is a realized FX gain/loss.
        // (Both rates default to 1, so base-currency payments post exactly as before.)
        const purRate = Number(purchase.exchangeRate) || 1
        const payRate = Number(payment.exchangeRate) || purRate
        const apBase = Math.round(amount * purRate * 100) / 100
        const whtBase = Math.round(wht * purRate * 100) / 100
        const cashBase = Math.round(netCash * payRate * 100) / 100
        const fx = Math.round((apBase - whtBase - cashBase) * 100) / 100
        const lines = [
          { accountId: get().controlAccountFor('suppliers', purchase.supplierId), debit: apBase, credit: 0, description: `Payment for ${purchase.number}` },
          { accountId: payment.bankAccountId, debit: 0, credit: cashBase, description: `Payment for ${purchase.number}` },
        ]
        if (whtBase > 0) lines.push({ accountId: 'acc-wht', debit: 0, credit: whtBase, description: `Withholding tax – ${purchase.number}` })
        if (fx > 0) lines.push({ accountId: 'acc-fxreal', debit: 0, credit: fx, description: `Realized FX gain – ${purchase.number}` })
        else if (fx < 0) lines.push({ accountId: 'acc-fxreal', debit: -fx, credit: 0, description: `Realized FX loss – ${purchase.number}` })
        const je = get().addJournalEntry({
          date: payment.date,
          description: `Payment ${number} for ${purchase.number}`,
          reference: number, type: 'payment_out', lines,
        })
        set((st) => ({
          purchases: st.purchases.map((p) =>
            p.id === purchaseId
              ? { ...p, amountPaid: newAmountPaid, status, payments: [...(p.payments || []), { ...payment, amount, id: uuid(), number, journalEntryId: je.id }] }
              : p
          ),
          settings: { ...st.settings, payment: { ...st.settings.payment, next: next + 1 } },
        }))
      },

      updatePurchase: (id, patch) =>
        set((s) => ({ purchases: s.purchases.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      // Void a purchase bill: reverse its bill + payment entries and back out the
      // received stock, marking it 'void' (kept for the audit trail).
      voidPurchase: (id, { date, reason } = {}) => {
        const pur = get().purchases.find((p) => p.id === id)
        if (!pur || pur.status === 'void') return
        const voidDate = date || new Date().toISOString().slice(0, 10)
        const jeIds = [pur.journalEntryId, ...(pur.payments || []).map((p) => p.journalEntryId)].filter(Boolean)
        jeIds.forEach((jeId) => {
          const je = get().journalEntries.find((j) => j.id === jeId)
          if (je && !je.reversedBy) get().voidJournalEntry(jeId, { date: voidDate, reason: reason || `Void bill ${pur.number}` })
        })
        const back = {}
        ;(pur.items || []).forEach((line) => {
          if (!line.itemId) return
          const q = parseFloat(line.quantity) || 0
          if (q > 0) back[line.itemId] = (back[line.itemId] || 0) + q
        })
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((s) => ({
          purchases: s.purchases.map((p) => (p.id === id ? { ...p, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString(), amountPaid: 0 } : p)),
          inventoryItems: s.inventoryItems.map((it) => {
            const q = back[it.id]
            if (!q) return it
            const patch = { quantity: Math.max(0, (it.quantity || 0) - q) }
            if (it.stockByWarehouse) { const m = { ...it.stockByWarehouse }; m[defWh] = (m[defWh] || 0) - q; patch.stockByWarehouse = m }
            return { ...it, ...patch }
          }),
        }))
        Object.entries(back).forEach(([itemId, q]) => {
          const it = get().inventoryItems.find((i) => i.id === itemId)
          get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: -q, ref: pur.number, note: 'Bill voided' })
        })
        get().logActivity('Voided purchase bill', `${pur.number}${reason ? ' · ' + reason : ''}`)
      },

      deletePurchase: (id) => {
        const pur = get().purchases.find((p) => p.id === id)
        const payJEs = (pur?.payments || []).map((p) => p.journalEntryId)
        const jeIds = new Set([pur?.journalEntryId, ...payJEs].filter(Boolean))
        get().assertJEsUnlocked(...jeIds)
        get().logActivity('Deleted purchase', pur?.number || id)
        // Reverse any perpetual stock received by this purchase.
        const recv = {}
        ;(pur?.items || []).forEach((line) => {
          if (!line.itemId) return
          const q = parseFloat(line.quantity) || 0
          if (q > 0) recv[line.itemId] = (recv[line.itemId] || 0) + q
        })
        const defWh = get().warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
        set((s) => ({
          purchases: s.purchases.filter((p) => p.id !== id),
          journalEntries: s.journalEntries.filter((j) => !jeIds.has(j.id)),
          stockMovements: s.stockMovements.filter((m) => m.ref !== pur?.number),
          inventoryItems: s.inventoryItems.map((it) => {
            const q = recv[it.id]
            if (!q) return it
            const patch = { quantity: (it.quantity || 0) - q }
            if (it.stockByWarehouse) {
              const map = { ...it.stockByWarehouse }
              map[defWh] = (map[defWh] || 0) - q
              patch.stockByWarehouse = map
            }
            return { ...it, ...patch }
          }),
        }))
      },

      // ─── DEBIT NOTES (Purchase Returns) ────────────────────────────
      debitNotes: [],

      addDebitNote: (dn) => {
        const s = get()
        const { prefix, next } = s.settings.debitNote
        const number = nextNum(prefix, next)
        const lines = [
          { accountId: get().controlAccountFor('suppliers', dn.supplierId), debit: dn.total, credit: 0, description: `Debit Note ${number}` },
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
          get().assertJEsUnlocked(dn?.journalEntryId)
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

      deleteDepartment: (id) => {
        get().recycleRecord('departments', id)
        return set((s) => ({ departments: s.departments.filter((d) => d.id !== id) }))
      },

      // ─── EMPLOYEES ─────────────────────────────────────────────────
      employees: [],

      addEmployee: (emp) =>
        set((s) => ({ employees: [...s.employees, { ...emp, id: uuid(), createdAt: new Date().toISOString() }] })),

      updateEmployee: (id, patch) => {
        const before = get().employees.find((e) => e.id === id)
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
        get().logChange('Updated employee', before, get().employees.find((e) => e.id === id), { entity: 'employee' })
      },

      deleteEmployee: (id) => {
        get().recycleRecord('employees', id)
        const gone = get().employees.find((e) => e.id === id)
        set((s) => ({ employees: s.employees.filter((e) => e.id !== id) }))
        if (gone) get().logActivity('Deleted employee', gone.name || '', { entity: 'employee', entityId: id, entityRef: gone.name })
      },

      // ─── EMPLOYMENT CONTRACTS ──────────────────────────────────────
      //
      // An employee has a history of contracts and exactly one is in force on
      // any day. A pay rise is a new contract, not an edit — which is what
      // makes "what were they on last March" answerable, and what makes an
      // end-of-service figure defensible.
      employmentContracts: [],

      addContract: (data) => {
        const check = validateContract(data, get().employmentContracts)
        if (!check.ok) throw new Error(`CONTRACT_INVALID: ${check.errors.join(' ')}`)
        const c = { ...emptyContract(), ...data, id: uuid(), createdAt: new Date().toISOString() }
        set((s) => ({ employmentContracts: [...s.employmentContracts, c] }))
        get().logActivity('Added contract', `${get().employees.find((e) => e.id === c.employeeId)?.name || ''}`)
        return c
      },

      updateContract: (id, patch) => {
        const before = get().employmentContracts.find((c) => c.id === id)
        if (!before) return null
        const merged = { ...before, ...patch }
        const check = validateContract(merged, get().employmentContracts, { id })
        if (!check.ok) throw new Error(`CONTRACT_INVALID: ${check.errors.join(' ')}`)
        set((s) => ({ employmentContracts: s.employmentContracts.map((c) => (c.id === id ? merged : c)) }))
        get().logChange('Updated contract', before, merged, { entity: 'contract' })
        return merged
      },

      deleteContract: (id) => {
        const gone = get().employmentContracts.find((c) => c.id === id)
        set((s) => ({ employmentContracts: s.employmentContracts.filter((c) => c.id !== id) }))
        if (gone) get().logActivity('Deleted contract', gone.employeeId)
      },

      /** The contract in force for someone on a date (today by default). */
      contractFor: (employeeId, asAt) =>
        contractInForce(employeeId, get().employmentContracts, asAt || new Date().toISOString().slice(0, 10)),

      /** When service began — the earliest contract, not the current one. */
      serviceStartFor: (employeeId) => serviceStartOf(employeeId, get().employmentContracts),

      // ─── END-OF-SERVICE ────────────────────────────────────────────
      eosbAccruals: [],

      eosbSettings: () => ({ ...defaultEosbSettings(), ...(get().settings.hr?.eosb || {}) }),

      /** What is owed if this person left today (or on a given day). */
      eosbFor: (employeeId, { asAt, reason = 'termination' } = {}) => {
        const cfg = get().eosbSettings()
        const at = asAt || new Date().toISOString().slice(0, 10)
        const contract = get().contractFor(employeeId, at)
        if (!contract) return null
        return eosbAward(contract, {
          serviceStart: get().serviceStartFor(employeeId), asAt: at, reason,
          rule: cfg.rule, daysPerYear: cfg.daysPerYear, wageBasis: cfg.wageBasis,
        })
      },

      /** What has been provided for one employee so far, from posted accruals. */
      eosbProvidedFor: (employeeId) =>
        Math.round(get().eosbAccruals
          .filter((a) => a.status === 'posted')
          .reduce((s, a) => s + ((a.lines || []).find((l) => l.employeeId === employeeId)?.movement || 0), 0) * 100) / 100,

      /** The accrual due for a period, per employee — nothing is posted yet. */
      eosbSchedule: (asAt) => {
        const cfg = get().eosbSettings()
        const at = asAt || new Date().toISOString().slice(0, 10)
        if (cfg.rule === 'none') return { lines: [], total: 0, closing: 0 }
        const rows = get().employees
          .filter((e) => e.status === 'active')
          .map((e) => {
            const contract = get().contractFor(e.id, at)
            if (!contract) return null
            return {
              employeeId: e.id, employeeName: e.name, contract,
              serviceStart: get().serviceStartFor(e.id),
              alreadyProvided: get().eosbProvidedFor(e.id),
            }
          })
          .filter(Boolean)
        return accrualSchedule(rows, { to: at, rule: cfg.rule, daysPerYear: cfg.daysPerYear, wageBasis: cfg.wageBasis })
      },

      /** Post the accrual: Dr end-of-service expense, Cr the provision. */
      postEosbAccrual: (asAt, { period = '' } = {}) => {
        const at = asAt || new Date().toISOString().slice(0, 10)
        const schedule = get().eosbSchedule(at)
        if (!schedule.lines.length || Math.abs(schedule.total) < 0.005)
          throw new Error('EOSB_NOTHING_TO_POST')
        const label = period || at.slice(0, 7)
        const je = get().addJournalEntry({
          date: at,
          description: `End-of-service accrual — ${label}`,
          reference: label, type: 'eosb_accrual',
          lines: eosbAccrualLines(schedule.total, { reference: label }),
        })
        const record = {
          id: uuid(), date: at, period: label, status: 'posted',
          total: schedule.total, closing: schedule.closing,
          lines: schedule.lines, journalEntryId: je.id,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ eosbAccruals: [...s.eosbAccruals, record] }))
        get().logActivity('Posted end-of-service accrual', label)
        return record
      },

      deleteEosbAccrual: (id) =>
        set((s) => {
          const rec = s.eosbAccruals.find((a) => a.id === id)
          get().assertJEsUnlocked(rec?.journalEntryId)
          return {
            eosbAccruals: s.eosbAccruals.filter((a) => a.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== rec?.journalEntryId),
          }
        }),

      /**
       * Settle a leaver: release their provision, charge or credit the
       * difference, and put what they are owed into salaries payable.
       */
      settleEosb: (employeeId, { asAt, reason = 'termination', endContract = true } = {}) => {
        const at = asAt || new Date().toISOString().slice(0, 10)
        const award = get().eosbFor(employeeId, { asAt: at, reason })
        if (!award) throw new Error('EOSB_NO_CONTRACT')
        const provided = get().eosbProvidedFor(employeeId)
        const name = get().employees.find((e) => e.id === employeeId)?.name || ''
        const lines = eosbSettlementLines(award.award, provided, { reference: name })
        if (!lines.length) throw new Error('EOSB_NOTHING_TO_SETTLE')

        const je = get().addJournalEntry({
          date: at,
          description: `End-of-service settlement — ${name}`,
          reference: name, type: 'eosb_settlement', lines,
        })
        // The release is recorded as a negative movement so the provision this
        // person carries falls back to nil and cannot be double-counted.
        const record = {
          id: uuid(), date: at, period: at.slice(0, 7), status: 'posted',
          kind: 'settlement', employeeId, reason,
          total: -provided, closing: 0,
          award: award.award, provided,
          lines: [{ employeeId, employeeName: name, movement: -provided, opening: provided, closing: 0 }],
          journalEntryId: je.id, createdAt: new Date().toISOString(),
        }
        set((s) => ({ eosbAccruals: [...s.eosbAccruals, record] }))

        if (endContract) {
          const c = get().contractFor(employeeId, at)
          if (c) set((s) => ({
            employmentContracts: s.employmentContracts.map((x) =>
              x.id === c.id ? { ...x, status: 'terminated', endDate: x.endDate || at, endReason: reason } : x),
          }))
          get().updateEmployee(employeeId, { status: 'inactive' })
        }
        get().logActivity('Settled end-of-service', name)
        return { record, award, provided }
      },

      // ─── ATTENDANCE ────────────────────────────────────────────────
      //
      // One record per employee per day. A day with no record is not an
      // absence — it is a day nobody has said anything about, and it deducts
      // nothing. See utils/attendance.js.
      attendance: [],

      attendanceSheet: (employeeId, period) =>
        sheetFor(employeeId, period, get().attendance, { restDays: get().settings.hr?.restDays || [5, 6] }),

      setAttendanceDay: (employeeId, date, patch) => {
        const check = validateDay({ ...patch })
        if (!check.ok) throw new Error(`ATTENDANCE_INVALID: ${check.errors.join(' ')}`)
        const key = String(date).slice(0, 10)
        set((s) => {
          const at = s.attendance.findIndex((r) => r.employeeId === employeeId && String(r.date).slice(0, 10) === key)
          const next = [...s.attendance]
          if (at >= 0) next[at] = { ...next[at], ...patch }
          else next.push({ id: uuid(), employeeId, date: key, status: '', hours: '', overtimeHours: '', lateMinutes: '', note: '', ...patch })
          return { attendance: next }
        })
      },

      /** Save a whole month at once, replacing that employee's days in it. */
      saveAttendanceSheet: (employeeId, period, days = []) => {
        const keep = get().attendance.filter(
          (r) => !(r.employeeId === employeeId && periodOf(r.date) === period)
        )
        // Only days that say something are stored; a blank day is the absence
        // of a record, not a record saying "blank".
        const rows = days
          .filter((d) => d.status || d.hours || d.overtimeHours || d.lateMinutes || d.note)
          .map((d) => ({
            id: d.id || uuid(), employeeId, date: String(d.date).slice(0, 10),
            status: d.status || '', hours: d.hours ?? '', overtimeHours: d.overtimeHours ?? '',
            lateMinutes: d.lateMinutes ?? '', note: d.note || '',
          }))
        set(() => ({ attendance: [...keep, ...rows] }))
        get().logActivity('Saved attendance', `${get().employees.find((e) => e.id === employeeId)?.name || ''} · ${period}`)
        return rows.length
      },

      clearAttendanceMonth: (employeeId, period) =>
        set((s) => ({
          attendance: s.attendance.filter((r) => !(r.employeeId === employeeId && periodOf(r.date) === period)),
        })),

      /** What a month's attendance does to one person's pay. */
      attendanceImpact: (employeeId, period) => {
        const contract = get().contractFor(employeeId, `${period}-28`)
        if (!contract) return null
        const days = get().attendanceSheet(employeeId, period)
        const summary = summariseAttendance(days)
        const hr = get().settings.hr || {}
        return {
          summary,
          ...payrollImpact(summary, contract, {
            daysInMonth: days.length || 30,
            deductLate: !!hr.deductLate,
            lateGraceMinutes: hr.lateGraceMinutes || 0,
          }),
        }
      },

      updateHrSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, hr: {
          ...(s.settings.hr || {}), ...patch,
          eosb: { ...defaultEosbSettings(), ...(s.settings.hr?.eosb || {}), ...(patch.eosb || {}) },
        } } })),

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
        const n = (l, f) => Number(l[f]) || 0
        // Earnings breakdown (basic + allowances) → gross; fall back to legacy `gross`.
        // Overtime is earnings, so it belongs in gross — and therefore in the
        // salary expense — rather than being netted off somewhere quiet.
        const grossOf = (l) => n(l, 'gross') || (n(l, 'basic') + n(l, 'housing') + n(l, 'transport') + n(l, 'other') + n(l, 'overtime'))
        const otherDedOf = (l) => n(l, 'late') + n(l, 'absent') + n(l, 'penalty')
        const gosiEmpOf = (l) => n(l, 'gosi') || n(l, 'socialSecurity') // employee GOSI (legacy: socialSecurity)
        const totalGross     = run.lines.reduce((a, l) => a + grossOf(l), 0)
        const totalTax       = run.lines.reduce((a, l) => a + n(l, 'tax'), 0)
        const totalGosiEmp   = run.lines.reduce((a, l) => a + gosiEmpOf(l), 0)
        const totalGosiEmployer = run.lines.reduce((a, l) => a + n(l, 'gosiEmployer'), 0)
        const totalOtherDed  = run.lines.reduce((a, l) => a + otherDedOf(l), 0)
        const totalNet       = run.lines.reduce((a, l) => a + n(l, 'net'), 0)
        // Salary cost = earnings not withheld from unpaid deductions (late/absent/penalty
        // reduce the expense; tax & GOSI become payroll liabilities).
        const salaryExpense = totalGross - totalOtherDed
        const lines = [
          { accountId: 'acc-salary', debit: salaryExpense, credit: 0,        description: `Payroll ${run.number} – Salaries` },
          { accountId: 'acc-salpay', debit: 0,             credit: totalNet, description: `Payroll ${run.number} – Net Pay` },
        ]
        if (totalTax > 0)
          lines.push({ accountId: 'acc-paye',  debit: 0, credit: totalTax,     description: `Payroll ${run.number} – Income Tax` })
        if (totalGosiEmp > 0)
          lines.push({ accountId: 'acc-sspay', debit: 0, credit: totalGosiEmp, description: `Payroll ${run.number} – GOSI (employee)` })
        if (totalGosiEmployer > 0) {
          lines.push({ accountId: 'acc-gosiemp', debit: totalGosiEmployer, credit: 0,                   description: `Payroll ${run.number} – GOSI (employer)` })
          lines.push({ accountId: 'acc-sspay',   debit: 0,                  credit: totalGosiEmployer, description: `Payroll ${run.number} – GOSI (employer)` })
        }
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
          get().assertJEsUnlocked(run?.journalEntryId, run?.paymentJEId)
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
        // Bought on credit, the liability belongs on whichever payables
        // control account that supplier uses — the default when none is named.
        const creditAccId = asset.paymentType === 'credit'
          ? get().controlAccountFor('suppliers', asset.supplierId)
          : (asset.bankAccountId || 'acc-bank1')
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

      // Batch straight-line depreciation for every active asset in one period.
      // Skips assets already depreciated for that period or fully depreciated,
      // and caps the charge at the remaining depreciable base.
      runDepreciation: ({ period, date }) => {
        const assets = get().fixedAssets.filter((a) => a.status === 'active')
        let count = 0, total = 0
        assets.forEach((a) => {
          if ((a.depreciationMethod || 'straight_line') !== 'straight_line') return
          if (a.purchaseDate && date && a.purchaseDate > date) return // not yet acquired
          if (get().assetDepreciations.some((d) => d.assetId === a.id && d.period === period)) return
          const cost = a.purchaseCost || 0, salvage = a.salvageValue || 0
          const months = (a.usefulLifeYears || 0) * 12
          if (months <= 0) return
          const remaining = (cost - salvage) - (a.accumulatedDepreciation || 0)
          const amount = Math.round(Math.min((cost - salvage) / months, remaining) * 100) / 100
          if (amount <= 0.005) return
          get().recordDepreciation(a.id, { date, amount, period })
          count += 1; total += amount
        })
        return { count, total: Math.round(total * 100) / 100 }
      },

      // preview only (no posting): how many assets are due for a period + total
      previewDepreciation: (period, date) => {
        const assets = get().fixedAssets.filter((a) => a.status === 'active')
        let count = 0, total = 0
        assets.forEach((a) => {
          if ((a.depreciationMethod || 'straight_line') !== 'straight_line') return
          if (a.purchaseDate && date && a.purchaseDate > date) return
          if (get().assetDepreciations.some((d) => d.assetId === a.id && d.period === period)) return
          const cost = a.purchaseCost || 0, salvage = a.salvageValue || 0
          const months = (a.usefulLifeYears || 0) * 12
          if (months <= 0) return
          const remaining = (cost - salvage) - (a.accumulatedDepreciation || 0)
          const amount = Math.round(Math.min((cost - salvage) / months, remaining) * 100) / 100
          if (amount <= 0.005) return
          count += 1; total += amount
        })
        return { count, total: Math.round(total * 100) / 100 }
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
          // all JEs this asset produced: purchase, every depreciation charge, disposal
          const depJEs = s.assetDepreciations.filter((d) => d.assetId === id).map((d) => d.journalEntryId)
          const jeIds = new Set([asset?.journalEntryId, asset?.disposalJEId, ...depJEs].filter(Boolean))
          get().assertJEsUnlocked(...jeIds)
          return {
            fixedAssets: s.fixedAssets.filter((a) => a.id !== id),
            assetDepreciations: s.assetDepreciations.filter((d) => d.assetId !== id),
            journalEntries: s.journalEntries.filter((j) => !jeIds.has(j.id)),
          }
        }),

      // ─── STOCK ADJUSTMENTS ─────────────────────────────────────────
      stockAdjustments: [],

      // ─── STOCK MOVEMENT LEDGER ─────────────────────────────────────
      // Append-only audit trail of every on-hand quantity change, powering
      // per-item stock cards. type: 'sale'|'adjustment'|'production'|'consumption'.
      stockMovements: [],
      logStockMovement: (mv) =>
        set((s) => ({ stockMovements: [...s.stockMovements, { id: uuid(), createdAt: new Date().toISOString(), ...mv }] })),

      // ── Landed cost ────────────────────────────────────────────────
      // Capitalise extra acquisition costs (freight, duty, insurance, handling)
      // into inventory value. Additive: bumps each item's weighted-average cost
      // and posts a balanced JE (Dr Inventory / Cr the funding account, e.g. AP).
      landedCosts: [],
      postLandedCost: ({ date, reference, note, method = 'value', amount, creditAccountId = 'acc-ap', lines }) => {
        const total = Math.round((Number(amount) || 0) * 100) / 100
        if (total <= 0) throw new Error('LANDED_NO_AMOUNT')
        const items = get().inventoryItems
        const enriched = (lines || [])
          .filter((l) => l.itemId && (parseFloat(l.qty) || 0) > 0)
          .map((l) => {
            const it = items.find((i) => i.id === l.itemId)
            return { itemId: l.itemId, name: it?.name || '', qty: parseFloat(l.qty) || 0, unitCost: it?.costPrice || 0, weight: parseFloat(l.weight) || 0 }
          })
        if (enriched.length === 0) throw new Error('LANDED_NO_LINES')

        const alloc = allocateLandedCost(total, enriched, method) // [{ itemId, allocated }]
        const allocMap = Object.fromEntries(alloc.map((a) => [a.itemId, a.allocated]))

        // Debit each item's own inventory account for its share.
        const drMap = {}
        enriched.forEach((e) => {
          const it = items.find((i) => i.id === e.itemId)
          const acc = it?.inventoryAccountId || 'acc-inv'
          drMap[acc] = Math.round(((drMap[acc] || 0) + (allocMap[e.itemId] || 0)) * 100) / 100
        })
        const jeLines = [
          ...Object.entries(drMap).map(([accountId, amt]) => ({ accountId, debit: amt, credit: 0, description: 'Landed cost capitalised' })),
          { accountId: creditAccountId, debit: 0, credit: total, description: `Landed cost ${reference || ''}`.trim() },
        ]
        const je = get().addJournalEntry({
          date, description: `Landed cost ${reference || ''}`.trim() || 'Landed cost', reference: reference || '', type: 'landed-cost', lines: jeLines,
        })

        // Bump weighted-average unit cost: spread each item's share over its on-hand
        // quantity, so total inventory value rises by exactly the allocated amount.
        set((st) => ({
          inventoryItems: st.inventoryItems.map((it) => {
            const share = allocMap[it.id]
            if (!share) return it
            const q = it.quantity || 0
            if (q <= 0) return it
            const newCost = Math.round(((it.costPrice || 0) + share / q) * 10000) / 10000
            return { ...it, costPrice: newCost }
          }),
        }))

        const rec = {
          id: uuid(), date, reference: reference || '', note: note || '', method, amount: total,
          creditAccountId, journalEntryId: je.id,
          lines: enriched.map((e) => ({ itemId: e.itemId, name: e.name, qty: e.qty, allocated: allocMap[e.itemId] || 0 })),
          createdAt: new Date().toISOString(),
        }
        set((st) => ({ landedCosts: [...st.landedCosts, rec] }))
        enriched.forEach((e) => get().logStockMovement({ itemId: e.itemId, itemName: e.name, date, type: 'landed-cost', qtyChange: 0, ref: reference || 'LC', note: `Landed cost +${allocMap[e.itemId] || 0}` }))
        get().logActivity('Posted landed cost', `${reference || ''} · ${total}`.trim())
        return rec
      },

      // Segregation of duties: an adjustment is created as PENDING — it does not
      // touch the ledger or on-hand quantity until a *different* manager approves it.
      addStockAdjustment: (adj) => {
        const s = get()
        const { prefix, next } = s.settings.stockAdj
        const number = nextNum(prefix, next)
        const rec = {
          ...adj, id: uuid(), number, status: 'pending',
          createdBy: adj.createdBy || null, createdByName: adj.createdByName || '',
          approvedBy: null, approvedByName: '', approvedAt: null, journalEntryId: null,
          createdAt: new Date().toISOString(),
        }
        set((st) => ({
          stockAdjustments: [...st.stockAdjustments, rec],
          settings: { ...st.settings, stockAdj: { ...st.settings.stockAdj, next: next + 1 } },
        }))
        return rec
      },

      approveStockAdjustment: (id, approver) => {
        const adj = get().stockAdjustments.find((a) => a.id === id)
        if (!adj || adj.status === 'approved') return
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
          description: `Stock Adj ${adj.number} – ${adj.itemName || ''}`,
          reference: adj.number, type: 'stock_adj', lines,
        })
        const qtyChange = adj.type === 'increase' ? adj.quantity : -adj.quantity
        get().logStockMovement({ itemId: adj.itemId, itemName: adj.itemName, date: adj.date, type: 'adjustment', qtyChange, ref: adj.number, note: adj.reason || '' })
        set((st) => ({
          stockAdjustments: st.stockAdjustments.map((a) =>
            a.id === id ? { ...a, status: 'approved', approvedBy: approver?.id || null, approvedByName: approver?.name || '', approvedAt: new Date().toISOString(), journalEntryId: je.id } : a
          ),
          inventoryItems: st.inventoryItems.map((i) =>
            i.id === adj.itemId ? { ...i, quantity: (i.quantity || 0) + qtyChange } : i
          ),
        }))
      },

      rejectStockAdjustment: (id, approver, reason) =>
        set((s) => ({
          stockAdjustments: s.stockAdjustments.map((a) =>
            a.id === id ? { ...a, status: 'rejected', approvedBy: approver?.id || null, approvedByName: approver?.name || '', approvedAt: new Date().toISOString(), rejectionReason: reason || '' } : a
          ),
        })),

      deleteStockAdjustment: (id) =>
        set((s) => {
          const adj = s.stockAdjustments.find((a) => a.id === id)
          get().assertJEsUnlocked(adj?.journalEntryId)
          // Only reverse quantity/JE if the adjustment was actually posted (approved or legacy).
          const wasPosted = adj && (adj.status === 'approved' || adj.status === undefined)
          const qtyChange = wasPosted ? (adj.type === 'increase' ? -adj.quantity : adj.quantity) : 0
          return {
            stockAdjustments: s.stockAdjustments.filter((a) => a.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== adj?.journalEntryId),
            stockMovements: s.stockMovements.filter((m) => m.ref !== adj?.number),
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
          get().assertJEsUnlocked(pre?.journalEntryId)
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
          get().assertJEsUnlocked(claim?.approvalJEId, claim?.paymentJEId)
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

      deleteBOM: (id) => {
        get().recycleRecord('billsOfMaterials', id)
        return set((s) => ({ billsOfMaterials: s.billsOfMaterials.filter((b) => b.id !== id) }))
      },

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
        const compDate = completionDate || new Date().toISOString().slice(0, 10)
        // consume raw-material components from stock (mirrors the credit to raw materials)
        const consume = {}
        ;(wo.components || []).forEach((comp) => {
          if (!comp.itemId) return
          const used = (comp.quantity || 0) * qty
          if (used <= 0) return
          consume[comp.itemId] = (consume[comp.itemId] || 0) + used
          get().logStockMovement({ itemId: comp.itemId, itemName: comp.name, date: compDate, type: 'consumption', qtyChange: -used, ref: wo.number, note: 'Work order material' })
        })
        get().logStockMovement({ itemId: wo.outputItemId, itemName: wo.outputName, date: compDate, type: 'production', qtyChange: outputQty, ref: wo.number, note: 'Work order output' })
        set((st) => ({
          workOrders: st.workOrders.map((w) =>
            w.id === id ? { ...w, status: 'completed', completedAt: new Date().toISOString(), actualCost: totalMaterialCost, jeIssueId: je1.id, jeCompleteId: je2.id, completionDate } : w
          ),
          inventoryItems: st.inventoryItems.map((item) => {
            if (!consume[item.id] && item.id !== wo.outputItemId) return item
            const patch = { quantity: item.quantity || 0 }
            if (consume[item.id]) patch.quantity -= consume[item.id]
            if (item.id === wo.outputItemId) {
              // roll the finished good's cost into a weighted-average so it later
              // sells with a real COGS (the total material cost / units produced)
              const oldQty = item.quantity || 0
              const newQty = oldQty + outputQty
              patch.quantity += outputQty
              patch.costPrice = newQty > 0
                ? Math.round(((oldQty * (item.costPrice || 0) + totalMaterialCost) / newQty) * 100) / 100
                : (item.costPrice || 0)
            }
            return { ...item, ...patch }
          }),
        }))
      },

      deleteWorkOrder: (id) =>
        set((s) => {
          const wo = s.workOrders.find((w) => w.id === id)
          get().assertJEsUnlocked(wo?.jeIssueId, wo?.jeCompleteId)
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
          projectId: tx.projectId || null, departmentId: tx.departmentId || null, lines,
        })
        const newTx = { ...tx, id: uuid(), journalEntryId: je.id, createdAt: new Date().toISOString() }
        set((s) => ({ bankTransactions: [...s.bankTransactions, newTx] }))
        return newTx
      },

      // ─── BANK-FEED MATCHING RULES ──────────────────────────────────
      // Rules that auto-categorize imported statement lines whose description
      // contains a keyword to a target account, so unmatched lines can be
      // booked and cleared in one click. flow: 'auto' | 'in' | 'out'.
      matchRules: [],
      addMatchRule: (rule) =>
        set((s) => ({ matchRules: [...s.matchRules, { flow: 'auto', ...rule, id: uuid(), contains: (rule.contains || '').trim() }] })),
      deleteMatchRule: (id) => {
        get().recycleRecord('matchRules', id)
        return set((s) => ({ matchRules: s.matchRules.filter((r) => r.id !== id) }))
      },

      deleteBankTransaction: (id) =>
        set((s) => {
          const tx = s.bankTransactions.find((t) => t.id === id)
          get().assertJEsUnlocked(tx?.journalEntryId)
          return {
            bankTransactions: s.bankTransactions.filter((t) => t.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== tx?.journalEntryId),
          }
        }),

      // ─── INTRA-BANK / INTERNAL TRANSFERS ───────────────────────────
      // Move funds between two of the company's own bank/cash accounts.
      // Posts: Dr destination, Cr source (amount + fee), Dr bank charges (fee).
      // No revenue/expense impact except the optional bank fee.
      bankTransfers: [],

      addBankTransfer: (tf) => {
        const amount = Number(tf.amount) || 0
        const fee = Number(tf.fee) || 0
        if (amount <= 0 || !tf.fromAccountId || !tf.toAccountId || tf.fromAccountId === tf.toAccountId) return null
        const accs = get().accounts
        const fromName = accs.find((a) => a.id === tf.fromAccountId)?.name || tf.fromAccountId
        const toName = accs.find((a) => a.id === tf.toAccountId)?.name || tf.toAccountId
        const feeAccId = (fee > 0 && accs.some((a) => a.id === tf.feeAccountId)) ? tf.feeAccountId : 'acc-bankchg'
        const lines = [
          { accountId: tf.toAccountId,   debit: amount,        credit: 0,            description: `Transfer from ${fromName}` },
          { accountId: tf.fromAccountId, debit: 0,             credit: amount + fee, description: `Transfer to ${toName}` },
        ]
        if (fee > 0) lines.push({ accountId: feeAccId, debit: fee, credit: 0, description: `Transfer fee (${fromName})` })
        const je = get().addJournalEntry({
          date: tf.date, description: tf.notes || `Transfer: ${fromName} → ${toName}`,
          reference: tf.reference || '', type: 'transfer', lines,
        })
        const rec = { id: uuid(), date: tf.date, fromAccountId: tf.fromAccountId, toAccountId: tf.toAccountId, amount, fee, feeAccountId: fee > 0 ? feeAccId : null, reference: tf.reference || '', notes: tf.notes || '', journalEntryId: je.id, createdAt: new Date().toISOString() }
        set((s) => ({ bankTransfers: [...s.bankTransfers, rec] }))
        return rec
      },

      deleteBankTransfer: (id) =>
        set((s) => {
          const tf = s.bankTransfers.find((t) => t.id === id)
          get().assertJEsUnlocked(tf?.journalEntryId)
          return {
            bankTransfers: s.bankTransfers.filter((t) => t.id !== id),
            journalEntries: s.journalEntries.filter((j) => j.id !== tf?.journalEntryId),
          }
        }),

      // ─── SCHEDULED (RECURRING) TRANSFERS ───────────────────────────
      // Define a transfer once; post it (and advance its next date) when due.
      scheduledTransfers: [],

      addScheduledTransfer: (sc) =>
        set((s) => ({
          scheduledTransfers: [...s.scheduledTransfers, {
            ...sc, id: uuid(), active: true, lastPosted: null, postedCount: 0, createdAt: new Date().toISOString(),
          }],
        })),

      updateScheduledTransfer: (id, patch) =>
        set((s) => ({ scheduledTransfers: s.scheduledTransfers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      deleteScheduledTransfer: (id) => {
        get().recycleRecord('scheduledTransfers', id)
        return set((s) => ({ scheduledTransfers: s.scheduledTransfers.filter((x) => x.id !== id) }))
      },

      // Post a scheduled transfer now (on its scheduled date) and roll the next date forward.
      postScheduledTransfer: (id) => {
        const sc = get().scheduledTransfers.find((x) => x.id === id)
        if (!sc) return null
        const onDate = sc.nextDate || new Date().toISOString().slice(0, 10)
        const rec = get().addBankTransfer({
          date: onDate, fromAccountId: sc.fromAccountId, toAccountId: sc.toAccountId,
          amount: sc.amount, fee: sc.fee || 0, feeAccountId: sc.feeAccountId,
          reference: sc.reference || '', notes: (sc.notes ? sc.notes + ' ' : '') + '(Scheduled)',
        })
        if (rec) {
          const nextDate = get().advanceDate(onDate, sc.frequency)
          set((s) => ({
            scheduledTransfers: s.scheduledTransfers.map((x) =>
              x.id === id ? { ...x, nextDate, lastPosted: onDate, postedCount: (x.postedCount || 0) + 1 } : x),
          }))
        }
        return rec
      },

      // ─── WAREHOUSES & STOCK TRANSFERS ──────────────────────────────
      warehouses: DEFAULT_WAREHOUSES,
      stockTransfers: [],

      addWarehouse: (wh) =>
        set((s) => ({ warehouses: [...s.warehouses, { ...wh, id: uuid(), isDefault: false }] })),

      updateWarehouse: (id, patch) =>
        set((s) => ({ warehouses: s.warehouses.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),

      deleteWarehouse: (id) => {
        get().recycleRecord('warehouses', id)
        return set((s) => {
          const wh = s.warehouses.find((w) => w.id === id)
          if (wh?.isDefault) return s
          return { warehouses: s.warehouses.filter((w) => w.id !== id) }
        })
      },

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

      deleteRecurringInvoice: (id) => {
        get().recycleRecord('recurringInvoices', id)
        return set((s) => ({ recurringInvoices: s.recurringInvoices.filter((r) => r.id !== id) }))
      },

      advanceDate: (dateStr, frequency) => {
        const d = new Date(dateStr)
        if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
        else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14)
        else {
          // month-based: preserve the day-of-month, clamped to the target month's
          // last day so Jan 31 → Feb 28/29 (never drifts to Mar 3 or skips February)
          const add = frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 1
          const day = d.getUTCDate()
          d.setUTCDate(1)
          d.setUTCMonth(d.getUTCMonth() + add)
          const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
          d.setUTCDate(Math.min(day, lastDay))
        }
        return d.toISOString().slice(0, 10)
      },

      // ─── RECURRING JOURNAL ENTRIES ─────────────────────────────────
      // Templated journal entries (e.g. monthly rent accrual, amortization)
      // that post automatically on a schedule.
      recurringJournals: [],
      addRecurringJournal: (r) =>
        set((s) => ({ recurringJournals: [...s.recurringJournals, {
          id: uuid(), name: r.name || 'Recurring entry', frequency: r.frequency || 'monthly',
          nextDate: r.nextDate, lines: r.lines || [], status: 'active', lastPosted: null,
          postedCount: 0, createdAt: new Date().toISOString(),
        }] })),
      updateRecurringJournal: (id, patch) =>
        set((s) => ({ recurringJournals: s.recurringJournals.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteRecurringJournal: (id) => {
        get().recycleRecord('recurringJournals', id)
        return set((s) => ({ recurringJournals: s.recurringJournals.filter((x) => x.id !== id) }))
      },

      postRecurringJournal: (id, { onDate } = {}) => {
        const r = get().recurringJournals.find((x) => x.id === id)
        if (!r) return null
        const date = onDate || r.nextDate
        const je = get().addJournalEntry({ date, description: r.name, reference: 'REC', type: 'recurring', lines: r.lines })
        const nextDate = get().advanceDate(date, r.frequency)
        set((s) => ({ recurringJournals: s.recurringJournals.map((x) =>
          (x.id === id ? { ...x, nextDate, lastPosted: date, postedCount: (x.postedCount || 0) + 1 } : x)) }))
        return je
      },
      // Post every active recurring journal whose nextDate has arrived (catches up
      // multiple missed periods, bounded, and stops on a locked period).
      generateDueRecurringJournals: () => {
        const today = new Date().toISOString().slice(0, 10)
        let count = 0
        get().recurringJournals.filter((r) => r.status === 'active' && r.nextDate <= today).forEach((r) => {
          let guard = 0
          while (guard++ < 60) {
            const cur = get().recurringJournals.find((x) => x.id === r.id)
            if (!cur || cur.status !== 'active' || cur.nextDate > today) break
            try { get().postRecurringJournal(r.id, { onDate: cur.nextDate }); count += 1 }
            catch { break }
          }
        })
        return count
      },

      // ─── RECURRING EXPENSES / BILLS ────────────────────────────────
      // Rent, utilities, subscriptions — the payables side of recurring
      // invoices. Each posting creates a real supplier bill so it lands in AP
      // and flows through the normal payment workflow, rather than a bare
      // journal that could never be "paid".
      recurringExpenses: [],

      addRecurringExpense: (r) =>
        set((s) => ({ recurringExpenses: [...s.recurringExpenses, {
          id: uuid(),
          name: r.name || 'Recurring expense',
          supplierId: r.supplierId || '', supplierName: r.supplierName || '',
          frequency: r.frequency || 'monthly',
          nextDate: r.nextDate, endDate: r.endDate || '',
          amount: Number(r.amount) || 0,
          taxRate: Number(r.taxRate) || 0,
          expenseAccountId: r.expenseAccountId || 'acc-admin',
          notes: r.notes || '',
          status: 'active', lastPosted: null, generatedCount: 0,
          createdAt: new Date().toISOString(),
        }] })),

      updateRecurringExpense: (id, patch) =>
        set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      deleteRecurringExpense: (id) => {
        get().recycleRecord('recurringExpenses', id)
        return set((s) => ({ recurringExpenses: s.recurringExpenses.filter((x) => x.id !== id) }))
      },

      postRecurringExpense: (id, { onDate } = {}) => {
        const r = get().recurringExpenses.find((x) => x.id === id)
        if (!r) return null
        const date = onDate || r.nextDate
        const subtotal = Math.round((Number(r.amount) || 0) * 100) / 100
        const taxAmount = Math.round(subtotal * ((Number(r.taxRate) || 0) / 100) * 100) / 100
        const bill = get().addPurchase({
          supplierId: r.supplierId, supplierName: r.supplierName || r.name,
          date, dueDate: date,
          items: [{
            description: r.name, quantity: 1, unitPrice: subtotal,
            taxRate: Number(r.taxRate) || 0, subtotal,
            accountId: r.expenseAccountId || 'acc-admin',
          }],
          subtotal, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100,
          notes: (r.notes ? r.notes + ' ' : '') + '(Recurring)',
        })
        const nextDate = get().advanceDate(date, r.frequency)
        set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) =>
          (x.id === id ? { ...x, nextDate, lastPosted: date, generatedCount: (x.generatedCount || 0) + 1 } : x)) }))
        return bill
      },

      // Post every active recurring expense whose nextDate has arrived, catching
      // up missed periods. Bounded, honours endDate, and stops on any posting
      // error (e.g. a locked period) so one bad schedule can't block the rest.
      generateDueRecurringExpenses: () => {
        const today = new Date().toISOString().slice(0, 10)
        let count = 0
        get().recurringExpenses.filter((r) => r.status === 'active' && r.nextDate <= today).forEach((r) => {
          let guard = 0
          while (guard++ < 60) {
            const cur = get().recurringExpenses.find((x) => x.id === r.id)
            if (!cur || cur.status !== 'active' || cur.nextDate > today) break
            if (cur.endDate && cur.nextDate > cur.endDate) {
              set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) => (x.id === r.id ? { ...x, status: 'ended' } : x)) }))
              break
            }
            try { get().postRecurringExpense(r.id, { onDate: cur.nextDate }); count += 1 }
            catch { break }
          }
        })
        return count
      },

      // Boot-time scheduler: on app load, catch up any due recurring journals and
      // recurring invoices automatically, at most once per calendar day per company.
      // Both underlying actions already bound their catch-up and skip locked periods,
      // so this is safe to run unattended; depreciation stays manual (a deliberate
      // month-end posting). Returns what it posted so the UI can confirm it.
      schedulerLastRun: null,
      runScheduler: () => {
        const today = new Date().toISOString().slice(0, 10)
        if (get().schedulerLastRun === today) return { journals: 0, invoices: 0, expenses: 0, ran: false }
        if (get().settings?.accounting?.autoPostRecurring === false) {
          set({ schedulerLastRun: today })
          return { journals: 0, invoices: 0, expenses: 0, ran: false }
        }
        let journals = 0, invoices = 0, expenses = 0
        try { journals = get().generateDueRecurringJournals() } catch { /* never block boot */ }
        try { invoices = get().generateDueRecurring() } catch { /* never block boot */ }
        try { expenses = get().generateDueRecurringExpenses() } catch { /* never block boot */ }
        set({ schedulerLastRun: today })
        if (journals || invoices || expenses)
          get().logActivity('Auto-posted scheduled entries', `${invoices} invoice(s), ${journals} journal(s), ${expenses} bill(s)`)
        return { journals, invoices, expenses, ran: journals > 0 || invoices > 0 || expenses > 0 }
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
            // don't let a locked period (or any posting error) crash the page —
            // skip this schedule and let it retry once the block clears
            try {
              get().addInvoice({
                customerId: r.customerId, customerName: r.customerName,
                date: nextDate, dueDate: due30,
                items: r.items, subtotal: r.subtotal, taxAmount: r.taxAmount, total: r.total,
                notes: (r.notes ? r.notes + ' ' : '') + `(Recurring ${r.number})`,
              })
            } catch { break }
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

      deleteRequisition: (id) => {
        get().recycleRecord('requisitions', id)
        return set((s) => ({ requisitions: s.requisitions.filter((r) => r.id !== id) }))
      },

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

      deleteDeliveryNote: (id) => {
        get().recycleRecord('deliveryNotes', id)
        return set((s) => ({ deliveryNotes: s.deliveryNotes.filter((d) => d.id !== id) }))
      },

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

      deleteCurrency: (id) => {
        get().recycleRecord('currencies', id)
        return set((s) => ({ currencies: s.currencies.filter((c) => c.id !== id) }))
      },

      // ─── FX REVALUATION ────────────────────────────────────────────
      // Restates foreign-currency account balances to the period-end closing
      // rate and posts the unrealized gain/loss to acc-fxgl. `entries` is a list
      // of { accountId, currency, fcBalance, rate, currentBase, revaluedBase }.
      fxRevaluations: [],
      postFxRevaluation: ({ date, entries, note }) => {
        const rows = (entries || [])
          .map((e) => ({ ...e, delta: Math.round(((e.revaluedBase || 0) - (e.currentBase || 0)) * 100) / 100 }))
          .filter((e) => Math.abs(e.delta) >= 0.01)
        if (rows.length === 0) return null
        const accs = get().accounts
        const lines = []
        let net = 0 // debits minus credits from the account legs
        rows.forEach((e) => {
          const acc = accs.find((a) => a.id === e.accountId)
          const debitNatured = ['asset', 'expense'].includes(acc?.type)
          // increasing an account's base carrying value debits a debit-natured
          // account and credits a credit-natured one; negative delta flips it
          let dr = 0, cr = 0
          if (debitNatured) { if (e.delta >= 0) dr = e.delta; else cr = -e.delta }
          else { if (e.delta >= 0) cr = e.delta; else dr = -e.delta }
          lines.push({ accountId: e.accountId, debit: dr, credit: cr, description: `FX revaluation @ ${e.rate} ${e.currency}` })
          net += dr - cr
        })
        // balancing offset to the FX gain/loss account
        net = Math.round(net * 100) / 100
        if (net >= 0) lines.push({ accountId: 'acc-fxgl', debit: 0, credit: net, description: 'Unrealized FX gain' })
        else lines.push({ accountId: 'acc-fxgl', debit: -net, credit: 0, description: 'Unrealized FX loss' })
        const je = get().addJournalEntry({
          date, description: `FX Revaluation${note ? ' – ' + note : ''}`, reference: '', type: 'fx_reval', lines,
        })

        // Auto-reverse on the first day of the next period.
        //
        // A revaluation restates the *carrying value* of AR/AP for reporting at
        // the period-end rate; it does not change what the customer owes. When
        // the invoice later settles, recordInvoicePayment relieves AR at the
        // original document rate — so without this reversal the restatement is
        // stranded in AR forever and the same movement is counted twice, once
        // unrealized and again as a realized gain on settlement.
        //
        // Reversing is also what makes the split honest: acc-fxgl holds only
        // estimates that have since been undone, acc-fxreal holds only cash
        // differences that actually happened.
        // The reversal is always postable: the period lock rejects any date at or
        // before it, so a revaluation that posted at all has a next day that is
        // open too.
        const revDate = addDaysISO(date, 1)
        const revJe = get().addJournalEntry({
          date: revDate,
          description: `FX Revaluation reversal${note ? ' – ' + note : ''}`,
          reference: '', type: 'fx_reval', reverses: je.id,
          lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, description: `Reversal – ${l.description}` })),
        })

        const rec = {
          id: uuid(), date, journalEntryId: je.id, reversalJEId: revJe.id, reversalDate: revDate,
          note: note || '', entries: rows, gainLoss: net, createdAt: new Date().toISOString(),
        }
        set((s) => ({ fxRevaluations: [...s.fxRevaluations, rec] }))
        return rec
      },

      // ─── CRM · SALES PIPELINE ──────────────────────────────────────
      leads: [],

      addLead: (lead) =>
        set((s) => ({ leads: [...s.leads, { ...lead, id: uuid(), stage: lead.stage || 'new', createdAt: new Date().toISOString() }] })),

      updateLead: (id, patch) =>
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

      deleteLead: (id) => {
        get().recycleRecord('leads', id)
        return set((s) => ({ leads: s.leads.filter((l) => l.id !== id) }))
      },

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

      deleteProject: (id) => {
        get().recycleRecord('projects', id)
        return set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          timeEntries: s.timeEntries.filter((t) => t.projectId !== id),
        }))
      },

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

      deleteTimeEntry: (id) => {
        get().recycleRecord('timeEntries', id)
        return set((s) => ({ timeEntries: s.timeEntries.filter((t) => t.id !== id) }))
      },

      // ─── BUDGETS (annual, per account) ─────────────────────────────
      budgets: [],

      setBudget: (accountId, year, amount) =>
        set((s) => {
          const existing = s.budgets.find((b) => b.accountId === accountId && b.year === year)
          if (existing)
            return { budgets: s.budgets.map((b) => (b.id === existing.id ? { ...b, amount } : b)) }
          return { budgets: [...s.budgets, { id: uuid(), accountId, year, amount }] }
        }),

      deleteBudget: (id) => {
        get().recycleRecord('budgets', id)
        return set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) }))
      },

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
          'stockMovements', 'bankTransfers', 'scheduledTransfers', 'matchRules', 'fxRevaluations',
          'recurringJournals', 'goodsReceipts', 'landedCosts', 'recurringExpenses',
          'approvalRequests', 'recycleBin', 'accountGroups', 'capitalAccounts', 'capitalSubaccounts',
          'salesOrders', 'purchaseQuotes', 'stockCounts',
          'employmentContracts', 'eosbAccruals', 'attendance',
        ]
        const out = { _app: 'erp-accounting-smb', _version: 31, _exportedAt: new Date().toISOString() }
        slices.forEach((k) => { out[k] = s[k] })
        return out
      },

      importData: (data) => {
        if (!data || data._app !== 'erp-accounting-smb') throw new Error('Invalid backup file')
        const { _app, _version, _exportedAt, ...slices } = data
        set((s) => ({ ...s, ...slices }))
      },

      resetAllData: () => {
        const key = currentCompanyKey()
        try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key) } catch { /* ignore */ }
        // Data now lives in IndexedDB — clear it there too, then reload once done.
        import('./utils/idbKvStorage')
          .then((m) => m.idbKvStorage.removeItem(key))
          .catch(() => {})
          .finally(() => { if (typeof window !== 'undefined') window.location.reload() })
      },

      // ─── Local snapshots (automatic + on-demand) ───────────────────
      // Rolling in-browser restore points, kept in IndexedDB alongside the live
      // store. These guard against accidental data loss between off-device backups;
      // for true off-device safety the user still downloads (optionally encrypted)
      // backup files. At most 8 snapshots are retained (oldest dropped first).
      _readBackups: async () => {
        try { const raw = await idbKvStorage.getItem(currentCompanyKey() + '::backups'); const s = raw ? JSON.parse(raw) : null; if (s && Array.isArray(s.items)) return s } catch { /* ignore */ }
        return { items: [], lastAutoAt: null }
      },
      _writeBackups: async (store) => { await idbKvStorage.setItem(currentCompanyKey() + '::backups', JSON.stringify(store)) },

      snapshotNow: async (label = 'Manual') => {
        const data = get().exportData()
        const store = await get()._readBackups()
        const entry = { id: uuid(), at: new Date().toISOString(), label, data }
        store.items = [...store.items, entry].slice(-8)
        if (label === 'Auto') store.lastAutoAt = entry.at
        await get()._writeBackups(store)
        return { id: entry.id, at: entry.at, label }
      },

      listSnapshots: async () => {
        const store = await get()._readBackups()
        return store.items
          .map((e) => ({ id: e.id, at: e.at, label: e.label, bytes: JSON.stringify(e.data).length }))
          .sort((a, b) => b.at.localeCompare(a.at))
      },

      restoreSnapshot: async (id) => {
        const store = await get()._readBackups()
        const entry = store.items.find((e) => e.id === id)
        if (!entry) throw new Error('Snapshot not found')
        get().importData(entry.data)
        // Give the persist middleware a moment to flush the restored state, then reload.
        if (typeof window !== 'undefined') setTimeout(() => window.location.reload(), 900)
        return true
      },

      deleteSnapshot: async (id) => {
        const store = await get()._readBackups()
        store.items = store.items.filter((e) => e.id !== id)
        await get()._writeBackups(store)
      },

      // Boot-time: take one automatic snapshot per day (only if there is data).
      runBackupScheduler: async () => {
        try {
          const s = get()
          const hasData = (s.journalEntries?.length || 0) > 0 || (s.invoices?.length || 0) > 0 || (s.customers?.length || 0) > 0
          if (!hasData) return { ran: false }
          const store = await s._readBackups()
          const last = store.lastAutoAt ? new Date(store.lastAutoAt).getTime() : 0
          if (Date.now() - last < 24 * 60 * 60 * 1000) return { ran: false }
          const e = await s.snapshotNow('Auto')
          return { ran: true, at: e.at }
        } catch { return { ran: false } }
      },

      // ─── CLOUD SYNC (opt-in) ───────────────────────────────────────
      // Everything here is loaded on demand (dynamic imports) so companies
      // that never opt into cloud sync never pull @supabase/supabase-js —
      // or any of its network calls — into their bundle or runtime at all.
      syncStatus: 'idle', // 'idle' | 'syncing' | 'error'
      lastSyncAt: null,
      lastSyncError: null,

      _readSyncMeta: async () => {
        try {
          const raw = await idbKvStorage.getItem(currentCompanyKey() + '::syncMeta')
          const m = raw ? JSON.parse(raw) : null
          if (m) return m
        } catch { /* ignore */ }
        return { snapshot: null, pulledAt: null }
      },
      _writeSyncMeta: async (meta) => { await idbKvStorage.setItem(currentCompanyKey() + '::syncMeta', JSON.stringify(meta)) },

      syncNow: async () => {
        const { useAuth } = await import('./auth')
        const auth = useAuth.getState()
        const company = auth.companies.find((c) => c.id === auth.currentCompanyId)
        if (!company?.cloudCompanyId) return { skipped: true, reason: 'NOT_LINKED' }

        const { getSupabase, isOnline } = await import('./lib/supabase')
        if (!isOnline()) return { skipped: true, reason: 'OFFLINE' }
        const client = getSupabase()
        const { data: sessionData } = await client.auth.getSession()
        if (!sessionData?.session) return { skipped: true, reason: 'NOT_SIGNED_IN' }

        const s = get()
        set({ syncStatus: 'syncing' })
        try {
          const { runSync } = await import('./cloudSync')
          const meta = await s._readSyncMeta()
          const localSnapshot = s.exportData()
          const entities = Object.keys(localSnapshot).filter((k) => !k.startsWith('_'))
          const { merged, newPulledAt, pushed, pulled } = await runSync({
            client, companyId: company.cloudCompanyId, userId: sessionData.session.user.id, entities,
            localSnapshot, lastSyncedSnapshot: meta.snapshot, lastPulledAt: meta.pulledAt,
          })
          get().importData(merged)
          await get()._writeSyncMeta({ snapshot: merged, pulledAt: newPulledAt })
          const now = new Date().toISOString()
          set({ syncStatus: 'idle', lastSyncAt: now, lastSyncError: null })
          return { ok: true, pushed, pulled }
        } catch (e) {
          set({ syncStatus: 'error', lastSyncError: e.message })
          return { error: e.message }
        }
      },

      // ─── VAT SETTLEMENT ────────────────────────────────────────────
      // Close a filing period: clear Output VAT (liability) against Input VAT
      // (asset) and pay/receive the net through a bank account.
      //   net > 0 → payment to ZATCA (Cr bank), net < 0 → refund (Dr bank).
      settleVat: ({ date, from, to, bankAccountId, outputVat, inputVat }) => {
        const out = Math.round((Number(outputVat) || 0) * 100) / 100
        const inp = Math.round((Number(inputVat) || 0) * 100) / 100
        const net = Math.round((out - inp) * 100) / 100
        if (out === 0 && inp === 0) throw new Error('VAT_NOTHING_TO_SETTLE')
        const lines = []
        if (out > 0) lines.push({ accountId: 'acc-vatout', debit: out, credit: 0, description: 'Output VAT settled' })
        if (inp > 0) lines.push({ accountId: 'acc-vatin', debit: 0, credit: inp, description: 'Input VAT recovered' })
        if (net > 0) lines.push({ accountId: bankAccountId, debit: 0, credit: net, description: 'VAT paid to ZATCA' })
        else if (net < 0) lines.push({ accountId: bankAccountId, debit: -net, credit: 0, description: 'VAT refund from ZATCA' })
        return get().addJournalEntry({
          date,
          description: `VAT settlement ${from} → ${to}`,
          reference: `VAT ${from}..${to}`,
          type: 'vat_settlement',
          lines,
        })
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
      version: 31,
      // IndexedDB primary (no 5 MB cap), transparently migrating any existing
      // localStorage snapshot; safeStorage remains the graceful fallback inside.
      storage: createJSONStorage(() => idbKvStorage),
      migrate: (persisted, version) => {
       try {
        if (version < 4) {
          const existingIds = new Set((persisted.accounts || []).map((a) => a.id))
          const newAccounts = DEFAULT_ACCOUNTS.filter((a) => !existingIds.has(a.id))
          persisted.accounts = [...(persisted.accounts || []), ...newAccounts]

          persisted.settings = {
            ...DEFAULT_SETTINGS,
            ...persisted.settings,
            company:    { ...DEFAULT_SETTINGS.company,    ...(persisted.settings?.company    || {}) },
            tax:        { ...DEFAULT_SETTINGS.tax,        ...(persisted.settings?.tax        || {}) },
            accounting: { ...DEFAULT_SETTINGS.accounting, ...(persisted.settings?.accounting || {}) },
            approvals:  { ...defaultApprovalSettings(),   ...(persisted.settings?.approvals  || {}) },
          }
          // Upgrading companies that already had ZATCA switched on were Saudi
          // VAT filers in every case that mattered — tag them so the VAT
          // return keeps its bilingual ZATCA box layout after this upgrade.
          if (!persisted.settings.tax.country && persisted.settings.zatca?.enabled) {
            persisted.settings.tax.country = 'SA'
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
        if (version < 13) {
          persisted.settings = {
            ...persisted.settings,
            wht: persisted.settings?.wht || { enabled: false, rate: 5, name: 'Withholding Tax' },
          }
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-wht')) {
            persisted.accounts.push({ id: 'acc-wht', code: '2110', name: 'Withholding Tax Payable', type: 'liability', subtype: 'current', isSystem: false })
          }
        }
        if (version < 14) {
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-fxgl')) {
            persisted.accounts.push({ id: 'acc-fxgl', code: '4005', name: 'Unrealized FX Gain/(Loss)', type: 'revenue', subtype: 'revenue', isSystem: false })
          }
          if (!persisted.matchRules) persisted.matchRules = []
          if (!persisted.fxRevaluations) persisted.fxRevaluations = []
        }
        if (version < 15) {
          if (!persisted.recurringJournals) persisted.recurringJournals = []
          if (persisted.settings && !persisted.settings.accounting)
            persisted.settings.accounting = { lockDate: '', lockedBy: '', lockedAt: '' }
        }
        if (version < 16) {
          if (persisted.settings?.accounting && persisted.settings.accounting.autoPostRecurring === undefined)
            persisted.settings.accounting.autoPostRecurring = true
        }
        if (version < 17) {
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-fxreal'))
            persisted.accounts.push({ id: 'acc-fxreal', code: '4006', name: 'Realized FX Gain/(Loss)', type: 'revenue', subtype: 'revenue', isSystem: false })
        }
        if (version < 18) {
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-grni'))
            persisted.accounts.push({ id: 'acc-grni', code: '2050', name: 'Goods Received Not Invoiced', type: 'liability', subtype: 'current', isSystem: true })
          if (!persisted.goodsReceipts) persisted.goodsReceipts = []
          if (persisted.settings && !persisted.settings.goodsReceipt)
            persisted.settings.goodsReceipt = { prefix: 'GRN-', next: 1 }
        }
        if (version < 19) {
          const add = [
            { id: 'acc-salesdisc', code: '4011', name: 'Sales Discounts', type: 'revenue', subtype: 'revenue', isSystem: false },
            { id: 'acc-shipinc', code: '4020', name: 'Shipping & Delivery Income', type: 'revenue', subtype: 'revenue', isSystem: false },
            { id: 'acc-purchdisc', code: '5030', name: 'Purchase Discounts', type: 'expense', subtype: 'expense', isSystem: false },
            { id: 'acc-freightin', code: '5031', name: 'Freight-In / Delivery', type: 'expense', subtype: 'expense', isSystem: false },
          ]
          if (Array.isArray(persisted.accounts)) add.forEach((a) => { if (!persisted.accounts.some((x) => x.id === a.id)) persisted.accounts.push(a) })
        }
        if (version < 20) {
          // Threshold approvals: off by default, so an upgrade never suddenly
          // blocks a company from posting bills it could post yesterday.
          if (persisted.settings)
            persisted.settings.approvals = { ...defaultApprovalSettings(), ...(persisted.settings.approvals || {}) }
          if (!persisted.approvalRequests) persisted.approvalRequests = []
        }
        if (version < 21) {
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-obe'))
            persisted.accounts.push({ id: 'acc-obe', code: '3009', name: 'Opening Balance Equity', type: 'equity', subtype: 'equity', isSystem: true })
          if (persisted.settings && !persisted.settings.opening)
            persisted.settings.opening = { date: '', posted: false, journalEntryId: null, postedAt: '', counts: null }
        }
        if (version < 22) {
          if (!persisted.recycleBin) persisted.recycleBin = []
        }
        if (version < 23) {
          // The chart becomes a tree. Existing accounts keep their ids and
          // their balances — they only gain a groupId — so nothing on a report
          // changes value as a result of this upgrade, only its indentation.
          if (!Array.isArray(persisted.accountGroups) || !persisted.accountGroups.length)
            persisted.accountGroups = DEFAULT_GROUPS.map((g) => ({ ...g }))
          if (Array.isArray(persisted.accounts))
            persisted.accounts = assignDefaultGroups(persisted.accounts)
        }
        if (version < 31) {
          // HR gains contracts, end-of-service and attendance.
          //
          // Existing employees keep the salary on their record: an upgrading
          // company is not forced to re-enter every contract before it can run
          // payroll again. Payroll falls back to the employee's own figures
          // whenever no contract covers the period, so nothing breaks — a
          // contract simply makes the answer better once one exists.
          if (!persisted.employmentContracts) persisted.employmentContracts = []
          if (!persisted.eosbAccruals) persisted.eosbAccruals = []
          if (!persisted.attendance) persisted.attendance = []
          if (persisted.settings && !persisted.settings.hr)
            persisted.settings.hr = { eosb: defaultEosbSettings(), restDays: [5, 6], deductLate: false, lateGraceMinutes: 0 }
          const addAcc = [
            { id: 'acc-eosb-prov', code: '2215', name: 'End-of-Service Provision', type: 'liability', subtype: 'noncurrent', isSystem: false },
            { id: 'acc-eosb-exp',  code: '5016', name: 'End-of-Service Benefit',   type: 'expense',   subtype: 'expense',    isSystem: false },
          ]
          if (Array.isArray(persisted.accounts))
            addAcc.forEach((x) => { if (!persisted.accounts.some((y) => y.id === x.id)) persisted.accounts.push(x) })
        }
        if (version < 30) {
          // Custom fields gain types and stable ids.
          //
          // The old shape stored plain labels in settings and keyed each
          // record's values by that same label, so a rename detached every
          // value ever entered. Both halves move together here: the label
          // becomes a definition with a generated id, and every customer and
          // supplier bag is rekeyed to match. A value whose label has no
          // definition is left under its original key rather than dropped.
          const { customFields, rekey } = migrateCustomFieldSettings(persisted.settings?.customFields)
          if (persisted.settings) persisted.settings.customFields = customFields
          const move = (rows, entityId) => (Array.isArray(rows)
            ? rows.map((r) => (r?.customFields ? { ...r, customFields: rekey(entityId, r.customFields) } : r))
            : rows)
          persisted.customers = move(persisted.customers, 'customer')
          persisted.suppliers = move(persisted.suppliers, 'supplier')
        }
        if (version < 29) {
          if (persisted.settings) {
            if (!persisted.settings.terms) persisted.settings.terms = defaultTerms()
            if (!persisted.settings.cycleCount)
              persisted.settings.cycleCount = { policy: defaultCyclePolicy(), batchSize: 20 }
          }
        }
        if (version < 28) {
          // Branding gains its own settings block. The logo itself is moved
          // out of the store on first render — see useBrandAsset — because a
          // migration cannot do async IndexedDB work.
          if (persisted.settings)
            persisted.settings.branding = { ...defaultBranding(), ...(persisted.settings.branding || {}) }
          if (persisted.settings?.company?.accentColor && persisted.settings.branding)
            persisted.settings.branding.accentColor = persisted.settings.company.accentColor
        }
        if (version < 27) {
          if (!persisted.stockCounts) persisted.stockCounts = []
          if (persisted.settings && !persisted.settings.stockCount)
            persisted.settings.stockCount = { prefix: 'SC-', next: 1 }
        }
        if (version < 26) {
          // Both are non-posting documents, so there is nothing to backfill —
          // an upgrading company simply starts with none.
          if (!persisted.salesOrders) persisted.salesOrders = []
          if (!persisted.purchaseQuotes) persisted.purchaseQuotes = []
          if (persisted.settings) {
            if (!persisted.settings.salesOrder) persisted.settings.salesOrder = { prefix: 'SO-', next: 1 }
            if (!persisted.settings.purchaseQuote) persisted.settings.purchaseQuote = { prefix: 'PQ-', next: 1 }
          }
        }
        if (version < 25) {
          // Flag the three shipped control accounts. resolveControl treats
          // these as control accounts regardless, so this is cosmetic — it
          // just makes them show up in the settings list alongside any the
          // user adds.
          if (Array.isArray(persisted.accounts)) {
            const kinds = { 'acc-ar': 'customers', 'acc-ap': 'suppliers', 'acc-inv': 'inventoryItems' }
            persisted.accounts = persisted.accounts.map((a) =>
              kinds[a.id] && !a.controlFor ? { ...a, controlFor: kinds[a.id] } : a)
          }
        }
        if (version < 24) {
          // Capital accounts start empty — a sole trader needs none, and
          // inventing partners for them would be worse than useless. The
          // control account is added regardless so the subledger has somewhere
          // to post the moment they add their first one.
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-capital-ctl'))
            persisted.accounts.push({
              id: 'acc-capital-ctl', code: '3005', name: 'Capital Accounts',
              type: 'equity', subtype: 'equity', isSystem: true, groupId: 'grp-eq',
            })
          if (!persisted.capitalAccounts) persisted.capitalAccounts = []
          if (!persisted.capitalSubaccounts?.length)
            persisted.capitalSubaccounts = DEFAULT_SUBACCOUNTS.map((s) => ({ ...s }))
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
