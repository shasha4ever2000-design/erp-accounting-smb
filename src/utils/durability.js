// How likely is this business to still have its books tomorrow?
//
// The books live in the browser's IndexedDB. That is fast, private and works
// offline, and it has one property nobody tells the user about: the browser is
// allowed to throw it away. Under storage pressure a "best-effort" origin is
// evicted without warning and without asking. Clearing site data does the same
// thing deliberately, and so does a profile reset, an uninstall, or a well-meant
// "clean up browser storage" from an IT helper.
//
// The daily automatic snapshot does not help with any of that. It is written to
// the *same* IndexedDB as the ledger (see store.js `_writeBackups`), so it is
// destroyed by exactly the same events that destroy the books. It protects
// against a bad import or a mistaken bulk edit — a genuine use — and against
// nothing else. Treating it as a backup is the most dangerous misunderstanding
// available in this application, so nothing in this module ever counts it as
// protection.
//
// Only two things here actually survive the device:
//   • a backup file the user downloaded and keeps somewhere else, and
//   • cloud sync, when the company has opted in.
//
// Everything below exists to establish which of those the user has, ask the
// browser for the strongest durability it will grant, and say so plainly.

export const AT_RISK = 'at-risk'
export const FRAGILE = 'fragile'
export const PROTECTED = 'protected'

/** How stale an off-device copy may get before we start saying so. */
export const STALE_AFTER_DAYS = 7
/** Beyond this an export is old enough that losing the device really costs. */
export const VERY_STALE_AFTER_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Ask the browser to stop treating this origin as disposable.
 *
 * `navigator.storage.persist()` moves the origin from "best-effort" to
 * "persistent", which means the browser will not evict it to reclaim space.
 * Browsers decide this differently — Firefox prompts, Chrome grants silently
 * based on engagement signals (installed as an app, bookmarked, frequently
 * visited) and may simply say no. A refusal is not an error and must not be
 * treated as one; it is a fact to report.
 *
 * Safe to call on every boot: `persisted()` is checked first, so an origin that
 * already has the grant never re-asks.
 *
 * @returns {Promise<{supported: boolean, persisted: boolean, alreadyGranted: boolean}>}
 */
export async function requestPersistence(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const storage = nav?.storage
  if (!storage || typeof storage.persist !== 'function' || typeof storage.persisted !== 'function') {
    return { supported: false, persisted: false, alreadyGranted: false }
  }
  try {
    if (await storage.persisted()) return { supported: true, persisted: true, alreadyGranted: true }
    const granted = await storage.persist()
    return { supported: true, persisted: !!granted, alreadyGranted: false }
  } catch {
    // A throwing storage manager tells us nothing about durability either way;
    // report it as unsupported rather than as a denial.
    return { supported: false, persisted: false, alreadyGranted: false }
  }
}

/** Current persistence state without asking for it. */
export async function isPersisted(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const storage = nav?.storage
  if (!storage || typeof storage.persisted !== 'function') return false
  try { return !!(await storage.persisted()) } catch { return false }
}

/**
 * How much room the origin is using and how much it is allowed.
 *
 * `quota` is the browser's allowance for this origin, not the free space on the
 * disk, and it shrinks as the disk fills. A high ratio is the condition under
 * which a best-effort origin gets evicted, so it is worth showing.
 */
export async function storageEstimate(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const storage = nav?.storage
  if (!storage || typeof storage.estimate !== 'function') {
    return { supported: false, usage: 0, quota: 0, ratio: 0 }
  }
  try {
    const { usage = 0, quota = 0 } = await storage.estimate()
    return { supported: true, usage, quota, ratio: quota > 0 ? usage / quota : 0 }
  } catch {
    return { supported: false, usage: 0, quota: 0, ratio: 0 }
  }
}

/** Whole days between an ISO timestamp and now; null when there is no timestamp. */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((now - t) / MS_PER_DAY)
}

/**
 * Judge how safe the books are, and say why.
 *
 * The verdict turns on one question only: **does a copy of this data exist
 * somewhere that a browser cannot delete?** Persistence and storage headroom
 * change how likely local loss is, but they can never substitute for that copy,
 * so they never lift the verdict above FRAGILE on their own.
 *
 * @param {object} o
 * @param {boolean} o.hasData        false for an empty company — nothing to lose yet
 * @param {boolean} o.persisted      navigator.storage.persisted()
 * @param {boolean} o.persistSupported
 * @param {string}  o.lastExportAt   ISO time a backup file was last downloaded
 * @param {boolean} o.cloudLinked    company opted into cloud sync
 * @param {string}  o.lastSyncAt     ISO time cloud sync last succeeded
 * @param {number}  o.quotaRatio     usage / quota, 0 when unknown
 * @param {number}  o.now
 */
export function assessDurability({
  hasData = true,
  persisted = false,
  persistSupported = true,
  lastExportAt = '',
  cloudLinked = false,
  lastSyncAt = '',
  quotaRatio = 0,
  now = Date.now(),
} = {}) {
  const reasons = []
  const exportAge = daysSince(lastExportAt, now)
  const syncAge = daysSince(lastSyncAt, now)

  // A company with nothing in it cannot lose anything. Nagging here would
  // train the user to dismiss the warning before it ever means something.
  if (!hasData) {
    return { level: PROTECTED, offDevice: false, exportAge, syncAge, reasons: [], empty: true }
  }

  // Cloud sync that has actually run is the only continuously-maintained copy
  // off this device. A link that has never synced is an intention, not a copy.
  const cloudCopy = cloudLinked && syncAge != null
  if (cloudLinked && syncAge == null) reasons.push({ code: 'CLOUD_NEVER_SYNCED', severity: 'warn' })
  if (cloudCopy && syncAge > STALE_AFTER_DAYS) reasons.push({ code: 'CLOUD_STALE', severity: 'warn', days: syncAge })

  const fileCopy = exportAge != null
  // A missing backup file is urgent only when nothing else is keeping a copy.
  // Working cloud sync already satisfies the requirement this whole assessment
  // turns on, and shouting about an export on top of it would be crying wolf —
  // which is how a warning stops being read at all.
  if (!fileCopy) reasons.push({ code: 'NEVER_EXPORTED', severity: cloudCopy ? 'info' : 'danger' })
  else if (exportAge > VERY_STALE_AFTER_DAYS) reasons.push({ code: 'EXPORT_VERY_STALE', severity: cloudCopy ? 'info' : 'danger', days: exportAge })
  else if (exportAge > STALE_AFTER_DAYS) reasons.push({ code: 'EXPORT_STALE', severity: cloudCopy ? 'info' : 'warn', days: exportAge })

  const offDevice = cloudCopy || (fileCopy && exportAge <= VERY_STALE_AFTER_DAYS)

  if (!persisted) {
    reasons.push({
      code: persistSupported ? 'NOT_PERSISTED' : 'PERSIST_UNSUPPORTED',
      severity: offDevice ? 'info' : 'danger',
    })
  }
  if (quotaRatio >= 0.9) reasons.push({ code: 'QUOTA_NEARLY_FULL', severity: 'danger', ratio: quotaRatio })
  else if (quotaRatio >= 0.75) reasons.push({ code: 'QUOTA_HIGH', severity: 'warn', ratio: quotaRatio })

  // The snapshot store is never a mitigation, so it is stated as a caveat
  // whenever it is the only thing the user believes they have.
  if (!offDevice) reasons.push({ code: 'SNAPSHOTS_SHARE_FATE', severity: 'info' })

  let level
  if (!offDevice) level = AT_RISK
  else if (reasons.some((r) => r.severity === 'danger')) level = FRAGILE
  else if (!persisted || reasons.some((r) => r.severity === 'warn')) level = FRAGILE
  else level = PROTECTED

  return { level, offDevice, exportAge, syncAge, persisted, reasons, empty: false }
}

/** Plain-language line for each reason code, keyed for i18n. */
export const REASON_TEXT = {
  NEVER_EXPORTED: 'You have never downloaded a backup file. If this browser loses its data, the books are gone.',
  EXPORT_VERY_STALE: 'Your last backup file is over a month old.',
  EXPORT_STALE: 'Your last backup file is more than a week old.',
  CLOUD_NEVER_SYNCED: 'Cloud sync is linked but has never completed a sync.',
  CLOUD_STALE: 'Cloud sync has not run for over a week.',
  NOT_PERSISTED: 'This browser has not granted persistent storage, so it may delete the data to free space.',
  PERSIST_UNSUPPORTED: 'This browser does not support persistent storage.',
  QUOTA_NEARLY_FULL: 'Browser storage for this app is nearly full.',
  QUOTA_HIGH: 'Browser storage for this app is filling up.',
  SNAPSHOTS_SHARE_FATE: 'Automatic snapshots are stored in this same browser, so they are lost with everything else. They are not a backup.',
}

/** Headline for each level, keyed for i18n. */
export const LEVEL_TEXT = {
  [AT_RISK]: 'Your books exist in only one place',
  [FRAGILE]: 'Your books are backed up, but not as well as they could be',
  [PROTECTED]: 'Your books are safe off this device',
}

/** Human-readable byte size, for the storage estimate readout. */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
