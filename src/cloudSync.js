// Cloud sync engine. Pure functions operating on plain snapshot objects
// (the same shape useStore().exportData() produces) — the Supabase client is
// always passed in as a parameter, never imported directly, so this whole
// module is testable against a fake client with no network involved.
//
// Design: snapshot-diff sync, not per-mutation change tracking. Each sync
// cycle diffs the current local snapshot against the snapshot captured after
// the previous successful sync to find what changed, pushes those records,
// then pulls anything newer on the server. This trades a little CPU (a JSON
// diff over the whole company each cycle — fine at SMB record counts) for
// not having to instrument every one of the store's ~150 mutation actions.
//
// Conflict resolution is last-write-wins by the *server's* updated_at
// timestamp (set by a DB trigger — see supabase/migrations/0001_init.sql),
// never a client-supplied one, so clock skew between devices can't cause a
// stale write to incorrectly "win".

/** A slice is a multi-record entity if it's an array of objects each carrying
 * an `id`. Anything else (a plain object like `settings`, or an array of
 * primitives like the `reconciliations` string keys) is synced whole, as one
 * singleton record — simpler and correct; those slices are small and change
 * together anyway. */
export function isRecordArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v) && 'id' in v)
}

// Slices that are legitimately array-of-record but happen to be empty right
// now still need multi-record treatment on the next sync once populated —
// harmless either way since an empty array diffs to "no change" regardless.

/** Diff two snapshots for the given entity list. Returns
 *  { [entity]: { upserts: [...], deletes: [...ids], singleton: bool } } —
 *  only for entities that actually changed. */
export function diffSnapshots(prevSnapshot, nextSnapshot, entities) {
  const prev = prevSnapshot || {}
  const changes = {}
  entities.forEach((entity) => {
    const nextVal = nextSnapshot[entity]
    if (nextVal === undefined) return
    const prevVal = prev[entity]

    if (Array.isArray(nextVal)) {
      const prevIsNonEmptyArr = Array.isArray(prevVal) && prevVal.length > 0
      // Both sides empty (or first-ever sync of an as-yet-unused entity):
      // nothing meaningful to sync either way — and critically, an empty
      // array can't tell us whether this entity is record-shaped or a
      // primitives singleton, so don't guess.
      if (nextVal.length === 0 && !prevIsNonEmptyArr) return

      // Decide shape from whichever side actually has content.
      const recordShaped = nextVal.length > 0 ? isRecordArray(nextVal) : isRecordArray(prevVal)

      if (recordShaped) {
        const prevArr = Array.isArray(prevVal) ? prevVal : []
        const prevMap = new Map(prevArr.map((r) => [String(r.id), r]))
        const nextMap = new Map(nextVal.map((r) => [String(r.id), r]))
        const upserts = []
        nextMap.forEach((rec, id) => {
          const before = prevMap.get(id)
          if (!before || JSON.stringify(before) !== JSON.stringify(rec)) upserts.push(rec)
        })
        const deletes = []
        prevMap.forEach((_rec, id) => { if (!nextMap.has(id)) deletes.push(id) })
        if (upserts.length || deletes.length) changes[entity] = { upserts, deletes, singleton: false }
        return
      }

      // Non-empty array of primitives (e.g. reconciliations), or cleared to [].
      if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
        changes[entity] = { upserts: [{ id: 'singleton', value: nextVal }], deletes: [], singleton: true }
      }
      return
    }

    // Non-array singleton (settings).
    if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
      changes[entity] = { upserts: [{ id: 'singleton', value: nextVal }], deletes: [], singleton: true }
    }
  })
  return changes
}

// Rows per request. A first sync of a busy company is thousands of records;
// one request that size risks the gateway's body limit and a timeout that
// throws the whole batch away.
export const PUSH_CHUNK = 500

/** Push a changes map (from diffSnapshots) to Supabase. */
export async function pushChanges(client, companyId, userId, changes, { chunk = PUSH_CHUNK } = {}) {
  for (const [entity, { upserts, deletes, singleton }] of Object.entries(changes)) {
    const rows = [
      ...upserts.map((rec) => ({
        company_id: companyId, entity, record_id: String(singleton ? 'singleton' : rec.id),
        data: singleton ? rec.value : rec, deleted: false, updated_by: userId,
      })),
      ...deletes.map((id) => ({
        company_id: companyId, entity, record_id: String(id), data: {}, deleted: true, updated_by: userId,
      })),
    ]
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await client.from('records').upsert(rows.slice(i, i + chunk), { onConflict: 'company_id,entity,record_id' })
      if (error) throw new Error(`SYNC_PUSH_FAILED:${entity}:${error.message || error}`)
    }
  }
}

// The server returns at most this many rows per request (Supabase's default
// max-rows is 1000), so a pull pages until a short page comes back.
export const PULL_PAGE = 1000

// How far back each pull reaches past the last cursor. updated_at is the time
// the writing transaction *started*: a write that began just before our last
// pull but committed just after it carries an earlier timestamp than the
// cursor, and a strict "newer than" would skip it for ever. Re-reading a
// minute of rows is harmless — the server holds only the latest version of
// each record, and applying it twice changes nothing.
export const PULL_OVERLAP_MS = 60_000

const minus = (iso, ms) => new Date(new Date(iso).getTime() - ms).toISOString()

/** Pull every record updated after `sinceIso` (or everything, if this is the first sync). */
export async function pullChanges(client, companyId, sinceIso, { pageSize = PULL_PAGE, overlapMs = PULL_OVERLAP_MS } = {}) {
  const since = sinceIso ? minus(sinceIso, overlapMs) : '1970-01-01T00:00:00Z'
  const all = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('records')
      .select('entity, record_id, data, deleted, updated_at')
      .eq('company_id', companyId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true }) // stable paging when timestamps tie
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`SYNC_PULL_FAILED:${error.message || error}`)
    all.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return all
}

/** Merge pulled rows into a local snapshot. Remote always wins for the rows
 * it includes (we've already pushed our own newer edits before pulling, so
 * a remote row present here is either our own echo — a harmless no-op
 * overwrite — or a genuinely newer edit from elsewhere). */
export function applyPulledRows(snapshot, rows) {
  const next = { ...snapshot }
  rows.forEach((row) => {
    const { entity, record_id: recordId, data, deleted } = row
    const cur = next[entity]
    if (recordId === 'singleton') {
      // pushChanges stores a singleton's value unwrapped (see below) — read it back the same way.
      next[entity] = deleted ? (Array.isArray(cur) ? [] : {}) : data
      return
    }
    const arr = Array.isArray(cur) ? cur.slice() : []
    const idx = arr.findIndex((r) => String(r.id) === recordId)
    if (deleted) {
      if (idx >= 0) arr.splice(idx, 1)
    } else if (idx >= 0) {
      arr[idx] = data
    } else {
      arr.push(data)
    }
    next[entity] = arr
  })
  return next
}

/** One full sync cycle: diff → push → pull → merge. Returns the merged
 * snapshot (to import back into the local store) and the new sync cursor. */
export async function runSync({ client, companyId, userId, entities, localSnapshot, lastSyncedSnapshot, lastPulledAt }) {
  const changes = diffSnapshots(lastSyncedSnapshot, localSnapshot, entities)
  if (Object.keys(changes).length) await pushChanges(client, companyId, userId, changes)

  const rows = await pullChanges(client, companyId, lastPulledAt)
  const merged = applyPulledRows(localSnapshot, rows)
  // The cursor only moves forward: an overlap pull of nothing but old rows
  // must not drag it back.
  const latest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), lastPulledAt || '')
  const newPulledAt = latest || new Date().toISOString()

  // Count only rows that changed something here: the overlap window re-reads
  // rows this device already has, and those are not news.
  const pulled = rows.filter((r) => {
    const cur = localSnapshot[r.entity]
    if (r.record_id === 'singleton') return JSON.stringify(cur) !== JSON.stringify(r.deleted ? (Array.isArray(cur) ? [] : {}) : r.data)
    const mine = Array.isArray(cur) ? cur.find((x) => String(x.id) === r.record_id) : undefined
    return r.deleted ? !!mine : JSON.stringify(mine) !== JSON.stringify(r.data)
  }).length
  return { merged, newPulledAt, pushed: Object.keys(changes).length, pulled }
}

/**
 * Put back what the user changed on this device while a sync was in flight.
 *
 * A sync takes a snapshot, then spends seconds on the network. Anything typed
 * in that time is in the live store but not in the snapshot, and importing
 * the merged result would overwrite it without a trace — and because the
 * merged result also becomes the "last synced" baseline, the next sync would
 * never notice it had gone. So: diff the snapshot against the store as it is
 * now, and lay those edits over the merged result. They are pushed on the
 * next cycle like any other local change.
 */
export function reapplyLocalEdits(merged, before, after, entities) {
  const changes = diffSnapshots(before, after, entities)
  const rows = []
  for (const [entity, { upserts, deletes, singleton }] of Object.entries(changes)) {
    upserts.forEach((rec) => rows.push({ entity, record_id: singleton ? 'singleton' : String(rec.id), data: singleton ? rec.value : rec, deleted: false }))
    deletes.forEach((id) => rows.push({ entity, record_id: String(id), data: {}, deleted: true }))
  }
  return { snapshot: rows.length ? applyPulledRows(merged, rows) : merged, edits: rows.length }
}
