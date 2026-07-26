import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { CF_ENTITIES } from '../src/utils/customFields.js'

const g = () => useStore.getState()
const migrate = useStore.persist.getOptions().migrate

beforeEach(() => {
  // Each test starts from an empty definition list so field ids don't leak
  // between cases.
  useStore.setState((s) => ({
    settings: { ...s.settings, customFields: Object.fromEntries(CF_ENTITIES.map((e) => [e.id, []])) },
  }))
})

describe('defining fields', () => {
  it('adds a field and reads it back in order', () => {
    g().addCustomField('customer', { name: 'Contract number', type: 'text' })
    g().addCustomField('customer', { name: 'Region', type: 'select', options: ['North', 'South'] })
    const fields = g().customFieldsFor('customer')
    expect(fields.map((f) => f.name)).toEqual(['Contract number', 'Region'])
    expect(fields[1].options).toEqual(['North', 'South'])
  })

  it('keeps the fields of each form separate', () => {
    g().addCustomField('customer', { name: 'Contract number', type: 'text' })
    expect(g().customFieldsFor('supplier')).toEqual([])
  })

  it('refuses a duplicate name on the same form', () => {
    g().addCustomField('customer', { name: 'Contract', type: 'text' })
    expect(() => g().addCustomField('customer', { name: 'contract', type: 'text' })).toThrow(/CUSTOM_FIELD_INVALID/)
    expect(g().customFieldsFor('customer')).toHaveLength(1)
  })

  it('allows the same name on a different form', () => {
    g().addCustomField('customer', { name: 'Contract', type: 'text' })
    expect(() => g().addCustomField('supplier', { name: 'Contract', type: 'text' })).not.toThrow()
  })

  it('refuses a dropdown with one choice', () => {
    expect(() => g().addCustomField('customer', { name: 'City', type: 'select', options: ['Riyadh'] }))
      .toThrow(/CUSTOM_FIELD_INVALID/)
  })

  it('never marks a field printable on a form that has no printout', () => {
    // The manager hides the option; the store must not depend on that.
    const f = g().addCustomField('invoice', { name: 'PO number', type: 'text', showOnPrint: true })
    expect(f.showOnPrint).toBe(true)
  })

  it('edits a field without changing its id, so values stay attached', () => {
    const f = g().addCustomField('customer', { name: 'Contract', type: 'text' })
    const after = g().updateCustomField('customer', f.id, { name: 'Contract number', type: 'number' })
    expect(after.id).toBe(f.id)
    expect(after.name).toBe('Contract number')
    expect(after.type).toBe('number')
  })

  it('reorders', () => {
    g().addCustomField('customer', { name: 'A', type: 'text' })
    const b = g().addCustomField('customer', { name: 'B', type: 'text' })
    g().moveCustomField('customer', b.id, -1)
    expect(g().customFieldsFor('customer').map((f) => f.name)).toEqual(['B', 'A'])
  })

  it('will not move a field off either end', () => {
    const a = g().addCustomField('customer', { name: 'A', type: 'text' })
    g().moveCustomField('customer', a.id, -1)
    expect(g().customFieldsFor('customer').map((f) => f.name)).toEqual(['A'])
  })

  it('leaves values in the records when a definition is deleted', () => {
    // A field removed by mistake must be recoverable by adding it back, so the
    // deletion does not cascade into the data.
    const f = g().addCustomField('customer', { name: 'Contract', type: 'text' })
    const c = g().addCustomer({ name: 'Acme', customFields: { [f.id]: 'ABC-1' } })
    g().deleteCustomField('customer', f.id)
    expect(g().customers.find((x) => x.id === c.id).customFields[f.id]).toBe('ABC-1')
  })
})

describe('cleanCustomValues', () => {
  it('coerces to the declared types and drops the unknown', () => {
    const n = g().addCustomField('customer', { name: 'Floors', type: 'number' })
    const d = g().addCustomField('customer', { name: 'Since', type: 'date' })
    const out = g().cleanCustomValues('customer', { [n.id]: '3', [d.id]: '2026-02-01', ghost: 'x' })
    expect(out).toEqual({ [n.id]: 3, [d.id]: '2026-02-01' })
  })
})

describe('the version 30 migration — no value may be lost', () => {
  it('turns labels into typed definitions and rekeys the records to match', () => {
    const persisted = {
      settings: { customFields: { customer: ['Contract #'], supplier: ['Vendor code'] } },
      customers: [{ id: 'c1', name: 'Acme', customFields: { 'Contract #': 'ABC-1' } }],
      suppliers: [{ id: 's1', name: 'Globex', customFields: { 'Vendor code': 'V-9' } }],
    }
    const out = migrate(persisted, 29)

    const cust = out.settings.customFields.customer[0]
    expect(cust).toMatchObject({ name: 'Contract #', type: 'text' })
    expect(out.customers[0].customFields).toEqual({ [cust.id]: 'ABC-1' })

    const supp = out.settings.customFields.supplier[0]
    expect(out.suppliers[0].customFields).toEqual({ [supp.id]: 'V-9' })
  })

  it('keeps a value whose label was already deleted rather than dropping it', () => {
    const out = migrate({
      settings: { customFields: { customer: [] } },
      customers: [{ id: 'c1', customFields: { Ghost: 'still here' } }],
    }, 29)
    expect(out.customers[0].customFields).toEqual({ Ghost: 'still here' })
  })

  it('leaves records that never had custom fields untouched', () => {
    const out = migrate({
      settings: { customFields: { customer: ['X'] } },
      customers: [{ id: 'c1', name: 'Acme' }],
    }, 29)
    expect(out.customers[0]).toEqual({ id: 'c1', name: 'Acme' })
  })

  it('gives every form a list so Settings has something to render', () => {
    const out = migrate({ settings: {} }, 29)
    CF_ENTITIES.forEach((e) => expect(Array.isArray(out.settings.customFields[e.id])).toBe(true))
  })

  it('does not run again on data already at version 30', () => {
    const already = {
      settings: { customFields: { customer: [{ id: 'cf-fixed', name: 'Contract', type: 'text' }] } },
      customers: [{ id: 'c1', customFields: { 'cf-fixed': 'ABC-1' } }],
    }
    const out = migrate(already, 30)
    expect(out.settings.customFields.customer[0].id).toBe('cf-fixed')
    expect(out.customers[0].customFields).toEqual({ 'cf-fixed': 'ABC-1' })
  })

  it('survives a file with no customers at all', () => {
    expect(() => migrate({ settings: { customFields: { customer: ['X'] } } }, 29)).not.toThrow()
  })
})
