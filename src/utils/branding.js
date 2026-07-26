// Document branding — what your paperwork looks like when it leaves the building.
//
// An invoice is often the only document a customer ever sees from you, so it
// carries more weight than its contents. This module decides what appears on
// each kind of document: the logo, the accent colour, a line under the header,
// terms at the foot, bank details, and a signature block.
//
// Two decisions in here are worth stating.
//
// The accent colour has to stay readable. Someone will choose a pale yellow
// and someone else will choose near-black, and white text on the first is
// invisible while dark text on the second is too. So nothing hard-codes a text
// colour against the brand — `contrastOn` picks it from the colour's own
// luminance.
//
// And every document type falls back to a shared default rather than being
// configured separately from scratch. A company that wants the same footer on
// everything should set it once; a company that wants different payment terms
// on a quotation than on an invoice can override just that one.

export const DOC_TYPES = {
  invoice:      { id: 'invoice',      label: 'Sales invoice',  bank: true,  terms: true },
  quotation:    { id: 'quotation',    label: 'Quotation',      bank: false, terms: true },
  salesOrder:   { id: 'salesOrder',   label: 'Sales order',    bank: false, terms: true },
  deliveryNote: { id: 'deliveryNote', label: 'Delivery note',  bank: false, terms: false },
  purchaseOrder:{ id: 'purchaseOrder',label: 'Purchase order', bank: false, terms: true },
  statement:    { id: 'statement',    label: 'Statement',      bank: true,  terms: false },
  creditNote:   { id: 'creditNote',   label: 'Credit note',    bank: false, terms: false },
}

export const DOC_TYPE_LIST = Object.keys(DOC_TYPES)

export const LAYOUTS = {
  classic: { id: 'classic', label: 'Classic', note: 'Logo left, document title right' },
  centred: { id: 'centred', label: 'Centred', note: 'Logo and company centred above a rule' },
  banded:  { id: 'banded',  label: 'Banded',  note: 'Solid colour band across the top' },
}

export function defaultBranding() {
  return {
    accentColor: '#2563eb',
    layout: 'classic',
    logoHeight: 64,          // px on screen; scales with the page when printed
    showLogo: true,
    showSignature: false,
    signatureLabel: 'Authorised signature',
    footer: '',              // shared, appears on everything
    terms: '',               // shared payment / delivery terms
    perDoc: {},              // { [docType]: { header, terms, footer, showBank } }
  }
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Accepts `2563eb`, `#2563EB`, `#25e`; returns a normalised 6-digit hex. */
export function normaliseHex(value, fallback = '#2563eb') {
  let v = String(value == null ? '' : value).trim()
  if (!v) return fallback
  if (v[0] !== '#') v = `#${v}`
  if (!HEX.test(v)) return fallback
  if (v.length === 4) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return v.toLowerCase()
}

/** Relative luminance, 0 (black) to 1 (white), per WCAG. */
export function luminance(hex) {
  const v = normaliseHex(hex)
  const channel = (h) => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = channel(v.slice(1, 3))
  const g = channel(v.slice(3, 5))
  const b = channel(v.slice(5, 7))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Readable text colour to sit on `hex`.
 *
 * Chosen from luminance rather than fixed, because a user picking pale yellow
 * and a user picking navy both need this to work, and hard-coding white would
 * make the first invisible.
 */
export function contrastOn(hex) {
  return luminance(hex) > 0.45 ? '#111827' : '#ffffff'
}

/** A soft tint of the accent, for table headers and rules. */
export function tintOf(hex, alpha = 0.12) {
  const v = normaliseHex(hex)
  const r = parseInt(v.slice(1, 3), 16)
  const g = parseInt(v.slice(3, 5), 16)
  const b = parseInt(v.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * The branding that applies to one document type.
 *
 * Per-document values override the shared ones; anything left blank falls back
 * so a company only has to configure what actually differs.
 */
export function resolveDocBrand(branding, docType) {
  const base = { ...defaultBranding(), ...(branding || {}) }
  const per = (base.perDoc || {})[docType] || {}
  const cfg = DOC_TYPES[docType] || {}
  const pick = (key, fallback) => {
    const v = per[key]
    return v == null || v === '' ? fallback : v
  }
  return {
    accentColor: normaliseHex(base.accentColor),
    textOnAccent: contrastOn(base.accentColor),
    tint: tintOf(base.accentColor),
    layout: LAYOUTS[base.layout] ? base.layout : 'classic',
    logoHeight: Math.min(160, Math.max(24, Number(base.logoHeight) || 64)),
    showLogo: base.showLogo !== false,
    showSignature: per.showSignature != null ? !!per.showSignature : !!base.showSignature,
    signatureLabel: pick('signatureLabel', base.signatureLabel || 'Authorised signature'),
    header: pick('header', ''),
    terms: cfg.terms === false ? '' : pick('terms', base.terms || ''),
    footer: pick('footer', base.footer || ''),
    // Bank details only make sense where someone is expected to pay you.
    showBank: cfg.bank === true && (per.showBank != null ? !!per.showBank : true),
  }
}

/** Check branding before it is saved. */
export function validateBranding(patch) {
  const errors = []
  if (patch?.accentColor && normaliseHex(patch.accentColor, null) === null)
    errors.push('That is not a valid colour. Use a hex value such as #2563eb.')
  const h = patch?.logoHeight
  if (h != null && h !== '' && (Number.isNaN(Number(h)) || Number(h) < 24 || Number(h) > 160))
    errors.push('Logo height must be between 24 and 160.')
  if (patch?.layout && !LAYOUTS[patch.layout]) errors.push('Unknown layout.')
  return errors.length ? { ok: false, errors } : { ok: true }
}

/**
 * Which image format to keep a logo in.
 *
 * A logo is not a photograph. Re-encoding one as JPEG throws away its
 * transparency — the result is a white rectangle around the mark, which shows
 * on any document that is not pure white, and looks broken on a coloured band.
 * So anything with an alpha channel stays PNG even though PNG is larger.
 */
export function pickLogoFormat(sourceType, hasAlpha) {
  if (hasAlpha) return { mime: 'image/png', quality: undefined }
  if (String(sourceType || '').toLowerCase() === 'image/png') return { mime: 'image/png', quality: undefined }
  return { mime: 'image/jpeg', quality: 0.9 }
}
