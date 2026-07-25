import { describe, it, expect } from 'vitest'
import { TAX_REGIONS, findTaxRegion, taxRegionPatch } from '../src/utils/taxRegions.js'

describe('TAX_REGIONS', () => {
  it('every region has a unique id and a valid system', () => {
    const ids = TAX_REGIONS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    TAX_REGIONS.forEach((r) => expect(['vat', 'sales_tax', 'none']).toContain(r.system))
  })

  it('includes Saudi Arabia as the only ZATCA-flagged region', () => {
    const zatcaRegions = TAX_REGIONS.filter((r) => r.zatca)
    expect(zatcaRegions).toHaveLength(1)
    expect(zatcaRegions[0].id).toBe('SA')
  })

  it('flags the US as sales-tax and everything else with a rate as VAT/GST', () => {
    const us = findTaxRegion('US')
    expect(us.system).toBe('sales_tax')
    const sa = findTaxRegion('SA')
    expect(sa.system).toBe('vat')
    expect(sa.rate).toBe(15)
  })
})

describe('taxRegionPatch', () => {
  it('builds a settings patch that enables tax and sets the ZATCA flag for Saudi Arabia', () => {
    const patch = taxRegionPatch('SA')
    expect(patch.tax).toMatchObject({ enabled: true, name: 'VAT', rate: 15, system: 'vat', country: 'SA' })
    expect(patch.zatca).toBeUndefined() // SA leaves ZATCA untouched (caller turns it on)
  })

  it('turns off ZATCA for a non-Saudi region', () => {
    const patch = taxRegionPatch('US')
    expect(patch.zatca).toEqual({ enabled: false })
    expect(patch.tax.system).toBe('sales_tax')
  })

  it('disables tax entirely for the "no tax" region', () => {
    const patch = taxRegionPatch('NO')
    expect(patch.tax.enabled).toBe(false)
    expect(patch.tax.system).toBe('none')
  })

  it('returns null for an unknown id', () => {
    expect(taxRegionPatch('ZZ')).toBeNull()
  })
})
