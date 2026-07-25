import { describe, it, expect } from 'vitest'
import { diffRecord, summarise, describeChanges, severityFor } from '../src/utils/auditDiff.js'

describe('summarise', () => {
  it('renders scalars readably', () => {
    expect(summarise('Acme')).toBe('Acme')
    expect(summarise(250)).toBe('250')
    expect(summarise(true)).toBe('yes')
    expect(summarise(false)).toBe('no')
  })
  it('renders blanks as a dash', () => {
    expect(summarise('')).toBe('—')
    expect(summarise(null)).toBe('—')
    expect(summarise(undefined)).toBe('—')
  })
  it('counts arrays instead of dumping them', () => {
    expect(summarise([1, 2, 3])).toBe('3 item(s)')
  })
  it('never lets a data URL into the log', () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(50000)
    const out = summarise(logo)
    expect(out).not.toContain('AAAA')
    expect(out).toMatch(/^\(\d+ chars\)$/)
  })
  it('truncates any oversized string', () => {
    expect(summarise('x'.repeat(5000))).toBe('(5000 chars)')
  })
})

describe('diffRecord', () => {
  it('reports only the fields that changed', () => {
    const d = diffRecord({ name: 'A', total: 100, status: 'draft' }, { name: 'A', total: 250, status: 'sent' })
    expect(d).toHaveLength(2)
    expect(d).toContainEqual({ field: 'total', from: '100', to: '250' })
    expect(d).toContainEqual({ field: 'status', from: 'draft', to: 'sent' })
  })

  it('returns nothing when a record is unchanged', () => {
    const rec = { name: 'A', total: 100 }
    expect(diffRecord(rec, { ...rec })).toEqual([])
  })

  it('detects a nested change JSON-deep, not just by reference', () => {
    const d = diffRecord({ items: [{ qty: 1 }] }, { items: [{ qty: 5 }] })
    expect(d).toHaveLength(1)
    expect(d[0].field).toBe('items')
  })

  it('ignores machine fields nobody audits', () => {
    const d = diffRecord(
      { id: 'a', createdAt: 'x', updatedAt: '1', journalEntryId: 'j1', name: 'A' },
      { id: 'b', createdAt: 'y', updatedAt: '2', journalEntryId: 'j2', name: 'A' }
    )
    expect(d).toEqual([])
  })

  it('records THAT an opaque field changed but never its contents', () => {
    const d = diffRecord({ logo: 'data:image/png;base64,AAA' }, { logo: 'data:image/png;base64,BBB' })
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ field: 'logo', opaque: true })
    expect(JSON.stringify(d)).not.toContain('AAA')
    expect(JSON.stringify(d)).not.toContain('BBB')
  })

  it('catches added and removed fields', () => {
    const added = diffRecord({ a: 1 }, { a: 1, b: 2 })
    expect(added).toContainEqual({ field: 'b', from: '—', to: '2' })
    const removed = diffRecord({ a: 1, b: 2 }, { a: 1 })
    expect(removed).toContainEqual({ field: 'b', from: '2', to: '—' })
  })

  it('treats null, undefined and empty string as the same "empty"', () => {
    // Edit forms coerce missing fields to '' on load; without this the log
    // filled up with meaningless "— → —" rows on every save.
    expect(diffRecord({ note: undefined }, { note: '' })).toEqual([])
    expect(diffRecord({ note: null }, { note: '' })).toEqual([])
    expect(diffRecord({}, { note: '' })).toEqual([])
    // A real fill-in is still reported.
    expect(diffRecord({ note: '' }, { note: 'hello' })).toEqual([{ field: 'note', from: '—', to: 'hello' }])
    // And so is a real clear-out.
    expect(diffRecord({ note: 'hello' }, { note: '' })).toEqual([{ field: 'note', from: 'hello', to: '—' }])
  })

  it('honours an extra ignore list', () => {
    expect(diffRecord({ x: 1, noisy: 'a' }, { x: 2, noisy: 'b' }, { ignore: ['noisy'] }))
      .toEqual([{ field: 'x', from: '1', to: '2' }])
  })

  it('handles null/undefined records without throwing', () => {
    expect(() => diffRecord(null, { a: 1 })).not.toThrow()
    expect(diffRecord(null, { a: 1 })).toContainEqual({ field: 'a', from: '—', to: '1' })
    expect(diffRecord(undefined, undefined)).toEqual([])
  })

  it('keeps the whole diff bounded even for a wide record', () => {
    const before = {}, after = {}
    for (let i = 0; i < 40; i++) { before['f' + i] = 'x'.repeat(2000); after['f' + i] = 'y'.repeat(2000) }
    const size = JSON.stringify(diffRecord(before, after)).length
    expect(size).toBeLessThan(4000)   // summarised, not dumped
  })
})

describe('describeChanges', () => {
  it('summarises a short list inline', () => {
    expect(describeChanges([{ field: 'total', from: '1', to: '2' }])).toBe('total: 1 → 2')
  })
  it('caps the list and counts the remainder', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((f) => ({ field: f, from: '1', to: '2' }))
    expect(describeChanges(many)).toContain('+2 more')
  })
  it('handles an empty diff', () => {
    expect(describeChanges([])).toBe('No field changes')
    expect(describeChanges(null)).toBe('No field changes')
  })
})

describe('severityFor', () => {
  it('flags destructive actions as critical', () => {
    expect(severityFor('Deleted customer')).toBe('critical')
    expect(severityFor('Voided invoice')).toBe('critical')
    expect(severityFor('Reset All Data')).toBe('critical')
    expect(severityFor('Reopened fiscal year')).toBe('critical')
  })
  it('flags edits and approvals as notable', () => {
    expect(severityFor('Updated invoice')).toBe('notable')
    expect(severityFor('Approved expense claim')).toBe('notable')
    expect(severityFor('Locked period')).toBe('notable')
  })
  it('treats ordinary postings as routine', () => {
    expect(severityFor('Posted sales invoice')).toBe('routine')
    expect(severityFor('')).toBe('routine')
  })
})
