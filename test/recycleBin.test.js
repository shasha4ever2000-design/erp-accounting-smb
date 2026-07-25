import { describe, it, expect } from 'vitest'
import {
  RECYCLABLE, VOID_INSTEAD, isRecyclable, describe as describeEntry, entityLabel,
  makeEntry, canRestore, ageInDays, expiredEntries, countByEntity,
} from '../src/utils/recycleBin.js'

describe('the boundary — what the bin covers and what it must not', () => {
  it('covers master data and non-posting documents', () => {
    ;['customers', 'suppliers', 'inventoryItems', 'accounts', 'quotations', 'purchaseOrders']
      .forEach((e) => expect(isRecyclable(e), e).toBe(true))
  })

  it('never covers a document that posts to the ledger', () => {
    // Restoring one of these would put the row back while its reversing entry
    // stayed posted — the transaction would count twice. They are voided.
    ;['invoices', 'purchases', 'journalEntries', 'creditNotes', 'expenseClaims', 'payrollRuns']
      .forEach((e) => expect(isRecyclable(e), e).toBe(false))
  })

  it('keeps the two lists disjoint', () => {
    Object.keys(RECYCLABLE).forEach((e) => expect(VOID_INSTEAD.has(e), e).toBe(false))
  })

  it('gives every covered entity a slice, a label and a namer', () => {
    Object.entries(RECYCLABLE).forEach(([k, cfg]) => {
      expect(cfg.slice, k).toBeTruthy()
      expect(cfg.label, k).toBeTruthy()
      expect(typeof cfg.name, k).toBe('function')
    })
  })
})

describe('describe', () => {
  it('names a record the way a human would recognise it', () => {
    expect(describeEntry({ entity: 'customers', record: { name: 'Acme' } })).toBe('Acme')
    expect(describeEntry({ entity: 'inventoryItems', record: { code: 'SKU-1', name: 'Widget' } })).toBe('SKU-1 — Widget')
    expect(describeEntry({ entity: 'currencies', record: { code: 'EUR', name: 'Euro' } })).toBe('EUR — Euro')
  })
  it('falls back to the type when the record has no usable name', () => {
    expect(describeEntry({ entity: 'customers', record: {} })).toBe('(Customer)')
  })
  it('never throws on a malformed entry', () => {
    expect(describeEntry(null)).toBe('')
    expect(describeEntry({ entity: 'nope', record: {} })).toBe('nope')
    expect(() => describeEntry({ entity: 'customers', record: null })).not.toThrow()
  })
  it('labels an entity for the UI', () => {
    expect(entityLabel('customers')).toBe('Customer')
    expect(entityLabel('unknown')).toBe('unknown')
  })
})

describe('makeEntry', () => {
  it('captures the record, who deleted it and when', () => {
    const e = makeEntry('customers', { id: 'c1', name: 'Acme' }, {
      user: { id: 'u1', name: 'Sara' }, now: '2026-07-01T10:00:00.000Z',
    })
    expect(e).toMatchObject({
      entity: 'customers', recordId: 'c1',
      deletedBy: 'u1', deletedByName: 'Sara', deletedAt: '2026-07-01T10:00:00.000Z',
    })
    expect(e.record).toEqual({ id: 'c1', name: 'Acme' })
  })
  it('records an unknown user rather than an empty name', () => {
    expect(makeEntry('customers', { id: 'c1' }).deletedByName).toBe('Unknown')
  })
  it('gives each entry a distinct id, so deleting the same record twice keeps both', () => {
    const a = makeEntry('customers', { id: 'c1' }, { now: '2026-07-01T10:00:00.000Z' })
    const b = makeEntry('customers', { id: 'c1' }, { now: '2026-07-02T10:00:00.000Z' })
    expect(a.id).not.toBe(b.id)
  })
})

describe('canRestore', () => {
  const entry = { entity: 'customers', recordId: 'c1', record: { id: 'c1' } }

  it('allows a restore into a slice that no longer holds the id', () => {
    expect(canRestore(entry, [{ id: 'other' }]).ok).toBe(true)
    expect(canRestore(entry, []).ok).toBe(true)
  })
  it('refuses when the id is back in use — otherwise it would appear twice', () => {
    const r = canRestore(entry, [{ id: 'c1' }])
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/already exists/i)
  })
  it('refuses a type the bin does not cover', () => {
    expect(canRestore({ entity: 'invoices', recordId: 'i1' }, []).ok).toBe(false)
  })
  it('refuses a missing entry rather than throwing', () => {
    expect(canRestore(null, []).ok).toBe(false)
  })
})

describe('retention', () => {
  const at = (iso) => ({ deletedAt: iso })
  const NOW = Date.parse('2026-07-01T00:00:00.000Z')

  it('measures age in whole days', () => {
    expect(ageInDays(at('2026-07-01T00:00:00.000Z'), NOW)).toBe(0)
    expect(ageInDays(at('2026-06-24T00:00:00.000Z'), NOW)).toBe(7)
  })
  it('treats a malformed timestamp as brand new rather than instantly expired', () => {
    expect(ageInDays(at('not-a-date'), NOW)).toBe(0)
    expect(ageInDays({}, NOW)).toBe(0)
  })
  it('lists what has passed the retention window', () => {
    const entries = [at('2026-01-01T00:00:00.000Z'), at('2026-06-30T00:00:00.000Z')]
    expect(expiredEntries(entries, 90, NOW)).toHaveLength(1)
  })
  it('expires nothing when retention is switched off', () => {
    expect(expiredEntries([at('2020-01-01T00:00:00.000Z')], 0, NOW)).toEqual([])
  })
})

describe('countByEntity', () => {
  it('counts per type for the filter chips', () => {
    expect(countByEntity([
      { entity: 'customers' }, { entity: 'customers' }, { entity: 'suppliers' },
    ])).toEqual({ customers: 2, suppliers: 1 })
  })
  it('handles an empty bin', () => {
    expect(countByEntity()).toEqual({})
  })
})
