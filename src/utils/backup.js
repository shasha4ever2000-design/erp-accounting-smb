// Backup encryption + envelope helpers. Pure and environment-agnostic: uses the
// Web Crypto API (available in browsers and Node ≥ 18), so it is unit-testable.
//
// A plain backup is the raw exportData() object (starts with _app). An encrypted
// backup wraps that JSON in an AES-256-GCM envelope, with the key derived from the
// user's passphrase via PBKDF2-SHA256. Only the passphrase can recover the data —
// there is no recovery if it is lost, which is the point.

const APP = 'erp-accounting-smb'
const KDF_ITERATIONS = 210000
const subtle = () => {
  const c = globalThis.crypto
  if (!c || !c.subtle) throw new Error('Web Crypto is not available in this environment')
  return c.subtle
}

// Base64 <-> bytes, chunked so large payloads don't overflow the call stack.
function bytesToB64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}
function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(password, salt, iterations) {
  const baseKey = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** True if `obj` is an encrypted backup envelope (vs a plain export). */
export function isEncryptedEnvelope(obj) {
  return !!obj && obj._app === APP && obj._enc === 'AES-GCM' && typeof obj.ct === 'string'
}

/** True if `obj` is a valid plain (unencrypted) export. */
export function isPlainBackup(obj) {
  return !!obj && obj._app === APP && !obj._enc
}

/**
 * Encrypt a backup object with a passphrase.
 * @returns a JSON-serialisable envelope: { _app, _enc, _kdf, _iter, _exportedAt, salt, iv, ct }
 */
export async function encryptBackup(dataObj, password) {
  if (!password) throw new Error('A passphrase is required')
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, KDF_ITERATIONS)
  const plaintext = new TextEncoder().encode(JSON.stringify(dataObj))
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    _app: APP,
    _enc: 'AES-GCM',
    _kdf: 'PBKDF2-SHA256',
    _iter: KDF_ITERATIONS,
    _exportedAt: new Date().toISOString(),
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
  }
}

/**
 * Decrypt an envelope produced by encryptBackup.
 * Throws Error('WRONG_PASSWORD') on a bad passphrase or tampered ciphertext.
 */
export async function decryptBackup(envelope, password) {
  if (!isEncryptedEnvelope(envelope)) throw new Error('Not an encrypted backup')
  const salt = b64ToBytes(envelope.salt)
  const iv = b64ToBytes(envelope.iv)
  const key = await deriveKey(password, salt, envelope._iter || KDF_ITERATIONS)
  let plaintext
  try {
    plaintext = await subtle().decrypt({ name: 'AES-GCM', iv }, key, b64ToBytes(envelope.ct))
  } catch {
    // AES-GCM authentication failed → wrong key (wrong passphrase) or corrupted file.
    throw new Error('WRONG_PASSWORD')
  }
  const obj = JSON.parse(new TextDecoder().decode(plaintext))
  if (!isPlainBackup(obj)) throw new Error('Backup is corrupted')
  return obj
}

/** Parse a backup file's text into { encrypted, envelope|data }. Throws on invalid. */
export function parseBackupText(text) {
  let obj
  try { obj = JSON.parse(text) } catch { throw new Error('This file is not a valid backup') }
  if (isEncryptedEnvelope(obj)) return { encrypted: true, envelope: obj }
  if (isPlainBackup(obj)) return { encrypted: false, data: obj }
  throw new Error('This file is not an ERP Accounting backup')
}
