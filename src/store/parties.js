// Customers and suppliers.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'

export const createPartiesSlice = (set, get) => ({
  // ─── CUSTOMERS ─────────────────────────────────────────────────
  customers: [],

  addCustomer: (c) => {
    const newC = { ...c, id: uuid(), createdAt: new Date().toISOString() }
    set((s) => ({ customers: [...s.customers, newC] }))
    return newC
  },

  updateCustomer: (id, patch) => {
    const before = get().customers.find((c) => c.id === id)
    set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
    get().logChange('Updated customer', before, get().customers.find((c) => c.id === id), { entity: 'customer' })
  },

  deleteCustomer: (id) => {
    get().recycleRecord('customers', id)
    const gone = get().customers.find((c) => c.id === id)
    set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }))
    if (gone) get().logActivity('Deleted customer', gone.name || '', { entity: 'customer', entityId: id, entityRef: gone.name })
  },

  // ─── SUPPLIERS ─────────────────────────────────────────────────
  suppliers: [],

  addSupplier: (sup) =>
    set((s) => ({ suppliers: [...s.suppliers, { ...sup, id: uuid(), createdAt: new Date().toISOString() }] })),

  updateSupplier: (id, patch) => {
    const before = get().suppliers.find((x) => x.id === id)
    set((s) => ({ suppliers: s.suppliers.map((s2) => (s2.id === id ? { ...s2, ...patch } : s2)) }))
    get().logChange('Updated supplier', before, get().suppliers.find((x) => x.id === id), { entity: 'supplier' })
  },

  deleteSupplier: (id) => {
    get().recycleRecord('suppliers', id)
    const gone = get().suppliers.find((x) => x.id === id)
    set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== id) }))
    if (gone) get().logActivity('Deleted supplier', gone.name || '', { entity: 'supplier', entityId: id, entityRef: gone.name })
  },
})
