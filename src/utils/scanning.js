// Turning a scanned code back into a record.
//
// Three kinds of code arrive at this function and they are not equally
// trustworthy:
//
//   1. One of our own labels — `ERP:FA:<id>` or `ERP:IT:<id>`. This is exact.
//      It carries the record's permanent id, so it still resolves after the
//      name and the stock code have both been changed.
//   2. A manufacturer's barcode printed on the packaging. Reliable, but only
//      as reliable as the barcode field somebody typed in.
//   3. A stock code someone typed by hand because the label was unreadable.
//
// They are tried in that order, and the match reports which one it was, so a
// stock count can show "scanned" differently from "typed". A guess that
// silently resolves to the wrong item is worse than no match at all — which is
// why an ambiguous code returns every candidate rather than picking one.

import { parsePayload } from './labels'

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase()

/**
 * Resolve a scanned or typed code.
 *
 * @returns null                                        nothing matched
 *        | { kind, record, matchedBy }                 one match
 *        | { ambiguous: true, candidates: [...] }      several
 */
export function resolveScan(text, { inventoryItems = [], fixedAssets = [] } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return null

  // 1 — our own label
  const payload = parsePayload(raw)
  if (payload) {
    const pool = payload.kind === 'fixedAssets' ? fixedAssets : inventoryItems
    const record = pool.find((r) => r.id === payload.id)
    // A label that parses but points at a deleted record is a real answer:
    // "this tag is stale", not "unknown code".
    return record
      ? { kind: payload.kind, record, matchedBy: 'label' }
      : { kind: payload.kind, record: null, matchedBy: 'label', stale: true }
  }

  const needle = norm(raw)
  const hits = []

  // 2 — barcode
  inventoryItems.forEach((r) => {
    if (norm(r.barcode) && norm(r.barcode) === needle) hits.push({ kind: 'inventoryItems', record: r, matchedBy: 'barcode' })
  })

  // 3 — stock code / asset number
  inventoryItems.forEach((r) => {
    if (norm(r.code) && norm(r.code) === needle && !hits.some((h) => h.record.id === r.id))
      hits.push({ kind: 'inventoryItems', record: r, matchedBy: 'code' })
  })
  fixedAssets.forEach((r) => {
    if ((norm(r.number) && norm(r.number) === needle) || (norm(r.code) && norm(r.code) === needle))
      hits.push({ kind: 'fixedAssets', record: r, matchedBy: 'code' })
  })

  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0]
  return { ambiguous: true, candidates: hits }
}

/**
 * Is a live camera scanner available?
 *
 * `BarcodeDetector` is not in every browser, and a camera needs a secure
 * context. Callers use this to decide whether to offer the camera at all
 * rather than opening one that will never fire.
 */
export function scannerSupport() {
  if (typeof window === 'undefined') return { camera: false, reason: 'no-window' }
  const secure = window.isSecureContext || window.location?.hostname === 'localhost'
  if (!secure) return { camera: false, reason: 'insecure' }
  if (!('BarcodeDetector' in window)) return { camera: false, reason: 'unsupported' }
  if (!navigator.mediaDevices?.getUserMedia) return { camera: false, reason: 'no-camera-api' }
  return { camera: true, reason: '' }
}

/** Formats the reason so the UI can explain itself instead of just hiding. */
export function scannerMessage(reason) {
  switch (reason) {
    case 'insecure':      return 'Camera scanning needs a secure (https) connection.'
    case 'unsupported':   return 'This browser cannot scan with the camera. Chrome or Edge on Android can; Safari cannot yet.'
    case 'no-camera-api': return 'No camera is available on this device.'
    default:              return ''
  }
}

/** Barcode symbologies worth asking for — ours are QR, the rest are packaging. */
export const SCAN_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf']
