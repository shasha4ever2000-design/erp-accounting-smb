import { describe, it, expect, beforeEach } from 'vitest'
import { diffSnapshots, pushChanges, pullChanges, applyPulledRows, runSync, isRecordArray, reapplyLocalEdits } from '../src/cloudSync.js'

// A minimal in-memory stand-in for the subset of the supabase-js query
// builder this app uses: .from(t).upsert(rows, {onConflict}) and
// .from(t).select(cols).eq(k,v).gt(k,v).order(k,{ascending}) — the second
// chain is a "thenable" exactly like the real client, so `await` on it
// resolves to { data, error } without a network call.
function makeFakeSupabase({ maxRows = 1000, sameTimestamp = false } = {}) {
  const upserts = []
  const table = new Map() // key: `${company_id}::${entity}::${record_id}` -> row
  let clock = 0
  const nextTimestamp = () => { clock += 1; return `2026-01-01T00:00:${String(clock).padStart(2, '0')}.000Z` }

  const client = {
    from: (name) => {
      if (name !== 'records') throw new Error('unexpected table ' + name)
      return {
        upsert: async (rows) => {
          upserts.push(rows.length)
          // One transaction: with sameTimestamp every row gets the same updated_at, as Postgres now() does.
          const stamp = sameTimestamp ? nextTimestamp() : null
          rows.forEach((r) => {
            const key = `${r.company_id}::${r.entity}::${r.record_id}`
            table.set(key, { ...r, updated_at: stamp || nextTimestamp() }) // server always stamps updated_at
          })
          return { error: null }
        },
        select: () => {
          const state = { companyId: null, gtCol: null, gtVal: null, from: 0, to: null }
          const builder = {
            eq: (col, val) => { if (col === 'company_id') state.companyId = val; return builder },
            gt: (col, val) => { if (col === 'updated_at') { state.gtCol = col; state.gtVal = val }; return builder },
            order: () => builder,
            range: (from, to) => { state.from = from; state.to = to; return builder },
            then: (resolve) => {
              let rows = [...table.values()].filter((r) => r.company_id === state.companyId)
              if (state.gtVal) rows = rows.filter((r) => r.updated_at > state.gtVal)
              rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.record_id.localeCompare(b.record_id))
              // Like PostgREST: never more than maxRows in one response.
              const end = Math.min(state.to == null ? rows.length - 1 : state.to, state.from + maxRows - 1)
              resolve({ data: rows.slice(state.from, end + 1), error: null })
            },
          }
          return builder
        },
      }
    },
  }
  return { client, table, upserts }
}

describe('isRecordArray', () => {
  it('detects arrays of id-carrying objects', () => {
    expect(isRecordArray([{ id: 'a' }, { id: 'b' }])).toBe(true)
    expect(isRecordArray([])).toBe(false)
    expect(isRecordArray(['a', 'b'])).toBe(false)
    expect(isRecordArray({ a: 1 })).toBe(false)
  })
})

describe('diffSnapshots', () => {
  it('finds new, changed and deleted records in a multi-record entity', () => {
    const prev = { invoices: [{ id: '1', total: 100 }, { id: '2', total: 200 }] }
    const next = { invoices: [{ id: '1', total: 150 }, { id: '3', total: 300 }] }
    const changes = diffSnapshots(prev, next, ['invoices'])
    expect(changes.invoices.upserts.map((r) => r.id).sort()).toEqual(['1', '3'])
    expect(changes.invoices.deletes).toEqual(['2'])
    expect(changes.invoices.singleton).toBe(false)
  })

  it('treats a plain object slice (settings) as a singleton', () => {
    const prev = { settings: { company: { name: 'Old' } } }
    const next = { settings: { company: { name: 'New' } } }
    const changes = diffSnapshots(prev, next, ['settings'])
    expect(changes.settings.singleton).toBe(true)
    expect(changes.settings.upserts[0]).toEqual({ id: 'singleton', value: next.settings })
  })

  it('treats an array of primitives (e.g. reconciliations) as a singleton', () => {
    const prev = { reconciliations: ['a::1'] }
    const next = { reconciliations: ['a::1', 'b::2'] }
    const changes = diffSnapshots(prev, next, ['reconciliations'])
    expect(changes.reconciliations.singleton).toBe(true)
    expect(changes.reconciliations.upserts[0].value).toEqual(['a::1', 'b::2'])
  })

  it('reports nothing when unchanged', () => {
    const snap = { customers: [{ id: '1', name: 'A' }] }
    expect(diffSnapshots(snap, snap, ['customers'])).toEqual({})
  })

  it('an empty array with no prior history reports no change, for both record and primitive entities', () => {
    // Regression: an empty array is ambiguous (could be a not-yet-used
    // record entity or an empty primitives singleton) — must not guess and
    // push a spurious singleton row that would later corrupt real records.
    expect(diffSnapshots(null, { customers: [] }, ['customers'])).toEqual({})
    expect(diffSnapshots(null, { reconciliations: [] }, ['reconciliations'])).toEqual({})
  })

  it('clearing a record entity down to empty reports deletes, not a singleton wipe', () => {
    const prev = { customers: [{ id: '1', name: 'A' }] }
    const changes = diffSnapshots(prev, { customers: [] }, ['customers'])
    expect(changes.customers).toEqual({ upserts: [], deletes: ['1'], singleton: false })
  })

  it('clearing a primitives singleton down to empty reports a singleton wipe, not deletes', () => {
    const prev = { reconciliations: ['a::1'] }
    const changes = diffSnapshots(prev, { reconciliations: [] }, ['reconciliations'])
    expect(changes.reconciliations).toEqual({ upserts: [{ id: 'singleton', value: [] }], deletes: [], singleton: true })
  })

  it('handles a first sync (no previous snapshot) by upserting everything', () => {
    const next = { customers: [{ id: '1', name: 'A' }] }
    const changes = diffSnapshots(null, next, ['customers'])
    expect(changes.customers.upserts).toHaveLength(1)
  })
})

describe('push / pull / merge against a fake client', () => {
  let client, table
  beforeEach(() => { ({ client, table } = makeFakeSupabase()) })

  it('pushChanges writes rows the fake table can be pulled back from', async () => {
    const changes = diffSnapshots(null, { customers: [{ id: 'c1', name: 'Acme' }] }, ['customers'])
    await pushChanges(client, 'co-1', 'user-1', changes)
    expect(table.size).toBe(1)
    const rows = await pullChanges(client, 'co-1', null)
    expect(rows).toHaveLength(1)
    expect(rows[0].data).toEqual({ id: 'c1', name: 'Acme' })
  })

  it('a settings singleton round-trips through push and pull with the correct unwrapped shape', async () => {
    const changes = diffSnapshots(null, { settings: { company: { name: 'Acme Co' } } }, ['settings'])
    await pushChanges(client, 'co-1', 'user-1', changes)
    const rows = await pullChanges(client, 'co-1', null)
    expect(rows[0].record_id).toBe('singleton')
    expect(rows[0].data).toEqual({ company: { name: 'Acme Co' } }) // unwrapped, not { value: {...} }
    const merged = applyPulledRows({ settings: {} }, rows)
    expect(merged.settings).toEqual({ company: { name: 'Acme Co' } })
  })

  it('pullChanges only returns rows for the requested company', async () => {
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: [{ id: 'c1', name: 'A' }] }, ['customers']))
    await pushChanges(client, 'co-2', 'u', diffSnapshots(null, { customers: [{ id: 'c2', name: 'B' }] }, ['customers']))
    const rows = await pullChanges(client, 'co-1', null)
    expect(rows).toHaveLength(1)
    expect(rows[0].record_id).toBe('c1')
  })

  it('pullChanges with a cursor only returns rows updated after it', async () => {
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: [{ id: 'c1', name: 'A' }] }, ['customers']))
    const firstPull = await pullChanges(client, 'co-1', null)
    const cursor = firstPull[0].updated_at
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: [{ id: 'c2', name: 'B' }] }, ['customers']))
    const rows = await pullChanges(client, 'co-1', cursor, { overlapMs: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0].record_id).toBe('c2')
  })

  it('applyPulledRows upserts, updates and removes deleted records locally', () => {
    let snap = { customers: [{ id: 'c1', name: 'A' }] }
    snap = applyPulledRows(snap, [
      { entity: 'customers', record_id: 'c1', data: { id: 'c1', name: 'A-renamed' }, deleted: false },
      { entity: 'customers', record_id: 'c2', data: { id: 'c2', name: 'B' }, deleted: false },
    ])
    expect(snap.customers).toEqual([{ id: 'c1', name: 'A-renamed' }, { id: 'c2', name: 'B' }])
    snap = applyPulledRows(snap, [{ entity: 'customers', record_id: 'c1', data: {}, deleted: true }])
    expect(snap.customers).toEqual([{ id: 'c2', name: 'B' }])
  })

  it('applyPulledRows restores a singleton (settings) from a remote pull', () => {
    const snap = { settings: { company: { name: 'Local' } } }
    const next = applyPulledRows(snap, [{ entity: 'settings', record_id: 'singleton', data: { company: { name: 'Remote' } }, deleted: false }])
    expect(next.settings).toEqual({ company: { name: 'Remote' } })
  })
})

describe('runSync — full cycle, two simulated devices', () => {
  it('pushes local changes and pulls changes made by another device', async () => {
    const { client } = makeFakeSupabase()
    const entities = ['customers']

    // Device A creates a customer and syncs.
    const deviceALocal = { customers: [{ id: 'c1', name: 'Acme' }] }
    const a1 = await runSync({ client, companyId: 'co-1', userId: 'userA', entities, localSnapshot: deviceALocal, lastSyncedSnapshot: null, lastPulledAt: null })
    expect(a1.merged.customers).toEqual([{ id: 'c1', name: 'Acme' }])

    // Device B, starting empty, syncs and should receive Acme.
    const b1 = await runSync({ client, companyId: 'co-1', userId: 'userB', entities, localSnapshot: { customers: [] }, lastSyncedSnapshot: null, lastPulledAt: null })
    expect(b1.merged.customers).toEqual([{ id: 'c1', name: 'Acme' }])

    // Device B renames the customer and syncs.
    const b2Local = { customers: [{ id: 'c1', name: 'Acme Renamed by B' }] }
    const b2 = await runSync({ client, companyId: 'co-1', userId: 'userB', entities, localSnapshot: b2Local, lastSyncedSnapshot: b1.merged, lastPulledAt: b1.newPulledAt })
    expect(b2.merged.customers).toEqual([{ id: 'c1', name: 'Acme Renamed by B' }])

    // Device A syncs again (no local edits since a1) and should pick up B's rename.
    const a2 = await runSync({ client, companyId: 'co-1', userId: 'userA', entities, localSnapshot: a1.merged, lastSyncedSnapshot: a1.merged, lastPulledAt: a1.newPulledAt })
    expect(a2.merged.customers).toEqual([{ id: 'c1', name: 'Acme Renamed by B' }])
  })

  it('deletes made on one device propagate to another', async () => {
    const { client } = makeFakeSupabase()
    const entities = ['customers']
    const a1 = await runSync({ client, companyId: 'co-1', userId: 'userA', entities, localSnapshot: { customers: [{ id: 'c1', name: 'X' }] }, lastSyncedSnapshot: null, lastPulledAt: null })
    const b1 = await runSync({ client, companyId: 'co-1', userId: 'userB', entities, localSnapshot: { customers: [] }, lastSyncedSnapshot: null, lastPulledAt: null })
    expect(b1.merged.customers).toHaveLength(1)

    // Device A deletes the customer.
    const a2 = await runSync({ client, companyId: 'co-1', userId: 'userA', entities, localSnapshot: { customers: [] }, lastSyncedSnapshot: a1.merged, lastPulledAt: a1.newPulledAt })
    expect(a2.merged.customers).toEqual([])

    // Device B syncs and should see the deletion too.
    const b2 = await runSync({ client, companyId: 'co-1', userId: 'userB', entities, localSnapshot: b1.merged, lastSyncedSnapshot: b1.merged, lastPulledAt: b1.newPulledAt })
    expect(b2.merged.customers).toEqual([])
  })

  it('a no-op cycle pushes and pulls nothing', async () => {
    const { client } = makeFakeSupabase()
    const snap = { customers: [{ id: 'c1', name: 'X' }] }
    const first = await runSync({ client, companyId: 'co-1', userId: 'u', entities: ['customers'], localSnapshot: snap, lastSyncedSnapshot: null, lastPulledAt: null })
    const second = await runSync({ client, companyId: 'co-1', userId: 'u', entities: ['customers'], localSnapshot: first.merged, lastSyncedSnapshot: first.merged, lastPulledAt: first.newPulledAt })
    expect(second.pushed).toBe(0)
    expect(second.pulled).toBe(0)
  })
})

describe('sync fixes (October 2026 audit)', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, name: `C${i}` }))

  it('pulls every row of a big company, not just the first 1,000', async () => {
    const { client } = makeFakeSupabase({ sameTimestamp: true })
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(2500) }, ['customers']), { chunk: 5000 })
    const rows = await pullChanges(client, 'co-1', null)
    expect(rows).toHaveLength(2500)
  })

  it('a device that synced before a big import still gets all of it on its next pull', async () => {
    const { client } = makeFakeSupabase({ sameTimestamp: true })
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(1) }, ['customers']))
    const cursor = (await pullChanges(client, 'co-1', null)).at(-1).updated_at
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(1800) }, ['customers']), { chunk: 5000 })
    const rows = await pullChanges(client, 'co-1', cursor)
    expect(new Set(rows.map((r) => r.record_id)).size).toBe(1800)
  })

  it('re-reads a short overlap so a row committed just after the cursor is not skipped', async () => {
    const { client, table } = makeFakeSupabase()
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(1) }, ['customers']))
    const cursor = (await pullChanges(client, 'co-1', null)).at(-1).updated_at
    // A write whose transaction started 10s before the cursor but committed after our pull.
    table.set('co-1::customers::late', { company_id: 'co-1', entity: 'customers', record_id: 'late', data: { id: 'late' }, deleted: false,
      updated_at: new Date(new Date(cursor).getTime() - 10_000).toISOString() })
    const rows = await pullChanges(client, 'co-1', cursor)
    expect(rows.map((r) => r.record_id)).toContain('late')
  })

  it('pushes a big change in chunks', async () => {
    const { client, upserts } = makeFakeSupabase()
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(1200) }, ['customers']))
    expect(upserts).toEqual([500, 500, 200])
  })

  it('the pull cursor never moves backwards', async () => {
    const { client } = makeFakeSupabase()
    await pushChanges(client, 'co-1', 'u', diffSnapshots(null, { customers: many(2) }, ['customers']))
    const first = await runSync({ client, companyId: 'co-1', userId: 'u', entities: ['customers'], localSnapshot: { customers: many(2) }, lastSyncedSnapshot: { customers: many(2) }, lastPulledAt: null })
    const second = await runSync({ client, companyId: 'co-1', userId: 'u', entities: ['customers'], localSnapshot: first.merged, lastSyncedSnapshot: first.merged, lastPulledAt: first.newPulledAt })
    expect(second.newPulledAt >= first.newPulledAt).toBe(true)
  })

  it('keeps what was typed on this device while a sync was running', () => {
    const before = { customers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: { x: 1 } }
    const merged = { customers: [{ id: 'a', name: 'A (from other device)' }, { id: 'b', name: 'B' }, { id: 'r', name: 'Remote' }], settings: { x: 1 } }
    const after = { customers: [{ id: 'a', name: 'A' }, { id: 'n', name: 'New during sync' }], settings: { x: 2 } } // b deleted, n added, settings edited
    const { snapshot, edits } = reapplyLocalEdits(merged, before, after, ['customers', 'settings'])
    expect(edits).toBe(3)
    expect(snapshot.customers.map((c) => c.id).sort()).toEqual(['a', 'n', 'r'])
    expect(snapshot.customers.find((c) => c.id === 'a').name).toBe('A (from other device)')
    expect(snapshot.settings).toEqual({ x: 2 })
  })
})
