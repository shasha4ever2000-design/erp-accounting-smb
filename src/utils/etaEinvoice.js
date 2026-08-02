// Egyptian Tax Authority (ETA) e-invoicing — the document, and what it needs.
//
// Egypt requires B2B invoices to be filed with the ETA as a structured JSON
// document, signed with the taxpayer's own e-signature certificate. The signing
// key lives on a hardware token, and submission is an authenticated server-side
// call, so neither belongs in a browser app that runs on your own machine with
// no backend.
//
// What does belong here is everything up to that point, which is the tedious
// part: shaping the invoice into ETA's structure, and — more usefully — saying
// exactly which required fields are missing before the portal rejects it. A
// rejected submission tells you very little; this tells you "customer has no
// tax registration number" while you can still fix it.
//
// So the output is a document you sign and upload (through the ETA portal's own
// tool, or your integrator), not a submission.
//
// ── On the tax codes ────────────────────────────────────────────────────
// ETA identifies each tax by a type (T1 is value-added tax) and a sub-type
// code. The sub-type that applies to a given supply depends on the taxpayer's
// registered activity, and the code lists are revised. The defaults below are
// the common ones, but they are settings rather than constants precisely
// because they must be checked against your own ETA profile — a wrong
// sub-type is accepted by the shape and rejected by the Authority.

/** Document types ETA recognises. */
export const ETA_DOC_TYPES = { invoice: 'I', credit: 'C', debit: 'D' }

/** Who the invoice is issued to. B: business, P: natural person, F: foreigner. */
export const ETA_RECEIVER_TYPES = [
  { id: 'B', label: 'Business (has a tax registration number)' },
  { id: 'P', label: 'Individual (national ID)' },
  { id: 'F', label: 'Foreign customer' },
]

/** How an item is coded. ETA accepts its own EGS list or a GS1 barcode. */
export const ETA_ITEM_CODE_TYPES = [
  { id: 'EGS', label: 'EGS — Egyptian Goods & Services code' },
  { id: 'GS1', label: 'GS1 — global trade item number (barcode)' },
]

/** Defaults for the VAT sub-type codes. Confirm against your ETA profile. */
export const ETA_DEFAULT_TAX_SUBTYPES = {
  standard: 'V009',   // general rate supplies
  zero:     'V001',   // export / zero-rated
  exempt:   'V002',   // exempt supplies
}

const r5 = (n) => Math.round((Number(n) || 0) * 1e5) / 1e5
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const str = (v) => (v == null ? '' : String(v).trim())

/** ETA timestamps are UTC, to the second, with a trailing Z. */
export function etaTimestamp(invoice) {
  const d = invoice?.createdAt
    ? new Date(invoice.createdAt)
    : new Date(`${invoice?.date || new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return `${d.toISOString().slice(0, 19)}Z`
}

/** Which sub-type code a line's VAT category maps to. */
function subTypeFor(line, subTypes) {
  const cat = line?.taxCategory === 'zero' || line?.taxCategory === 'exempt' ? line.taxCategory : 'standard'
  return subTypes[cat] || ETA_DEFAULT_TAX_SUBTYPES[cat]
}

/**
 * Everything stopping this invoice from being filed, in the order a person
 * would fix it. Empty array means the document is complete — not that the
 * Authority will accept it, which only signing and submitting can tell you.
 *
 * @returns {Array<{field: string, message: string}>}
 */
export function validateEtaInvoice(invoice, ctx = {}) {
  const { eta = {}, customer = null, items = [] } = ctx
  const errors = []
  const need = (cond, field, message) => { if (!cond) errors.push({ field, message }) }

  need(str(eta.taxpayerId), 'eta.taxpayerId', 'Your taxpayer registration number is not set (Settings › Tax & e-invoicing).')
  need(str(eta.activityCode), 'eta.activityCode', 'Your ETA activity code is not set — every document carries it.')
  need(str(eta.address?.governate), 'eta.address.governate', 'Your governorate is missing from the issuer address.')
  need(str(eta.address?.regionCity), 'eta.address.regionCity', 'Your city or region is missing from the issuer address.')
  need(str(eta.address?.street), 'eta.address.street', 'Your street is missing from the issuer address.')
  need(str(eta.address?.buildingNumber), 'eta.address.buildingNumber', 'Your building number is missing from the issuer address.')

  need(invoice, 'invoice', 'There is no invoice to file.')
  if (!invoice) return errors

  const receiverType = str(customer?.etaReceiverType) || 'B'
  need(str(invoice.customerName), 'invoice.customerName', 'The invoice has no customer name.')
  if (receiverType === 'B') {
    need(str(customer?.taxId), 'customer.taxId',
      `${invoice.customerName || 'The customer'} has no tax registration number — required for a business (B) receiver.`)
  } else if (receiverType === 'P') {
    need(str(customer?.taxId), 'customer.taxId',
      `${invoice.customerName || 'The customer'} has no national ID — required for an individual (P) receiver.`)
  }

  const lines = invoice.items || []
  need(lines.length > 0, 'invoice.items', 'The invoice has no lines.')
  lines.forEach((l, i) => {
    const item = items.find((x) => x.id === l.itemId)
    const code = str(l.etaItemCode) || str(item?.etaItemCode)
    const label = str(l.description) || `Line ${i + 1}`
    need(code, `invoice.items[${i}].etaItemCode`,
      `"${label}" has no EGS or GS1 code — ETA rejects a line without one.`)
    need(str(l.unit) || str(item?.unit), `invoice.items[${i}].unit`,
      `"${label}" has no unit of measure.`)
  })

  return errors
}

/**
 * Shape an invoice into the document ETA expects.
 *
 * Amounts are reported in EGP: a foreign-currency invoice carries both the sold
 * amount and its EGP equivalent at the invoice's own rate, which is what the
 * Authority reconciles against.
 *
 * @param {object} invoice   the sales invoice
 * @param {object} ctx       { eta, company, customer, items, docType }
 * @returns {object} the ETA JSON document
 */
export function buildEtaInvoice(invoice, ctx = {}) {
  const { eta = {}, company = {}, customer = null, items = [], docType = ETA_DOC_TYPES.invoice } = ctx
  const subTypes = { ...ETA_DEFAULT_TAX_SUBTYPES, ...(eta.taxSubTypes || {}) }

  // The ledger is in the company's base currency; ETA wants EGP. When the
  // invoice was raised in another currency, its own rate is what converts it.
  const sold = str(invoice.currency) || str(company.currency) || 'EGP'
  const isForeign = sold !== 'EGP'
  const rate = Number(invoice.exchangeRate) || 1
  const toEGP = (v) => r5((Number(v) || 0) * (isForeign ? rate : 1))

  const addr = (a = {}) => ({
    country: str(a.country) || 'EG',
    governate: str(a.governate),
    regionCity: str(a.regionCity),
    street: str(a.street),
    buildingNumber: str(a.buildingNumber),
    ...(str(a.postalCode) ? { postalCode: str(a.postalCode) } : {}),
    ...(str(a.floor) ? { floor: str(a.floor) } : {}),
    ...(str(a.room) ? { room: str(a.room) } : {}),
    ...(str(a.landmark) ? { landmark: str(a.landmark) } : {}),
  })

  const invoiceLines = (invoice.items || []).map((l) => {
    const item = items.find((x) => x.id === l.itemId)
    const qty = Number(l.quantity) || 0
    const unitSold = Number(l.unitPrice) || 0
    const gross = r5(qty * unitSold)
    const net = r5(Number(l.subtotal) || gross)          // after line discount
    const discount = r5(gross - net)
    const taxAmount = r5(Number(l.taxAmount) || 0)
    const taxRate = Number(l.taxRate) || 0

    return {
      description: str(l.description) || str(item?.name),
      itemType: str(l.etaItemCodeType) || str(item?.etaItemCodeType) || str(eta.defaultItemCodeType) || 'EGS',
      itemCode: str(l.etaItemCode) || str(item?.etaItemCode),
      unitType: str(l.unit) || str(item?.unit) || 'EA',
      quantity: r5(qty),
      internalCode: str(item?.code),
      salesTotal: toEGP(gross),
      total: toEGP(net + taxAmount),
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: toEGP(net),
      itemsDiscount: 0,
      unitValue: {
        currencySold: sold,
        amountEGP: toEGP(unitSold),
        ...(isForeign ? { amountSold: r5(unitSold), currencyExchangeRate: r5(rate) } : {}),
      },
      discount: { rate: Number(l.discount) || 0, amount: toEGP(discount) },
      taxableItems: taxAmount > 0 || taxRate > 0 ? [{
        taxType: 'T1',
        amount: toEGP(taxAmount),
        subType: subTypeFor(l, subTypes),
        rate: taxRate,
      }] : [],
    }
  })

  const totalSales = r5(invoiceLines.reduce((s, l) => s + l.salesTotal, 0))
  const totalDiscount = r5(invoiceLines.reduce((s, l) => s + (l.discount?.amount || 0), 0))
  const netAmount = r5(totalSales - totalDiscount)
  const taxTotal = r5(invoiceLines.reduce((s, l) => s + (l.taxableItems[0]?.amount || 0), 0))

  return {
    issuer: {
      address: { branchID: str(eta.branchId) || '0', ...addr(eta.address) },
      type: 'B',
      id: str(eta.taxpayerId),
      name: str(company.name),
    },
    receiver: {
      address: addr(customer?.etaAddress || {}),
      type: str(customer?.etaReceiverType) || 'B',
      id: str(customer?.taxId),
      name: str(invoice.customerName) || str(customer?.name),
    },
    documentType: docType,
    documentTypeVersion: str(eta.documentTypeVersion) || '1.0',
    dateTimeIssued: etaTimestamp(invoice),
    taxpayerActivityCode: str(eta.activityCode),
    internalID: str(invoice.number),
    ...(str(invoice.purchaseOrderRef) ? { purchaseOrderReference: str(invoice.purchaseOrderRef) } : {}),
    invoiceLines,
    totalDiscountAmount: totalDiscount,
    totalSalesAmount: totalSales,
    netAmount,
    taxTotals: taxTotal > 0 ? [{ taxType: 'T1', amount: taxTotal }] : [],
    totalAmount: r2(netAmount + taxTotal),
    extraDiscountAmount: r5(invoice.docDiscountAmount || 0),
    totalItemsDiscountAmount: 0,
  }
}

/** The filename an exported document should carry. */
export function etaFilename(invoice) {
  return `ETA-${str(invoice?.number) || 'invoice'}.json`
}
