// Where the logo actually lives.
//
// It used to sit in the Zustand store as a base64 string, up to 500 KB of it.
// That store is serialised in full on every single write — every invoice line
// typed, every setting toggled — so a large logo made unrelated parts of the
// app slow, and the Settings screen ended up advising people to delete their
// logo when storage ran low. Advising someone to remove their branding to make
// the software work is a bug report, not a setting.
//
// So brand assets live in IndexedDB, keyed by company, and the store keeps only
// a marker saying one exists. They are also scaled down on the way in: a logo
// is displayed at around 64 px tall and printed a little larger, so anything
// beyond a few hundred pixels is bytes nobody sees.

import { currentCompanyKey } from '../boot'
import { targetDimensions } from './itemImages'
import { pickLogoFormat } from './branding'

const DB_NAME = 'erp-brand-assets'
const STORE = 'assets'
const VERSION = 1

/** Generous enough for a crisp printed header, small enough to be free. */
export const LOGO_MAX_EDGE = 480
export const SIGNATURE_MAX_EDGE = 420
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024

export const ASSET_KINDS = ['logo', 'signature']

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const keyFor = (kind) => `${currentCompanyKey()}::${kind}`

export function validateAssetFile(file) {
  const errors = []
  if (!file) return { ok: false, errors: ['Choose a file.'] }
  const type = String(file.type || '').toLowerCase()
  if (!/^image\/(png|jpeg|webp|gif|bmp|svg\+xml)$/.test(type))
    errors.push('That is not an image. Use a PNG, JPEG, WebP or SVG.')
  if ((Number(file.size) || 0) > MAX_SOURCE_BYTES)
    errors.push(`That file is larger than ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`)
  return errors.length ? { ok: false, errors } : { ok: true }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_UNREADABLE')) }
    img.src = url
  })
}

/** Does this drawn image use its alpha channel anywhere? */
function detectAlpha(canvas, ctx) {
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // Step through pixels rather than every byte; a logo's transparency is
    // never a single stray pixel, so sampling is enough and far cheaper.
    for (let i = 3; i < data.length; i += 4 * 7) {
      if (data[i] < 250) return true
    }
    return false
  } catch {
    // A tainted canvas cannot be read. Assume transparency and keep PNG —
    // the safe direction, since the cost is bytes rather than a broken mark.
    return true
  }
}

/**
 * Store a logo or signature, scaled down, keeping transparency where it exists.
 * Returns metadata (not the image itself).
 */
export async function saveBrandAsset(kind, file) {
  if (!ASSET_KINDS.includes(kind)) throw new Error('ASSET_KIND_UNKNOWN')
  const check = validateAssetFile(file)
  if (!check.ok) throw new Error(`ASSET_INVALID:${check.errors.join(' ')}`)

  // An SVG is already resolution-independent and usually tiny; redrawing it
  // through a canvas would rasterise it and make it worse.
  if (String(file.type).toLowerCase() === 'image/svg+xml') {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    return persist(kind, { dataUrl, width: 0, height: 0, mime: 'image/svg+xml', name: file.name })
  }

  const img = await loadImage(file)
  const maxEdge = kind === 'logo' ? LOGO_MAX_EDGE : SIGNATURE_MAX_EDGE
  const { width, height } = targetDimensions(img.naturalWidth, img.naturalHeight, maxEdge)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)

  const hasAlpha = detectAlpha(canvas, ctx)
  const { mime, quality } = pickLogoFormat(file.type, hasAlpha)
  const dataUrl = canvas.toDataURL(mime, quality)

  return persist(kind, { dataUrl, width, height, mime, name: file.name, hasAlpha })
}

async function persist(kind, record) {
  const row = { id: keyFor(kind), kind, savedAt: new Date().toISOString(), ...record }
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(row)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const { dataUrl, ...meta } = row
  return meta
}

export async function getBrandAsset(kind) {
  try {
    const db = await openDB()
    const row = await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(keyFor(kind))
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
    db.close()
    return row
  } catch {
    // Never let a storage problem stop a document rendering — it just renders
    // without the mark.
    return null
  }
}

export async function deleteBrandAsset(kind) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(keyFor(kind))
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/**
 * Move a logo that an older version stored inside the settings object into
 * IndexedDB. Returns true when something was moved, so the caller can clear
 * the old field.
 */
export async function migrateLegacyLogo(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false
  const existing = await getBrandAsset('logo')
  if (existing) return false
  const mime = (/^data:([^;]+)/.exec(dataUrl) || [])[1] || 'image/png'
  await persist('logo', { dataUrl, width: 0, height: 0, mime, name: 'logo', migrated: true })
  return true
}
