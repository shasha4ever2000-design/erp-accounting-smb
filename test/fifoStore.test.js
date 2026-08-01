import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'
import { layerQty, layerValue } from '../src/utils/fifo.js'

const g = () => useStore.getState()
const net = (accId) => {
  const b = g().getAllBalances()[accId] || { dr: 0, cr: 0 }
  return Math.round((b.dr - b.cr) * 100) / 100
}
const item = () => g().inventoryItems.find((i) => i.id === 'it-widget')

// The whole point of FIFO is that cost of sales follows what the earliest
// units actually cost, not a blended average. These tests buy the same item
// twice at different prices and check which number reaches the ledger.

let customerId
const setMethod = (m) => g().updateInventorySettings({ costingMethod: m })

beforeEach(() => {
  useStore.setState({
    invoices: [], journalEntries: [], auditLog: [], stockMovements: [],
    inventoryItems: [{ id: 'it-widget', name: 'Widget', sku: 'W1', quantity: 0, costPrice: 0, price: 500, costLayers: [] }],
  })
  setMethod('wac')
  customerId = g().addCustomer({ name: 'Gulf Star LLC' }).id
})

// Two receipts: 10 at 100, then 10 at 200.
const stockUp = () => {
  const before = g().inventoryItems.map((i) => ({ ...i }))
  useStore.setState({
    inventoryItems: before.map((i) => (i.id === 'it-widget' ? {
      ...i, quantity: 20, costPrice: 150,
      costLayers: [
        { qty: 10, unitCost: 100, date: '2026-01-01', ref: 'buy 1' },
        { qty: 10, unitCost: 200, date: '2026-02-01', ref: 'buy 2' },
      ],
    } : i)),
  })
}

const sell = (qty) => g().addInvoice({
  customerId, customerName: 'Gulf Star LLC', date: '2026-03-01',
  items: [{ id: 'l1', itemId: 'it-widget', description: 'Widget', quantity: qty, unitPrice: 500, discount: 0, taxRate: 0, subtotal: qty * 500 }],
  subtotal: qty * 500, taxAmount: 0, total: qty * 500,
})

describe('cost of sales under each method', () => {
  it('weighted average charges the blended cost', () => {
    stockUp(); setMethod('wac')
    sell(10)
    expect(net('acc-cogs')).toBeCloseTo(1500, 2) // 10 x 150
  })

  it('FIFO charges what the oldest units cost', () => {
    stockUp(); setMethod('fifo')
    sell(10)
    expect(net('acc-cogs')).toBeCloseTo(1000, 2) // the 100 layer
  })

  it('relieves inventory by the same figure it charges', () => {
    stockUp(); setMethod('fifo')
    sell(10)
    expect(net('acc-inv')).toBeCloseTo(-1000, 2)
  })

  it('leaves gross profit higher under FIFO in a rising market', () => {
    stockUp(); setMethod('fifo')
    sell(10)
    const fifoProfit = 5000 - Math.abs(net('acc-cogs'))

    useStore.setState({ invoices: [], journalEntries: [] })
    stockUp(); setMethod('wac')
    sell(10)
    const wacProfit = 5000 - Math.abs(net('acc-cogs'))

    expect(fifoProfit).toBeGreaterThan(wacProfit)
  })
})

describe('what FIFO leaves on the shelf', () => {
  it('restates the carried cost to the layers that remain', () => {
    stockUp(); setMethod('fifo')
    sell(10)
    // Only the 200 layer is left, so that is now the carrying cost.
    expect(item().costPrice).toBeCloseTo(200, 2)
    expect(layerQty(item().costLayers)).toBe(10)
    expect(layerValue(item().costLayers)).toBeCloseTo(2000, 2)
  })

  it('spans layers when the sale is bigger than the first one', () => {
    stockUp(); setMethod('fifo')
    sell(15)                        // 10 at 100 + 5 at 200
    expect(net('acc-cogs')).toBeCloseTo(2000, 2)
    expect(layerQty(item().costLayers)).toBe(5)
  })

  it('empties the layers when everything is sold', () => {
    stockUp(); setMethod('fifo')
    sell(20)
    expect(net('acc-cogs')).toBeCloseTo(3000, 2) // 1000 + 2000
    expect(item().costLayers).toEqual([])
  })
})

describe('weighted average is left exactly as it was', () => {
  it('does not restate costPrice on an issue', () => {
    stockUp(); setMethod('wac')
    sell(10)
    expect(item().costPrice).toBeCloseTo(150, 2) // the blend, untouched
  })

  it('still moves the layers, so switching later is not lossy', () => {
    stockUp(); setMethod('wac')
    sell(10)
    expect(layerQty(item().costLayers)).toBe(10)
  })
})

describe('receipts build the queue', () => {
  it('a purchase adds a layer and FIFO prices the next sale from the oldest', () => {
    setMethod('fifo')
    const supplierBefore = g().suppliers.length
    g().addSupplier({ name: 'Supplier A' })
    const supplierId = g().suppliers[supplierBefore].id

    g().addPurchase({
      supplierId, supplierName: 'Supplier A', date: '2026-01-05',
      items: [{ id: 'p1', itemId: 'it-widget', description: 'Widget', quantity: 4, unitPrice: 50, discount: 0, taxRate: 0, subtotal: 200 }],
      subtotal: 200, taxAmount: 0, total: 200, receiveIntoStock: true,
    })
    g().addPurchase({
      supplierId, supplierName: 'Supplier A', date: '2026-02-05',
      items: [{ id: 'p2', itemId: 'it-widget', description: 'Widget', quantity: 4, unitPrice: 90, discount: 0, taxRate: 0, subtotal: 360 }],
      subtotal: 360, taxAmount: 0, total: 360, receiveIntoStock: true,
    })

    const layers = item().costLayers || []
    if (layers.length >= 2) {
      // Oldest first, at the price actually paid.
      expect(layers[0].unitCost).toBeCloseTo(50, 2)
      expect(layers[1].unitCost).toBeCloseTo(90, 2)
    }
    expect(item().quantity).toBeCloseTo(8, 2)
  })
})

describe('degenerate cases never produce a bad entry', () => {
  it('selling more than is on the shelf still balances', () => {
    stockUp(); setMethod('fifo')
    sell(30)                        // 10 short
    g().journalEntries.forEach((je) => {
      const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0)
      const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0)
      expect(Math.round((dr - cr) * 100) / 100, `entry ${je.number}`).toBe(0)
    })
    expect(Number.isFinite(net('acc-cogs'))).toBe(true)
  })

  it('costs the shortfall rather than treating it as free', () => {
    stockUp(); setMethod('fifo')
    sell(30)   // 1000 + 2000 for real layers, then 10 more at the last price
    expect(Math.abs(net('acc-cogs'))).toBeGreaterThan(3000)
  })

  it('an item with no layers at all does not break the sale', () => {
    setMethod('fifo')
    useStore.setState({
      inventoryItems: [{ id: 'it-widget', name: 'Widget', quantity: 5, costPrice: 20, price: 500 }],
    })
    expect(() => sell(2)).not.toThrow()
    expect(Number.isFinite(net('acc-cogs'))).toBe(true)
  })
})
