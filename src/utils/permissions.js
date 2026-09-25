// Who may do what.
//
// Every user on a device has a role. A role grants actions (view, create,
// edit, delete, approve) per area of the business (sales, purchases, ...).
// Owners and admins can adjust what each of the other roles may do on the
// Team page; owner and admin themselves always have everything, so nobody
// can lock the business out of its own books.
//
// The rule is enforced in two places:
//   - the store (src/store/guard.js): every action that changes data checks
//     the current user's permission first, so a hidden button, an old tab or
//     the browser console can't get around it;
//   - the screens: pages outside a role's areas are left out of the menu and
//     show a "no access" notice, and delete/void buttons are hidden.

export const AREAS = [
  { id: 'sales', label: 'Sales & customers' },
  { id: 'purchases', label: 'Purchases & suppliers' },
  { id: 'inventory', label: 'Inventory & production' },
  { id: 'banking', label: 'Cash & banking' },
  { id: 'accounting', label: 'Accounting & assets' },
  { id: 'hr', label: 'HR & payroll' },
  { id: 'reports', label: 'Reports & analytics' },
  { id: 'settings', label: 'Settings & data' },
]

export const ACTIONS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete / void' },
  { id: 'approve', label: 'Approve' },
]

const ALL = ACTIONS.map((a) => a.id)
const full = () => Object.fromEntries(AREAS.map((a) => [a.id, ALL.slice()]))
const only = (grants) => Object.fromEntries(AREAS.map((a) => [a.id, (grants[a.id] || []).slice()]))

export const ROLES = [
  { id: 'owner', label: 'Owner', desc: 'Full control, incl. companies & team', locked: true },
  { id: 'admin', label: 'Admin', desc: 'Manage settings, team & all data', locked: true },
  { id: 'accountant', label: 'Accountant', desc: 'Day-to-day bookkeeping' },
  { id: 'sales', label: 'Sales clerk', desc: 'Quotes, orders and invoices; no deleting' },
  { id: 'purchasing', label: 'Purchasing clerk', desc: 'Orders, bills and stock; no deleting' },
  { id: 'hr', label: 'HR officer', desc: 'Employees, attendance and payroll' },
  { id: 'viewer', label: 'Viewer', desc: 'Read-only access' },
]

export const ROLE_PRESETS = {
  owner: full(),
  admin: full(),
  accountant: only({
    sales: ALL, purchases: ALL, inventory: ALL, banking: ALL, accounting: ALL,
    hr: ['view', 'create', 'edit'], reports: ['view'], settings: ['view'],
  }),
  sales: only({
    sales: ['view', 'create', 'edit'], inventory: ['view'], reports: ['view'],
  }),
  purchasing: only({
    purchases: ['view', 'create', 'edit'], inventory: ['view', 'create', 'edit'], reports: ['view'],
  }),
  hr: only({
    hr: ['view', 'create', 'edit'],
  }),
  viewer: only({
    sales: ['view'], purchases: ['view'], inventory: ['view'], banking: ['view'],
    accounting: ['view'], reports: ['view'],
  }),
}

export const roleLabel = (role) => ROLES.find((r) => r.id === role)?.label || role
export const areaLabel = (area) => AREAS.find((a) => a.id === area)?.label || area

/** The grants a role actually has: the owner's adjustments, else the preset. */
export function permissionsFor(role, overrides = {}) {
  const preset = ROLE_PRESETS[role] || ROLE_PRESETS.viewer
  if (ROLES.find((r) => r.id === role)?.locked) return preset
  return { ...preset, ...(overrides?.[role] || {}) }
}

export function can(role, area, action, overrides) {
  if (!area) return true
  const grants = permissionsFor(role, overrides)[area] || []
  // Anything you may change, you may look at.
  return grants.includes(action) || (action === 'view' && grants.length > 0)
}

// ─── Store actions ────────────────────────────────────────────────────
// Every store action that changes data, with the permission it needs. Reads
// (balances, previews, "what is due") need none. test/permissions.test.js
// fails when a new action is added to the store without being listed here or
// in UNGUARDED, so nothing slips through by being forgotten.
const A = (area, list) => Object.fromEntries(Object.entries(list).flatMap(([action, names]) => names.map((n) => [n, [area, action]])))

export const ACTION_PERMISSIONS = {
  ...A('sales', {
    create: ['addInvoice', 'recordInvoicePayment', 'receiveAdvance', 'applyAdvance', 'refundAdvance', 'addQuotation',
      'convertQuotationToInvoice', 'postSettlementDiscount', 'addSalesOrder', 'convertQuotationToSalesOrder',
      'convertSalesOrderToInvoice', 'convertSalesOrderToDeliveryNote', 'addCreditNote', 'createSalesReturn',
      'addRecurringInvoice', 'addDeliveryNote', 'addLead', 'convertLeadToCustomer', 'addCustomer'],
    edit: ['updateInvoice', 'reviseInvoice', 'updateQuotation', 'updateSalesOrder', 'updateRecurringInvoice',
      'updateDeliveryNote', 'updateLead', 'updateCustomer'],
    delete: ['voidInvoice', 'deleteInvoice', 'deleteAdvance', 'deleteQuotation', 'deleteSalesOrder', 'deleteCreditNote',
      'voidCreditNote', 'deleteRecurringInvoice', 'deleteDeliveryNote', 'deleteLead', 'deleteCustomer'],
  }),
  ...A('purchases', {
    create: ['addPurchaseQuote', 'convertPurchaseQuoteToOrder', 'addPurchaseOrder', 'convertPOToPurchase', 'receiveGoods',
      'billReceivedPO', 'addPurchase', 'recordPurchasePayment', 'addDebitNote', 'createPurchaseReturn', 'addRecurringExpense',
      'postRecurringExpense', 'addRequisition', 'convertRequisitionToPO', 'addSupplier'],
    edit: ['updatePurchaseQuote', 'updatePurchaseOrder', 'updatePurchase', 'revisePurchase', 'updateRecurringExpense', 'updateSupplier'],
    delete: ['deletePurchaseQuote', 'deletePurchaseOrder', 'voidPurchase', 'deletePurchase', 'deleteDebitNote', 'voidDebitNote',
      'deleteRecurringExpense', 'deleteRequisition', 'deleteSupplier'],
    approve: ['approveRequisition', 'rejectRequisition'],
  }),
  ...A('inventory', {
    create: ['addInventoryItem', 'cycleCountBatch', 'startCycleCount', 'startStockCount', 'postStockCount', 'postLandedCost',
      'addStockAdjustment', 'addBOM', 'addWorkOrder', 'startWorkOrder', 'completeWorkOrder', 'addWarehouse', 'addStockTransfer'],
    edit: ['updateInventoryItem', 'updateStockCount', 'updateBOM', 'updateWarehouse'],
    delete: ['deleteInventoryItem', 'deleteStockCount', 'deleteStockAdjustment', 'deleteBOM', 'deleteWorkOrder', 'deleteWarehouse', 'deleteStockTransfer'],
    approve: ['approveStockAdjustment', 'rejectStockAdjustment'],
  }),
  ...A('banking', {
    create: ['addBankAccount', 'addCheque', 'addBankTransaction', 'addMatchRule', 'addBankTransfer', 'addScheduledTransfer',
      'postScheduledTransfer', 'addCurrency', 'postFxRevaluation'],
    edit: ['updateBankAccount', 'setChequeStatus', 'updateScheduledTransfer', 'updateCurrency', 'toggleReconciled'],
    delete: ['deleteBankAccount', 'deleteCheque', 'deleteMatchRule', 'deleteBankTransaction', 'deleteBankTransfer',
      'deleteScheduledTransfer', 'deleteCurrency'],
  }),
  ...A('accounting', {
    create: ['addAccount', 'addAccountGroup', 'addCapitalAccount', 'addCapitalSubaccount', 'recordCapitalMovement',
      'allocateProfitToPartners', 'postOpeningBalances', 'addJournalEntry', 'addRecurringJournal', 'postRecurringJournal',
      'addFixedAsset', 'recordDepreciation', 'runDepreciation', 'depreciationCatchUp', 'disposeAsset', 'addPrepaidExpense',
      'amortizePrepaid', 'addLease', 'recogniseLease', 'postLeasePeriod', 'recordLeasePayment', 'postEclProvision',
      'postDeferredTax', 'addProject', 'recordProjectTransaction', 'addTimeEntry', 'setBudget', 'settleVat'],
    edit: ['updateAccount', 'updateAccountGroup', 'moveAccountToGroup', 'setAccountControlKind', 'setRecordControlAccount',
      'updateCapitalAccount', 'restoreDefaultGroups', 'updateOpening', 'updateJournalEntry', 'updateRecurringJournal',
      'updateProject', 'updateTimeEntry', 'terminateLease', 'sealLedger'],
    delete: ['deleteAccount', 'deleteAccountGroup', 'deleteCapitalAccount', 'deleteCapitalSubaccount', 'reverseOpeningBalances',
      'deleteJournalEntry', 'voidJournalEntry', 'deleteRecurringJournal', 'deleteFixedAsset', 'deletePrepaidExpense',
      'deleteLease', 'deleteProject', 'deleteTimeEntry', 'deleteBudget'],
    approve: ['approveRequest', 'rejectRequest'],
  }),
  ...A('hr', {
    create: ['issueEmployeeAdvance', 'repayEmployeeAdvance', 'addDepartment', 'addEmployee', 'addContract', 'postEosbAccrual',
      'settleEosb', 'addPayrollRun', 'processPayrollRun', 'payPayrollRun', 'addExpenseClaim', 'payExpenseClaim'],
    edit: ['updateDepartment', 'updateEmployee', 'updateContract', 'setAttendanceDay', 'saveAttendanceSheet', 'updateHrSettings'],
    delete: ['writeOffEmployeeAdvance', 'deleteEmployeeAdvance', 'deleteDepartment', 'deleteEmployee', 'deleteContract',
      'deleteEosbAccrual', 'clearAttendanceMonth', 'deletePayrollRun', 'deleteExpenseClaim'],
    approve: ['approveExpenseClaim'],
  }),
  ...A('settings', {
    create: ['importData', 'snapshotNow', 'addCustomField'],
    edit: ['updateSettings', 'updateCompany', 'updateInventorySettings', 'updateTax', 'updateInvoiceSettings', 'updateAiSettings',
      'updateZatca', 'reopenSetup', 'updateEta', 'updateCustomFields', 'updateCustomField', 'moveCustomField', 'updateWht',
      'updateApprovals', 'setPeriodLock', 'closeFiscalYear', 'reopenFiscalYear', 'setAutoPostRecurring', 'updateEclSettings',
      'updateDeferredTaxSettings', 'updatePaymentTerms', 'updateBranding', 'updateDocBranding', 'clearLegacyLogo',
      'restoreFromBin', 'recordOffDeviceBackup'],
    delete: ['resetAllData', 'restoreSnapshot', 'deleteSnapshot', 'deleteCustomField', 'cleanCustomValues', 'purgeFromBin',
      'emptyRecycleBin', 'clearAuditLog', 'recycleRecord'],
  }),
}

// Actions that change nothing the business cares about, or that the app runs
// on its own (schedulers, sync, audit logging), or that anyone may ask for
// (an approval request is a question, not a change).
export const UNGUARDED = new Set([
  'setTheme', 'setDensity', 'markSetupDone', 'submitForApproval', 'withdrawRequest', 'logActivity', 'logChange',
  'logStockMovement', 'runScheduler', 'generateDueRecurring', 'generateDueRecurringJournals', 'generateDueRecurringExpenses',
  'runBackupScheduler', 'syncNow', 'exportData', 'checkBackupAnchor', '_readBackups', '_writeBackups', '_readSyncMeta',
  '_writeSyncMeta', '_recordAdvanceRepayments', '_depreciationTotals', 'dismissNotification', 'restoreNotifications',
  'setNotificationPrefs', 'markNotificationsSeen',
])

// Questions the store answers without changing anything.
export const READS = new Set(`costingMethod customFieldsFor isDateLocked controlAccountFor controlAccountOptions currentUser
  allUsers journalEditBlock verifyLedger ledgerAnchor assertJEsUnlocked getAccountBalance getAllBalances cashAccountOptions
  outstandingCheques getItemStock stockShortfall invoiceEditBlock customerCreditBalance termsFor dueDateFrom settlementOffer
  advanceDate purchaseEditBlock advanceDueFor advanceOwedBy totalEmployeeAdvances contractFor serviceStartFor eosbSettings
  eosbFor eosbProvidedFor eosbSchedule attendanceSheet attendanceImpact depreciationDue previewDepreciation leaseTerms
  eclAssessment deferredTaxAssessment taxRateReconciliation disclosureNotes durabilityReport listSnapshots`.split(/\s+/))

// Screens → area. The longest matching prefix wins; '/' is the dashboard,
// which every role may open.
export const ROUTE_AREAS = {
  '/accounts': 'accounting', '/capital-accounts': 'accounting', '/journals': 'accounting', '/recurring-journals': 'accounting',
  '/opening-balances': 'accounting', '/fixed-assets': 'accounting', '/prepaid-expenses': 'accounting', '/leases': 'accounting',
  '/projects': 'accounting', '/budgets': 'accounting', '/period-close': 'accounting', '/year-end': 'accounting',
  '/currencies': 'accounting', '/revaluation': 'accounting', '/approvals': 'accounting',
  '/bank-accounts': 'banking', '/cash-flow': 'banking', '/banking': 'banking', '/reconciliation': 'banking', '/cheques': 'banking',
  '/pipeline': 'sales', '/pos': 'sales', '/customers': 'sales', '/quotations': 'sales', '/sales-orders': 'sales',
  '/invoices': 'sales', '/recurring-invoices': 'sales', '/payment-reminders': 'sales', '/commissions': 'sales',
  '/delivery-notes': 'sales', '/advances': 'sales', '/credit-notes': 'sales', '/statements': 'sales',
  '/requisitions': 'purchases', '/suppliers': 'purchases', '/purchase-quotes': 'purchases', '/purchase-orders': 'purchases',
  '/purchases': 'purchases', '/debit-notes': 'purchases', '/landed-costs': 'purchases', '/recurring-expenses': 'purchases',
  '/inventory': 'inventory', '/inventory-control': 'inventory', '/warehouses': 'inventory', '/stock-adjustments': 'inventory',
  '/stock-counts': 'inventory', '/labels': 'inventory', '/manufacturing': 'inventory',
  '/departments': 'hr', '/employees': 'hr', '/contracts': 'hr', '/attendance': 'hr', '/payroll': 'hr',
  '/employee-advances': 'hr', '/expense-claims': 'hr',
  '/analytics': 'reports', '/trade-analytics': 'reports', '/financial-health': 'reports', '/cash-forecast': 'reports',
  '/consolidation': 'reports', '/reports': 'reports', '/audit-log': 'reports',
  '/import-export': 'settings', '/recycle-bin': 'settings', '/settings': 'settings',
}

export function areaForPath(pathname = '/') {
  const p = String(pathname).replace(/\/+$/, '') || '/'
  let best = null
  for (const prefix of Object.keys(ROUTE_AREAS)) {
    if ((p === prefix || p.startsWith(prefix + '/')) && (!best || prefix.length > best.length)) best = prefix
  }
  return best ? ROUTE_AREAS[best] : null
}

/** Which action a route is for: /x/new → create, /x/:id/edit → edit, else view. */
export function actionForPath(pathname = '/') {
  if (/\/new$/.test(pathname)) return 'create'
  if (/\/edit$/.test(pathname)) return 'edit'
  return 'view'
}

// ─── Who is acting ────────────────────────────────────────────────────
// The store must not import the sign-in store (tests and the sync engine use
// the store with nobody signed in), so auth.js registers a resolver instead.
// No resolver, or nobody signed in, means no restriction.
let resolveActor = () => null
export function setActorResolver(fn) { resolveActor = typeof fn === 'function' ? fn : () => null }
/** { role, name, overrides } for the signed-in user, or null. */
export const currentActor = () => { try { return resolveActor() } catch { return null } }

export function actorCan(area, action) {
  const actor = currentActor()
  if (!actor) return true
  return can(actor.role, area, action, actor.overrides)
}

const ACTION_WORDS = { view: 'view', create: 'create', edit: 'edit', delete: 'delete or void', approve: 'approve' }

/** The refusal in words; `t` translates each part when the app is in Arabic. */
export function refusalMessage({ role, area, action }, t = (x) => x) {
  return t("Your role ({role}) can't {action} in {area}. Ask an owner or admin if you need this.")
    .replace('{role}', t(roleLabel(role))).replace('{action}', t(ACTION_WORDS[action] || action)).replace('{area}', t(areaLabel(area)))
}

export class PermissionError extends Error {
  constructor(area, action, role) {
    super(refusalMessage({ role, area, action }))
    this.name = 'PermissionError'
    this.code = 'PERMISSION_DENIED'
    this.area = area
    this.action = action
    this.role = role
  }
}
