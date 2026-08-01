// Restoring a backup replaces the whole company and then reloads the page.
// Saves are coalesced behind a short timer, so anything that reloads has to
// flush first — otherwise the reload reads the *old* books back off disk and
// the restore silently restored nothing. This is the regression that shipped
// when write coalescing was introduced; these tests pin the contract.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { hasPendingWrites, flushNow } from '../src/utils/idbKvStorage.js'

const g = () => useStore.getState()

beforeEach(async () => {
  await flushNow()
})

describe('a restore leaves nothing unwritten', () => {
  it('restoreSnapshot has flushed by the time it resolves', async () => {
    g().addCustomer({ name: 'Before Restore' })
    await flushNow()

    const snapshot = g().exportData()
    // Take the books somewhere else, so a failed restore is visible.
    g().addCustomer({ name: 'After Snapshot' })

    // Stand in for the real snapshot store.
    useStore.setState({
      _readBackups: async () => ({ items: [{ id: 'snap-1', at: '2026-01-01', data: snapshot }] }),
    })

    await g().restoreSnapshot('snap-1')

    expect(hasPendingWrites()).toBe(false)
    expect(g().customers.map((c) => c.name)).not.toContain('After Snapshot')
  })

  it('importData on its own queues a write — the flush is what makes it durable', async () => {
    const data = g().exportData()
    g().importData(data)
    // Zustand's persist subscriber runs synchronously on set, so a write is
    // now queued. Reloading here is exactly the bug.
    expect(hasPendingWrites()).toBe(true)
    await flushNow()
    expect(hasPendingWrites()).toBe(false)
  })
})
