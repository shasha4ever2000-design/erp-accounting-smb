// Gross margin by customer, item and department.
//
// The tests that carry weight here are about what margin is *for*: ranking by
// profit rather than revenue, netting returns against the customer that made
// them, and never silently presenting an apportioned estimate as an exact
// figure. Arithmetic correctness matters too, but a report that adds up and
// ranks the wrong customer first is still the wrong report.
import { describe, it, expect } from 'vitest'
import {
  marginPct, documentCost, lineCosts, marginBy,
  marginByCustomer, marginByItem, marginByDepartment, marginSummary,
} from '../src/utils/margin.js'

// A sale with cost recorded at posting time (the modern shape).
const sale = (over = {}) => ({
  id: 'i1', number: 'INV-1', status: 'sent', date: '2026-03-10',
  customerId: 'c1', customerName: 'Acme', subtotal: 1000,
  items: [{ itemId: 'p1', description: 'Widget', quantity: 10, subtotal: 1000 }],
  cogsTotal: 600, cogsByItem: { p1: 600 },
  ...over,
})

const stock = [{ id: 'p1', name: 'Widget', trackStock: true }, { id: 'p2', name: 'Gadget', trackStock: true }]

describe('margin percentage', () => {
  it('is profit over revenue', () => {
    expect(marginPct(1000, 600)).toBeCloseTo(0.4)
  })

  it('is null rather than Infinity when there is no revenue', () => {
    expect(marginPct(0, 500)).toBeNull()
  })

  it('goes negative when cost exceeds revenue', () => {
    expect(marginPct(100, 150)).toBeCloseTo(-0.5)
  })
})

describe('reading a document’s cost', () => {
  it('prefers the cost recorded when the sale was posted', () => {
    expect(documentCost(sale())).toEqual({ cost: 600, exact: true })
  })

  it('falls back to the COGS journal entry and flags the figure as inexact', () => {
    const old = { cogsJournalEntryId: 'je1', items: [] }
    const jes = [{ id: 'je1', lines: [
      { accountId: 'acc-cogs', debit: 450, credit: 0 },
      { accountId: 'acc-inv', debit: 0, credit: 450 },
    ] }]
    expect(documentCost(old, jes)).toEqual({ cost: 450, exact: false })
  })

  it('treats a sale with no COGS entry as a zero-cost service sale', () => {
    expect(documentCost({ items: [] }, [])).toEqual({ cost: 0, exact: true })
  })

  it('does not re-derive cost from the item’s current price', () => {
    // The whole point: the item may have been repriced ten times since.
    const doc = sale({ cogsTotal: 600 })
    const expensiveNow = [{ id: 'p1', name: 'Widget', costPrice: 999 }]
    expect(documentCost(doc, [], expensiveNow).cost).toBe(600)
  })
})

describe('cost per line', () => {
  it('uses the recorded per-item cost', () => {
    const doc = sale({
      items: [
        { itemId: 'p1', quantity: 10, subtotal: 1000 },
        { itemId: 'p2', quantity: 5, subtotal: 500 },
      ],
      cogsByItem: { p1: 600, p2: 300 },
    })
    expect(lineCosts(doc, { inventoryItems: stock })).toEqual([
      { cost: 600, exact: true }, { cost: 300, exact: true },
    ])
  })

  it('splits one item across two lines by revenue', () => {
    const doc = sale({
      items: [
        { itemId: 'p1', quantity: 5, subtotal: 750 },
        { itemId: 'p1', quantity: 5, subtotal: 250 },
      ],
      cogsByItem: { p1: 600 },
    })
    expect(lineCosts(doc, { inventoryItems: stock })).toEqual([
      { cost: 450, exact: true }, { cost: 150, exact: true },
    ])
  })

  it('gives a service line zero cost, not a share of the goods', () => {
    const doc = sale({
      items: [
        { itemId: 'p1', quantity: 10, subtotal: 1000 },
        { description: 'Consulting', quantity: 4, subtotal: 800 },   // no itemId
      ],
      cogsByItem: { p1: 600 },
    })
    const [goods, service] = lineCosts(doc, { inventoryItems: stock })
    expect(goods).toEqual({ cost: 600, exact: true })
    expect(service).toEqual({ cost: 0, exact: true })
  })

  it('apportions a historical document across its stock lines and flags it', () => {
    const old = {
      cogsJournalEntryId: 'je1',
      items: [
        { itemId: 'p1', quantity: 1, subtotal: 750 },
        { itemId: 'p2', quantity: 1, subtotal: 250 },
        { description: 'Delivery', quantity: 1, subtotal: 100 },
      ],
    }
    const jes = [{ id: 'je1', lines: [{ accountId: 'acc-cogs', debit: 400, credit: 0 }] }]
    const out = lineCosts(old, { journalEntries: jes, inventoryItems: stock })
    expect(out[0]).toEqual({ cost: 300, exact: false })   // 750/1000 of 400
    expect(out[1]).toEqual({ cost: 100, exact: false })   // 250/1000 of 400
    expect(out[2]).toEqual({ cost: 0, exact: true })      // service line untouched
  })
})

describe('margin by customer', () => {
  const data = {
    invoices: [
      sale({ id: 'a', customerId: 'c1', customerName: 'Acme', subtotal: 10000, cogsTotal: 9600, cogsByItem: { p1: 9600 } }),
      sale({ id: 'b', customerId: 'c2', customerName: 'Bright', subtotal: 4000, cogsTotal: 1200, cogsByItem: { p1: 1200 } }),
    ],
    creditNotes: [], journalEntries: [], inventoryItems: stock,
  }

  it('ranks by profit, not revenue — the whole point of the report', () => {
    const rows = marginByCustomer(data)
    // Acme is 71% of revenue but the weaker customer by profit.
    expect(rows[0].label).toBe('Bright')
    expect(rows[0].profit).toBe(2800)
    expect(rows[1].label).toBe('Acme')
    expect(rows[1].profit).toBe(400)
  })

  it('computes the margin percentage per customer', () => {
    const rows = marginByCustomer(data)
    expect(rows.find((r) => r.label === 'Acme').pct).toBeCloseTo(0.04)
    expect(rows.find((r) => r.label === 'Bright').pct).toBeCloseTo(0.70)
  })

  it('nets a return against the customer that made it', () => {
    const withReturn = {
      ...data,
      creditNotes: [{
        id: 'cn1', status: 'issued', date: '2026-03-20', invoiceId: 'b',
        subtotal: 2000, cogsTotal: 600, cogsByItem: { p1: 600 },
        items: [{ itemId: 'p1', quantity: 5, subtotal: 2000 }],
      }],
    }
    const bright = marginByCustomer(withReturn).find((r) => r.label === 'Bright')
    expect(bright.revenue).toBe(2000)   // 4000 sold, 2000 returned
    expect(bright.cost).toBe(600)       // 1200 cost, 600 back
    expect(bright.profit).toBe(1400)
    expect(bright.returns).toBe(2000)
  })

  it('excludes void invoices and opening stubs', () => {
    const noisy = { ...data, invoices: [
      ...data.invoices,
      sale({ id: 'v', status: 'void', customerId: 'c3', customerName: 'Void Co', subtotal: 99999 }),
      sale({ id: 'o', isOpening: true, customerId: 'c4', customerName: 'Opening', subtotal: 88888 }),
    ] }
    const labels = marginByCustomer(noisy).map((r) => r.label)
    expect(labels).not.toContain('Void Co')
    expect(labels).not.toContain('Opening')
  })

  it('honours a date range', () => {
    const rows = marginByCustomer(data, { from: '2026-04-01', to: '2026-04-30' })
    expect(rows).toEqual([])
  })

  it('uses revenue net of tax, because margin is a trading measure', () => {
    const taxed = { ...data, invoices: [
      sale({ id: 't', customerId: 'c9', customerName: 'Taxed', subtotal: 1000, taxAmount: 150, total: 1150,
             cogsTotal: 400, cogsByItem: { p1: 400 } }),
    ] }
    const row = marginByCustomer(taxed)[0]
    expect(row.revenue).toBe(1000)      // not 1150
    expect(row.pct).toBeCloseTo(0.6)
  })
})

describe('margin by item', () => {
  it('aggregates the same item across invoices', () => {
    const data = {
      invoices: [
        sale({ id: 'a', items: [{ itemId: 'p1', description: 'Widget', quantity: 10, subtotal: 1000 }], cogsByItem: { p1: 600 }, cogsTotal: 600 }),
        sale({ id: 'b', items: [{ itemId: 'p1', description: 'Widget', quantity: 5, subtotal: 500 }], cogsByItem: { p1: 300 }, cogsTotal: 300 }),
      ],
      creditNotes: [], journalEntries: [], inventoryItems: stock,
    }
    const [row] = marginByItem(data)
    expect(row).toMatchObject({ label: 'Widget', qty: 15, revenue: 1500, cost: 900, profit: 600 })
    expect(row.pct).toBeCloseTo(0.4)
  })

  it('subtracts returned units and their cost', () => {
    const data = {
      invoices: [sale({ items: [{ itemId: 'p1', description: 'Widget', quantity: 10, subtotal: 1000 }], cogsByItem: { p1: 600 }, cogsTotal: 600 })],
      creditNotes: [{
        id: 'cn', status: 'issued', date: '2026-03-15', invoiceId: 'i1',
        items: [{ itemId: 'p1', description: 'Widget', quantity: 3, subtotal: 300 }],
        cogsByItem: { p1: 180 }, cogsTotal: 180,
      }],
      journalEntries: [], inventoryItems: stock,
    }
    const [row] = marginByItem(data)
    expect(row).toMatchObject({ qty: 7, revenue: 700, cost: 420 })
  })

  it('reports a loss-making item as negative rather than hiding it', () => {
    const data = {
      invoices: [sale({ items: [{ itemId: 'p2', description: 'Gadget', quantity: 1, subtotal: 100 }], cogsByItem: { p2: 150 }, cogsTotal: 150 })],
      creditNotes: [], journalEntries: [], inventoryItems: stock,
    }
    const [row] = marginByItem(data)
    expect(row.profit).toBe(-50)
    expect(row.pct).toBeCloseTo(-0.5)
  })

  it('keeps a service line as its own row at full margin', () => {
    const data = {
      invoices: [sale({
        items: [{ description: 'Consulting', quantity: 4, subtotal: 800 }],
        cogsByItem: {}, cogsTotal: 0,
      })],
      creditNotes: [], journalEntries: [], inventoryItems: stock,
    }
    const [row] = marginByItem(data)
    expect(row).toMatchObject({ label: 'Consulting', revenue: 800, cost: 0, profit: 800, tracked: false })
    expect(row.pct).toBe(1)
  })

  it('gives a lump-sum credit note its own row instead of dropping it', () => {
    // A credit note raised for a value with no line detail cannot be charged
    // to any item. Silently omitting it would make this report disagree with
    // margin by customer, so it surfaces as its own labelled row.
    const data = {
      invoices: [sale({ items: [{ itemId: 'p1', description: 'Widget', quantity: 10, subtotal: 1000 }], cogsByItem: { p1: 600 }, cogsTotal: 600 })],
      creditNotes: [{ id: 'cn', status: 'issued', date: '2026-03-15', invoiceId: 'i1', subtotal: 500, items: [], cogsTotal: 0 }],
      journalEntries: [], inventoryItems: stock,
    }
    const rows = marginByItem(data)
    const odd = rows.find((r) => r.unattributed)
    expect(odd).toBeTruthy()
    expect(odd.revenue).toBe(-500)
    expect(odd.label).toMatch(/Not attributed/i)
    // A margin percentage here would read "100%", which is meaningless.
    expect(odd.pct).toBeNull()
  })

  it('reconciles with margin by customer — the property that keeps both trustworthy', () => {
    // Two reports of the same trading period must total the same revenue and
    // cost. This is what the unattributed row exists to preserve.
    const data = {
      invoices: [
        sale({ id: 'a', customerId: 'c1', customerName: 'Acme', subtotal: 1000,
               items: [{ itemId: 'p1', description: 'Widget', quantity: 10, subtotal: 1000 }],
               cogsByItem: { p1: 600 }, cogsTotal: 600 }),
        sale({ id: 'b', customerId: 'c2', customerName: 'Bright', subtotal: 400,
               items: [{ itemId: 'p2', description: 'Gadget', quantity: 2, subtotal: 400 }],
               cogsByItem: { p2: 250 }, cogsTotal: 250 }),
      ],
      creditNotes: [
        { id: 'cn', status: 'issued', date: '2026-03-20', invoiceId: 'a', subtotal: 500, items: [], cogsTotal: 0 },
      ],
      journalEntries: [], inventoryItems: stock,
    }
    const byCust = marginSummary(marginByCustomer(data))
    const byItem = marginSummary(marginByItem(data))
    expect(byItem.revenue).toBe(byCust.revenue)
    expect(byItem.cost).toBe(byCust.cost)
    expect(byItem.profit).toBe(byCust.profit)
  })

  it('sorts the unattributed row last however large it is', () => {
    const data = {
      invoices: [sale({ items: [{ itemId: 'p1', description: 'Widget', quantity: 1, subtotal: 10 }], cogsByItem: { p1: 1 }, cogsTotal: 1 })],
      creditNotes: [{ id: 'cn', status: 'issued', date: '2026-03-15', invoiceId: 'i1', subtotal: -99999, items: [], cogsTotal: 0 }],
      journalEntries: [], inventoryItems: stock,
    }
    const rows = marginByItem(data)
    expect(rows[rows.length - 1].unattributed).toBe(true)
  })

  it('marks rows whose cost had to be apportioned', () => {
    const data = {
      invoices: [{
        id: 'old', status: 'sent', date: '2026-03-01', customerId: 'c1',
        cogsJournalEntryId: 'je1',
        items: [{ itemId: 'p1', description: 'Widget', quantity: 2, subtotal: 500 }],
      }],
      creditNotes: [],
      journalEntries: [{ id: 'je1', lines: [{ accountId: 'acc-cogs', debit: 300, credit: 0 }] }],
      inventoryItems: stock,
    }
    const [row] = marginByItem(data)
    expect(row.cost).toBe(300)
    expect(row.estimated).toBe(true)
  })
})

describe('margin by department', () => {
  it('resolves department names and buckets the unassigned', () => {
    const data = {
      invoices: [
        sale({ id: 'a', departmentId: 'd1', subtotal: 1000, cogsTotal: 400, cogsByItem: { p1: 400 } }),
        sale({ id: 'b', departmentId: null, subtotal: 500, cogsTotal: 100, cogsByItem: { p1: 100 } }),
      ],
      creditNotes: [], journalEntries: [], inventoryItems: stock,
    }
    const rows = marginByDepartment(data, { departments: [{ id: 'd1', name: 'Retail' }] })
    expect(rows.map((r) => r.label).sort()).toEqual(['Retail', 'Unassigned'])
  })
})

describe('summary and concentration', () => {
  const rows = [
    { label: 'A', revenue: 1000, cost: 400, profit: 600, estimated: false },
    { label: 'B', revenue: 800, cost: 500, profit: 300, estimated: false },
    { label: 'C', revenue: 200, cost: 300, profit: -100, estimated: true },
  ]

  it('totals revenue, cost and profit', () => {
    const s = marginSummary(rows)
    expect(s).toMatchObject({ revenue: 2000, cost: 1200, profit: 800 })
    expect(s.pct).toBeCloseTo(0.4)
  })

  it('reports how concentrated gross profit is', () => {
    // A and B make 900 of profit against a net 800 — over 100%, because C
    // loses money. That is the point: the concentration read should show the
    // business leaning harder on its winners than the net total suggests.
    expect(marginSummary(rows).top5Share).toBeCloseTo(900 / 800)
  })

  it('names the rows that lose money', () => {
    expect(marginSummary(rows).lossMakers.map((r) => r.label)).toEqual(['C'])
  })

  it('counts how many rows relied on an estimate', () => {
    expect(marginSummary(rows).estimatedRows).toBe(1)
  })

  it('survives an empty report', () => {
    const s = marginSummary([])
    expect(s).toMatchObject({ revenue: 0, cost: 0, profit: 0, pct: null, top5Share: null })
    expect(s.lossMakers).toEqual([])
  })
})

describe('robustness', () => {
  it('needs a groupBy and says so', () => {
    expect(() => marginBy({}, {})).toThrow(/groupBy/)
  })

  it('survives empty books', () => {
    expect(marginByCustomer({ invoices: [], creditNotes: [] })).toEqual([])
    expect(marginByItem({})).toEqual([])
  })

  it('surfaces an invoice with revenue but no lines rather than losing it', () => {
    // No line detail means no item to charge it to, but the revenue is real
    // and must still show up — otherwise the two margin reports disagree.
    const data = { invoices: [sale({ items: [], cogsByItem: {}, cogsTotal: 0 })], creditNotes: [] }
    const rows = marginByItem(data)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unattributed: true, revenue: 1000 })
    expect(marginByCustomer(data)[0].revenue).toBe(1000)
  })

  it('emits nothing at all for a document with neither lines nor value', () => {
    const data = { invoices: [sale({ items: [], subtotal: 0, cogsByItem: {}, cogsTotal: 0 })], creditNotes: [] }
    expect(marginByItem(data)).toEqual([])
  })

  it('keeps money at two decimals through the aggregation', () => {
    const data = {
      invoices: [
        sale({ id: 'a', subtotal: 33.33, cogsTotal: 11.11, cogsByItem: { p1: 11.11 } }),
        sale({ id: 'b', subtotal: 33.33, cogsTotal: 11.11, cogsByItem: { p1: 11.11 } }),
      ],
      creditNotes: [], journalEntries: [], inventoryItems: stock,
    }
    const [row] = marginByCustomer(data)
    expect(row.revenue).toBe(66.66)
    expect(row.cost).toBe(22.22)
    expect(row.profit).toBe(44.44)
  })
})
