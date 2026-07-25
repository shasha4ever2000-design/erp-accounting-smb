import { describe, it, expect } from 'vitest'
import {
  LABEL_PRESETS, KINDS, presetFor, perPage, labelPayload, parsePayload,
  buildLabel, buildLabels, expandCopies, paginate, withOffset, buildSheet,
} from '../src/utils/labels.js'

const asset = {
  id: 'fa-1', number: 'FA-0001', name: 'CNC Lathe', location: 'Workshop A',
  serialNumber: 'SN-99', purchaseDate: '2025-03-14', cost: 45000,
}
const item = { id: 'it-1', code: 'BRG-6204', name: 'Bearing 6204', category: 'Bearings', unit: 'pcs', barcode: '5901234123457' }

describe('presets', () => {
  it('gives every preset a size and a sheet layout', () => {
    Object.values(LABEL_PRESETS).forEach((p) => {
      expect(p.width, p.id).toBeGreaterThan(0)
      expect(p.height, p.id).toBeGreaterThan(0)
      expect(p.cols * p.rows, p.id).toBeGreaterThan(0)
    })
  })

  it('fits its labels inside an A4 sheet', () => {
    // 210 × 297 mm, allowing a 10 mm margin all round.
    Object.values(LABEL_PRESETS).forEach((p) => {
      expect(p.cols * p.width, `${p.id} too wide`).toBeLessThanOrEqual(200)
      expect(p.rows * p.height, `${p.id} too tall`).toBeLessThanOrEqual(287)
    })
  })

  it('falls back to medium for an unknown preset', () => {
    expect(presetFor('nonsense').id).toBe('medium')
    expect(perPage('nonsense')).toBe(21)
  })
})

describe('the scannable payload', () => {
  it('encodes the id, not the name or number', () => {
    // Names get edited and numbers get re-sequenced; the id still resolves in
    // five years.
    expect(labelPayload('fixedAssets', asset)).toBe('ERP:FA:fa-1')
    expect(labelPayload('inventoryItems', item)).toBe('ERP:IT:it-1')
  })

  it('round-trips through parsePayload', () => {
    expect(parsePayload(labelPayload('fixedAssets', asset))).toEqual({ kind: 'fixedAssets', id: 'fa-1' })
    expect(parsePayload(labelPayload('inventoryItems', item))).toEqual({ kind: 'inventoryItems', id: 'it-1' })
  })

  it('ignores anything that is not one of ours', () => {
    expect(parsePayload('5901234123457')).toBeNull()
    expect(parsePayload('ERP:XX:1')).toBeNull()
    expect(parsePayload('')).toBeNull()
    expect(parsePayload(null)).toBeNull()
  })

  it('tolerates surrounding whitespace from a scanner', () => {
    expect(parsePayload('  ERP:FA:fa-1\n')).toEqual({ kind: 'fixedAssets', id: 'fa-1' })
  })

  it('keeps an id containing colons intact', () => {
    expect(parsePayload('ERP:IT:a:b:c')).toEqual({ kind: 'inventoryItems', id: 'a:b:c' })
  })
})

describe('buildLabel', () => {
  it('puts an asset\'s tag number, name and whereabouts on it', () => {
    const l = buildLabel('fixedAssets', asset, { company: 'Awaha Co' })
    expect(l.code).toBe('FA-0001')
    expect(l.title).toBe('CNC Lathe')
    expect(l.detail).toContain('Workshop A')
    expect(l.detail).toContain('S/N SN-99')
    expect(l.company).toBe('Awaha Co')
  })

  it('shows the cost only when a formatter is supplied', () => {
    expect(buildLabel('fixedAssets', asset, {}).detail.some((d) => d.includes('45'))).toBe(false)
    const withMoney = buildLabel('fixedAssets', asset, { fmtMoney: (n) => `SAR ${n}` })
    expect(withMoney.detail).toContain('SAR 45000')
  })

  it('puts an item\'s stock code and unit on it', () => {
    const l = buildLabel('inventoryItems', item)
    expect(l.code).toBe('BRG-6204')
    expect(l.detail).toContain('Bearings')
    expect(l.detail).toContain('pcs')
  })

  it('does not repeat the barcode when it is already the code', () => {
    const l = buildLabel('inventoryItems', { id: 'x', code: '5901234123457', barcode: '5901234123457', name: 'Thing' })
    expect(l.detail.filter((d) => d === '5901234123457')).toHaveLength(0)
  })

  it('falls back through number, code, then a slice of the id', () => {
    expect(buildLabel('fixedAssets', { id: 'abcdefghijkl', name: 'X' }).code).toBe('abcdefgh')
    expect(buildLabel('inventoryItems', { id: 'z', barcode: '123', name: 'Y' }).code).toBe('123')
  })

  it('falls back to the code when a record has no name', () => {
    expect(buildLabel('inventoryItems', { id: 'z', code: 'C1' }).title).toBe('C1')
  })

  it('returns nothing for a missing record', () => {
    expect(buildLabel('fixedAssets', null)).toBeNull()
    expect(buildLabels('fixedAssets', [null, asset])).toHaveLength(1)
  })
})

describe('expandCopies', () => {
  const labels = buildLabels('inventoryItems', [item, { id: 'it-2', code: 'B', name: 'Other' }])

  it('prints one of each by default', () => {
    expect(expandCopies(labels)).toHaveLength(2)
  })

  it('repeats a label the number of times asked', () => {
    const out = expandCopies(labels, { 'it-1': 3 })
    expect(out.filter((l) => l.id === 'it-1')).toHaveLength(3)
    expect(out).toHaveLength(4)
  })

  it('drops a label set to zero copies', () => {
    expect(expandCopies(labels, { 'it-1': 0 }).map((l) => l.id)).toEqual(['it-2'])
  })

  it('treats a negative or nonsense count as none', () => {
    expect(expandCopies(labels, { 'it-1': -5, 'it-2': 'abc' })).toHaveLength(0)
  })

  it('gives each copy a distinct key so React does not reuse a node', () => {
    const out = expandCopies(labels, { 'it-1': 3 })
    expect(new Set(out.map((l) => l.key)).size).toBe(out.length)
  })
})

describe('paginate', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, key: `l${i}` }))

  it('chunks by the preset\'s capacity', () => {
    expect(paginate(many, 'medium').map((p) => p.length)).toEqual([21, 21, 8])
  })

  it('uses a different capacity for a different preset', () => {
    expect(paginate(many, 'large')[0]).toHaveLength(10)
  })

  it('returns nothing for an empty run rather than one blank page', () => {
    expect(paginate([], 'medium')).toEqual([])
  })
})

describe('withOffset — reusing a part-used sheet', () => {
  const labels = [{ id: 'a', key: 'a' }, { id: 'b', key: 'b' }]

  it('pads with blanks so printing starts where the sheet does', () => {
    const out = withOffset(labels, 3, 'medium')
    expect(out.slice(0, 3).every((l) => l.blank)).toBe(true)
    expect(out).toHaveLength(5)
  })

  it('does nothing for a zero offset', () => {
    expect(withOffset(labels, 0, 'medium')).toHaveLength(2)
  })

  it('never offsets past a whole page, which would just waste one', () => {
    expect(withOffset(labels, 999, 'medium').filter((l) => l.blank)).toHaveLength(20)
  })

  it('ignores a negative offset', () => {
    expect(withOffset(labels, -4, 'medium')).toHaveLength(2)
  })
})

describe('buildSheet', () => {
  it('assembles labels, copies, blanks and pages in one call', () => {
    const sheet = buildSheet('inventoryItems', [item], { copies: { 'it-1': 25 }, presetId: 'medium', offset: 2 })
    expect(sheet.total).toBe(25)
    expect(sheet.preset.id).toBe('medium')
    // 2 blanks + 25 labels = 27 across two pages of 21.
    expect(sheet.pages.map((p) => p.length)).toEqual([21, 6])
  })

  it('reports an empty sheet honestly', () => {
    const sheet = buildSheet('fixedAssets', [], {})
    expect(sheet.total).toBe(0)
    expect(sheet.pages).toEqual([])
  })

  it('carries the company name onto every label', () => {
    const sheet = buildSheet('fixedAssets', [asset], { company: 'Awaha Co', copies: { 'fa-1': 2 } })
    expect(sheet.pages[0].every((l) => l.company === 'Awaha Co')).toBe(true)
  })
})

describe('kinds', () => {
  it('gives each kind a distinct scanner prefix', () => {
    const prefixes = Object.values(KINDS).map((k) => k.prefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})
