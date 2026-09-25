import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { currentCompanyKey } from './boot'
import { deferredJSONStorage } from './utils/idbKvStorage'
import { ETA_DEFAULT_TAX_SUBTYPES } from './utils/etaEinvoice'
import { layersFromBalance } from './utils/fifo'
import { chainEntries, PREV_TAG_LENGTH } from './utils/ledgerChain'
import { DECLINING_BALANCE } from './utils/deferredTax'
import { defaultApprovalSettings } from './utils/approvals'
import { defaultBranding } from './utils/branding'
import { defaultTerms } from './utils/paymentTerms'
import { defaultPolicy as defaultCyclePolicy } from './utils/cycleCount'
import { defaultEosbSettings } from './utils/endOfService'
import { migrateLegacy as migrateCustomFieldSettings } from './utils/customFields'
import { DEFAULT_GROUPS, assignDefaultGroups, OTHER_INCOME } from './utils/accountTree'
import { DEFAULT_MATRIX as DEFAULT_ECL_MATRIX } from './utils/ecl'
import { DEFAULT_SUBACCOUNTS } from './utils/capitalAccounts'
import { DEFAULT_ACCOUNTS, DEFAULT_BANK_ACCOUNTS, DEFAULT_SETTINGS, DEFAULT_WAREHOUSES } from './store/shared'
import { createSettingsSlice } from './store/settings'
import { createLedgerSlice } from './store/ledger'
import { createBankingSlice } from './store/banking'
import { createPartiesSlice } from './store/parties'
import { createInventorySlice } from './store/inventory'
import { createSalesSlice } from './store/sales'
import { createPurchasesSlice } from './store/purchases'
import { createHrSlice } from './store/hr'
import { createAssetsSlice } from './store/assets'
import { createReportingSlice } from './store/reporting'
import { createDataSlice } from './store/data'
import { guardActions } from './store/guard'
import { createNotificationsSlice } from './store/notifications'

// The whole company's books, as one Zustand store persisted to IndexedDB.
//
// It used to be a single 6,000-line file. Each area now lives in its own
// slice under src/store/, and they are spread together here into the one
// store every screen already uses — `get()` inside any slice still sees
// every other slice's state and actions, exactly as before.
export const useStore = create(
  persist(
    (set, get) => guardActions({
      ...createSettingsSlice(set, get),
      ...createLedgerSlice(set, get),
      ...createBankingSlice(set, get),
      ...createPartiesSlice(set, get),
      ...createInventorySlice(set, get),
      ...createSalesSlice(set, get),
      ...createPurchasesSlice(set, get),
      ...createHrSlice(set, get),
      ...createAssetsSlice(set, get),
      ...createReportingSlice(set, get),
      ...createDataSlice(set, get),
      ...createNotificationsSlice(set, get),
    }),
    {
      name: currentCompanyKey(),
      version: 43,
      // IndexedDB primary (no 5 MB cap), transparently migrating any existing
      // localStorage snapshot; localStorage remains the graceful fallback
      // inside idbKvStorage, which also raises erp-storage-error if a write
      // lands nowhere at all.
      // Not createJSONStorage: that serializes the whole company on every
      // mutation. deferredJSONStorage holds the object and serializes once
      // when the write queue drains. See utils/idbKvStorage.js.
      storage: deferredJSONStorage,
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
        if (version < 43) {
          // IAS 12 deferred tax. Off unless switched on: recognising it
          // changes reported profit and the balance sheet, and the
          // capital-allowance regime is a fact about the business's
          // jurisdiction that cannot be guessed from its books.
          const add = (a) => {
            if (Array.isArray(persisted.accounts) && !persisted.accounts.some((x) => x.id === a.id)) persisted.accounts.push(a)
          }
          add({ id: 'acc-dta', code: '1700', name: 'Deferred Tax Asset', type: 'asset', subtype: 'non_current', isSystem: false })
          add({ id: 'acc-dtl', code: '2600', name: 'Deferred Tax Liability', type: 'liability', subtype: 'non_current', isSystem: false })
          add({ id: 'acc-taxexp', code: '5018', name: 'Income Tax Expense', type: 'expense', subtype: 'expense', isSystem: false })
          persisted.settings = {
            ...persisted.settings,
            deferredTax: persisted.settings?.deferredTax || {
              enabled: false, ratePct: 0, allowanceRatePct: 0, assetTaxMethod: DECLINING_BALANCE,
              lossesCarriedForward: 0, recognitionPct: 100, offset: true, manual: [], lastAssessedAt: '',
            },
          }
        }
        if (version < 42) {
          // Shrink the stored back-link. It was a full 64-character hash, which
          // measured at +43% on the ledger; twelve characters serve its only
          // purpose (telling a changed entry from a moved one) at +28%.
          //
          // Deliberately not a re-chain. Recomputing hashes here would repair
          // any tampering that had already happened and erase the evidence —
          // the same trap `reseal` avoids by only ever working forward. This
          // rewrites one redundant field and never touches `hash`.
          if (Array.isArray(persisted.journalEntries)) {
            persisted.journalEntries = persisted.journalEntries.map((j) => (
              typeof j?.prevHash === 'string' && j.prevHash.length > PREV_TAG_LENGTH
                ? { ...j, prevHash: j.prevHash.slice(0, PREV_TAG_LENGTH) }
                : j
            ))
          }
        }
        if (version < 41) {
          // Seal the existing ledger into the hash chain, and start tracking
          // whether a copy of the books exists anywhere off this device.
          //
          // Sealing here is honest about its limits: it fixes the ledger from
          // the upgrade onward and proves nothing about the period before it.
          // That is unavoidable — there is no earlier chain to check against —
          // and it is still worth doing, because from this point every
          // alteration that does not go through the app becomes visible.
          if (Array.isArray(persisted.journalEntries)) {
            persisted.journalEntries = chainEntries(persisted.journalEntries)
          }
          persisted.settings = {
            ...persisted.settings,
            durability: persisted.settings?.durability || { lastExportAt: '', lastExportKind: '' },
          }
        }
        if (version < 40) {
          // IFRS 9 expected credit losses. Off unless switched on: recognising
          // an allowance changes the carrying value of receivables, and that
          // is an accounting-policy decision, not an upgrade side effect.
          const add = (a) => {
            if (Array.isArray(persisted.accounts) && !persisted.accounts.some((x) => x.id === a.id)) persisted.accounts.push(a)
          }
          add({ id: 'acc-ecl', code: '1105', name: 'Allowance for Expected Credit Losses', type: 'asset', subtype: 'current', isSystem: false })
          add({ id: 'acc-baddebt', code: '5017', name: 'Expected Credit Losses', type: 'expense', subtype: 'expense', isSystem: false })
          persisted.settings = {
            ...persisted.settings,
            ecl: persisted.settings?.ecl || { enabled: false, matrix: { ...DEFAULT_ECL_MATRIX }, lastAssessedAt: '' },
          }
        }
        if (version < 39) {
          // IFRS 16 needs somewhere to accumulate right-of-use depreciation,
          // kept apart from PPE so the balance sheet can disclose right-of-use
          // assets separately as the standard requires.
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((a) => a.id === 'acc-roudepr')) {
            persisted.accounts.push({ id: 'acc-roudepr', code: '1621', name: 'Accumulated Depreciation – Right-of-Use', type: 'asset', subtype: 'non_current', isSystem: false })
          }
          // Existing leases keep the treatment they were posted under. Silently
          // re-basing live books onto IFRS 16 would restate a balance sheet
          // nobody asked to have restated — capitalising is opt-in per lease.
          if (Array.isArray(persisted.leases)) {
            persisted.leases = persisted.leases.map((l) => ({ ...l, treatment: l.treatment || 'expense' }))
          }
        }
        if (version < 38) {
          // An existing company has been in use for a while — it does not need
          // a wizard explaining what it already has.
          persisted.settings = {
            ...persisted.settings,
            setup: persisted.settings?.setup || { state: 'done', at: '' },
          }
        }
        if (version < 37) {
          // Egyptian e-invoicing settings. Off unless switched on, so nobody
          // outside Egypt gains a section they have no use for.
          //
          // Spread rather than assign into persisted.settings: a partial blob
          // may carry no settings at all, and reaching into an undefined one
          // throws — which aborts the whole migration chain, taking every
          // earlier version's work with it.
          persisted.settings = {
            ...persisted.settings,
            eta: persisted.settings?.eta || {
              enabled: false, taxpayerId: '', activityCode: '', branchId: '0',
              documentTypeVersion: '1.0', defaultItemCodeType: 'EGS',
              address: { country: 'EG', governate: '', regionCity: '', street: '', buildingNumber: '', postalCode: '' },
              taxSubTypes: { ...ETA_DEFAULT_TAX_SUBTYPES },
            },
          }
        }
        if (version < 36) {
          // Employee salary advances. An asset — money handed over that has
          // not yet been worked off — winding down through payroll.
          if (!persisted.employeeAdvances) persisted.employeeAdvances = []
          const a = { id: 'acc-empadv', code: '1250', name: 'Employee Advances', type: 'asset', subtype: 'current', isSystem: true }
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((x) => x.id === a.id))
            persisted.accounts.push(a)
        }
        if (version < 35) {
          // FIFO becomes an option. Existing items get one cost layer seeded
          // from what they already hold, so a company switching to FIFO starts
          // from its current carrying value rather than from nothing — and a
          // company that stays on weighted average sees no change at all.
          if (persisted.settings && !persisted.settings.inventory)
            persisted.settings.inventory = { costingMethod: 'wac' }
          if (Array.isArray(persisted.inventoryItems))
            persisted.inventoryItems = persisted.inventoryItems.map((i) => (
              i.costLayers ? i : { ...i, costLayers: layersFromBalance(i.quantity, i.costPrice) }))
        }
        if (version < 34) {
          // Customer advances. A deposit is a liability until the work is
          // done, so it gets its own account rather than sitting as a
          // negative receivable.
          if (!persisted.customerAdvances) persisted.customerAdvances = []
          const advAcc = { id: 'acc-custadv', code: '2250', name: 'Customer Advances', type: 'liability', subtype: 'current', isSystem: true }
          if (Array.isArray(persisted.accounts) && !persisted.accounts.some((x) => x.id === advAcc.id))
            persisted.accounts.push(advAcc)
        }
        if (version < 33) {
          // The cheque register. Two system accounts keep a post-dated cheque
          // out of the bank balance until it clears — an asset for cheques
          // held, a liability for cheques written.
          if (!persisted.cheques) persisted.cheques = []
          const chqAcc = [
            { id: 'acc-chq-in',  code: '1150', name: 'Cheques Under Collection', type: 'asset',     subtype: 'current', isSystem: true },
            { id: 'acc-chq-out', code: '2150', name: 'Cheques Payable',          type: 'liability', subtype: 'current', isSystem: true },
          ]
          if (Array.isArray(persisted.accounts))
            chqAcc.forEach((a) => { if (!persisted.accounts.some((x) => x.id === a.id)) persisted.accounts.push(a) })
        }
        if (version < 32) {
          // Other Income becomes a named role, so the income statement can
          // keep it out of gross profit the same way it already keeps cost of
          // sales out of operating expenses.
          //
          // Only the role is added. No account changes type and no journal
          // entry moves, so the trial balance, retained earnings and net
          // profit are all identical before and after — what changes is that
          // gross profit and gross margin stop counting FX movements and
          // disposal gains as trading revenue.
          //
          // A company that renamed or re-parented the shipped group keeps its
          // own structure; the role attaches by id, and its absence just means
          // the statement behaves exactly as it did before.
          if (Array.isArray(persisted.accountGroups))
            persisted.accountGroups = persisted.accountGroups.map((g) =>
              (g.id === 'grp-oi' && !g.role ? { ...g, role: OTHER_INCOME } : g))
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

