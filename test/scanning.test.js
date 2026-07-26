import { describe, it, expect } from 'vitest'
import { resolveScan, scannerSupport, scannerMessage, SCAN_FORMATS } from '../src/utils/scanning.js'
import { labelPayload } from '../src/utils/labels.js'

const bearing = { id: 'it-1', code: 'BRG-6204', name: 'Bearing 6204', barcode: '5901234123457' }
const belt    = { id: 'it-2', code: 'BLT-A', name: 'Drive Belt', barcode: '' }
const lathe   = { id: 'fa-1', number: 'FA-0001', name: 'CNC Lathe' }
const CTX = { inventoryItems: [bearing, belt], fixedAssets: [lathe] }

describe('our own labels', () => {
  it('resolves an item label to the item', () => {
    const r = resolveScan(labelPayload('inventoryItems', bearing), CTX)
    expect(r).toMatchObject({ kind: 'inventoryItems', matchedBy: 'label' })
    expect(r.record.id).toBe('it-1')
  })

  it('resolves an asset label to the asset', () => {
    const r = resolveScan(labelPayload('fixedAssets', lathe), CTX)
    expect(r.record.id).toBe('fa-1')
    expect(r.kind).toBe('fixedAssets')
  })

  it('still works after the name and code have both changed', () => {
    // The whole reason the label carries the id rather than the code.
    const renamed = { ...bearing, code: 'NEW-CODE', name: 'Renamed' }
    const r = resolveScan('ERP:IT:it-1', { ...CTX, inventoryItems: [renamed] })
    expect(r.record.name).toBe('Renamed')
  })

  it('reports a label pointing at a deleted record as stale, not unknown', () => {
    const r = resolveScan('ERP:IT:gone', CTX)
    expect(r).toMatchObject({ matchedBy: 'label', stale: true, record: null })
  })

  it('tolerates whitespace a scanner appends', () => {
    expect(resolveScan('  ERP:IT:it-1\n', CTX).record.id).toBe('it-1')
  })
})

describe('manufacturer barcodes', () => {
  it('matches an item by its barcode', () => {
    const r = resolveScan('5901234123457', CTX)
    expect(r).toMatchObject({ kind: 'inventoryItems', matchedBy: 'barcode' })
    expect(r.record.id).toBe('it-1')
  })

  it('does not match an empty barcode field against an empty scan', () => {
    expect(resolveScan('', CTX)).toBeNull()
    expect(resolveScan('   ', CTX)).toBeNull()
  })
})

describe('typed codes', () => {
  it('matches an item by its stock code, ignoring case', () => {
    expect(resolveScan('brg-6204', CTX).record.id).toBe('it-1')
    expect(resolveScan('BLT-A', CTX).record.id).toBe('it-2')
  })

  it('matches a fixed asset by its tag number', () => {
    const r = resolveScan('FA-0001', CTX)
    expect(r).toMatchObject({ kind: 'fixedAssets', matchedBy: 'code' })
  })

  it('reports ambiguity when one item\'s barcode is another item\'s code', () => {
    // Two different physical things could be meant. Picking the barcode
    // because it is "more specific" would be a guess, and a stock count
    // routed to the wrong item is exactly what this must not do.
    const odd = { id: 'it-3', code: '5901234123457', name: 'Confusing' }
    const r = resolveScan('5901234123457', { ...CTX, inventoryItems: [bearing, odd] })
    expect(r.ambiguous).toBe(true)
    // Barcode first, so the UI can offer the likeliest at the top.
    expect(r.candidates[0].matchedBy).toBe('barcode')
    expect(r.candidates[0].record.id).toBe('it-1')
  })
})

describe('ambiguity is reported, never guessed', () => {
  it('returns every candidate when two records share a code', () => {
    const twin = { id: 'it-9', code: 'BRG-6204', name: 'Other Bearing' }
    const r = resolveScan('BRG-6204', { ...CTX, inventoryItems: [bearing, twin] })
    expect(r.ambiguous).toBe(true)
    expect(r.candidates).toHaveLength(2)
  })

  it('reports an item and an asset sharing a code', () => {
    const r = resolveScan('SHARED', {
      inventoryItems: [{ id: 'i', code: 'SHARED', name: 'Item' }],
      fixedAssets: [{ id: 'a', number: 'SHARED', name: 'Asset' }],
    })
    expect(r.ambiguous).toBe(true)
    expect(r.candidates.map((c) => c.kind).sort()).toEqual(['fixedAssets', 'inventoryItems'])
  })

  it('does not list the same record twice when its code and barcode both match', () => {
    const same = { id: 'x', code: 'DUP', barcode: 'DUP', name: 'Same' }
    const r = resolveScan('DUP', { inventoryItems: [same], fixedAssets: [] })
    expect(r.ambiguous).toBeUndefined()
    expect(r.record.id).toBe('x')
  })
})

describe('nothing matched', () => {
  it('returns null for an unknown code', () => {
    expect(resolveScan('NOT-A-THING', CTX)).toBeNull()
  })
  it('copes with no context at all', () => {
    expect(resolveScan('anything')).toBeNull()
    expect(resolveScan(null, CTX)).toBeNull()
  })
})

describe('camera support', () => {
  it('reports honestly when there is no window', () => {
    const s = scannerSupport()
    expect(typeof s.camera).toBe('boolean')
  })

  it('explains every refusal it can give', () => {
    ;['insecure', 'unsupported', 'no-camera-api'].forEach((r) => {
      expect(scannerMessage(r).length).toBeGreaterThan(10)
    })
    expect(scannerMessage('')).toBe('')
  })

  it('asks for QR plus the common packaging symbologies', () => {
    expect(SCAN_FORMATS).toContain('qr_code')
    expect(SCAN_FORMATS).toContain('ean_13')
    expect(SCAN_FORMATS).toContain('code_128')
  })
})
