import { describe, it, expect } from 'vitest'
import {
  DOC_TYPES, DOC_TYPE_LIST, LAYOUTS, defaultBranding,
  normaliseHex, luminance, contrastOn, tintOf,
  resolveDocBrand, validateBranding, pickLogoFormat,
} from '../src/utils/branding.js'
import { validateAssetFile, ASSET_KINDS, MAX_SOURCE_BYTES } from '../src/utils/brandAssets.js'

describe('normaliseHex', () => {
  it('accepts the forms people actually type', () => {
    expect(normaliseHex('#2563EB')).toBe('#2563eb')
    expect(normaliseHex('2563eb')).toBe('#2563eb')
    expect(normaliseHex('  #2563eb  ')).toBe('#2563eb')
  })
  it('expands shorthand', () => {
    expect(normaliseHex('#25e')).toBe('#2255ee')
  })
  it('falls back rather than emitting something a browser will ignore', () => {
    expect(normaliseHex('rebeccapurple')).toBe('#2563eb')
    expect(normaliseHex('#12345')).toBe('#2563eb')
    expect(normaliseHex('')).toBe('#2563eb')
    expect(normaliseHex(null)).toBe('#2563eb')
  })
  it('honours a caller\'s own fallback', () => {
    expect(normaliseHex('nonsense', '#000000')).toBe('#000000')
  })
})

describe('contrastOn — the accent has to stay readable', () => {
  it('puts dark text on a pale colour', () => {
    // Someone will choose pale yellow, and white on it is invisible.
    expect(contrastOn('#ffe066')).toBe('#111827')
    expect(contrastOn('#ffffff')).toBe('#111827')
  })
  it('puts light text on a dark colour', () => {
    expect(contrastOn('#111827')).toBe('#ffffff')
    expect(contrastOn('#2563eb')).toBe('#ffffff')
  })
  it('handles the extremes without argument', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })
  it('never returns something unreadable for a nonsense colour', () => {
    expect(['#111827', '#ffffff']).toContain(contrastOn('not-a-colour'))
  })
})

describe('tintOf', () => {
  it('produces a translucent version of the accent', () => {
    expect(tintOf('#2563eb')).toBe('rgba(37, 99, 235, 0.12)')
  })
  it('takes an alpha', () => {
    expect(tintOf('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
  })
})

describe('document types', () => {
  it('offers bank details only where someone is meant to pay you', () => {
    expect(DOC_TYPES.invoice.bank).toBe(true)
    expect(DOC_TYPES.statement.bank).toBe(true)
    expect(DOC_TYPES.deliveryNote.bank).toBe(false)
    expect(DOC_TYPES.purchaseOrder.bank).toBe(false)
  })
  it('covers every document a customer or supplier sees', () => {
    ;['invoice', 'quotation', 'salesOrder', 'deliveryNote', 'purchaseOrder', 'statement', 'creditNote']
      .forEach((k) => expect(DOC_TYPE_LIST).toContain(k))
  })
})

describe('resolveDocBrand', () => {
  const branding = {
    ...defaultBranding(),
    accentColor: '#0f766e',
    footer: 'Registered in Riyadh',
    terms: 'Net 30',
    perDoc: {
      quotation: { terms: 'Valid for 30 days', header: 'This is an estimate' },
      invoice: { showBank: false },
      deliveryNote: { footer: 'Goods received in good order' },
    },
  }

  it('falls back to the shared value when a document says nothing', () => {
    expect(resolveDocBrand(branding, 'invoice').terms).toBe('Net 30')
    expect(resolveDocBrand(branding, 'invoice').footer).toBe('Registered in Riyadh')
  })

  it('lets one document override just what differs', () => {
    const q = resolveDocBrand(branding, 'quotation')
    expect(q.terms).toBe('Valid for 30 days')
    expect(q.header).toBe('This is an estimate')
    expect(q.footer).toBe('Registered in Riyadh')      // still shared
  })

  it('carries the readable text colour alongside the accent', () => {
    const r = resolveDocBrand(branding, 'invoice')
    expect(r.accentColor).toBe('#0f766e')
    expect(r.textOnAccent).toBe('#ffffff')
    expect(r.tint).toMatch(/^rgba\(/)
  })

  it('suppresses bank details on a document nobody pays from', () => {
    expect(resolveDocBrand(branding, 'deliveryNote').showBank).toBe(false)
    expect(resolveDocBrand(branding, 'purchaseOrder').showBank).toBe(false)
  })

  it('lets bank details be turned off where they would otherwise show', () => {
    expect(resolveDocBrand(branding, 'invoice').showBank).toBe(false)
    expect(resolveDocBrand(branding, 'statement').showBank).toBe(true)
  })

  it('never puts terms on a document that has no place for them', () => {
    expect(resolveDocBrand(branding, 'deliveryNote').terms).toBe('')
  })

  it('clamps a silly logo height instead of breaking the header', () => {
    expect(resolveDocBrand({ logoHeight: 5000 }, 'invoice').logoHeight).toBe(160)
    expect(resolveDocBrand({ logoHeight: 2 }, 'invoice').logoHeight).toBe(24)
    expect(resolveDocBrand({ logoHeight: 'abc' }, 'invoice').logoHeight).toBe(64)
  })

  it('falls back to a known layout', () => {
    expect(resolveDocBrand({ layout: 'nonsense' }, 'invoice').layout).toBe('classic')
    expect(resolveDocBrand({ layout: 'banded' }, 'invoice').layout).toBe('banded')
  })

  it('works with nothing configured at all', () => {
    const r = resolveDocBrand(null, 'invoice')
    expect(r.accentColor).toBe('#2563eb')
    expect(r.showLogo).toBe(true)
  })

  it('copes with an unknown document type', () => {
    expect(() => resolveDocBrand(branding, 'nonsense')).not.toThrow()
  })
})

describe('validateBranding', () => {
  it('accepts sensible settings', () => {
    expect(validateBranding({ accentColor: '#123456', logoHeight: 80, layout: 'centred' }).ok).toBe(true)
  })
  it('refuses a height that would wreck the header', () => {
    expect(validateBranding({ logoHeight: 400 }).ok).toBe(false)
    expect(validateBranding({ logoHeight: 1 }).ok).toBe(false)
  })
  it('refuses an unknown layout', () => {
    expect(validateBranding({ layout: 'diagonal' }).ok).toBe(false)
  })
  it('accepts an empty patch', () => {
    expect(validateBranding({}).ok).toBe(true)
  })
})

describe('pickLogoFormat — transparency must survive', () => {
  it('keeps PNG when the mark has transparency', () => {
    // Re-encoding as JPEG would put a white rectangle round the logo, which
    // shows on any document that is not pure white.
    expect(pickLogoFormat('image/png', true).mime).toBe('image/png')
    expect(pickLogoFormat('image/webp', true).mime).toBe('image/png')
  })
  it('keeps PNG for a PNG source even when it is opaque', () => {
    expect(pickLogoFormat('image/png', false).mime).toBe('image/png')
  })
  it('uses JPEG for an opaque photograph-style source', () => {
    const r = pickLogoFormat('image/jpeg', false)
    expect(r.mime).toBe('image/jpeg')
    expect(r.quality).toBeGreaterThan(0.8)
  })
  it('never sets a quality for PNG, which is lossless', () => {
    expect(pickLogoFormat('image/png', true).quality).toBeUndefined()
  })
})

describe('validateAssetFile', () => {
  const file = (type, size) => ({ type, size, name: 'logo' })

  it('accepts the formats a logo actually arrives in', () => {
    ;['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].forEach((t) => {
      expect(validateAssetFile(file(t, 1000)).ok, t).toBe(true)
    })
  })
  it('refuses a PDF or a document', () => {
    expect(validateAssetFile(file('application/pdf', 1000)).ok).toBe(false)
  })
  it('refuses something far too large to be a logo', () => {
    expect(validateAssetFile(file('image/png', MAX_SOURCE_BYTES + 1)).ok).toBe(false)
  })
  it('refuses nothing at all', () => {
    expect(validateAssetFile(null).ok).toBe(false)
  })
  it('knows the two kinds of asset it stores', () => {
    expect(ASSET_KINDS).toEqual(['logo', 'signature'])
  })
})
