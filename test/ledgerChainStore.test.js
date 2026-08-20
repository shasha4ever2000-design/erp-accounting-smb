// The hash chain, through the store.
//
// ledgerChain.test.js proves the cryptography. This proves the part that
// decides whether any of it survives contact with the application: that every
// route into the ledger seals what it posts, that the legitimate edits the app
// allows repair the chain instead of breaking it, and — the one that matters
// most — that an edit made *behind* the app's back does not.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { verifyChain, hashEntry, GENESIS } from '../src/utils/ledgerChain.js'

const g = () => useStore.getState()

const manual = (over = {}) => ({
  date: '2026-03-01',
  description: 'Test entry',
  lines: [
    { accountId: 'acc-bank1', debit: 100, credit: 0 },
    { accountId: 'acc-sales', debit: 0, credit: 100 },
  ],
  ...over,
})

const invoice = {
  customerId: 'c1', customerName: 'Acme',
  date: '2026-03-01', dueDate: '2026-04-01',
  items: [{ description: 'Work', quantity: 1, price: 500, subtotal: 500, accountId: 'acc-sales' }],
  subtotal: 500, taxAmount: 0, total: 500,
}

beforeEach(() => {
  useStore.setState({ journalEntries: [], invoices: [], customers: [], purchases: [] })
})

describe('posting', () => {
  it('seals every entry as it is written', () => {
    g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'Second' }))
    const jes = g().journalEntries
    expect(jes[0].prevHash).toBe(GENESIS)
    expect(jes[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(jes[1].prevHash).toBe(jes[0].hash)
    expect(g().verifyLedger().ok).toBe(true)
  })

  it('returns the sealed entry to the caller, not the unsealed one', () => {
    // Callers store what comes back and link documents to it. Handing back an
    // object without its hash would leave the two disagreeing forever.
    const je = g().addJournalEntry(manual())
    expect(je.hash).toBeTruthy()
    expect(je.hash).toBe(g().journalEntries[0].hash)
  })

  it('seals entries posted by documents, not just hand-typed ones', () => {
    // Most of the ledger is posted by invoices, payments and stock moves. A
    // chain that only covered manual entries would cover almost nothing.
    g().addInvoice({ ...invoice })
    expect(g().journalEntries.length).toBeGreaterThan(0)
    expect(g().journalEntries.every((j) => !!j.hash)).toBe(true)
    expect(g().verifyLedger().ok).toBe(true)
  })

  it('keeps the chain intact across a burst of postings in one tick', () => {
    // The tail is read inside the state setter for this reason: two postings
    // in the same tick must not both chain off the same predecessor.
    for (let i = 0; i < 25; i++) g().addJournalEntry(manual({ description: `E${i}` }))
    const v = g().verifyLedger()
    expect(v.ok).toBe(true)
    expect(v.sealed).toBe(25)
  })
})

describe('edits the app allows', () => {
  it('repairs the chain when a manual entry is corrected', () => {
    const a = g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'After' }))
    g().updateJournalEntry(a.id, { description: 'Corrected' })
    expect(g().verifyLedger().ok).toBe(true)
  })

  it('changes the entry’s hash, so the correction is not invisible', () => {
    const a = g().addJournalEntry(manual())
    const before = a.hash
    g().updateJournalEntry(a.id, { description: 'Corrected' })
    expect(g().journalEntries[0].hash).not.toBe(before)
  })

  it('records the old and new hash in the audit trail', () => {
    // An edit is permitted; being unable to tell later that it happened is
    // not. These two values are what let anyone check which version they hold.
    const a = g().addJournalEntry(manual())
    const before = a.hash
    g().updateJournalEntry(a.id, { description: 'Corrected' })
    const logged = g().auditLog.filter((e) => e.action === 'Edited journal entry').pop()
    expect(logged).toBeTruthy()
    const change = logged.changes.find((c) => c.field === 'ledgerHash')
    expect(change.from).toBe(before.slice(0, 12))
    expect(change.to).toBe(g().journalEntries[0].hash.slice(0, 12))
  })

  it('repairs the chain when an entry is deleted', () => {
    const a = g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'B' }))
    g().addJournalEntry(manual({ description: 'C' }))
    g().deleteJournalEntry(a.id)
    expect(g().verifyLedger().ok).toBe(true)
    expect(g().journalEntries).toHaveLength(2)
  })

  it('records the deletion, with the hash of what was removed', () => {
    const a = g().addJournalEntry(manual())
    const gone = a.hash
    g().deleteJournalEntry(a.id)
    const logged = g().auditLog.filter((e) => e.action === 'Deleted journal entry').pop()
    expect(logged.changes.find((c) => c.field === 'ledgerHash').from).toBe(gone.slice(0, 12))
  })

  it('does not break the chain when an entry is reversed', () => {
    // Reversal stamps `reversedBy` onto the original. The canonical form
    // excludes it precisely so a feature working correctly does not look like
    // tampering.
    const a = g().addJournalEntry(manual())
    if (typeof g().reverseJournalEntry === 'function') {
      g().reverseJournalEntry(a.id, '2026-03-05')
      expect(g().verifyLedger().ok).toBe(true)
    }
  })
})

describe('edits made behind the app’s back', () => {
  it('is caught when a figure is rewritten in storage', () => {
    // The scenario this whole feature exists for: somebody opens the developer
    // console and changes an amount. Every other integrity check still passes —
    // the entry balances, the trial balance nets to zero — and only this one
    // notices.
    g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'B' }))
    useStore.setState({
      journalEntries: g().journalEntries.map((j, i) => (i === 0
        ? { ...j, lines: [{ accountId: 'acc-bank1', debit: 9999, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 9999 }] }
        : j)),
    })
    const v = g().verifyLedger()
    expect(v.ok).toBe(false)
    expect(v.broken[0]).toMatchObject({ index: 0, kind: 'contents' })
  })

  it('is caught when the date is moved into another period', () => {
    // Backdating a posted entry moves profit between years. It changes no
    // total, so nothing else in the system would object.
    const a = g().addJournalEntry(manual())
    useStore.setState({ journalEntries: [{ ...a, date: '2025-12-31' }] })
    expect(g().verifyLedger().ok).toBe(false)
  })

  it('is caught when an entry is quietly dropped', () => {
    g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'B' }))
    g().addJournalEntry(manual({ description: 'C' }))
    useStore.setState({ journalEntries: g().journalEntries.filter((_, i) => i !== 1) })
    expect(g().verifyLedger().ok).toBe(false)
  })

  it('surfaces in the integrity report an accountant would actually run', async () => {
    const { runIntegrityCheck } = await import('../src/utils/integrityCheck.js')
    g().addJournalEntry(manual())
    useStore.setState({ journalEntries: g().journalEntries.map((j) => ({ ...j, description: 'rewritten' })) })
    const report = runIntegrityCheck(g())
    const check = report.checks.find((c) => c.id === 'ledger-chain')
    expect(check.ok).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('passes the integrity report on an untouched ledger', async () => {
    const { runIntegrityCheck } = await import('../src/utils/integrityCheck.js')
    g().addInvoice({ ...invoice })
    g().addJournalEntry(manual())
    const check = runIntegrityCheck(g()).checks.find((c) => c.id === 'ledger-chain')
    expect(check.ok).toBe(true)
  })
})

describe('books restored from before sealing existed', () => {
  it('are reported as unsealed, not as tampered', () => {
    useStore.setState({
      journalEntries: [
        { id: 'old-1', date: '2025-01-01', number: 'JE-1', type: 'manual', lines: [{ accountId: 'acc-bank1', debit: 50, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 50 }] },
      ],
    })
    const v = g().verifyLedger()
    expect(v.ok).toBe(true)
    expect(v.unsealed).toBe(1)
  })

  it('can be sealed, and the integrity check says so plainly', async () => {
    const { runIntegrityCheck } = await import('../src/utils/integrityCheck.js')
    useStore.setState({
      journalEntries: [
        { id: 'old-1', date: '2025-01-01', number: 'JE-1', type: 'manual', lines: [{ accountId: 'acc-bank1', debit: 50, credit: 0 }, { accountId: 'acc-sales', debit: 0, credit: 50 }] },
      ],
    })
    const res = g().sealLedger()
    expect(res.sealed).toBe(1)
    expect(g().verifyLedger()).toMatchObject({ ok: true, unsealed: 0, sealed: 1 })
    expect(runIntegrityCheck(g()).checks.find((c) => c.id === 'ledger-chain').ok).toBe(true)
  })

  it('records the sealing, because it proves nothing about the past', () => {
    useStore.setState({ journalEntries: [{ id: 'old-1', date: '2025-01-01', number: 'JE-1', type: 'manual', lines: [] }] })
    g().sealLedger()
    expect(g().auditLog.some((e) => e.action === 'Sealed the ledger')).toBe(true)
  })

  it('does nothing when there is nothing to seal', () => {
    g().addJournalEntry(manual())
    expect(g().sealLedger().sealed).toBe(0)
  })
})

describe('the anchor in exported backups', () => {
  it('travels with the file', () => {
    g().addJournalEntry(manual())
    const data = g().exportData()
    expect(data._ledgerAnchor.head).toMatch(/^[0-9a-f]{64}$/)
    expect(data._ledgerAnchor.count).toBe(g().journalEntries.length)
  })

  it('accepts a file that has not been touched since export', () => {
    g().addJournalEntry(manual())
    expect(g().checkBackupAnchor(g().exportData())).toMatchObject({ ok: true })
  })

  it('rejects a file whose ledger was edited after it was written', () => {
    // A backup emailed to an accountant carries a value neither party can
    // quietly change afterwards. This is what makes the chain mean something
    // outside this browser.
    g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'B' }))
    const data = g().exportData()
    data.journalEntries = data.journalEntries.map((j, i) => (i === 0 ? { ...j, description: 'altered in transit' } : j))
    expect(g().checkBackupAnchor(data)).toMatchObject({ ok: false, reason: 'ALTERED' })
  })

  it('rejects a file with entries stripped out of it', () => {
    g().addJournalEntry(manual())
    g().addJournalEntry(manual({ description: 'B' }))
    const data = g().exportData()
    data.journalEntries = data.journalEntries.slice(0, 1)
    expect(g().checkBackupAnchor(data)).toMatchObject({ ok: false, reason: 'ENTRIES_MISSING' })
  })

  it('says nothing about a backup taken before anchors existed', () => {
    // Absence of an anchor is not evidence of anything, and refusing such a
    // file would strand every user holding an older backup.
    const data = g().exportData()
    delete data._ledgerAnchor
    expect(g().checkBackupAnchor(data)).toBeNull()
  })

  it('does not carry the anchor into the imported state', () => {
    g().addJournalEntry(manual())
    const data = g().exportData()
    g().importData(data)
    expect(g()._ledgerAnchor).toBeUndefined()
    expect(g().verifyLedger().ok).toBe(true)
  })
})

describe('durability tracking', () => {
  it('starts with no record of the books ever leaving the device', () => {
    useStore.setState({ settings: { ...g().settings, durability: { lastExportAt: '', lastExportKind: '' } } })
    expect(g().settings.durability.lastExportAt).toBe('')
  })

  it('records a real off-device backup', () => {
    g().recordOffDeviceBackup('encrypted')
    expect(g().settings.durability.lastExportAt).toBeTruthy()
    expect(g().settings.durability.lastExportKind).toBe('encrypted')
  })

  it('is not advanced by taking a local snapshot', () => {
    // The whole point. A snapshot lives in the same IndexedDB as the ledger;
    // if it reset this clock the app would report a business as protected by
    // a copy that dies with the original. `snapshotNow` builds its payload
    // from `exportData`, so this is the call that must leave the clock alone.
    useStore.setState({ settings: { ...g().settings, durability: { lastExportAt: '', lastExportKind: '' } } })
    g().addJournalEntry(manual())
    g().exportData()
    expect(g().settings.durability.lastExportAt).toBe('')
  })
})

describe('the chain does not disturb the accounting', () => {
  it('leaves entries balanced and the trial balance netting to zero', () => {
    g().addInvoice({ ...invoice })
    g().addJournalEntry(manual())
    let dr = 0, cr = 0
    g().journalEntries.forEach((je) => je.lines.forEach((l) => { dr += l.debit || 0; cr += l.credit || 0 }))
    expect(Math.abs(dr - cr)).toBeLessThan(0.005)
  })

  it('hashes an entry the same way the store does', () => {
    const je = g().addJournalEntry(manual())
    expect(je.hash).toBe(hashEntry(je, GENESIS))
    expect(verifyChain([je]).ok).toBe(true)
  })
})
