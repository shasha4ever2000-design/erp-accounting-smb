import { describe, it, expect } from 'vitest'
import {
  CF_ENTITIES, CF_TYPES, isPrintable, newField, normaliseField,
  fieldsFor, printableFields, coerceValue, coerceValues,
  validateValues, validateField, displayValue, filledValues,
  migrateLegacy, exportColumns,
} from '../src/utils/customFields.js'

const settings = (customFields) => ({ customFields })

const text = (patch = {}) => ({ id: 'f1', name: 'Contract', type: 'text', options: [], required: false, showOnPrint: false, sort: 0, ...patch })

describe('definitions', () => {
  it('gives every new field its own id', () => {
    expect(newField().id).not.toBe(newField().id)
  })

  it('reads a plain string as a text field, which is what the old shape held', () => {
    const d = normaliseField('Contract #', 3)
    expect(d).toMatchObject({ name: 'Contract #', type: 'text', sort: 3 })
    expect(d.id).toBeTruthy()
  })

  it('degrades an unknown type to text rather than dropping the field', () => {
    // A field the user can still read beats a field that vanished.
    expect(normaliseField({ name: 'X', type: 'rocket' }).type).toBe('text')
  })

  it('keeps options only where they mean something', () => {
    expect(normaliseField({ name: 'A', type: 'text', options: ['x', 'y'] }).options).toEqual([])
    expect(normaliseField({ name: 'A', type: 'select', options: [' x ', '', 'y'] }).options).toEqual(['x', 'y'])
  })

  it('accepts the older `label` key', () => {
    expect(normaliseField({ label: 'Plate' }).name).toBe('Plate')
  })
})

describe('fieldsFor', () => {
  it('returns nothing for an entity with no fields', () => {
    expect(fieldsFor(settings({}), 'customer')).toEqual([])
    expect(fieldsFor(null, 'customer')).toEqual([])
  })

  it('drops nameless fields and orders by sort', () => {
    const s = settings({ customer: [
      { id: 'b', name: 'Beta', sort: 20 },
      { id: 'x', name: '', sort: 1 },
      { id: 'a', name: 'Alpha', sort: 10 },
    ] })
    expect(fieldsFor(s, 'customer').map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('breaks a sort tie by name so the order is stable across reloads', () => {
    const s = settings({ customer: [{ id: 'b', name: 'Beta', sort: 0 }, { id: 'a', name: 'Alpha', sort: 0 }] })
    expect(fieldsFor(s, 'customer').map((f) => f.name)).toEqual(['Alpha', 'Beta'])
  })
})

describe('printable fields', () => {
  it('knows which forms have a printed document', () => {
    expect(isPrintable('invoice')).toBe(true)
    expect(isPrintable('customer')).toBe(false)
  })

  it('shows only fields marked for print', () => {
    const s = settings({ invoice: [
      { id: 'a', name: 'PO number', showOnPrint: true },
      { id: 'b', name: 'Internal ref', showOnPrint: false },
    ] })
    expect(printableFields(s, 'invoice').map((f) => f.id)).toEqual(['a'])
  })

  it('never prints fields from a form that has no printed document', () => {
    const s = settings({ customer: [{ id: 'a', name: 'Notes', showOnPrint: true }] })
    expect(printableFields(s, 'customer')).toEqual([])
  })
})

describe('coerceValue — the type has to survive the round trip', () => {
  it('keeps a number a number so it sorts and totals', () => {
    expect(coerceValue(text({ type: 'number' }), '42')).toBe(42)
    expect(coerceValue(text({ type: 'number' }), 'abc')).toBe('')
  })

  it('keeps a date as an ISO day', () => {
    expect(coerceValue(text({ type: 'date' }), '2026-03-04T00:00:00Z')).toBe('2026-03-04')
    expect(coerceValue(text({ type: 'date' }), '4 March')).toBe('')
  })

  it('keeps a checkbox boolean, so no is distinguishable from unanswered', () => {
    expect(coerceValue(text({ type: 'checkbox' }), true)).toBe(true)
    expect(coerceValue(text({ type: 'checkbox' }), 'true')).toBe(true)
    expect(coerceValue(text({ type: 'checkbox' }), '')).toBe(false)
  })

  it('refuses a dropdown value that is not on the list', () => {
    const d = text({ type: 'select', options: ['Riyadh', 'Jeddah'] })
    expect(coerceValue(d, 'Riyadh')).toBe('Riyadh')
    expect(coerceValue(d, 'riyadh')).toBe('')
  })

  it('leaves a blank blank rather than turning it into 0 or false', () => {
    // "Not filled in" is real information and must not be forged into a value.
    expect(coerceValue(text({ type: 'number' }), '')).toBe('')
    expect(coerceValue(text(), null)).toBe('')
  })
})

describe('coerceValues', () => {
  const defs = [text({ id: 'a' }), text({ id: 'n', type: 'number' }), text({ id: 'c', type: 'checkbox' })]

  it('cleans a whole bag and drops the empties', () => {
    expect(coerceValues(defs, { a: 'hi', n: '5', c: true })).toEqual({ a: 'hi', n: 5, c: true })
    expect(coerceValues(defs, { a: '', n: '' })).toEqual({})
  })

  it('keeps an explicit no on a checkbox', () => {
    expect(coerceValues(defs, { c: false })).toEqual({ c: false })
  })

  it('ignores values for fields that no longer exist', () => {
    expect(coerceValues(defs, { gone: 'x' })).toEqual({})
  })
})

describe('validateValues', () => {
  it('accepts a filled required field', () => {
    expect(validateValues([text({ required: true })], { f1: 'ABC' }).ok).toBe(true)
  })
  it('refuses a blank one and names it', () => {
    const r = validateValues([text({ name: 'Contract', required: true })], {})
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('Contract')
  })
  it('accepts zero, which is a real answer', () => {
    expect(validateValues([text({ type: 'number', required: true })], { f1: 0 }).ok).toBe(true)
  })
  it('never demands a checkbox be ticked', () => {
    expect(validateValues([text({ type: 'checkbox', required: true })], {}).ok).toBe(true)
  })
})

describe('validateField', () => {
  const existing = [text({ id: 'f1', name: 'Contract' })]

  it('accepts an ordinary field', () => {
    expect(validateField({ name: 'Plate', type: 'text' }, existing).ok).toBe(true)
  })
  it('needs a name', () => {
    expect(validateField({ name: '  ', type: 'text' }, existing).ok).toBe(false)
  })
  it('refuses a duplicate name on the same form', () => {
    expect(validateField({ name: 'contract', type: 'text' }, existing).ok).toBe(false)
  })
  it('lets a field keep its own name while being edited', () => {
    expect(validateField({ name: 'Contract', type: 'text' }, existing, { id: 'f1' }).ok).toBe(true)
  })
  it('refuses a dropdown with fewer than two choices', () => {
    expect(validateField({ name: 'City', type: 'select', options: ['Riyadh'] }, []).ok).toBe(false)
  })
  it('refuses a dropdown listing the same choice twice', () => {
    const r = validateField({ name: 'City', type: 'select', options: ['Riyadh', 'riyadh'] }, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/same choice twice/)
  })
})

describe('displayValue', () => {
  it('reads a checkbox as yes or no, including when unanswered', () => {
    expect(displayValue(text({ type: 'checkbox' }), true)).toBe('Yes')
    expect(displayValue(text({ type: 'checkbox' }), undefined)).toBe('No')
  })
  it('formats a date through the supplied formatter', () => {
    expect(displayValue(text({ type: 'date' }), '2026-03-04', { fmtDate: () => '04/03/2026' })).toBe('04/03/2026')
  })
  it('shows nothing for a blank', () => {
    expect(displayValue(text(), '')).toBe('')
  })
})

describe('filledValues', () => {
  it('returns only the fields with something to show', () => {
    const defs = [text({ id: 'a', name: 'A' }), text({ id: 'b', name: 'B' })]
    expect(filledValues(defs, { a: 'yes' }).map((r) => r.field.id)).toEqual(['a'])
  })
})

describe('migrateLegacy — nothing a user typed may disappear', () => {
  const legacy = { customer: ['Contract #', 'Site code'], supplier: ['Vendor code'] }

  it('turns labels into definitions with ids', () => {
    const { customFields } = migrateLegacy(legacy)
    expect(customFields.customer.map((f) => f.name)).toEqual(['Contract #', 'Site code'])
    customFields.customer.forEach((f) => expect(f.id).toMatch(/^cf-/))
  })

  it('rekeys a record from label to the matching id', () => {
    const { customFields, rekey } = migrateLegacy(legacy)
    const id = customFields.customer.find((f) => f.name === 'Contract #').id
    expect(rekey('customer', { 'Contract #': 'ABC-1' })).toEqual({ [id]: 'ABC-1' })
  })

  it('keeps a value whose label has no definition instead of dropping it', () => {
    // The definition may have been deleted while the value lived on. Losing it
    // silently is worse than carrying an orphan.
    const { rekey } = migrateLegacy(legacy)
    expect(rekey('customer', { Ghost: 'still here' })).toEqual({ Ghost: 'still here' })
  })

  it('gives every entity a list, so the settings form has something to render', () => {
    const { customFields } = migrateLegacy(undefined)
    CF_ENTITIES.forEach((e) => expect(Array.isArray(customFields[e.id])).toBe(true))
  })

  it('leaves already-migrated definitions alone', () => {
    const done = { customer: [{ id: 'cf-keep', name: 'Contract', type: 'date' }] }
    const { customFields, rekey } = migrateLegacy(done)
    expect(customFields.customer[0]).toMatchObject({ id: 'cf-keep', type: 'date' })
    expect(rekey('customer', { 'cf-keep': '2026-01-01' })).toEqual({ 'cf-keep': '2026-01-01' })
  })

  it('survives rubbish', () => {
    expect(migrateLegacy(null).customFields.customer).toEqual([])
    expect(migrateLegacy({ customer: 'nope' }).customFields.customer).toEqual([])
  })
})

describe('exportColumns', () => {
  it('namespaces the key so a custom field cannot collide with a built-in column', () => {
    // A field the user names "Name" must not overwrite the record's own Name.
    const [col] = exportColumns([text({ id: 'f1', name: 'Name' })])
    expect(col.key).toBe('custom.f1')
    expect(col.label).toBe('Name')
  })

  it('reads the value out of the record bag, one level down', () => {
    const [col] = exportColumns([text({ id: 'f1', name: 'Contract' })])
    expect(col.map(undefined, { name: 'Acme', customFields: { f1: 'ABC-1' } })).toBe('ABC-1')
  })

  it('exports a checkbox as yes or no and a date through the formatter', () => {
    const [cb] = exportColumns([text({ id: 'c', type: 'checkbox' })])
    expect(cb.map(undefined, { customFields: { c: true } })).toBe('Yes')
    const [d] = exportColumns([text({ id: 'd', type: 'date' })], { fmtDate: () => '04/03/2026' })
    expect(d.map(undefined, { customFields: { d: '2026-03-04' } })).toBe('04/03/2026')
  })

  it('gives an empty cell for a record that never filled the field in', () => {
    const [col] = exportColumns([text({ id: 'f1', name: 'Contract' })])
    expect(col.map(undefined, { name: 'Acme' })).toBe('')
  })

  it('right-aligns numbers only', () => {
    expect(exportColumns([text({ type: 'number' })])[0].right).toBe(true)
    expect(exportColumns([text()])[0].right).toBe(false)
  })
})

describe('the catalogue itself', () => {
  it('offers the types people actually need', () => {
    expect(CF_TYPES.map((t) => t.id)).toEqual(['text', 'textarea', 'number', 'date', 'select', 'checkbox'])
  })
  it('has no duplicate entity ids', () => {
    expect(new Set(CF_ENTITIES.map((e) => e.id)).size).toBe(CF_ENTITIES.length)
  })
})
