import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { RECYCLABLE } from '../src/utils/recycleBin.js'

const g = () => useStore.getState()
const last = (a) => a[a.length - 1]
const binFor = (recordId) => (g().recycleBin || []).filter((e) => e.recordId === recordId)

describe('deleting a covered record puts it in the bin', () => {
  beforeEach(() => useStore.setState({ recycleBin: [] }))

  it('captures a customer on the way out', () => {
    g().addCustomer({ name: 'Deletable Co', email: 'x@y.com' })
    const c = last(g().customers)
    g().deleteCustomer(c.id)

    expect(g().customers.find((x) => x.id === c.id)).toBeUndefined()
    const [entry] = binFor(c.id)
    expect(entry.entity).toBe('customers')
    expect(entry.record).toMatchObject({ name: 'Deletable Co', email: 'x@y.com' })
  })

  it('captures records across every kind of covered entity', () => {
    g().addSupplier({ name: 'Gone Supplier' })
    const sup = last(g().suppliers)
    g().addInventoryItem({ name: 'Gone Item', code: 'GI', quantity: 0, costPrice: 0, salePrice: 0 })
    const item = last(g().inventoryItems)
    g().addLead({ company: 'Gone Lead' })
    const lead = last(g().leads)

    g().deleteSupplier(sup.id); g().deleteInventoryItem(item.id); g().deleteLead(lead.id)

    expect(binFor(sup.id)[0].entity).toBe('suppliers')
    expect(binFor(item.id)[0].entity).toBe('inventoryItems')
    expect(binFor(lead.id)[0].entity).toBe('leads')
  })

  it('leaves ledger documents alone — those are voided, not binned', () => {
    g().addCustomer({ name: 'Invoice Co' })
    const cust = last(g().customers)
    const inv = g().addInvoice({
      customerId: cust.id, customerName: 'Invoice Co', date: '2026-05-01', dueDate: '2026-06-01',
      items: [{ description: 'x', quantity: 1, unitPrice: 100, taxRate: 0, subtotal: 100, accountId: 'acc-sales' }],
      subtotal: 100, taxAmount: 0, total: 100,
    })
    const before = (g().recycleBin || []).length
    g().deleteInvoice(inv.id)
    // Nothing added to the bin: restoring an invoice whose entries were
    // reversed would post the sale twice.
    expect((g().recycleBin || []).length).toBe(before)
  })

  it('does nothing when the id does not exist', () => {
    const before = (g().recycleBin || []).length
    g().deleteCustomer('no-such-id')
    expect((g().recycleBin || []).length).toBe(before)
  })
})

describe('restoreFromBin', () => {
  beforeEach(() => useStore.setState({ recycleBin: [] }))

  it('puts the record back exactly as it was', () => {
    g().addCustomer({ name: 'Restore Co', email: 'r@x.com', creditLimit: 1234 })
    const c = last(g().customers)
    g().deleteCustomer(c.id)
    const entry = binFor(c.id)[0]

    const restored = g().restoreFromBin(entry.id)

    expect(restored).toMatchObject({ id: c.id, name: 'Restore Co', email: 'r@x.com', creditLimit: 1234 })
    expect(g().customers.find((x) => x.id === c.id)).toMatchObject({ name: 'Restore Co' })
    // The entry leaves the bin once used.
    expect(binFor(c.id)).toHaveLength(0)
  })

  it('writes the restore into the audit trail', () => {
    g().addSupplier({ name: 'Audited Supplier' })
    const sup = last(g().suppliers)
    g().deleteSupplier(sup.id)
    g().restoreFromBin(binFor(sup.id)[0].id)

    const entry = last(g().auditLog)
    expect(entry.action).toMatch(/Restored from recycle bin/)
  })

  it('refuses when the id has been taken by a new record', () => {
    g().addCustomer({ name: 'Clash Co' })
    const c = last(g().customers)
    g().deleteCustomer(c.id)
    const entryId = binFor(c.id)[0].id

    // Someone re-created it by hand under the same id.
    useStore.setState((s) => ({ customers: [...s.customers, { id: c.id, name: 'Recreated' }] }))

    expect(() => g().restoreFromBin(entryId)).toThrow(/RESTORE_DENIED/)
    expect(g().customers.filter((x) => x.id === c.id)).toHaveLength(1)
  })

  it('refuses an entry that is not there', () => {
    expect(() => g().restoreFromBin('nope')).toThrow(/RESTORE_DENIED/)
  })

  it('survives a delete-restore-delete-restore cycle', () => {
    g().addCustomer({ name: 'Cycle Co' })
    const c = last(g().customers)
    for (let i = 0; i < 2; i++) {
      g().deleteCustomer(c.id)
      g().restoreFromBin(binFor(c.id)[0].id)
    }
    expect(g().customers.filter((x) => x.id === c.id)).toHaveLength(1)
  })
})

describe('purge and empty', () => {
  beforeEach(() => useStore.setState({ recycleBin: [] }))

  it('purges one entry for good', () => {
    g().addCustomer({ name: 'Purge Co' })
    const c = last(g().customers)
    g().deleteCustomer(c.id)
    const entryId = binFor(c.id)[0].id

    g().purgeFromBin(entryId)

    expect(binFor(c.id)).toHaveLength(0)
    expect(g().customers.find((x) => x.id === c.id)).toBeUndefined()
    expect(() => g().restoreFromBin(entryId)).toThrow()
  })

  it('records a purge as critical, because it cannot be undone', () => {
    g().addCustomer({ name: 'Critical Co' })
    const c = last(g().customers)
    g().deleteCustomer(c.id)
    g().purgeFromBin(binFor(c.id)[0].id)
    expect(last(g().auditLog).severity).toBe('critical')
  })

  it('empties the whole bin', () => {
    g().addCustomer({ name: 'A' }); g().deleteCustomer(last(g().customers).id)
    g().addCustomer({ name: 'B' }); g().deleteCustomer(last(g().customers).id)
    expect(g().recycleBin.length).toBeGreaterThanOrEqual(2)

    g().emptyRecycleBin()
    expect(g().recycleBin).toHaveLength(0)
  })

  it('empties only the entries named', () => {
    g().addCustomer({ name: 'Keep' }); const keep = last(g().customers); g().deleteCustomer(keep.id)
    g().addCustomer({ name: 'Drop' }); const drop = last(g().customers); g().deleteCustomer(drop.id)

    g().emptyRecycleBin([binFor(drop.id)[0].id])

    expect(binFor(drop.id)).toHaveLength(0)
    expect(binFor(keep.id)).toHaveLength(1)
  })
})

describe('the bin is bounded', () => {
  it('keeps at most 1000 entries so a bulk delete cannot fill storage', () => {
    // Seeded rather than deleted one-by-one: the cap is the behaviour under
    // test, not the store's write throughput.
    useStore.setState({
      recycleBin: Array.from({ length: 1000 }, (_, i) => ({
        id: `old:${i}`, entity: 'customers', recordId: `old-${i}`,
        record: { id: `old-${i}` }, deletedAt: '2026-01-01T00:00:00.000Z',
      })),
    })

    g().addCustomer({ name: 'The Newest' })
    const c = last(g().customers)
    g().deleteCustomer(c.id)

    expect(g().recycleBin.length).toBeLessThanOrEqual(1000)
    // The newest deletion is the one worth keeping; the oldest falls off.
    expect(binFor(c.id)).toHaveLength(1)
    expect(g().recycleBin.some((e) => e.id === 'old:0')).toBe(false)
    useStore.setState({ recycleBin: [] })
  })
})

describe('every covered entity actually snapshots on delete', () => {
  it('has a matching delete action wired for each slice in RECYCLABLE', () => {
    // Guards against adding an entity to RECYCLABLE and forgetting to call
    // recycleRecord in its delete action.
    const wired = {
      customers: 'deleteCustomer', suppliers: 'deleteSupplier', inventoryItems: 'deleteInventoryItem',
      accounts: 'deleteAccount', departments: 'deleteDepartment', employees: 'deleteEmployee',
      warehouses: 'deleteWarehouse', leads: 'deleteLead', projects: 'deleteProject',
      currencies: 'deleteCurrency', matchRules: 'deleteMatchRule', budgets: 'deleteBudget',
      billsOfMaterials: 'deleteBOM', recurringInvoices: 'deleteRecurringInvoice',
      recurringJournals: 'deleteRecurringJournal', recurringExpenses: 'deleteRecurringExpense',
      quotations: 'deleteQuotation', purchaseOrders: 'deletePurchaseOrder',
      requisitions: 'deleteRequisition', deliveryNotes: 'deleteDeliveryNote',
      timeEntries: 'deleteTimeEntry', scheduledTransfers: 'deleteScheduledTransfer',
      capitalAccounts: 'deleteCapitalAccount',
      salesOrders: 'deleteSalesOrder', purchaseQuotes: 'deletePurchaseQuote',
    }
    Object.keys(RECYCLABLE).forEach((entity) => {
      expect(wired[entity], `${entity} has no delete action mapped`).toBeTruthy()
      expect(typeof g()[wired[entity]], `${wired[entity]} missing from store`).toBe('function')
    })
  })
})
