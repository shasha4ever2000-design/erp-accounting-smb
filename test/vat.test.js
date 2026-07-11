import { describe, it, expect } from 'vitest'
import { vatCatRate, lineVatCategory, vatBreakdown, VAT_CATEGORIES } from '../src/utils/vat.js'

describe('VAT tax categories', () => {
  it('derives the rate from the category', () => {
    expect(vatCatRate('standard', 15)).toBe(15)
    expect(vatCatRate('standard', 5)).toBe(5)
    expect(vatCatRate('zero', 15)).toBe(0)
    expect(vatCatRate('exempt', 15)).toBe(0)
  })

  it('classifies lines, with a legacy fallback', () => {
    expect(lineVatCategory({ taxCategory: 'exempt' })).toBe('exempt')
    expect(lineVatCategory({ taxCategory: 'zero' })).toBe('zero')
    // legacy rows saved before categories existed: taxed ⇒ standard, else zero
    expect(lineVatCategory({ taxRate: 15, taxAmount: 15 })).toBe('standard')
    expect(lineVatCategory({ taxRate: 0, taxAmount: 0 })).toBe('zero')
  })

  it('breaks a set of documents down by category', () => {
    const docs = [
      { items: [{ taxCategory: 'standard', subtotal: 100 }, { taxCategory: 'zero', subtotal: 50 }, { taxCategory: 'exempt', subtotal: 30 }] },
      { items: [{ taxCategory: 'standard', subtotal: 200 }] },
      { subtotal: 80, taxAmount: 12 }, // legacy, no items, taxed → standard
      { subtotal: 40, taxAmount: 0 },  // legacy, no items, untaxed → zero
    ]
    const b = vatBreakdown(docs)
    expect(b.standard).toBe(380)
    expect(b.zero).toBe(90)
    expect(b.exempt).toBe(30)
  })

  it('exposes exactly the three ZATCA categories', () => {
    expect(VAT_CATEGORIES.map((c) => c.id)).toEqual(['standard', 'zero', 'exempt'])
  })
})
