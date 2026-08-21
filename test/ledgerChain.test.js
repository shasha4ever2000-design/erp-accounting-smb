// The ledger hash chain.
//
// Two things have to be true for any of this to be worth shipping. The digest
// has to actually be SHA-256 — a hand-rolled hash that is subtly wrong would
// produce a chain that verifies against itself and means nothing to anyone
// else. And a break has to be *found*: an altered entry must be named, and one
// alteration must not cascade into a hundred false alarms that bury it.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  sha256Hex, canonicalise, hashEntry, chainEntries, reseal, verifyChain,
  ledgerAnchor, matchesAnchor, shortHash, GENESIS, CHAIN_VERSION, PREV_TAG_LENGTH, prevTag,
} from '../src/utils/ledgerChain.js'

const je = (n, over = {}) => ({
  id: `je-${n}`, date: '2026-03-01', number: `JE-${n}`, type: 'manual', description: `Entry ${n}`,
  lines: [
    { accountId: 'acc-bank1', debit: 100, credit: 0 },
    { accountId: 'acc-sales', debit: 0, credit: 100 },
  ],
  ...over,
})

const ledger = (n) => chainEntries(Array.from({ length: n }, (_, i) => je(i + 1)))

describe('the digest is really SHA-256', () => {
  // If this drifts, every anchor this app has ever produced becomes
  // unverifiable by anything but this app — which defeats the purpose.
  const vectors = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]
  it.each(vectors)('matches node:crypto for a %s-length input', (input) => {
    expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'))
  })

  it('handles the padding boundaries where naive implementations break', () => {
    // 55/56 and 63/64 straddle the point where the length field forces an
    // extra block. These are where a wrong implementation usually is wrong.
    for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120]) {
      const s = 'x'.repeat(n)
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })

  it('hashes non-Latin text and emoji as UTF-8', () => {
    for (const s of ['مرحبا بالعالم', 'فاتورة رقم ١٢٣', '🧾', 'مزيج mixed 混合']) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
  })

  it('produces 64 hex characters', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('what the hash covers', () => {
  it('changes when an amount changes', () => {
    const a = je(1)
    const b = je(1, { lines: [{ accountId: 'acc-bank1', debit: 1000, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 1000 }] })
    expect(hashEntry(a)).not.toBe(hashEntry(b))
  })

  it('changes when the date, number, type or narrative changes', () => {
    const base = hashEntry(je(1))
    expect(hashEntry(je(1, { date: '2026-03-02' }))).not.toBe(base)
    expect(hashEntry(je(1, { number: 'JE-999' }))).not.toBe(base)
    expect(hashEntry(je(1, { type: 'invoice' }))).not.toBe(base)
    expect(hashEntry(je(1, { description: 'Something else' }))).not.toBe(base)
  })

  it('changes when a line moves to a different account', () => {
    const moved = je(1, { lines: [{ accountId: 'acc-cash', debit: 100, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 100 }] })
    expect(hashEntry(moved)).not.toBe(hashEntry(je(1)))
  })

  it('changes when an analytical tag changes', () => {
    // Departments and projects steer reporting; altering one after the fact
    // moves profit between segments without touching a single figure.
    const tagged = je(1, { lines: [{ accountId: 'acc-bank1', debit: 100, credit: 0, departmentId: 'd2' }, { accountId: 'acc-sales', debit: 0, credit: 100 }] })
    expect(hashEntry(tagged)).not.toBe(hashEntry(je(1)))
  })

  it('does not change for float noise in an amount', () => {
    // 100 and 100.00000000001 are the same money. A chain that disagreed
    // would cry tampering over arithmetic that is working correctly.
    const noisy = je(1, { lines: [{ accountId: 'acc-bank1', debit: 100.000000001, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 100 }] })
    expect(hashEntry(noisy)).toBe(hashEntry(je(1)))
  })

  it('does not change when a key order differs', () => {
    // Object key order is not guaranteed to survive storage or sync, so the
    // canonical form is an explicit projection rather than JSON.stringify.
    const reordered = { lines: je(1).lines, description: 'Entry 1', type: 'manual', number: 'JE-1', date: '2026-03-01', id: 'je-1' }
    expect(hashEntry(reordered)).toBe(hashEntry(je(1)))
  })

  it('does not change when the entry is later reversed', () => {
    // `reversedBy` is stamped on afterwards by a feature working as designed.
    // Covering it would break the chain every time somebody reversed an entry.
    expect(hashEntry(je(1, { reversedBy: 'je-99' }))).toBe(hashEntry(je(1)))
  })

  it('cannot be forged by crafting a description that looks like a field', () => {
    // Fields are length-prefixed for exactly this reason. Without it, a
    // description could impersonate a following field and two different
    // entries could share a hash.
    const a = je(1, { description: 'A', number: 'B|C' })
    const b = je(1, { description: 'A|B', number: 'C' })
    expect(canonicalise(a)).not.toBe(canonicalise(b))
    expect(hashEntry(a)).not.toBe(hashEntry(b))
  })

  it('links to the entry before it', () => {
    expect(hashEntry(je(1), 'aaa')).not.toBe(hashEntry(je(1), 'bbb'))
  })

  it('starts from a fixed genesis', () => {
    expect(hashEntry(je(1))).toBe(hashEntry(je(1), GENESIS))
  })

  it('is versioned, so the format can change without silent mismatches', () => {
    expect(canonicalise(je(1)).startsWith(CHAIN_VERSION + '|')).toBe(true)
  })
})

describe('chaining', () => {
  it('links each entry to its predecessor', () => {
    // The link is computed from the predecessor's full hash; what gets stored
    // is a short tag of it, because journal entries are the bulk of the data
    // and a second full hash per entry measured at +43% on disk.
    const chain = ledger(4)
    expect(chain[0].prevHash).toBe(prevTag(GENESIS))
    for (let i = 1; i < chain.length; i++) expect(chain[i].prevHash).toBe(prevTag(chain[i - 1].hash))
    expect(chain[1].hash).toBe(hashEntry(chain[1], chain[0].hash))
  })

  it('stores a back-reference far smaller than a full hash', () => {
    const chain = ledger(2)
    expect(chain[1].prevHash).toHaveLength(PREV_TAG_LENGTH)
    expect(chain[1].hash).toHaveLength(64)
  })

  it('does not mutate the entries it was given', () => {
    const raw = [je(1)]
    chainEntries(raw)
    expect(raw[0].hash).toBeUndefined()
  })

  it('verifies clean', () => {
    const v = verifyChain(ledger(10))
    expect(v.ok).toBe(true)
    expect(v.broken).toEqual([])
    expect(v.sealed).toBe(10)
    expect(v.unsealed).toBe(0)
  })

  it('accepts an empty ledger', () => {
    const v = verifyChain([])
    expect(v.ok).toBe(true)
    expect(v.head).toBe(GENESIS)
    expect(v.count).toBe(0)
  })
})

describe('catching tampering', () => {
  it('names the entry whose figures were changed', () => {
    const chain = ledger(6)
    chain[3] = { ...chain[3], lines: [{ accountId: 'acc-bank1', debit: 5000, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 5000 }] }
    const v = verifyChain(chain)
    expect(v.ok).toBe(false)
    expect(v.broken).toHaveLength(1)
    expect(v.broken[0]).toMatchObject({ index: 3, number: 'JE-4', kind: 'contents' })
  })

  it('reports one break for one alteration, not a cascade', () => {
    // This is what decides whether the check is usable. Following the computed
    // hash after a break would flag every entry that came after it, and the
    // real problem would be somewhere in a list of ninety-six false ones.
    const chain = ledger(100)
    chain[10] = { ...chain[10], description: 'quietly changed' }
    const v = verifyChain(chain)
    expect(v.broken).toHaveLength(1)
    expect(v.broken[0].index).toBe(10)
  })

  it('catches an entry inserted into the middle', () => {
    const chain = ledger(5)
    const forged = { ...je(99), prevHash: chain[1].hash, hash: hashEntry(je(99), chain[1].hash) }
    const v = verifyChain([...chain.slice(0, 2), forged, ...chain.slice(2)])
    expect(v.ok).toBe(false)
    // The forged entry itself hashes correctly against what precedes it; what
    // gives it away is that everything after it no longer lines up.
    expect(v.broken[0].kind).toBe('position')
  })

  it('catches an entry removed from the middle', () => {
    const chain = ledger(5)
    const v = verifyChain([...chain.slice(0, 2), ...chain.slice(3)])
    expect(v.ok).toBe(false)
    expect(v.broken.length).toBeGreaterThan(0)
  })

  it('catches two entries swapped', () => {
    const chain = ledger(5)
    const swapped = [chain[0], chain[2], chain[1], chain[3], chain[4]]
    expect(verifyChain(swapped).ok).toBe(false)
  })

  it('catches a hash edited to match altered contents but not its neighbours', () => {
    const chain = ledger(5)
    const altered = { ...chain[2], description: 'changed' }
    // Recomputed against the true predecessor — the stored prevHash is only a
    // short tag, so a forger has to go and get the real hash to do this at all.
    chain[2] = { ...altered, hash: hashEntry(altered, chain[1].hash) }
    const v = verifyChain(chain)
    // The entry itself now self-verifies — the break surfaces at the next one,
    // whose recorded prevHash no longer matches. A chain is only as forgeable
    // as its whole tail.
    expect(v.ok).toBe(false)
    expect(v.broken[0].index).toBe(3)
  })
})

describe('entries that predate sealing', () => {
  it('reports them as unsealed rather than tampered', () => {
    // Restoring a backup taken before this feature existed must not accuse
    // the user of altering their own books.
    const v = verifyChain([je(1), je(2), je(3)])
    expect(v.ok).toBe(true)
    expect(v.unsealed).toBe(3)
    expect(v.sealed).toBe(0)
  })

  it('does not make sealed entries after them look wrong', () => {
    const legacy = [je(1), je(2)]
    const chain = chainEntries(legacy)
    const mixed = [...legacy, ...chainEntries([je(3), je(4)], chain[1].hash)]
    const v = verifyChain(mixed)
    expect(v.ok).toBe(true)
    expect(v.unsealed).toBe(2)
    expect(v.sealed).toBe(2)
  })

  it('still catches tampering among the sealed ones', () => {
    const legacy = [je(1)]
    const sealedPart = chainEntries([je(2), je(3)], hashEntry(je(1), GENESIS))
    sealedPart[1] = { ...sealedPart[1], description: 'altered' }
    expect(verifyChain([...legacy, ...sealedPart]).ok).toBe(false)
  })
})

describe('resealing after a legitimate edit', () => {
  it('repairs the chain from the edited entry forward', () => {
    const chain = ledger(5)
    const edited = [...chain]
    edited[2] = { ...edited[2], description: 'corrected' }
    const fixed = reseal(edited, 2)
    expect(verifyChain(fixed).ok).toBe(true)
  })

  it('leaves everything before the edit untouched', () => {
    // The point of resealing forward only: re-hashing the whole ledger would
    // also repair any *earlier* tampering, erasing the evidence.
    const chain = ledger(5)
    const before = chain.slice(0, 2).map((e) => e.hash)
    const edited = [...chain]
    edited[2] = { ...edited[2], description: 'corrected' }
    const fixed = reseal(edited, 2)
    expect(fixed.slice(0, 2).map((e) => e.hash)).toEqual(before)
  })

  it('does not hide tampering that happened earlier', () => {
    const chain = ledger(6)
    chain[1] = { ...chain[1], lines: [{ accountId: 'acc-bank1', debit: 999, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 999 }] }
    chain[4] = { ...chain[4], description: 'a legitimate later edit' }
    const fixed = reseal(chain, 4)
    const v = verifyChain(fixed)
    expect(v.ok).toBe(false)
    expect(v.broken[0].index).toBe(1)
  })

  it('rechains everything when the first entry is the one that changed', () => {
    const chain = ledger(4)
    chain[0] = { ...chain[0], description: 'corrected' }
    expect(verifyChain(reseal(chain, 0)).ok).toBe(true)
  })
})

describe('the anchor', () => {
  it('fixes the ledger as it stood', () => {
    const chain = ledger(5)
    const a = ledgerAnchor(chain)
    expect(matchesAnchor(chain, a).ok).toBe(true)
  })

  it('still matches after new entries are posted', () => {
    // An anchor fixes the past. Business carrying on is not tampering.
    const chain = ledger(5)
    const a = ledgerAnchor(chain)
    const grown = [...chain, ...chainEntries([je(6)], chain[4].hash)]
    expect(matchesAnchor(grown, a)).toMatchObject({ ok: true, since: 1 })
  })

  it('fails when an anchored entry is altered afterwards', () => {
    // The property that makes this worth doing: once the anchor has left the
    // building, the ledger up to it can no longer be quietly rewritten.
    const chain = ledger(5)
    const a = ledgerAnchor(chain)
    const tampered = [...chain]
    tampered[1] = { ...tampered[1], lines: [{ accountId: 'acc-bank1', debit: 1, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 1 }] }
    expect(matchesAnchor(tampered, a)).toMatchObject({ ok: false, reason: 'ALTERED' })
  })

  it('fails when entries have gone missing', () => {
    const chain = ledger(5)
    const a = ledgerAnchor(chain)
    expect(matchesAnchor(chain.slice(0, 3), a)).toMatchObject({ ok: false, reason: 'ENTRIES_MISSING' })
  })

  it('says so when there is no anchor rather than passing', () => {
    expect(matchesAnchor(ledger(3), null)).toMatchObject({ ok: false, reason: 'NO_ANCHOR' })
    expect(matchesAnchor(ledger(3), {})).toMatchObject({ ok: false, reason: 'NO_ANCHOR' })
  })

  it('refuses an anchor from a different chain format', () => {
    const chain = ledger(3)
    const a = { ...ledgerAnchor(chain), version: 'v0' }
    expect(matchesAnchor(chain, a)).toMatchObject({ ok: false, reason: 'VERSION_MISMATCH' })
  })

  it('is small enough to write down', () => {
    const a = ledgerAnchor(ledger(3))
    expect(a.head).toMatch(/^[0-9a-f]{64}$/)
    expect(shortHash(a.head)).toHaveLength(12)
  })
})
