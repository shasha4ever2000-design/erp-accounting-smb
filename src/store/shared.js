// Constants and helpers shared by the store's slices and its migrations.
// Moved out of src/store.js unchanged; see the slice files beside this one.
import { ETA_DEFAULT_TAX_SUBTYPES } from '../utils/etaEinvoice'
import { explodeLines, isKit } from '../utils/kits'
import { weightedAverageCost } from '../utils/inventoryCost'
import { FIFO, receiveInto, layersFromBalance, consume, unitCostOf } from '../utils/fifo'
import { removeEntries } from '../utils/ledgerChain'
import { DECLINING_BALANCE } from '../utils/deferredTax'
import { defaultApprovalSettings } from '../utils/approvals'
import { defaultBranding } from '../utils/branding'
import { defaultTerms } from '../utils/paymentTerms'
import { defaultPolicy as defaultCyclePolicy } from '../utils/cycleCount'
import { defaultEosbSettings } from '../utils/endOfService'
import { CF_ENTITIES } from '../utils/customFields'
import { DEFAULT_MATRIX as DEFAULT_ECL_MATRIX } from '../utils/ecl'

export const DEFAULT_ACCOUNTS = [
  // ASSETS – Current
  { id: 'acc-cash',    code: '1001', name: 'Cash on Hand',              type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-bank1',  code: '1002', name: 'Main Bank Account',          type: 'asset',     subtype: 'current',     isSystem: false },
  { id: 'acc-ar',     code: '1100', name: 'Accounts Receivable',        type: 'asset',     subtype: 'current',     isSystem: true, controlFor: 'customers'  },
  { id: 'acc-chq-in', code: '1150', name: 'Cheques Under Collection',     type: 'asset',     subtype: 'current',     isSystem: true  },
  { id: 'acc-empadv', code: '1250', name: 'Employee Advances',            type: 'asset',     subtype: 'current',     isSystem: true  },
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
  { id: 'acc-roudepr',code: '1621', name: 'Accumulated Depreciation – Right-of-Use', type: 'asset', subtype: 'non_current', isSystem: false },
  { id: 'acc-dta',    code: '1700', name: 'Deferred Tax Asset',         type: 'asset',     subtype: 'non_current', isSystem: false },
  { id: 'acc-ecl',    code: '1105', name: 'Allowance for Expected Credit Losses', type: 'asset', subtype: 'current', isSystem: false },
  // LIABILITIES – Current
  { id: 'acc-ap',     code: '2001', name: 'Accounts Payable',           type: 'liability', subtype: 'current',     isSystem: true, controlFor: 'suppliers'  },
  { id: 'acc-grni',   code: '2050', name: 'Goods Received Not Invoiced', type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-chq-out',code: '2150', name: 'Cheques Payable',             type: 'liability', subtype: 'current',     isSystem: true  },
  { id: 'acc-custadv',code: '2250', name: 'Customer Advances',           type: 'liability', subtype: 'current',     isSystem: true  },
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
  // IAS 12 requires deferred tax to be classified as non-current whichever way
  // the underlying difference reverses (IAS 12.70), so both sides sit here.
  { id: 'acc-dtl',    code: '2600', name: 'Deferred Tax Liability',     type: 'liability', subtype: 'non_current', isSystem: false },
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
  { id: 'acc-baddebt',code: '5017', name: 'Expected Credit Losses',     type: 'expense',   subtype: 'expense',     isSystem: false },
  { id: 'acc-taxexp', code: '5018', name: 'Income Tax Expense',         type: 'expense',   subtype: 'expense',     isSystem: false },
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

export const DEFAULT_BANK_ACCOUNTS = [
  { id: 'ba-cash',  accountId: 'acc-cash',  name: 'Petty Cash',        type: 'cash', bankName: '', accountNumber: '', isDefault: false },
  { id: 'ba-bank1', accountId: 'acc-bank1', name: 'Main Bank Account', type: 'bank', bankName: '', accountNumber: '', isDefault: true  },
]

export const DEFAULT_SETTINGS = {
  company: { name: 'My Company', arabicName: '', address: '', phone: '', email: '', taxId: '', currency: 'USD', currencySymbol: '$', fiscalYearStart: '01', logo: '', accentColor: '#2563eb' },
  branding:      defaultBranding(),
  terms:         defaultTerms(),
  cycleCount:    { policy: defaultCyclePolicy(), batchSize: 20 },
  tax:           { enabled: false, rate: 15, name: 'VAT', system: 'vat', country: '' },
  // First-run setup. Until this is answered the wizard asks; 'skipped' counts
  // as answered, because being asked twice is worse than never being asked.
  setup:         { state: 'pending', at: '' },
  zatca:         { enabled: false, vatNumber: '', crNumber: '', showQr: true },
  // Egyptian Tax Authority e-invoicing. See utils/etaEinvoice — this app shapes
  // and validates the document; signing and submission stay with the taxpayer.
  eta:           { enabled: false, taxpayerId: '', activityCode: '', branchId: '0',
                   documentTypeVersion: '1.0', defaultItemCodeType: 'EGS',
                   address: { country: 'EG', governate: '', regionCity: '', street: '', buildingNumber: '', postalCode: '' },
                   taxSubTypes: { ...ETA_DEFAULT_TAX_SUBTYPES } },
  wht:           { enabled: false, rate: 5, name: 'Withholding Tax' },
  inventory:     { costingMethod: 'wac' },
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
  // IFRS 9 requires an entity's own observed loss experience, so these
  // are a starting point to be replaced, not a recommendation.
  ecl:           { enabled: false, matrix: { ...DEFAULT_ECL_MATRIX }, lastAssessedAt: '' },
  // When a copy of the books last left this device. Only a downloaded backup
  // file counts — the in-browser snapshots are stored in the same IndexedDB as
  // the ledger and die with it. See utils/durability.js.
  durability:    { lastExportAt: '', lastExportKind: '' },
  // IAS 12 deferred tax. Off unless switched on: recognising deferred tax
  // changes reported profit and the balance sheet, and which capital-allowance
  // regime applies is a fact about the business's jurisdiction that this
  // application cannot know and must not guess.
  deferredTax:   {
    enabled: false,
    ratePct: 0,              // rate profits are taxed at
    allowanceRatePct: 0,     // rate capital allowances are given at — a different thing
    assetTaxMethod: DECLINING_BALANCE,
    lossesCarriedForward: 0,
    recognitionPct: 100,     // how much of the unsupported asset is probable
    offset: true,            // IAS 12.74
    manual: [],
    lastAssessedAt: '',
  },
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

export const DEFAULT_WAREHOUSES = [
  { id: 'wh-main', name: 'Main Warehouse', location: '', isDefault: true },
]

export function nextNum(prefix, n) {
  return `${prefix}${String(n).padStart(4, '0')}`
}

// How far debits and credits may drift apart and still post: less than half a
// cent, so the two sides agree once rounded to the cent. This used to be 0.05,
// which let a hand-typed entry that was 4 cents out go into the ledger and
// leave the trial balance out by the same amount with nothing to say why.
export const BALANCE_TOLERANCE = 0.005

/**
 * Drop journal entries a deleted document owned, keeping the ones `keep`
 * approves, and repair the hash chain from the gap. A plain filter left the
 * next entry pointing at a deleted predecessor, so every legitimate delete or
 * document edit showed up in the integrity check as tampering.
 */
export function keepEntries(entries, keep) {
  return removeEntries(entries, (je) => !keep(je))
}

/**
 * Put stock back on the shelf at a known cost — a voided sale, an unposted
 * invoice, a customer return.
 *
 * The ledger side of these always debits inventory with what the units cost,
 * so the item has to take them back at that same value: blended into the
 * weighted average, and pushed onto the FIFO queue. Adding the quantity alone
 * left the cost layers short of the quantity on hand and let the carried cost
 * drift away from the inventory account.
 *
 * @param {object} it      the inventory item
 * @param {number} qty     units coming back
 * @param {number} value   what they cost in total (base currency)
 * @param {object} ctx     { method, date, ref, warehouseId }
 */
export function restockAtCost(it, qty, value, { method, date, ref, warehouseId, defaultWarehouseId }) {
  const oldQty = Number(it.quantity) || 0
  const seeded = { ...it, costLayers: it.costLayers || layersFromBalance(oldQty, it.costPrice) }
  const wacCost = weightedAverageCost({ onHand: oldQty, unitCost: it.costPrice, receivedQty: qty, receivedValue: value })
  const patch = { quantity: oldQty + qty, ...receiveInto(seeded, { qty, value, date, ref, method, wacCost }) }
  return { ...it, ...patch, ...whPatch(it, warehouseId, qty, defaultWarehouseId) }
}

/**
 * The per-warehouse side of a stock movement.
 *
 * An item that has only ever lived in the default warehouse carries no map at
 * all — its whole quantity is implicitly there. The first movement into or out
 * of any other warehouse creates the map from that implicit balance, so the
 * warehouses still add up to the item's quantity afterwards.
 */
export function whPatch(it, warehouseId, delta, defaultWarehouseId = 'wh-main') {
  const wh = warehouseId || defaultWarehouseId
  if (!it.stockByWarehouse && wh === defaultWarehouseId) return {}
  const map = { ...(it.stockByWarehouse || { [defaultWarehouseId]: Number(it.quantity) || 0 }) }
  map[wh] = Math.round(((map[wh] || 0) + delta) * 1e6) / 1e6
  return { stockByWarehouse: map }
}

/** Whether an item is physically stocked: not a kit, not a service. */
export function isStocked(item) {
  return !!item && !isKit(item) && item.type !== 'service'
}

/**
 * Take back stock that `restockAtCost` put on the shelf — deleting the return
 * that brought it in. The layer that return pushed is removed by its `ref`;
 * the weighted average is unblended by the same value.
 */
export function unstockAtCost(it, qty, value, { method, ref, warehouseId, defaultWarehouseId }) {
  const oldQty = Number(it.quantity) || 0
  const carried = Number(it.costPrice) || 0
  const newQty = oldQty - qty
  let layers = Array.isArray(it.costLayers) ? it.costLayers.map((l) => ({ ...l })) : layersFromBalance(oldQty, carried)
  // Take the units from the layer the receipt being undone pushed, when it is
  // still there; otherwise off the front of the queue.
  const at = ref ? layers.findIndex((l) => l.ref === ref && (Number(l.qty) || 0) >= qty - 1e-6) : -1
  if (at >= 0) {
    const left = Math.round(((Number(layers[at].qty) || 0) - qty) * 1e6) / 1e6
    if (left > 1e-9) layers[at] = { ...layers[at], qty: left }
    else layers.splice(at, 1)
  } else layers = consume(layers, qty, carried).layers
  const costPrice = method === FIFO
    ? unitCostOf(layers, carried)
    : (newQty > 1e-9 ? Math.max(0, Math.round(((oldQty * carried - (Number(value) || 0)) / newQty) * 10000) / 10000) : carried)
  const patch = { quantity: newQty, costLayers: layers, costPrice }
  return { ...it, ...patch, ...whPatch(it, warehouseId, -qty, defaultWarehouseId) }
}

/** What a purchase return took off the shelf, and which bill lines it marked returned. */
export function debitNoteStock(dn, items) {
  const back = {}, giveBack = {}
  if (!dn?.purchaseId) return { back, giveBack }
  ;(dn.items || []).forEach((l) => {
    const item = l.itemId ? items.find((i) => i.id === l.itemId) : null
    if (isStocked(item)) back[l.itemId] = (back[l.itemId] || 0) + (Number(l.quantity) || 0)
    if (l.sourceLineId) giveBack[l.sourceLineId] = (giveBack[l.sourceLineId] || 0) + (Number(l.quantity) || 0)
  })
  return { back, giveBack }
}

/**
 * What a bill put on the shelf: { itemId: { qty, cost } } in base currency.
 * Stored on the bill when it posts; worked out from its lines for older bills.
 */
export function stockReceivedBy(pur, items) {
  if (pur?.stockReceived) return pur.stockReceived
  const rate = Number(pur?.exchangeRate) || 1
  const recv = {}
  ;(pur?.items || []).forEach((line) => {
    if (!line.itemId || !isStocked(items.find((i) => i.id === line.itemId))) return
    const q = parseFloat(line.quantity) || 0
    if (q <= 0) return
    recv[line.itemId] = recv[line.itemId] || { qty: 0, cost: 0 }
    recv[line.itemId].qty += q
    recv[line.itemId].cost += Math.round((Number(line.subtotal) || 0) * rate * 100) / 100
  })
  return recv
}

// Fields of a sales invoice or bill that went into the ledger or the stock
// ledger when it posted.
export const POSTED_FIELDS = new Set([
  'items', 'subtotal', 'taxAmount', 'total', 'baseTotal', 'docDiscount', 'docDiscountAmount', 'shipping',
  'amountPaid', 'payments', 'status', 'exchangeRate', 'currency', 'date',
  'customerId', 'supplierId', 'warehouseId', 'departmentId',
  'journalEntryId', 'cogsJournalEntryId', 'cogsTotal', 'cogsByItem', 'stockIssued', 'stockReceived', 'number',
])

export function assertNoPostedFields(patch) {
  const bad = Object.keys(patch || {}).filter((k) => POSTED_FIELDS.has(k))
  if (bad.length) throw new Error(`DOC_FIELD_POSTED:${bad.join(',')}`)
}

/** The default warehouse's id. */
export function defaultWh(state) {
  return state.warehouses?.find((w) => w.isDefault)?.id || 'wh-main'
}

/** The warehouse a document moves stock in: its own, if it still exists, else the default. */
export function whOf(state, doc) {
  const id = doc?.warehouseId
  if (id && (state.warehouses || []).some((w) => w.id === id)) return id
  return defaultWh(state)
}

/**
 * What an invoice actually took off the shelf, item by item.
 *
 * Stored on the invoice when it posts. Invoices posted before that fall back
 * to exploding their lines, which is what the sale itself did — reversing by
 * raw line instead put a kit back as a phantom kit and never returned its
 * components.
 */
export function stockIssuedBy(inv, items) {
  return inv?.stockIssued || explodeLines(inv?.items || [], items)
}

/** Shift an ISO date by whole days. UTC, so a timezone can't move the boundary. */
export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
