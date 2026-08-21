// One writer per company.
//
// The bug being fixed is invisible by construction: two tabs open on the same
// books, both holding the whole company in memory, both saving it whole. The
// second save wins and the first tab's work is gone with no error anywhere.
//
// So these tests are less about the lock mechanics than about the promises the
// UI makes on top of them: exactly one tab is ever told it may write, a tab
// alone on the books is never nagged, and leadership is actually handed on
// when the holder goes away — including when it goes away without warning,
// which is the case heartbeat schemes get wrong.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  startTabGuard, shouldWarn, supportsLocks, LEADER, FOLLOWER, UNSUPPORTED,
} from '../src/utils/tabGuard.js'

// ── A LockManager standing in for the browser's ────────────────────────
// Faithful on the points that matter: exclusive holding, FIFO queueing,
// release-on-abort, and — the reason the real API was chosen — the holder
// simply vanishing.
function makeLocks() {
  const held = new Map()    // name -> { release }
  const queue = new Map()   // name -> [{ fn, resolve, signal }]

  const grant = (name, entry) => {
    held.set(name, entry)
    let done
    const finished = new Promise((r) => { done = r })
    entry.done = done
    Promise.resolve(entry.fn()).then(() => {
      held.delete(name)
      done()
      const next = (queue.get(name) || []).shift()
      if (next) grant(name, next)
    })
    return finished
  }

  return {
    /** Force-drop a lock as if the tab holding it had crashed. */
    crash(name) {
      const entry = held.get(name)
      if (!entry) return
      held.delete(name)
      entry.abort?.()
      const next = (queue.get(name) || []).shift()
      if (next) grant(name, next)
    },
    isHeld: (name) => held.has(name),
    manager: {
      request(name, opts, fn) {
        const signal = opts?.signal
        const entry = { fn, signal, abort: () => signal?.dispatchEvent?.(new Event('abort')) }
        if (signal?.aborted) return Promise.reject(new Error('AbortError'))
        if (!held.has(name)) return grant(name, entry)
        return new Promise((resolve) => {
          const waiting = queue.get(name) || []
          waiting.push({ ...entry, resolve })
          queue.set(name, waiting)
          // A queued request that is aborted simply leaves the queue.
          signal?.addEventListener?.('abort', () => {
            queue.set(name, (queue.get(name) || []).filter((w) => w !== waiting[waiting.length - 1]))
            resolve()
          })
        })
      },
    },
  }
}

// ── A BroadcastChannel bus shared by the fake tabs ─────────────────────
function makeBus() {
  const peers = new Set()
  return class FakeChannel {
    constructor(name) { this.name = name; this.onmessage = null; this.closed = false; peers.add(this) }
    postMessage(data) {
      // Like the real thing: never echoes back to its own sender.
      peers.forEach((p) => { if (p !== this && p.name === this.name && !p.closed) p.onmessage?.({ data }) })
    }
    close() { this.closed = true; peers.delete(this) }
  }
}

const makeDoc = (visibility = 'visible') => {
  const listeners = {}
  return {
    visibilityState: visibility,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    fire: (t) => (listeners[t] || []).forEach((f) => f()),
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

let locks, Channel
beforeEach(() => { locks = makeLocks(); Channel = makeBus() })

const openTab = (over = {}) => {
  const roles = []
  const doc = over.doc || makeDoc()
  const guard = startTabGuard({
    key: 'erp-co-1',
    nav: { locks: locks.manager },
    Channel,
    doc,
    onRole: (r) => roles.push(r),
    ...over,
  })
  return { guard, roles, doc, role: () => guard.role() }
}

describe('a single tab', () => {
  it('becomes the writer', async () => {
    const a = openTab()
    await settle()
    expect(a.role()).toBe(LEADER)
  })

  it('is never warned about a conflict that does not exist', async () => {
    // The role is briefly FOLLOWER before the lock is granted. Warning during
    // that window would put a scary banner in front of every user on every
    // load, and they would learn to ignore the real one.
    const a = openTab()
    expect(shouldWarn({ role: a.role(), sawOtherTab: false })).toBe(false)
    await settle()
    expect(shouldWarn({ role: a.role(), sawOtherTab: false })).toBe(false)
  })
})

describe('two tabs', () => {
  it('gives exactly one of them the right to write', async () => {
    const a = openTab(); await settle()
    const b = openTab(); await settle()
    expect([a.role(), b.role()].filter((r) => r === LEADER)).toHaveLength(1)
    expect(b.role()).toBe(FOLLOWER)
  })

  it('tells the second tab it is not the writer', async () => {
    const a = openTab(); await settle()
    const b = openTab(); await settle()
    expect(shouldWarn({ role: b.role(), sawOtherTab: b.guard.sawPeer() })).toBe(true)
    expect(shouldWarn({ role: a.role(), sawOtherTab: a.guard.sawPeer() })).toBe(false)
  })

  it('lets a newly opened tab discover a tab that was already there', async () => {
    // The first tab claimed its lock before anyone was listening, so its
    // announcement reached nobody. Without the hello/here handshake the second
    // tab would believe it was alone and stay silent — which is the exact
    // situation this feature exists to prevent.
    const a = openTab(); await settle()
    const b = openTab(); await settle()
    expect(b.guard.sawPeer()).toBe(true)
    expect(a.guard.sawPeer()).toBe(true)
  })

  it('does not warn a third tab that it is merely third', async () => {
    // Being a follower is being a follower; the message is the same whether
    // one other tab is open or four.
    openTab(); await settle()
    const b = openTab(); await settle()
    const c = openTab(); await settle()
    expect(b.role()).toBe(FOLLOWER)
    expect(c.role()).toBe(FOLLOWER)
  })
})

describe('handing leadership on', () => {
  it('promotes a waiting tab when the writer closes cleanly', async () => {
    const a = openTab(); await settle()
    const b = openTab(); await settle()
    expect(b.role()).toBe(FOLLOWER)

    a.guard.stop(); await settle()
    expect(b.role()).toBe(LEADER)
  })

  it('promotes a waiting tab when the writer vanishes without warning', async () => {
    // The whole reason for using Web Locks rather than heartbeats: a tab that
    // is force-quit, crashes, or is discarded under memory pressure never gets
    // to say goodbye. The browser releases its lock regardless.
    const a = openTab(); await settle()
    const b = openTab(); await settle()

    locks.crash('erp-writer:erp-co-1'); await settle()
    expect(b.role()).toBe(LEADER)
    expect(a.role()).toBe(FOLLOWER)
  })

  it('follows the tab the user is actually looking at', async () => {
    // A tab left open in the background must not keep the write lock hostage
    // while the user works in a different window.
    const a = openTab(); await settle()
    const b = openTab(); await settle()
    expect(a.role()).toBe(LEADER)

    a.doc.visibilityState = 'hidden'
    a.doc.fire('visibilitychange'); await settle()

    expect(a.role()).toBe(FOLLOWER)
    expect(b.role()).toBe(LEADER)
  })

  it('asks for the lock back when it returns to the foreground', async () => {
    const a = openTab(); await settle()
    a.doc.visibilityState = 'hidden'; a.doc.fire('visibilitychange'); await settle()
    expect(a.role()).toBe(FOLLOWER)

    a.doc.visibilityState = 'visible'; a.doc.fire('visibilitychange'); await settle()
    expect(a.role()).toBe(LEADER)
  })

  it('does not queue behind its own lock when told it is visible twice', async () => {
    // A second request while already holding would wait forever behind
    // itself, and orphan the controller so nothing could release the first.
    const a = openTab(); await settle()
    a.doc.fire('visibilitychange'); await settle()   // 'visible' again
    a.doc.fire('visibilitychange'); await settle()
    expect(a.role()).toBe(LEADER)

    a.guard.stop(); await settle()
    expect(locks.isHeld('erp-writer:erp-co-1')).toBe(false)
  })

  it('does not grab the lock when it starts life in the background', async () => {
    const hidden = openTab({ doc: makeDoc('hidden') }); await settle()
    expect(hidden.role()).toBe(FOLLOWER)
    expect(locks.isHeld('erp-writer:erp-co-1')).toBe(false)
  })
})

describe('separate companies', () => {
  it('do not compete for the same lock', async () => {
    // Two companies open side by side is normal use, not a conflict.
    const roles = { a: [], b: [] }
    const a = startTabGuard({ key: 'erp-co-1', nav: { locks: locks.manager }, Channel, doc: makeDoc(), onRole: (r) => roles.a.push(r) })
    const b = startTabGuard({ key: 'erp-co-2', nav: { locks: locks.manager }, Channel, doc: makeDoc(), onRole: (r) => roles.b.push(r) })
    await settle()
    expect(a.role()).toBe(LEADER)
    expect(b.role()).toBe(LEADER)
  })
})

describe('browsers without the Locks API', () => {
  it('say so rather than claiming this tab is alone', async () => {
    // A false "you are the only tab here" is worse than an honest "this
    // browser cannot tell", because the user acts on it.
    const g = startTabGuard({ key: 'erp-co-1', nav: {}, Channel, doc: makeDoc(), onRole: () => {} })
    await settle()
    expect(g.role()).toBe(UNSUPPORTED)
  })

  it('do not show a warning that has no action behind it', async () => {
    // Nothing can be done about it and it would appear on every load.
    expect(shouldWarn({ role: UNSUPPORTED, sawOtherTab: true })).toBe(false)
  })

  it('are detected honestly', () => {
    expect(supportsLocks({})).toBe(false)
    expect(supportsLocks(null)).toBe(false)
    expect(supportsLocks({ locks: { request: () => {} } })).toBe(true)
  })
})

describe('robustness', () => {
  it('survives a browser with no BroadcastChannel', async () => {
    const g = startTabGuard({ key: 'erp-co-1', nav: { locks: locks.manager }, Channel: null, doc: makeDoc(), onRole: () => {} })
    await settle()
    expect(g.role()).toBe(LEADER)
    expect(() => g.announce({ type: 'x' })).not.toThrow()
    g.stop()
  })

  it('survives a BroadcastChannel constructor that throws', async () => {
    const Broken = class { constructor() { throw new Error('blocked') } }
    const g = startTabGuard({ key: 'erp-co-1', nav: { locks: locks.manager }, Channel: Broken, doc: makeDoc(), onRole: () => {} })
    await settle()
    expect(g.role()).toBe(LEADER)
    g.stop()
  })

  it('stops cleanly and releases the lock', async () => {
    const a = openTab(); await settle()
    expect(locks.isHeld('erp-writer:erp-co-1')).toBe(true)
    a.guard.stop(); await settle()
    expect(locks.isHeld('erp-writer:erp-co-1')).toBe(false)
  })

  it('reports no further role changes after being stopped', async () => {
    const a = openTab(); await settle()
    const before = a.roles.length
    a.guard.stop(); await settle()
    a.doc.fire('visibilitychange'); await settle()
    expect(a.roles.length).toBe(before)
  })

  it('never announces the same role twice in a row', async () => {
    // The banner is driven off this callback; a repeated role would remount it.
    const a = openTab(); await settle()
    a.doc.visibilityState = 'hidden'; a.doc.fire('visibilitychange'); await settle()
    a.doc.fire('visibilitychange'); await settle()
    for (let i = 1; i < a.roles.length; i++) expect(a.roles[i]).not.toBe(a.roles[i - 1])
  })

  it('passes other tabs’ messages through to the caller', async () => {
    const onMessage = vi.fn()
    openTab(); await settle()
    const b = openTab({ onMessage }); await settle()
    b.guard.announce({ type: 'ping' })
    await settle()
    // b's own message must not come back to b.
    expect(onMessage).not.toHaveBeenCalledWith({ type: 'ping' })
  })
})
