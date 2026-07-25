// Country/region tax presets. One click fills in the tax name, rate, and the
// underlying tax *system* — the accounting engine treats VAT/GST-style taxes
// (recoverable input tax, output tax liability) differently from sales-tax
// style taxes (collected on final sale only, not recoverable on purchases).
//
// This list is a starting point, not a legal reference — always confirm the
// current statutory rate with a local advisor before filing.

export const TAX_SYSTEMS = {
  vat: { id: 'vat', label: 'VAT / GST (input tax recoverable)' },
  sales_tax: { id: 'sales_tax', label: 'Sales tax (collected on final sale only)' },
  none: { id: 'none', label: 'No tax' },
}

export const TAX_REGIONS = [
  { id: 'SA', country: 'Saudi Arabia',   taxName: 'VAT', rate: 15,   system: 'vat',       currency: 'SAR', zatca: true },
  { id: 'AE', country: 'UAE',            taxName: 'VAT', rate: 5,    system: 'vat',       currency: 'AED' },
  { id: 'BH', country: 'Bahrain',        taxName: 'VAT', rate: 10,   system: 'vat',       currency: 'BHD' },
  { id: 'EG', country: 'Egypt',          taxName: 'VAT', rate: 14,   system: 'vat',       currency: 'EGP' },
  { id: 'JO', country: 'Jordan',         taxName: 'Sales Tax', rate: 16, system: 'vat',   currency: 'JOD' },
  { id: 'GB', country: 'United Kingdom', taxName: 'VAT', rate: 20,   system: 'vat',       currency: 'GBP' },
  { id: 'IE', country: 'Ireland',        taxName: 'VAT', rate: 23,   system: 'vat',       currency: 'EUR' },
  { id: 'DE', country: 'Germany',        taxName: 'VAT (USt.)', rate: 19, system: 'vat',  currency: 'EUR' },
  { id: 'FR', country: 'France',         taxName: 'VAT (TVA)', rate: 20, system: 'vat',   currency: 'EUR' },
  { id: 'ES', country: 'Spain',          taxName: 'VAT (IVA)', rate: 21, system: 'vat',   currency: 'EUR' },
  { id: 'IN', country: 'India',          taxName: 'GST', rate: 18,   system: 'vat',       currency: 'INR' },
  { id: 'AU', country: 'Australia',      taxName: 'GST', rate: 10,   system: 'vat',       currency: 'AUD' },
  { id: 'SG', country: 'Singapore',      taxName: 'GST', rate: 9,    system: 'vat',       currency: 'USD' },
  { id: 'ZA', country: 'South Africa',   taxName: 'VAT', rate: 15,   system: 'vat',       currency: 'USD' },
  { id: 'CA', country: 'Canada',         taxName: 'GST/HST', rate: 5, system: 'vat',      currency: 'CAD',
    note: 'Federal GST shown — most provinces add PST/HST on top; adjust the rate to your province.' },
  { id: 'US', country: 'United States',  taxName: 'Sales Tax', rate: 0, system: 'sales_tax', currency: 'USD',
    note: 'Sales tax rates are set by state/county/city with no federal rate — enter your local combined rate.' },
  { id: 'XX', country: 'Custom / Other', taxName: 'Tax', rate: 0,    system: 'vat',       currency: '' },
  { id: 'NO', country: 'No tax',         taxName: 'Tax', rate: 0,    system: 'none',      currency: '' },
]

export const findTaxRegion = (id) => TAX_REGIONS.find((r) => r.id === id) || null

/** Build the settings.tax + settings.zatca patch for a chosen region. */
export function taxRegionPatch(id) {
  const r = findTaxRegion(id)
  if (!r) return null
  return {
    tax: { enabled: r.system !== 'none', name: r.taxName, rate: r.rate, system: r.system, country: r.id },
    zatca: r.zatca ? undefined : { enabled: false },
  }
}
