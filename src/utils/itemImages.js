// Photographs of inventory items.
//
// The whole point of a picture here is recognition: a storekeeper looking at a
// pick list wants to know that "BRG-6204" is the small sealed bearing, not the
// big one. That job is done by a thumbnail, and it is done just as well by a
// 40 KB image as a 4 MB one.
//
// Which matters more than it sounds, because this app keeps everything in the
// browser. A phone camera produces 3–5 MB per photo; a company photographing
// eight hundred items would be trying to hold three gigabytes in IndexedDB,
// and would hit the browser's quota long before that. So nothing is ever
// stored as it arrived: every upload is drawn through a canvas, scaled down to
// a sane maximum edge, and re-encoded as JPEG. A separate, much smaller
// thumbnail is stored alongside, so a list of two hundred items renders from
// two hundred small images rather than two hundred full-size ones.
//
// Images live in IndexedDB rather than the Zustand store because the store is
// serialised whole on every write — a few megabytes of base64 in there would
// make every keystroke in an unrelated form slow.

import { currentCompanyKey } from '../boot'

const DB_NAME = 'erp-item-images'
const STORE = 'images'
const VERSION = 1

/** Longest edge kept for the full image. Beyond this adds bytes, not clarity. */
export const MAX_EDGE = 1024
/** Longest edge for the list thumbnail. */
export const THUMB_EDGE = 160
export const JPEG_QUALITY = 0.82
export const THUMB_QUALITY = 0.7

/** Refused before any work is done, so a mistake fails fast and legibly. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']
/** Ceiling on what we will even try to decode. Applies to the *original*. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `img-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Scaled dimensions that fit inside `maxEdge`, preserving aspect ratio.
 *
 * Never scales up: a 90×60 logo stays 90×60 rather than being blown up to
 * 1024 and gaining nothing but bytes.
 */
export function targetDimensions(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(0, Math.round(Number(width) || 0))
  const h = Math.max(0, Math.round(Number(height) || 0))
  if (!w || !h) return { width: 0, height: 0 }
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { width: w, height: h }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

/** Check a file before trying to decode it. */
export function validateImageFile(file) {
  const errors = []
  if (!file) return { ok: false, errors: ['Choose a file.'] }
  const type = String(file.type || '').toLowerCase()
  if (!ACCEPTED_TYPES.includes(type))
    errors.push('That is not an image. Use a JPEG, PNG, WebP, GIF or BMP.')
  if ((Number(file.size) || 0) > MAX_SOURCE_BYTES)
    errors.push(`That image is larger than ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`)
  return errors.length ? { ok: false, errors } : { ok: true }
}

/** Roughly how many bytes a base64 data URL occupies once stored. */
export function dataUrlBytes(dataUrl) {
  const s = String(dataUrl || '')
  const comma = s.indexOf(',')
  if (comma < 0) return 0
  const b64 = s.slice(comma + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// ─── IndexedDB ───────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('item', 'item', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const itemKey = (itemId) => `${currentCompanyKey()}::${itemId}`

/**
 * Draw a file through a canvas at a reduced size and return a JPEG data URL.
 * Browser-only; the dimension maths it relies on is pure and tested separately.
 */
function drawScaled(imgSource, maxEdge, quality) {
  const { width, height } = targetDimensions(imgSource.naturalWidth || imgSource.width, imgSource.naturalHeight || imgSource.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // White ground: a transparent PNG re-encoded as JPEG would otherwise come
  // out with black where the transparency was.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imgSource, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height }
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

/**
 * Resize an uploaded file into a stored image plus its thumbnail.
 * Returns the record that was saved (without the full data URL).
 */
export async function addItemImage(itemId, file) {
  const check = validateImageFile(file)
  if (!check.ok) throw new Error(`IMAGE_INVALID:${check.errors.join(' ')}`)

  const img = await loadImage(file)
  const full = drawScaled(img, MAX_EDGE, JPEG_QUALITY)
  const thumb = drawScaled(img, THUMB_EDGE, THUMB_QUALITY)

  const existing = await listItemImages(itemId)
  const record = {
    id: uuid(),
    item: itemKey(itemId),
    itemId,
    name: file.name || 'photo.jpg',
    width: full.width,
    height: full.height,
    bytes: dataUrlBytes(full.dataUrl),
    originalBytes: Number(file.size) || 0,
    // The first picture of an item is its primary one without being asked;
    // an item whose only photo is not its main photo makes no sense.
    primary: existing.length === 0,
    createdAt: new Date().toISOString(),
    dataUrl: full.dataUrl,
    thumbUrl: thumb.dataUrl,
  }

  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const { dataUrl, ...meta } = record
  return meta
}

/** Every image for an item, oldest first, primary flagged. */
export async function listItemImages(itemId) {
  const db = await openDB()
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('item')
    const req = idx.getAll(itemKey(itemId))
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/** Thumbnails for many items at once, as { itemId: thumbUrl }. */
export async function primaryThumbs(itemIds = []) {
  if (!itemIds.length) return {}
  const wanted = new Set(itemIds)
  const db = await openDB()
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  const out = {}
  rows
    .filter((r) => r.item?.startsWith(`${currentCompanyKey()}::`) && wanted.has(r.itemId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .forEach((r) => {
      if (r.primary || !out[r.itemId]) out[r.itemId] = r.thumbUrl
    })
  return out
}

export async function deleteItemImage(imageId) {
  const db = await openDB()
  const row = await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(imageId)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => resolve(null)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(imageId)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  // Deleting the primary would leave an item with photos but no main one, so
  // the oldest survivor is promoted.
  if (row?.primary && row.itemId) {
    const rest = await listItemImages(row.itemId)
    if (rest.length) await setPrimaryImage(rest[0].id)
  }
}

export async function setPrimaryImage(imageId) {
  const db = await openDB()
  const row = await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(imageId)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => resolve(null)
  })
  db.close()
  if (!row) return
  const siblings = await listItemImages(row.itemId)
  const db2 = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db2.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    siblings.forEach((s) => os.put({ ...s, primary: s.id === imageId }))
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db2.close()
}

/** Remove every image for an item — used when the item itself is deleted. */
export async function deleteImagesFor(itemId) {
  const rows = await listItemImages(itemId)
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    rows.forEach((r) => os.delete(r.id))
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Total bytes held, so the user can see what the pictures are costing them. */
export async function imageStorageUsed() {
  const db = await openDB()
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  const mine = rows.filter((r) => r.item?.startsWith(`${currentCompanyKey()}::`))
  return {
    count: mine.length,
    bytes: mine.reduce((s, r) => s + (r.bytes || 0) + dataUrlBytes(r.thumbUrl), 0),
  }
}
