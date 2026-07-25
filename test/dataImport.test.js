import { describe, it, expect, vi } from 'vitest'
import {
  parseNumber, parseBool, autoMap, planImport, applyPlan,
  exportColumns, templateRow, SCHEMAS,
} from '../src/utils/dataImport.js'

describe('parseNumber — spreadsheets export money in every format there is', () => {
  it('reads a plain number', () => {
    expect(parseNumber('1234.5')).toBe(1234.5)
    expect(parseNumber(42)).toBe(42)
  })
  it('strips thousands separators', () => {
    expect(parseNumber('1,234.50')).toBe(1234.5)
    expect(parseNumber('1,234,567')).toBe(1234567)
  })
  it('reads a European decimal comma', () => {
    expect(parseNumber('1234,50')).toBe(1234.5)
    expect(parseNumber('1.234,50')).toBe(1234.5)
  })
  it('strips currency symbols and spaces', () => {
    expect(parseNumber('$1,234.50')).toBe(1234.5)
    expect(parseNumber('SAR 99')).toBe(99)
    expect(parseNumber(' 12.5 ')).toBe(12.5)
  })
  it('handles negatives', () => {
    expect(parseNumber('-500')).toBe(-500)
  })
  it('returns null for blanks and nonsense rather than 0', () => {
    // Returning 0 would silently turn an unreadable price into a free product.
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber(null)).toBeNull()
  })
})

describe('parseBool', () => {
  it('reads the usual truthy and falsy spellings', () => {
    expect(parseBool('yes')).toBe(true)
    expect(parseBool('TRUE')).toBe(true)
    expect(parseBool('1')).toBe(true)
    expect(parseBool('no')).toBe(false)
    expect(parseBool('0')).toBe(false)
  })
  it('returns null when it cannot tell', () => {
    expect(parseBool('maybe')).toBeNull()
    expect(parseBool('')).toBeNull()
  })
})

describe('autoMap', () => {
  it('maps headers that match exactly', () => {
    const m = autoMap('customers', ['Name', 'Email', 'Phone'])
    expect(m.name).toBe(0)
    expect(m.email).toBe(1)
    expect(m.phone).toBe(2)
  })
  it('is case- and separator-insensitive', () => {
    const m = autoMap('customers', ['CUSTOMER_NAME', 'e-mail', 'Tax  Number'])
    expect(m.name).toBe(0)
    expect(m.email).toBe(1)
    expect(m.taxNumber).toBe(2)
  })
  it('prefers an exact match over a substring one', () => {
    // "Name" must win outright rather than losing to "Customer Name" merely
    // because the latter contains an alias.
    const m = autoMap('customers', ['Customer Name', 'Name'])
    expect(m.name).toBe(1)
  })
  it('never assigns one column to two fields', () => {
    const m = autoMap('customers', ['Name', 'Notes'])
    const used = Object.values(m).filter((i) => i > -1)
    expect(new Set(used).size).toBe(used.length)
  })
  it('reports -1 for fields with no matching column', () => {
    expect(autoMap('customers', ['Name']).phone).toBe(-1)
  })
  it('maps an accounts file', () => {
    const m = autoMap('accounts', ['Account Code', 'Account Name', 'Type'])
    expect(m.code).toBe(0); expect(m.name).toBe(1); expect(m.type).toBe(2)
  })
  it('maps an inventory file with SKU and selling price', () => {
    const m = autoMap('inventoryItems', ['SKU', 'Description', 'Selling Price'])
    expect(m.code).toBe(0); expect(m.name).toBe(1); expect(m.salePrice).toBe(2)
  })
  it('returns nothing for an unknown entity rather than throwing', () => {
    expect(autoMap('nope', ['A'])).toEqual({})
  })
})

describe('planImport — decides, but changes nothing', () => {
  const map = { name: 0, email: 1, creditLimit: 2 }

  it('plans a create for a name not already on file', () => {
    const p = planImport('customers', [['Acme', 'a@x.com', '5000']], map, [])
    expect(p.counts).toMatchObject({ create: 1, update: 0, error: 0 })
    expect(p.creates[0].record).toEqual({ name: 'Acme', email: 'a@x.com', creditLimit: 5000 })
    expect(p.creates[0].line).toBe(2)   // line 1 is the header
  })

  it('plans an update and lists exactly which fields differ', () => {
    const existing = [{ id: 'c1', name: 'Acme', email: 'old@x.com', creditLimit: 5000 }]
    const p = planImport('customers', [['Acme', 'new@x.com', '5000']], map, existing)
    expect(p.counts).toMatchObject({ create: 0, update: 1 })
    expect(p.updates[0].id).toBe('c1')
    expect(p.updates[0].changes).toEqual([{ field: 'email', from: 'old@x.com', to: 'new@x.com' }])
  })

  it('skips a row that would change nothing', () => {
    // Re-importing an unchanged file must not churn every record and fill the
    // audit log with meaningless edits.
    const existing = [{ id: 'c1', name: 'Acme', email: 'a@x.com', creditLimit: 5000 }]
    const p = planImport('customers', [['Acme', 'a@x.com', '5000']], map, existing)
    expect(p.counts).toMatchObject({ create: 0, update: 0, skip: 1 })
    expect(p.skips[0].reason).toBe('No change')
  })

  it('matches the key case-insensitively', () => {
    const p = planImport('customers', [['ACME', 'a@x.com', '']], map, [{ id: 'c1', name: 'Acme' }])
    expect(p.counts.update + p.counts.skip).toBe(1)
    expect(p.counts.create).toBe(0)
  })

  it('treats blank and missing as the same, so absent columns are not "changes"', () => {
    const existing = [{ id: 'c1', name: 'Acme', email: '' }]
    const p = planImport('customers', [['Acme', '', '']], map, existing)
    expect(p.counts.skip).toBe(1)
  })

  it('ignores entirely blank lines', () => {
    const p = planImport('customers', [['', '', ''], ['Acme', '', '']], map, [])
    expect(p.counts).toMatchObject({ create: 1, error: 0 })
  })
})

describe('planImport — bad rows fail alone, they do not poison the file', () => {
  const map = { name: 0, email: 1, creditLimit: 2 }

  it('reports a missing required field with its line number', () => {
    const p = planImport('customers', [['', 'a@x.com', '']], map, [])
    expect(p.counts).toMatchObject({ create: 0, error: 1 })
    expect(p.errors[0].line).toBe(2)
    expect(p.errors[0].errors[0]).toMatch(/Name is required/)
  })

  it('reports an unreadable number instead of importing it as zero', () => {
    const p = planImport('customers', [['Acme', '', 'lots']], map, [])
    expect(p.counts.error).toBe(1)
    expect(p.errors[0].errors[0]).toMatch(/not a number/)
  })

  it('reports an invalid email', () => {
    const p = planImport('customers', [['Acme', 'not-an-email', '']], map, [])
    expect(p.errors[0].errors[0]).toMatch(/valid email/)
  })

  it('rejects a negative amount', () => {
    const p = planImport('customers', [['Acme', '', '-5']], map, [])
    expect(p.errors[0].errors[0]).toMatch(/negative/)
  })

  it('rejects an account type outside the allowed set, and names them', () => {
    const p = planImport('accounts', [['5100', 'Marketing', 'costs']], { code: 0, name: 1, type: 2 }, [])
    expect(p.counts.error).toBe(1)
    expect(p.errors[0].errors[0]).toMatch(/asset, liability, equity, revenue, expense/)
  })

  it('accepts a valid account type case-insensitively', () => {
    const p = planImport('accounts', [['5100', 'Marketing', 'Expense']], { code: 0, name: 1, type: 2 }, [])
    expect(p.counts.create).toBe(1)
    expect(p.creates[0].record.type).toBe('expense')
  })

  it('catches a key repeated inside the same file', () => {
    // Without this the second row would silently overwrite the first.
    const p = planImport('customers', [['Acme', '', ''], ['acme', '', '']], map, [])
    expect(p.counts).toMatchObject({ create: 1, error: 1 })
    expect(p.errors[0].errors[0]).toMatch(/Duplicate .* also on line 2/)
  })

  it('keeps the good rows when one row is bad', () => {
    const p = planImport('customers', [['Good', '', ''], ['', '', ''], ['Also Good', '', '']], map, [])
    // Row 3 is blank, not an error — rows 2 and 4 both import.
    expect(p.counts).toMatchObject({ create: 2, error: 0 })
  })

  it('collects every problem on a row, not just the first', () => {
    const p = planImport('customers', [['', 'bad', 'x']], map, [])
    expect(p.errors[0].errors.length).toBeGreaterThan(1)
  })
})

describe('applyPlan — writes through the store\'s own actions', () => {
  const plan = {
    creates: [{ line: 2, record: { name: 'New Co' } }],
    updates: [{ line: 3, id: 'c1', record: { name: 'Acme', email: 'x@y.com' }, changes: [] }],
    skips: [], errors: [],
  }

  it('creates and updates through the supplied actions', () => {
    const add = vi.fn(); const update = vi.fn()
    const res = applyPlan(plan, { add, update })
    expect(add).toHaveBeenCalledWith({ name: 'New Co' })
    expect(update).toHaveBeenCalledWith('c1', { name: 'Acme', email: 'x@y.com' })
    expect(res).toMatchObject({ created: 1, updated: 1 })
    expect(res.failed).toEqual([])
  })

  it('can create without touching existing records', () => {
    const add = vi.fn(); const update = vi.fn()
    const res = applyPlan(plan, { add, update }, { updateExisting: false })
    expect(add).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(res.updated).toBe(0)
  })

  it('records a failing row and carries on with the rest', () => {
    const add = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom') })
      .mockImplementationOnce(() => {})
    const res = applyPlan(
      { ...plan, creates: [{ line: 2, record: { name: 'A' } }, { line: 3, record: { name: 'B' } }], updates: [] },
      { add, update: vi.fn() }
    )
    expect(res.created).toBe(1)
    expect(res.failed).toEqual([{ line: 2, error: 'boom' }])
  })
})

describe('schemas, export columns and templates line up', () => {
  it('every entity has a key field and a store binding', () => {
    Object.entries(SCHEMAS).forEach(([, sc]) => {
      expect(sc.fields.filter((f) => f.key)).toHaveLength(1)
      expect(sc.store.add).toBeTruthy()
      expect(sc.store.update).toBeTruthy()
      expect(sc.store.list).toBeTruthy()
    })
  })

  it('exports the same columns the importer reads back', () => {
    Object.keys(SCHEMAS).forEach((entity) => {
      const cols = exportColumns(entity).map((c) => c.key)
      expect(cols).toEqual(SCHEMAS[entity].fields.map((f) => f.name))
    })
  })

  it('a template round-trips: export headers auto-map back onto themselves', () => {
    Object.keys(SCHEMAS).forEach((entity) => {
      const labels = exportColumns(entity).map((c) => c.label)
      const m = autoMap(entity, labels)
      SCHEMAS[entity].fields.forEach((f) => {
        expect(m[f.name], `${entity}.${f.name} should map from its own export header`).toBeGreaterThan(-1)
      })
    })
  })

  it('gives a filled sample row for every entity', () => {
    Object.keys(SCHEMAS).forEach((entity) => {
      const row = templateRow(entity)
      const keyField = SCHEMAS[entity].fields.find((f) => f.key)
      expect(row[keyField.name]).toBeTruthy()
    })
  })

  it('never offers stock on hand as an importable field', () => {
    // Importing quantity would move the inventory account with no journal
    // entry behind it. That belongs in Opening Balances.
    const names = SCHEMAS.inventoryItems.fields.map((f) => f.name)
    expect(names).not.toContain('quantity')
  })
})
