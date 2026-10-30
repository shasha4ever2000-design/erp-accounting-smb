import { describe, it, expect, beforeEach, vi } from 'vitest'

// A pretend Supabase shared by the store's sync code. `gate` lets a test hold
// the network open, to type something "during" the sync.
const server = { rows: new Map(), clock: 0, gate: null, reached: null }
const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, server.clock++)).toISOString()
const client = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  from: () => ({
    upsert: async (rows) => {
      if (server.gate) { server.reached?.(); await server.gate }
      rows.forEach((r) => server.rows.set(`${r.entity}::${r.record_id}`, { ...r, updated_at: stamp() }))
      return { error: null }
    },
    select: () => {
      const q = { gt: '', from: 0, to: 999 }
      const b = {
        eq: () => b, order: () => b,
        gt: (_c, v) => { q.gt = v; return b },
        range: (f, t) => { q.from = f; q.to = t; return b },
        then: (resolve) => {
          const all = [...server.rows.values()].filter((r) => r.updated_at > q.gt).sort((a, c) => a.updated_at.localeCompare(c.updated_at))
          resolve({ data: all.slice(q.from, q.to + 1), error: null })
        },
      }
      return b
    },
  }),
}
vi.mock('../src/lib/supabase', () => ({ getSupabase: () => client, isOnline: () => true }))

const { useStore } = await import('../src/store')
const { useAuth } = await import('../src/auth')
const { verifyChain, chainEntries } = await import('../src/utils/ledgerChain')

const initial = useStore.getState()
beforeEach(async () => {
  server.rows.clear(); server.gate = null; server.reached = null
  useStore.setState(initial, true)
  useAuth.setState({ companies: [{ id: 'local', cloudCompanyId: 'co-1' }], currentCompanyId: 'local', users: [], currentUserId: null })
  await useStore.getState()._writeSyncMeta({ snapshot: null, pulledAt: null })
})

const remoteRow = (entity, data) => server.rows.set(`${entity}::${data.id}`, { company_id: 'co-1', entity, record_id: String(data.id), data, deleted: false, updated_at: stamp() })

describe('sync cycle in the store', () => {
  it('keeps a customer added while the sync was on the network, and pushes it next time', async () => {
    let open
    server.gate = new Promise((r) => { open = r })
    const atNetwork = new Promise((r) => { server.reached = r })
    const running = useStore.getState().syncNow()
    await atNetwork // the snapshot is taken; the sync is waiting on the server
    useStore.getState().addCustomer({ name: 'Typed during sync' })
    open()
    const res = await running
    expect(res.ok).toBe(true)
    expect(res.keptEdits).toBeGreaterThan(0)
    expect(useStore.getState().customers.some((c) => c.name === 'Typed during sync')).toBe(true)
    await useStore.getState().syncNow()
    expect([...server.rows.values()].some((r) => r.entity === 'customers' && r.data.name === 'Typed during sync')).toBe(true)
  })

  it('runs one sync at a time', async () => {
    let open
    server.gate = new Promise((r) => { open = r })
    const a = useStore.getState().syncNow()
    const b = useStore.getState().syncNow()
    expect(b).toBe(a)
    open()
    await a
  })

  it('moves the invoice counter past a higher number pulled from another device', async () => {
    remoteRow('invoices', { id: 'r1', number: 'INV-0042', customerId: 'c', status: 'sent', total: 1, items: [] })
    await useStore.getState().syncNow()
    expect(useStore.getState().settings.invoice.next).toBe(43)
  })

  it('joins two devices’ journal entries into one valid chain and records it', async () => {
    const mk = (id, date) => ({ id, date, createdAt: `${date}T00:00:00Z`, number: id, description: id, type: 'manual', lines: [{ accountId: 'acc-cash', debit: 1, credit: 0 }, { accountId: 'acc-capital', debit: 0, credit: 1 }] })
    const mine = chainEntries([mk('local-1', '2026-09-03')])
    useStore.setState({ journalEntries: mine })
    // another device sealed its own entry onto an empty ledger
    remoteRow('journalEntries', chainEntries([mk('remote-1', '2026-09-02')])[0])
    const res = await useStore.getState().syncNow()
    expect(res.resealed).toBe(2)
    const jes = useStore.getState().journalEntries
    expect(jes.map((j) => j.id)).toEqual(['remote-1', 'local-1'])
    expect(verifyChain(jes).ok).toBe(true)
    expect(useStore.getState().auditLog.at(-1).action).toBe('Ledger re-sealed after sync')
  })
})
