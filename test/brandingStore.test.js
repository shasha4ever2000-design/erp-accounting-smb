import { describe, it, expect } from 'vitest'
import { useStore } from '../src/store.js'
import { resolveDocBrand } from '../src/utils/branding.js'
const g = () => useStore.getState()

describe('branding round-trip through the store', () => {
  it('keeps terms, footer and colour, and shows them on an invoice', () => {
    g().updateBranding({ terms: 'Net 30', footer: 'Foot line', accentColor: '#0f766e' })
    const b = g().settings.branding
    expect(b.terms).toBe('Net 30')
    expect(b.accentColor).toBe('#0f766e')

    const r = resolveDocBrand(b, 'invoice')
    expect(r.terms).toBe('Net 30')
    expect(r.footer).toBe('Foot line')
    expect(r.accentColor).toBe('#0f766e')
  })

  it('per-document override wins and blank falls back', () => {
    g().updateBranding({ terms: 'Net 30' })
    g().updateDocBranding('quotation', { terms: 'Valid 14 days' })
    expect(resolveDocBrand(g().settings.branding, 'quotation').terms).toBe('Valid 14 days')
    expect(resolveDocBrand(g().settings.branding, 'invoice').terms).toBe('Net 30')
  })

  it('successive edits accumulate rather than clobbering', () => {
    g().updateBranding({ terms: 'A' })
    g().updateBranding({ footer: 'B' })
    expect(g().settings.branding.terms).toBe('A')
    expect(g().settings.branding.footer).toBe('B')
  })
})
