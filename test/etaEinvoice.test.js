// The Egyptian e-invoice document, and the check that runs before it.
//
// The validation matters more than the document here. A malformed submission
// comes back from the Authority as a rejection with very little in it, hours
// after the fact; the point of checking first is to say "this customer has no
// tax registration number" while somebody can still go and get one.
import { describe, it, expect } from 'vitest'
import {
  buildEtaInvoice, validateEtaInvoice, etaTimestamp, etaFilename,
  ETA_DOC_TYPES, ETA_DEFAULT_TAX_SUBTYPES,
} from '../src/utils/etaEinvoice.js'

const eta = {
  enabled: true, taxpayerId: '100200300', activityCode: '4620', branchId: '0',
  documentTypeVersion: '1.0', defaultItemCodeType: 'EGS',
  address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: 'Abbas El Akkad', buildingNumber: '12' },
  taxSubTypes: { ...ETA_DEFAULT_TAX_SUBTYPES },
}
const company = { name: 'Nile Trading', currency: 'EGP' }
const customer = { id: 'c1', name: 'Delta Co', taxId: '900800700', etaReceiverType: 'B' }
const items = [{ id: 'i1', name: 'Laptop', code: 'SKU-001', unit: 'EA', etaItemCode: 'EG-123456', etaItemCodeType: 'EGS' }]

const invoice = {
  number: 'INV-0001', date: '2026-08-02', createdAt: '2026-08-02T09:30:00.000Z',
  customerId: 'c1', customerName: 'Delta Co', currency: 'EGP', exchangeRate: 1,
  items: [{
    id: 'L1', itemId: 'i1', description: 'Laptop', unit: 'EA',
    quantity: 2, unitPrice: 1000, discount: 0, taxCategory: 'standard',
    taxRate: 14, subtotal: 2000, taxAmount: 280, total: 2280,
  }],
  subtotal: 2000, taxAmount: 280, total: 2280,
}
const ctx = { eta, company, customer, items }

describe('the document handed to ETA', () => {
  const doc = buildEtaInvoice(invoice, ctx)

  it('identifies who issued it and who it is for', () => {
    expect(doc.issuer.id).toBe('100200300')
    expect(doc.issuer.name).toBe('Nile Trading')
    expect(doc.issuer.address.governate).toBe('Cairo')
    expect(doc.issuer.address.branchID).toBe('0')
    expect(doc.receiver.id).toBe('900800700')
    expect(doc.receiver.type).toBe('B')
    expect(doc.taxpayerActivityCode).toBe('4620')
  })

  it('carries the invoice number and an issue time to the second, in UTC', () => {
    expect(doc.internalID).toBe('INV-0001')
    expect(doc.dateTimeIssued).toBe('2026-08-02T09:30:00Z')
    expect(doc.documentType).toBe(ETA_DOC_TYPES.invoice)
  })

  it('codes every line, because a line without a code is refused', () => {
    const [l] = doc.invoiceLines
    expect(l.itemCode).toBe('EG-123456')
    expect(l.itemType).toBe('EGS')
    expect(l.unitType).toBe('EA')
    expect(l.internalCode).toBe('SKU-001')
  })

  it('adds up the way the Authority reconciles it', () => {
    const [l] = doc.invoiceLines
    expect(l.salesTotal).toBe(2000)
    expect(l.netTotal).toBe(2000)
    expect(l.taxableItems).toEqual([{ taxType: 'T1', amount: 280, subType: 'V009', rate: 14 }])
    expect(doc.totalSalesAmount).toBe(2000)
    expect(doc.netAmount).toBe(2000)
    expect(doc.taxTotals).toEqual([{ taxType: 'T1', amount: 280 }])
    expect(doc.totalAmount).toBe(2280)
  })

  it('reports a line discount separately from the net it produced', () => {
    const d = buildEtaInvoice({
      ...invoice,
      items: [{ ...invoice.items[0], discount: 10, subtotal: 1800, taxAmount: 252, total: 2052 }],
    }, ctx)
    const [l] = d.invoiceLines
    expect(l.salesTotal).toBe(2000)          // before discount
    expect(l.discount).toEqual({ rate: 10, amount: 200 })
    expect(l.netTotal).toBe(1800)
    expect(d.totalDiscountAmount).toBe(200)
    expect(d.netAmount).toBe(1800)
  })

  it('maps zero-rated and exempt supplies to their own sub-type codes', () => {
    const zero = buildEtaInvoice({
      ...invoice,
      items: [{ ...invoice.items[0], taxCategory: 'zero', taxRate: 0, taxAmount: 0, total: 2000 }],
    }, ctx)
    expect(zero.invoiceLines[0].taxableItems).toEqual([])   // nothing to report

    const exempt = buildEtaInvoice({
      ...invoice,
      items: [{ ...invoice.items[0], taxCategory: 'exempt', taxRate: 0, taxAmount: 0.0001 }],
    }, ctx)
    expect(exempt.invoiceLines[0].taxableItems[0].subType).toBe('V002')
  })

  it('honours a sub-type code the taxpayer has corrected for their own profile', () => {
    const d = buildEtaInvoice(invoice, { ...ctx, eta: { ...eta, taxSubTypes: { standard: 'V011' } } })
    expect(d.invoiceLines[0].taxableItems[0].subType).toBe('V011')
  })

  it('reports a foreign-currency sale in EGP as well as what was charged', () => {
    const d = buildEtaInvoice(
      { ...invoice, currency: 'USD', exchangeRate: 48.5 },
      { ...ctx, company: { ...company, currency: 'EGP' } }
    )
    const [l] = d.invoiceLines
    expect(l.unitValue.currencySold).toBe('USD')
    expect(l.unitValue.amountSold).toBe(1000)
    expect(l.unitValue.currencyExchangeRate).toBe(48.5)
    expect(l.unitValue.amountEGP).toBe(48500)
    expect(d.totalSalesAmount).toBe(97000)               // 2 × 1,000 × 48.5
    expect(d.totalAmount).toBe(110580)                   // plus 14% VAT
  })

  it('leaves the exchange fields off an ordinary EGP invoice', () => {
    expect(doc.invoiceLines[0].unitValue).toEqual({ currencySold: 'EGP', amountEGP: 1000 })
  })

  it('names the file after the invoice', () => {
    expect(etaFilename(invoice)).toBe('ETA-INV-0001.json')
    expect(etaFilename(null)).toBe('ETA-invoice.json')
  })
})

describe('what has to be fixed before filing', () => {
  const fieldsOf = (errs) => errs.map((e) => e.field)

  it('passes a complete invoice', () => {
    expect(validateEtaInvoice(invoice, ctx)).toEqual([])
  })

  it('names the missing taxpayer details rather than just failing', () => {
    const errs = validateEtaInvoice(invoice, { ...ctx, eta: { ...eta, taxpayerId: '', activityCode: '' } })
    expect(fieldsOf(errs)).toContain('eta.taxpayerId')
    expect(fieldsOf(errs)).toContain('eta.activityCode')
    expect(errs[0].message).toMatch(/Settings/)
  })

  it('catches an incomplete issuer address, field by field', () => {
    const errs = validateEtaInvoice(invoice, { ...ctx, eta: { ...eta, address: { country: 'EG' } } })
    expect(fieldsOf(errs)).toEqual(expect.arrayContaining([
      'eta.address.governate', 'eta.address.regionCity', 'eta.address.street', 'eta.address.buildingNumber',
    ]))
  })

  it('says which customer is missing a registration number, by name', () => {
    const errs = validateEtaInvoice(invoice, { ...ctx, customer: { ...customer, taxId: '' } })
    const e = errs.find((x) => x.field === 'customer.taxId')
    expect(e.message).toMatch(/Delta Co/)
    expect(e.message).toMatch(/business \(B\)/)
  })

  it('asks an individual for a national ID instead', () => {
    const errs = validateEtaInvoice(invoice, { ...ctx, customer: { ...customer, taxId: '', etaReceiverType: 'P' } })
    expect(errs.find((x) => x.field === 'customer.taxId').message).toMatch(/national ID/)
  })

  it('does not demand a registration number from a foreign customer', () => {
    const errs = validateEtaInvoice(invoice, { ...ctx, customer: { ...customer, taxId: '', etaReceiverType: 'F' } })
    expect(fieldsOf(errs)).not.toContain('customer.taxId')
  })

  it('names the uncoded line, by its description', () => {
    const errs = validateEtaInvoice(
      { ...invoice, items: [{ ...invoice.items[0], description: 'Consultancy', itemId: null }] },
      ctx
    )
    const e = errs.find((x) => x.field === 'invoice.items[0].etaItemCode')
    expect(e.message).toMatch(/"Consultancy"/)
    expect(e.message).toMatch(/EGS or GS1/)
  })

  it('accepts a code put on the line itself when the item carries none', () => {
    const errs = validateEtaInvoice(
      { ...invoice, items: [{ ...invoice.items[0], itemId: null, etaItemCode: 'EG-999', unit: 'EA' }] },
      ctx
    )
    expect(fieldsOf(errs)).not.toContain('invoice.items[0].etaItemCode')
  })

  it('refuses an invoice with no lines at all', () => {
    expect(fieldsOf(validateEtaInvoice({ ...invoice, items: [] }, ctx))).toContain('invoice.items')
  })

  it('does not throw on nothing', () => {
    expect(() => validateEtaInvoice(null, {})).not.toThrow()
    expect(fieldsOf(validateEtaInvoice(null, {}))).toContain('invoice')
  })
})

describe('the issue timestamp', () => {
  it('uses the moment the invoice was raised when there is one', () => {
    expect(etaTimestamp({ createdAt: '2026-08-02T09:30:45.123Z' })).toBe('2026-08-02T09:30:45Z')
  })
  it('falls back to the invoice date at midnight UTC', () => {
    expect(etaTimestamp({ date: '2026-08-02' })).toBe('2026-08-02T00:00:00Z')
  })
})

// The migration that adds these settings runs against whatever is in storage,
// including blobs that carry no settings at all. Reaching into an undefined
// settings object throws, and a throw inside migrate() abandons the whole
// chain — so every earlier version's work is silently skipped too. That is
// what this guards.
describe('the settings migration', () => {
  it('survives a persisted blob with no settings at all', async () => {
    const { useStore } = await import('../src/store.js')
    const migrate = useStore.persist.getOptions().migrate
    expect(() => migrate({ accountGroups: [] }, 31)).not.toThrow()
    const out = migrate({ accountGroups: [] }, 31)
    expect(out.settings.eta.enabled).toBe(false)
    expect(out.settings.eta.taxSubTypes.standard).toBe(ETA_DEFAULT_TAX_SUBTYPES.standard)
  })

  it('leaves settings a taxpayer has already configured alone', async () => {
    const { useStore } = await import('../src/store.js')
    const migrate = useStore.persist.getOptions().migrate
    const mine = { enabled: true, taxpayerId: '999', taxSubTypes: { standard: 'V011' } }
    const out = migrate({ settings: { eta: mine } }, 36)
    expect(out.settings.eta).toBe(mine)
  })
})
