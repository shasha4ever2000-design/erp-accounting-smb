// IndexedDB-backed supporting-document storage.
//
// Files (receipts, contracts, scans...) are kept in IndexedDB rather than the
// Zustand/localStorage store: binary data is large and would blow the ~5 MB
// localStorage quota. Records are scoped to the active company and linked to a
// host record by (entityType, entityId) — e.g. ('invoice', <id>).

import { currentCompanyKey } from '../boot'

const DB_NAME = 'erp-attachments'
const STORE = 'files'
const VERSION = 1

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `att-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('entity', 'entity', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const entityKey = (type, id) => `${currentCompanyKey()}::${type}::${id}`

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Store a File against (entityType, entityId). Returns the saved record (without dataUrl). */
export async function addAttachment(entityType, entityId, file) {
  const dataUrl = await readFileAsDataURL(file)
  const rec = {
    id: uuid(),
    entity: entityKey(entityType, entityId),
    entityType, entityId,
    name: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size || 0,
    dataUrl,
    createdAt: new Date().toISOString(),
  }
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(rec)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const { dataUrl: _omit, ...meta } = rec
  return meta
}

/** List attachments (metadata + dataUrl) for an entity, newest first. */
export async function listAttachments(entityType, entityId) {
  const db = await openDB()
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('entity')
    const req = idx.getAll(entityKey(entityType, entityId))
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

/** Count attachments for an entity (for the badge). */
export async function countAttachments(entityType, entityId) {
  const db = await openDB()
  const n = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('entity')
    const req = idx.count(entityKey(entityType, entityId))
    req.onsuccess = () => resolve(req.result || 0)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return n
}

/** Delete one attachment by id. */
export async function deleteAttachment(id) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** Trigger a browser download of a stored attachment. */
export function downloadAttachment(att) {
  const a = document.createElement('a')
  a.href = att.dataUrl
  a.download = att.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export function formatBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`
}
