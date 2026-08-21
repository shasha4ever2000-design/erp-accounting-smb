// Two tabs, one set of books.
//
// The store persists as a single JSON blob keyed by company. Every tab holds
// the whole company in memory and writes the whole company back on change, so
// two tabs open on the same company overwrite each other: whichever saves last
// wins, and the other tab's work is gone. No error, no warning, no trace — the
// invoice was simply never there. It is the quietest way this application can
// lose a day's work, and until now nothing in it noticed.
//
// ── What this fixes, and what it does not ──────────────────────────────
//
// It does not merge concurrent edits. Doing that properly means per-entity
// conflict resolution — the machinery `cloudSync` already has for the cloud
// case — and retrofitting it onto local storage is a much larger change than
// this one. What this does is make the situation *visible*: exactly one tab is
// the writer at any moment, every other tab knows it is not, and it says so on
// screen instead of silently racing.
//
// ── Why the Web Locks API rather than heartbeats ──────────────────────
//
// The hard part of electing one writer is not the election, it is noticing
// when the winner disappears. A tab that crashes, is force-quit, or is
// discarded by the browser under memory pressure never gets to announce it is
// leaving; `pagehide` is best-effort and `beforeunload` is worse. Heartbeat
// schemes then have to guess a timeout, and every guess is either too slow to
// be usable or fast enough to hand leadership to two tabs at once.
//
// A held Web Lock is released by the browser itself when the tab holding it
// goes away, however it goes away. The next tab queued on that lock acquires
// it automatically. There is no timeout to tune and no split-brain window.
//
// Leadership follows the tab the user is actually looking at: a tab that
// becomes hidden releases the lock so a visible tab can take over, and asks
// for it again when it comes back. Two windows side by side is the one case
// that genuinely has to be resolved by telling the user.

export const LEADER = 'leader'
export const FOLLOWER = 'follower'
/** No coordination available — one writer cannot be guaranteed. */
export const UNSUPPORTED = 'unsupported'

const lockName = (key) => `erp-writer:${key}`
const channelName = (key) => `erp-tabs:${key}`

export const supportsLocks = (nav = typeof navigator !== 'undefined' ? navigator : null) =>
  !!nav?.locks && typeof nav.locks.request === 'function'

/**
 * Elect a single writer tab for one company, and keep the caller informed.
 *
 * @param {object} o
 * @param {string} o.key           the company storage key
 * @param {(role: string) => void} o.onRole   called whenever this tab's role changes
 * @param {() => void} [o.onPeer]   called the first time another tab is seen
 * @param {(msg: object) => void} [o.onMessage] called for broadcasts from other tabs
 * @param {Navigator} [o.nav]
 * @param {typeof BroadcastChannel} [o.Channel]
 * @param {Document} [o.doc]
 * @returns {{ stop: () => void, announce: (msg: object) => void, role: () => string }}
 */
export function startTabGuard({
  key,
  onRole = () => {},
  onPeer = () => {},
  onMessage = () => {},
  nav = typeof navigator !== 'undefined' ? navigator : null,
  Channel = typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null,
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  let role = null
  let stopped = false
  let controller = null
  let channel = null

  const setRole = (next) => {
    if (stopped || next === role) return
    role = next
    onRole(next)
  }

  let sawPeer = false
  const post = (msg) => { try { channel?.postMessage(msg) } catch { /* closed */ } }
  const notePeer = () => {
    if (sawPeer || stopped) return
    sawPeer = true
    onPeer()
  }

  if (Channel) {
    try {
      channel = new Channel(channelName(key))
      // A BroadcastChannel never echoes to its own sender, so anything that
      // arrives here is proof another tab is open on these books.
      channel.onmessage = (e) => {
        if (stopped) return
        const msg = e?.data || {}
        notePeer()
        // A tab that has just opened does not know who else is out there —
        // the leader claimed its lock before anyone was listening. Answering
        // its hello is what makes an existing tab discoverable.
        if (msg.type === 'hello') post({ type: 'here' })
        onMessage(msg)
      }
      post({ type: 'hello' })
    } catch { channel = null }
  }

  // Without the Locks API there is no safe way to elect one writer. Say so
  // rather than pretending: a false "you are the only tab" is worse than an
  // honest "this browser cannot tell".
  if (!supportsLocks(nav)) {
    setRole(UNSUPPORTED)
    return {
      role: () => role,
      sawPeer: () => sawPeer,
      announce: post,
      stop: () => { stopped = true; try { channel?.close() } catch { /* already closed */ } },
    }
  }

  /**
   * Queue for the write lock and hold it until told to let go.
   *
   * The callback never resolves on its own: holding the lock *is* being the
   * leader. It ends only when the AbortController fires (this tab went into
   * the background, or the guard was stopped) or the tab itself goes away, at
   * which point the browser releases it and the next tab in the queue wins.
   */
  const acquire = () => {
    if (stopped) return
    // Already holding, or already queued. Asking again would leave this tab
    // waiting behind its own lock forever, and would orphan the first
    // controller so nothing could ever release it.
    if (controller) return
    controller = new AbortController()
    const signal = controller.signal
    nav.locks
      .request(lockName(key), { mode: 'exclusive', signal }, () => {
        setRole(LEADER)
        post({ type: 'claimed' })
        return new Promise((resolve) => { signal.addEventListener('abort', () => resolve()) })
      })
      .catch(() => {
        // AbortError on release, or the request being dropped. Neither is a
        // failure: it just means this tab is not the writer right now.
      })
      .finally(() => {
        // Note on the abort: per spec a signal only *drops* a request that has
        // not been granted yet — it does not release a lock already held. What
        // releases a held lock here is the callback's promise settling, which
        // the same abort event resolves. Both paths land in this finally.
        if (controller?.signal === signal) controller = null
        if (!stopped && role === LEADER) setRole(FOLLOWER)
      })

    // Until the lock is actually granted this tab is not the writer, and the
    // UI should say so from the first frame rather than after a flicker.
    if (role === null) setRole(FOLLOWER)
  }

  const release = () => {
    try { controller?.abort() } catch { /* nothing held */ }
    controller = null
  }

  // Hand leadership to whichever tab the user is looking at. A tab left open
  // in the background must not keep the write lock hostage.
  const onVisibility = () => {
    if (stopped) return
    if (doc.visibilityState === 'hidden') { release(); setRole(FOLLOWER) }
    else acquire()
  }
  if (doc?.addEventListener) doc.addEventListener('visibilitychange', onVisibility)

  if (!doc || doc.visibilityState !== 'hidden') acquire()
  else setRole(FOLLOWER)

  return {
    role: () => role,
    sawPeer: () => sawPeer,
    announce: post,
    stop: () => {
      stopped = true
      release()
      if (doc?.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility)
      try { channel?.close() } catch { /* already closed */ }
    },
  }
}

/**
 * Should this tab warn the user?
 *
 * A follower is only worth mentioning once another tab has actually shown
 * itself. On a single open tab the role is briefly FOLLOWER before the lock is
 * granted, and warning about a conflict that does not exist would train the
 * user to ignore the one that does.
 */
export function shouldWarn({ role, sawOtherTab }) {
  if (role === UNSUPPORTED) return false
  return role === FOLLOWER && !!sawOtherTab
}

export const WARNING_TEXT =
  'These books are open in another tab or window. Only one can save changes, so work in that one — anything you enter here may be lost.'
