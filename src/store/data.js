// Backup, restore, local snapshots, durability and cloud sync.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { currentCompanyKey } from '../boot'
import { useAuth } from '../auth'
import { idbKvStorage, flushNow } from '../utils/idbKvStorage'
import { ledgerAnchor, matchesAnchor } from '../utils/ledgerChain'
import { isPersisted, storageEstimate, assessDurability } from '../utils/durability'
import { useStore } from '../store'
import { asSystem } from './guard'
import { raiseCounters } from './shared'

// Everything that is the company's books: the backup file, the local
// snapshot and the cloud sync payload are all made of exactly these.
export const DATA_SLICES = [
  'settings', 'accounts', 'bankAccounts', 'customers', 'suppliers', 'inventoryItems',
  'journalEntries', 'invoices', 'quotations', 'creditNotes', 'purchaseOrders', 'purchases',
  'debitNotes', 'departments', 'employees', 'payrollRuns', 'fixedAssets', 'assetDepreciations',
  'stockAdjustments', 'prepaidExpenses', 'leases', 'expenseClaims', 'billsOfMaterials',
  'workOrders', 'bankTransactions', 'projects', 'timeEntries', 'budgets', 'reconciliations',
  'warehouses', 'stockTransfers', 'recurringInvoices', 'leads',
  'deliveryNotes', 'currencies', 'auditLog', 'requisitions',
  'stockMovements', 'bankTransfers', 'scheduledTransfers', 'matchRules', 'fxRevaluations',
  'recurringJournals', 'goodsReceipts', 'landedCosts', 'recurringExpenses',
  'approvalRequests', 'recycleBin', 'accountGroups', 'capitalAccounts', 'capitalSubaccounts',
  'salesOrders', 'purchaseQuotes', 'stockCounts',
  'employmentContracts', 'eosbAccruals', 'attendance', 'cheques', 'customerAdvances', 'employeeAdvances',
]

export const createDataSlice = (set, get) => ({
  // ─── BACKUP / RESTORE ──────────────────────────────────────────
  exportData: () => {
    const s = get()
    const out = { _app: 'erp-accounting-smb', _version: 43, _exportedAt: new Date().toISOString() }
    DATA_SLICES.forEach((k) => { out[k] = s[k] })
    // The AI assistant's API key is a personal secret, not company data.
    // This object is the backup file, the local snapshot and the cloud
    // sync payload, so leaving the key in it handed it to whoever received
    // a backup and to every member of a shared cloud company.
    if (out.settings?.ai?.apiKey) {
      out.settings = { ...out.settings, ai: { ...out.settings.ai, apiKey: '' } }
    }
    // The anchor travels with the file. This is what turns the hash chain
    // from a local self-check into something an outsider can rely on: a
    // backup emailed to an accountant carries a value that fixes the ledger
    // as it stood, and neither party can quietly change it afterwards.
    out._ledgerAnchor = ledgerAnchor(s.journalEntries, out._exportedAt)
    return out
  },

  importData: (data) => {
    if (!data || data._app !== 'erp-accounting-smb') throw new Error('Invalid backup file')
    const { _app, _version, _exportedAt, _ledgerAnchor, ...rest } = data
    // A backup made by an older version skipped every upgrade step since:
    // missing accounts, settings and slices that the app now assumes are
    // there. Run it through the same migration a stored company gets.
    // Only when the file says which version made it: a payload without
    // one (a merged sync result, say) is current data, and re-running
    // every migration on it would, among other things, re-seal the ledger.
    const current = useStore.persist?.getOptions?.().version
    const from = Number(_version)
    const migrate = useStore.persist?.getOptions?.().migrate
    const slices = (migrate && current && Number.isFinite(from) && from > 0 && from < current)
      ? migrate(rest, from) : rest
    set((s) => {
      const next = { ...s, ...slices }
      // A restored backup, a snapshot or another device's settings can carry
      // counters older than the documents now in the books.
      next.settings = raiseCounters(next.settings, next)
      // Backups carry no API key (see exportData); keep the one this
      // device already has rather than wiping it on every restore or sync.
      const localKey = s.settings?.ai?.apiKey
      if (localKey && next.settings && !next.settings.ai?.apiKey) {
        next.settings = { ...next.settings, ai: { ...(next.settings.ai || {}), apiKey: localKey } }
      }
      return next
    })
  },

  /**
   * Check a backup file's ledger against the anchor it was exported with.
   *
   * A file that has been edited between export and import — by accident or
   * otherwise — no longer matches its own anchor, and this is the only
   * place that would ever notice. Returns null for older backups that
   * predate the anchor, because absence of an anchor is not evidence of
   * anything.
   */
  checkBackupAnchor: (data) => {
    const anchor = data?._ledgerAnchor
    if (!anchor?.head) return null
    return matchesAnchor(data.journalEntries || [], anchor)
  },

  // ─── DURABILITY ────────────────────────────────────────────────
  // Whether this business would still have its books tomorrow. See
  // utils/durability.js for why the local snapshots do not count.

  /**
   * Record that a backup file actually left the device.
   *
   * Called from the export handler rather than from `exportData`, because
   * `exportData` is also what the in-browser snapshot is built from — and
   * letting a snapshot reset this clock would be precisely the false
   * reassurance this whole feature exists to remove.
   */
  recordOffDeviceBackup: (kind = 'plain') =>
    set((s) => ({
      settings: {
        ...s.settings,
        durability: { ...(s.settings.durability || {}), lastExportAt: new Date().toISOString(), lastExportKind: kind },
      },
    })),

  /** Everything needed to tell the user how safe their books are. */
  durabilityReport: async () => {
    const s = get()
    const [persisted, estimate] = await Promise.all([isPersisted(), storageEstimate()])
    let cloudLinked = false
    try {
      const auth = useAuth.getState()
      cloudLinked = !!auth.companies.find((c) => c.id === auth.currentCompanyId)?.cloudCompanyId
    } catch { /* auth is not available in unit tests */ }
    const assessment = assessDurability({
      hasData: (s.journalEntries?.length || 0) > 0 || (s.invoices?.length || 0) > 0,
      persisted,
      persistSupported: typeof navigator !== 'undefined' && !!navigator.storage?.persist,
      lastExportAt: s.settings?.durability?.lastExportAt || '',
      cloudLinked,
      lastSyncAt: s.lastSyncAt || '',
      quotaRatio: estimate.ratio,
    })
    return { ...assessment, estimate }
  },

  resetAllData: () => {
    const key = currentCompanyKey()
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key) } catch { /* ignore */ }
    // Data now lives in IndexedDB — clear it there too, then reload once done.
    import('../utils/idbKvStorage')
      .then((m) => m.idbKvStorage.removeItem(key))
      .catch(() => {})
      .finally(() => { if (typeof window !== 'undefined') window.location.reload() })
  },

  // ─── Local snapshots (automatic + on-demand) ───────────────────
  // Rolling in-browser restore points, kept in IndexedDB alongside the live
  // store. These guard against accidental data loss between off-device backups;
  // for true off-device safety the user still downloads (optionally encrypted)
  // backup files. At most 8 snapshots are retained (oldest dropped first).
  _readBackups: async () => {
    try { const raw = await idbKvStorage.getItem(currentCompanyKey() + '::backups'); const s = raw ? JSON.parse(raw) : null; if (s && Array.isArray(s.items)) return s } catch { /* ignore */ }
    return { items: [], lastAutoAt: null }
  },
  // A snapshot is a safety net, so it is written through rather than
  // left in the coalescing queue — the moment a user takes one is exactly
  // the moment they expect it to exist.
  _writeBackups: async (store) => {
    await idbKvStorage.setItem(currentCompanyKey() + '::backups', JSON.stringify(store))
    await flushNow()
  },

  snapshotNow: async (label = 'Manual') => {
    const data = get().exportData()
    const store = await get()._readBackups()
    const entry = { id: uuid(), at: new Date().toISOString(), label, data }
    store.items = [...store.items, entry].slice(-8)
    if (label === 'Auto') store.lastAutoAt = entry.at
    await get()._writeBackups(store)
    return { id: entry.id, at: entry.at, label }
  },

  listSnapshots: async () => {
    const store = await get()._readBackups()
    return store.items
      .map((e) => ({ id: e.id, at: e.at, label: e.label, bytes: JSON.stringify(e.data).length }))
      .sort((a, b) => b.at.localeCompare(a.at))
  },

  restoreSnapshot: async (id) => {
    const store = await get()._readBackups()
    const entry = store.items.find((e) => e.id === id)
    if (!entry) throw new Error('Snapshot not found')
    get().importData(entry.data)
    // Writes are coalesced, so the restored state is still only in memory.
    // Flush it before reloading — a timer here is a race, and losing it
    // would mean a restore that silently restored nothing.
    await flushNow()
    if (typeof window !== 'undefined') window.location.reload()
    return true
  },

  deleteSnapshot: async (id) => {
    const store = await get()._readBackups()
    store.items = store.items.filter((e) => e.id !== id)
    await get()._writeBackups(store)
  },

  // Boot-time: take one automatic snapshot per day (only if there is data).
  runBackupScheduler: async () => {
    try {
      const s = get()
      const hasData = (s.journalEntries?.length || 0) > 0 || (s.invoices?.length || 0) > 0 || (s.customers?.length || 0) > 0
      if (!hasData) return { ran: false }
      const store = await s._readBackups()
      const last = store.lastAutoAt ? new Date(store.lastAutoAt).getTime() : 0
      if (Date.now() - last < 24 * 60 * 60 * 1000) return { ran: false }
      const e = await asSystem(() => s.snapshotNow('Auto'))
      return { ran: true, at: e.at }
    } catch { return { ran: false } }
  },

  // ─── CLOUD SYNC (opt-in) ───────────────────────────────────────
  // Everything here is loaded on demand (dynamic imports) so companies
  // that never opt into cloud sync never pull @supabase/supabase-js —
  // or any of its network calls — into their bundle or runtime at all.
  syncStatus: 'idle', // 'idle' | 'syncing' | 'error'
  lastSyncAt: null,
  lastSyncError: null,

  _readSyncMeta: async () => {
    try {
      const raw = await idbKvStorage.getItem(currentCompanyKey() + '::syncMeta')
      const m = raw ? JSON.parse(raw) : null
      if (m) return m
    } catch { /* ignore */ }
    return { snapshot: null, pulledAt: null }
  },
  _writeSyncMeta: async (meta) => { await idbKvStorage.setItem(currentCompanyKey() + '::syncMeta', JSON.stringify(meta)) },

  syncNow: () => {
    // The boot sync, the two-minute timer, coming back online and the Sync
    // button can all fire together. Two cycles interleaved would each import
    // a merge built from a stale snapshot, so a second call joins the first.
    if (syncInFlight) return syncInFlight
    syncInFlight = (async () => {
      try { return await runSyncCycle(set, get) } finally { syncInFlight = null }
    })()
    return syncInFlight
  },
})

let syncInFlight = null

async function runSyncCycle(set, get) {
  const { useAuth } = await import('../auth')
  const auth = useAuth.getState()
  const company = auth.companies.find((c) => c.id === auth.currentCompanyId)
  if (!company?.cloudCompanyId) return { skipped: true, reason: 'NOT_LINKED' }

  const { getSupabase, isOnline } = await import('../lib/supabase')
  if (!isOnline()) return { skipped: true, reason: 'OFFLINE' }
  const client = getSupabase()
  const { data: sessionData } = await client.auth.getSession()
  if (!sessionData?.session) return { skipped: true, reason: 'NOT_SIGNED_IN' }

  const s = get()
  set({ syncStatus: 'syncing' })
  try {
    const { runSync, reapplyLocalEdits } = await import('../cloudSync')
    const { repairFork } = await import('../utils/ledgerChain')
    const meta = await s._readSyncMeta()
    const localSnapshot = s.exportData()
    const entities = Object.keys(localSnapshot).filter((k) => !k.startsWith('_'))
    const { merged, newPulledAt, pushed, pulled } = await runSync({
      client, companyId: company.cloudCompanyId, userId: sessionData.session.user.id, entities,
      localSnapshot, lastSyncedSnapshot: meta.snapshot, lastPulledAt: meta.pulledAt,
    })
    // Anything entered on this device while the network calls were running.
    const { snapshot: final, edits } = reapplyLocalEdits(merged, localSnapshot, get().exportData(), entities)
    // Two devices that both posted since the last sync leave the ledger's
    // seal forked; join it, unless an entry was altered (see repairFork).
    const fork = repairFork(final.journalEntries)
    if (fork.repaired) final.journalEntries = fork.entries
    asSystem(() => get().importData(final))
    if (fork.repaired) {
      get().logActivity('Ledger re-sealed after sync',
        `${fork.count} entr${fork.count === 1 ? 'y' : 'ies'} from more than one device joined into one chain`, { entity: 'ledger' })
    }
    // The baseline is what the server now holds. Local edits made during the
    // sync (and a re-sealed chain) differ from it, so the next cycle pushes them.
    await get()._writeSyncMeta({ snapshot: merged, pulledAt: newPulledAt })
    const now = new Date().toISOString()
    set({ syncStatus: 'idle', lastSyncAt: now, lastSyncError: null })
    // Invoices customers paid online since the last sync, recorded now and
    // pushed with the next cycle. A failure here never fails the sync.
    let online = null
    try {
      const { onlinePaymentsAfterSync } = await import('../utils/onlinePayments')
      online = await onlinePaymentsAfterSync(get)
    } catch { /* tried again next sync */ }
    return { ok: true, pushed, pulled, keptEdits: edits, resealed: fork.repaired ? fork.count : 0, onlineRecorded: online?.applied || 0 }
  } catch (e) {
    set({ syncStatus: 'error', lastSyncError: e.message })
    return { error: e.message }
  }
}
