import { describe, it, expect } from 'vitest'
import { chainEntries, verifyChain, repairFork, hashEntry } from '../src/utils/ledgerChain'
import { applyPulledRows } from '../src/cloudSync'
import { raiseCounters, duplicateNumbers, usedNumbers } from '../src/store/shared'
import { gosiWage, employerCost, DEFAULT_GOSI_WAGE_CAP } from '../src/utils/contracts'

const je = (id, date, amount, createdAt = `${date}T09:00:00Z`) => ({
  id, date, createdAt, number: id.toUpperCase(), description: id, type: 'manual',
  lines: [{ accountId: 'a', debit: amount, credit: 0 }, { accountId: 'b', debit: 0, credit: amount }],
})

// Two devices start from the same synced ledger and each posts offline.
function twoDevices() {
  const common = chainEntries([je('c1', '2026-09-01', 10), je('c2', '2026-09-02', 20)])
  const a = chainEntries([...common, je('a1', '2026-09-05', 30, '2026-09-05T10:00:00Z')].map(({ hash, prevHash, ...x }) => x))
  const b = chainEntries([...common, je('b1', '2026-09-04', 40, '2026-09-04T08:00:00Z'), je('b2', '2026-09-06', 50)].map(({ hash, prevHash, ...x }) => x))
  return { common, a, b }
}
// What device A holds after pulling B's entries (appended, as applyPulledRows does).
const mergeOnA = (a, b) => applyPulledRows({ journalEntries: a }, b.slice(2).map((x) => ({ entity: 'journalEntries', record_id: x.id, data: x, deleted: false }))).journalEntries

describe('ledger seal across devices', () => {
  it('a merge of two devices’ postings breaks the plain chain (the false alarm)', () => {
    const { a, b } = twoDevices()
    expect(verifyChain(a).ok).toBe(true)
    expect(verifyChain(mergeOnA(a, b)).ok).toBe(false)
  })

  it('repairs the fork when every entry is intact, in date order', () => {
    const { a, b } = twoDevices()
    const res = repairFork(mergeOnA(a, b))
    expect(res.repaired).toBe(true)
    expect(verifyChain(res.entries).ok).toBe(true)
    expect(res.entries.map((x) => x.id)).toEqual(['c1', 'c2', 'b1', 'a1', 'b2'])
    // the shared history before the fork is not re-sealed
    expect(res.entries[1].hash).toBe(a[1].hash)
  })

  it('both devices arrive at the same chain, so they stop rewriting each other', () => {
    const { a, b } = twoDevices()
    const onA = repairFork(mergeOnA(a, b)).entries
    const onB = repairFork(mergeOnA(b, a.slice(0, 2).concat(a.slice(2)))).entries
    expect(onB.map((x) => x.hash)).toEqual(onA.map((x) => x.hash))
    // and B, after pulling A's repaired copy into its own order, changes nothing more
    const bPullsA = applyPulledRows({ journalEntries: b }, onA.map((x) => ({ entity: 'journalEntries', record_id: x.id, data: x, deleted: false }))).journalEntries
    expect(repairFork(bPullsA).entries.map((x) => x.hash)).toEqual(onA.map((x) => x.hash))
  })

  it('never re-seals an entry whose figures were changed', () => {
    const { a, b } = twoDevices()
    const tampered = b.map((x) => (x.id === 'b1' ? { ...x, lines: [{ accountId: 'a', debit: 4000, credit: 0 }, { accountId: 'b', debit: 0, credit: 4000 }] } : x))
    const res = repairFork(mergeOnA(a, tampered))
    expect(res.repaired).toBe(false)
    expect(res.reason).toBe('altered')
    expect(verifyChain(res.entries).ok).toBe(false)
  })

  it('leaves an intact ledger alone', () => {
    const { a } = twoDevices()
    expect(repairFork(a)).toEqual({ entries: a, repaired: false })
    expect(hashEntry(a[0])).toBe(a[0].hash)
  })
})

describe('document numbers never go backwards', () => {
  const state = {
    invoices: [{ number: 'INV-0007', payments: [{ number: 'REC-0012' }] }, { number: 'INV-0003' }],
    purchases: [{ number: 'PUR-0002' }],
    prepaidExpenses: [{ number: 'PRE-0009' }],
  }
  const settings = {
    invoice: { prefix: 'INV-', next: 5, notes: 'x' },
    receipt: { prefix: 'REC-', next: 20 },
    purchase: { prefix: 'PUR-', next: 1 },
    payroll: { prefix: 'PR-', next: 1 },
    prepaid: { prefix: 'PRE-', next: 3 },
    company: { name: 'Acme' },
  }

  it('raises each counter above the highest number used, and only those', () => {
    const out = raiseCounters(settings, state)
    expect(out.invoice).toEqual({ prefix: 'INV-', next: 8, notes: 'x' })
    expect(out.receipt.next).toBe(20) // already ahead
    expect(out.purchase.next).toBe(3)
    expect(out.payroll.next).toBe(1) // PRE- numbers are not PR- numbers
    expect(out.prepaid.next).toBe(10)
    expect(out.company).toBe(settings.company)
  })

  it('returns the same object when nothing moves', () => {
    const ok = { invoice: { prefix: 'INV-', next: 99 } }
    expect(raiseCounters(ok, state)).toBe(ok)
  })

  it('finds receipt numbers inside invoices', () => {
    expect(usedNumbers(state)).toContain('REC-0012')
  })

  it('reports numbers used twice by live documents', () => {
    const dup = duplicateNumbers({
      invoices: [{ number: 'INV-0007' }, { number: 'INV-0007' }, { number: 'INV-0008' }, { number: 'INV-0008', status: 'void' }],
    })
    expect(dup).toEqual([{ number: 'INV-0007', collection: 'invoices', count: 2 }])
  })
})

describe('GOSI wage ceiling', () => {
  it('caps the contributory wage at SAR 45,000 by default', () => {
    expect(DEFAULT_GOSI_WAGE_CAP).toBe(45000)
    expect(gosiWage(60000)).toBe(45000)
    expect(gosiWage(12000)).toBe(12000)
    expect(gosiWage(60000, 0)).toBe(60000)
  })

  it('employer cost uses the capped wage', () => {
    const c = { gosiApplicable: true, gosiEmployerRate: 11.75, basic: 50000, housing: 12500, transport: 0, other: 0 }
    expect(employerCost(c).gosiEmployer).toBe(5287.5) // 45,000 × 11.75%
    expect(employerCost(c, { gosiCap: 0 }).gosiEmployer).toBe(7343.75)
  })
})
