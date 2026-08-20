// Tamper-evidence for the ledger.
//
// Every posted journal entry is hashed together with the hash of the entry
// before it, so the ledger forms a chain. Change one figure in a posted entry
// and its hash no longer matches its contents; the break is visible and it
// names the entry.
//
// ── What this does and does not prove ──────────────────────────────────
//
// It is worth being exact, because a chain like this is easy to oversell.
//
// The books live on the user's own machine. Anyone who can edit an entry
// through the developer console can also recompute the chain — nothing here
// stops a determined, knowledgeable local attacker, and no purely local scheme
// can. What it does do:
//
//   • Anything that alters the ledger *without going through this app* is
//     detected. That covers hand-editing IndexedDB, a doctored backup file, a
//     corrupted sync, a bad merge, and a bug in our own code.
//   • Every legitimate edit re-chains and is recorded, so the audit trail and
//     the chain agree about what changed and when.
//   • The head hash is an anchor. Once it has been written somewhere the user
//     does not control — an emailed backup file, a cloud sync row, a figure
//     printed on a signed statement — the ledger up to that point is fixed.
//     Anyone can recompute the chain from the data and compare it to the
//     anchor. That is the property an auditor actually wants, and it is the
//     reason the anchor travels in exports.
//
// So: strong evidence against accident, corruption and casual alteration;
// genuine proof against later alteration once an anchor has left the building.
// It is not a defence against the user rewriting their own history before any
// anchor exists, and it is not presented as one.
//
// ── Why the hash is computed synchronously ─────────────────────────────
//
// `crypto.subtle.digest` is asynchronous. `addJournalEntry` is not, and every
// posting path in the store depends on getting the entry back immediately.
// Making the ledger async to add a hash would be a far larger and riskier
// change than implementing SHA-256 directly, so the digest below is a plain
// synchronous implementation of FIPS 180-4. It is checked against the standard
// test vectors in test/ledgerChain.test.js.

// ── SHA-256 ────────────────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  // Environments without TextEncoder are not expected, but a hash that throws
  // would take the whole posting path down with it.
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00)
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return new Uint8Array(out)
}

/** SHA-256 of a string, as lowercase hex. */
export function sha256Hex(message) {
  const msg = utf8Bytes(message)
  const bitLenHi = Math.floor((msg.length / 0x20000000))
  const bitLenLo = (msg.length << 3) >>> 0
  const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64)
  padded.set(msg)
  padded[msg.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLenHi)
  dv.setUint32(padded.length - 4, bitLenLo)

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }

  let hex = ''
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0')
  return hex
}

// ── Canonical form ─────────────────────────────────────────────────────

/** The chain has to start somewhere. */
export const GENESIS = '0'.repeat(64)

/** Bumping this invalidates every stored hash, so it is versioned explicitly. */
export const CHAIN_VERSION = 'v1'

// Length-prefixed so no value can be crafted to look like a field boundary.
// Without this, a description ending in "|100" could impersonate a line.
const seg = (v) => {
  const s = v == null ? '' : String(v)
  return s.length + ':' + s
}

// Money is normalised before hashing: 100, 100.0, "100.00" and 99.999999999
// are the same amount, and a hash that disagreed would raise false alarms on
// nothing but float noise.
const amt = (v) => {
  const n = Math.round((Number(v) || 0) * 100) / 100
  return (Object.is(n, -0) ? 0 : n).toFixed(2)
}

/**
 * The exact bytes that get hashed for one entry.
 *
 * Deliberately an explicit projection rather than JSON.stringify: object key
 * order is not guaranteed to survive a round-trip through storage or sync, and
 * a hash that depended on it would break for no reason.
 *
 * What is covered: everything that determines what the entry *means* — its
 * identity, date, number, type, narrative, and every line's account, amounts
 * and analytical tags.
 *
 * What is deliberately not covered: fields that are legitimately written after
 * posting. `reversedBy` is stamped on an entry when a later entry reverses it;
 * including it would break the chain every time somebody used a feature working
 * exactly as designed. The reversing entry is itself chained, so the event is
 * still covered — just by its own link rather than by rewriting an old one.
 */
export function canonicalise(je) {
  const lines = (je?.lines || []).map((l) => [
    seg(l?.accountId), amt(l?.debit), amt(l?.credit),
    seg(l?.description), seg(l?.capitalAccountId), seg(l?.departmentId), seg(l?.projectId),
  ].join(','))
  return [
    CHAIN_VERSION,
    seg(je?.id),
    seg(je?.date),
    seg(je?.number),
    seg(je?.type || 'manual'),
    seg(je?.description),
    seg(je?.reverses),
    seg(lines.length),
    ...lines,
  ].join('|')
}

/** The hash an entry should carry, given the hash of the entry before it. */
export function hashEntry(je, prevHash = GENESIS) {
  return sha256Hex(canonicalise(je) + '|' + (prevHash || GENESIS))
}

// ── Chaining and verification ──────────────────────────────────────────

/**
 * Stamp `prevHash` and `hash` onto every entry, in order.
 *
 * Returns new objects — the input is never mutated. Used when sealing an
 * existing ledger for the first time, and when re-sealing from the point an
 * entry was legitimately edited or removed.
 */
export function chainEntries(entries, startPrev = GENESIS) {
  let prev = startPrev
  return (entries || []).map((je) => {
    const hash = hashEntry(je, prev)
    const out = { ...je, prevHash: prev, hash }
    prev = hash
    return out
  })
}

/**
 * Re-seal from `fromIndex` onward, leaving everything before it untouched.
 *
 * Editing a manual entry is a legal operation, so the chain has to be repaired
 * rather than left broken — but only forward of the change. Re-hashing the
 * whole ledger on every edit would be both slow and wrong: it would quietly
 * erase the evidence that anything earlier had been altered.
 */
export function reseal(entries, fromIndex) {
  if (fromIndex <= 0) return chainEntries(entries)
  const head = entries.slice(0, fromIndex)
  const prev = head[head.length - 1]?.hash || GENESIS
  return [...head, ...chainEntries(entries.slice(fromIndex), prev)]
}

/**
 * Walk the chain and report what does not add up.
 *
 * An entry with no `hash` at all is *unsealed*, not broken — that is what
 * entries restored from a backup taken before this feature existed look like,
 * and calling those tampered would be a lie. They are counted and reported
 * separately, and the walk continues through them using the hash they would
 * have had, so an unsealed prefix does not make everything after it look wrong.
 *
 * After a genuine break the walk follows the *recorded* hash rather than the
 * computed one. One altered entry then reports as one break instead of
 * cascading into every entry that follows it, which is what makes the result
 * usable for actually finding the problem.
 */
export function verifyChain(entries) {
  const list = entries || []
  let prev = GENESIS
  let unsealed = 0
  const broken = []

  list.forEach((je, index) => {
    const expected = hashEntry(je, prev)
    if (!je?.hash) {
      unsealed++
      prev = expected
      return
    }
    if (je.hash !== expected) {
      broken.push({
        index,
        id: je.id,
        number: je.number || '',
        date: je.date || '',
        // A prevHash that still matches means the entry's own contents were
        // altered. A prevHash that does not means the entry was moved, or
        // something before it was inserted or removed.
        kind: je.prevHash === prev ? 'contents' : 'position',
        expected,
        found: je.hash,
      })
    }
    prev = je.hash
  })

  return {
    ok: broken.length === 0,
    broken,
    unsealed,
    sealed: list.length - unsealed,
    count: list.length,
    head: prev,
  }
}

/**
 * The anchor: the one value that fixes the whole ledger.
 *
 * Small enough to email, print on a statement, read down a phone, or store in
 * a row somebody else controls. Recomputing the chain and arriving at the same
 * head proves the ledger has not moved since the anchor was taken.
 */
export function ledgerAnchor(entries, at = new Date().toISOString()) {
  const v = verifyChain(entries)
  return { version: CHAIN_VERSION, head: v.head, count: v.count, sealed: v.sealed, at }
}

/** Compare a ledger against an anchor taken earlier. */
export function matchesAnchor(entries, anchor) {
  if (!anchor?.head) return { ok: false, reason: 'NO_ANCHOR' }
  if (anchor.version && anchor.version !== CHAIN_VERSION) return { ok: false, reason: 'VERSION_MISMATCH' }
  const v = verifyChain(entries)
  // Entries posted since the anchor was taken are expected and fine; what the
  // anchor fixes is the ledger as it stood at that count.
  if (v.count < anchor.count) return { ok: false, reason: 'ENTRIES_MISSING', have: v.count, expected: anchor.count }

  const atAnchor = verifyChain(entries.slice(0, anchor.count))
  // Both halves are needed, and the second is the one that is easy to miss.
  //
  // `head` is the *recorded* hash of the last anchored entry, because that is
  // the value that was stored and exported. Comparing only that would leave a
  // gap you could drive a lorry through: altering an entry in the middle of
  // the anchored range does not touch the final entry's recorded hash, so the
  // head still matches while the books underneath have changed. Requiring the
  // range to verify clean is what actually closes it.
  if (!atAnchor.ok) return { ok: false, reason: 'ALTERED', broken: atAnchor.broken }
  if (atAnchor.head !== anchor.head) return { ok: false, reason: 'ALTERED', broken: atAnchor.broken }
  return { ok: true, since: v.count - anchor.count }
}

/** A short, readable form of a hash for display — full hashes are unreadable. */
export const shortHash = (h) => (typeof h === 'string' && h.length >= 12 ? h.slice(0, 12) : h || '')
