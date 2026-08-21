// Gross margin by customer, item and department.
//
// The reports this replaces ranked by *revenue*, which is the number that
// flatters the wrong customer. A customer at 22% of revenue and 4% of margin
// is a different conversation from one at 8% of revenue and 19% of margin, and
// revenue alone cannot tell them apart. The ledger already knows the answer:
// every sale posts its cost of goods at the cost the units actually carried
// when they left the shelf.
//
// Two things this is careful about:
//
//   1. Cost is taken from what was recorded at the time of sale, never
//      re-derived from an item's current cost price. Re-deriving would
//      re-price history every time a purchase lands, so last quarter's margin
//      would change after the quarter closed.
//   2. Documents posted before per-item cost was captured still have a total
//      on their COGS journal entry. Those are apportioned across the lines,
//      and every figure that relied on apportionment is flagged, so a number
//      that is partly an estimate never passes itself off as exact.
//
// Service lines carry no cost and are not an error: a consulting hour has no
// stock behind it, so it is 100% margin by construction and the `costed`
// counters let the UI say so rather than implying a suspiciously good product.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Live documents only — a void invoice is not a sale, an opening stub is history. */
const isLive = (doc) => doc && doc.status !== 'void' && !doc.isOpening

/** Margin as a fraction of revenue; null when there is no revenue to divide by. */
export function marginPct(revenue, cost) {
  if (!revenue) return null
  return (revenue - cost) / revenue
}

/**
 * Total cost of a document, preferring what was captured at posting time and
 * falling back to its COGS journal entry.
 *
 * @returns {{ cost: number, exact: boolean }} `exact` is false when the figure
 *   came from the journal entry rather than the document's own record.
 */
export function documentCost(doc, journalEntries = []) {
  if (doc && typeof doc.cogsTotal === 'number') return { cost: r2(doc.cogsTotal), exact: true }
  const je = doc?.cogsJournalEntryId
    ? journalEntries.find((j) => j.id === doc.cogsJournalEntryId)
    : null
  if (!je) return { cost: 0, exact: true }   // nothing sold from stock — a pure service sale
  // The COGS entry debits expense and credits inventory; either side is the
  // total. Debits are the safer read: a restock entry reverses the direction.
  const debit = (je.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const credit = (je.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0)
  return { cost: r2(Math.max(debit, credit)), exact: false }
}

/**
 * Cost attributable to each line of a document.
 *
 * Uses the per-item costs recorded at posting time when present. Otherwise the
 * document's total cost is apportioned across the lines that could plausibly
 * carry cost — those naming a stock item — in proportion to their revenue.
 * Apportionment is an estimate and says so.
 */
export function lineCosts(doc, { journalEntries = [], inventoryItems = [] } = {}) {
  const items = doc?.items || []
  const byItem = doc?.cogsByItem

  if (byItem && Object.keys(byItem).length) {
    // Recorded per item. A single item can appear on more than one line, so
    // split its recorded cost across those lines by revenue.
    const revenueByItem = {}
    items.forEach((l) => {
      if (!l.itemId) return
      revenueByItem[l.itemId] = (revenueByItem[l.itemId] || 0) + (Number(l.subtotal) || 0)
    })
    return items.map((l) => {
      const recorded = l.itemId ? byItem[l.itemId] : undefined
      if (recorded === undefined) return { cost: 0, exact: true }
      const totalRev = revenueByItem[l.itemId] || 0
      const share = totalRev > 0 ? (Number(l.subtotal) || 0) / totalRev : 1
      return { cost: r2(recorded * share), exact: true }
    })
  }

  // Historical document: apportion the total across stock-bearing lines.
  const { cost: total } = documentCost(doc, journalEntries)
  if (total <= 0) return items.map(() => ({ cost: 0, exact: true }))
  const tracked = new Set(inventoryItems.filter((i) => i.trackStock !== false).map((i) => i.id))
  const bearing = items.filter((l) => l.itemId && (tracked.size === 0 || tracked.has(l.itemId)))
  const base = bearing.reduce((s, l) => s + (Number(l.subtotal) || 0), 0)
  return items.map((l) => {
    const carries = l.itemId && (tracked.size === 0 || tracked.has(l.itemId))
    if (!carries) return { cost: 0, exact: true }
    const share = base > 0 ? (Number(l.subtotal) || 0) / base : 1 / (bearing.length || 1)
    return { cost: r2(total * share), exact: false }
  })
}

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to)

/**
 * Gross margin grouped by a key taken from each invoice.
 *
 * Credit notes are netted against the customer and period they belong to —
 * a return is a reversal of a sale, not a separate negative sale, so both its
 * revenue and its cost come back out. That is what stops a heavily-returned
 * customer from looking profitable.
 *
 * @param {object} data  { invoices, creditNotes, journalEntries, inventoryItems }
 * @param {object} opts  { from, to, groupBy: (invoice) => {key, label} }
 */
export function marginBy(data = {}, opts = {}) {
  const { invoices = [], creditNotes = [], journalEntries = [], inventoryItems = [] } = data
  const { from = null, to = null, groupBy } = opts
  if (typeof groupBy !== 'function') throw new Error('marginBy needs a groupBy function')

  const rows = new Map()
  const bump = (key, label, patch) => {
    const cur = rows.get(key) || { key, label, revenue: 0, cost: 0, count: 0, returns: 0, estimated: false }
    cur.revenue = r2(cur.revenue + (patch.revenue || 0))
    cur.cost = r2(cur.cost + (patch.cost || 0))
    cur.count += patch.count || 0
    cur.returns = r2(cur.returns + (patch.returns || 0))
    cur.estimated = cur.estimated || !!patch.estimated
    rows.set(key, cur)
  }

  invoices.filter((i) => isLive(i) && inRange(i.date, from, to)).forEach((inv) => {
    const g = groupBy(inv)
    if (!g) return
    const { cost, exact } = documentCost(inv, journalEntries)
    bump(g.key, g.label, {
      revenue: Number(inv.subtotal) || 0,   // net of tax: margin is a trading measure
      cost, count: 1, estimated: !exact,
    })
  })

  // Net the returns off the customer that made them.
  const byId = new Map(invoices.map((i) => [i.id, i]))
  creditNotes.filter((c) => isLive(c) && inRange(c.date, from, to)).forEach((cn) => {
    const origin = byId.get(cn.invoiceId)
    const g = groupBy(origin || cn)
    if (!g) return
    const { cost, exact } = documentCost(cn, journalEntries)
    const back = Number(cn.subtotal) || 0
    bump(g.key, g.label, { revenue: -back, cost: -cost, returns: back, estimated: !exact })
  })

  return [...rows.values()]
    .map((r) => ({ ...r, profit: r2(r.revenue - r.cost), pct: marginPct(r.revenue, r.cost) }))
    .sort((a, b) => b.profit - a.profit)
}

/** Margin per customer. */
export function marginByCustomer(data, opts = {}) {
  return marginBy(data, {
    ...opts,
    groupBy: (inv) => ({ key: inv.customerId || '—', label: inv.customerName || 'Unknown customer' }),
  })
}

/** Margin per department / cost centre. */
export function marginByDepartment(data, opts = {}) {
  const names = new Map((opts.departments || []).map((d) => [d.id, d.name]))
  return marginBy(data, {
    ...opts,
    groupBy: (inv) => ({
      key: inv.departmentId || '—',
      label: names.get(inv.departmentId) || 'Unassigned',
    }),
  })
}

/**
 * Margin per inventory item, down at the line level.
 *
 * This is the one that needs per-line cost, so it is also the one most likely
 * to lean on apportionment for older documents — hence the per-row `estimated`
 * flag rather than a single banner over the whole report.
 */
export const UNATTRIBUTED = '__unattributed__'

export function marginByItem(data = {}, opts = {}) {
  const { invoices = [], creditNotes = [], journalEntries = [], inventoryItems = [] } = data
  const { from = null, to = null } = opts
  const rows = new Map()

  const bumpRow = (key, seed, patch) => {
    const cur = rows.get(key) || { key, ...seed, qty: 0, revenue: 0, cost: 0, estimated: false }
    cur.qty = r2(cur.qty + (patch.qty || 0))
    cur.revenue = r2(cur.revenue + (patch.revenue || 0))
    cur.cost = r2(cur.cost + (patch.cost || 0))
    cur.estimated = cur.estimated || !!patch.estimated
    rows.set(key, cur)
  }

  const walk = (doc, sign) => {
    const lines = doc.items || []

    // A document can carry a value with no line detail behind it — most often
    // a credit note raised for a lump sum rather than against specific goods.
    // There is no item to charge it to, but dropping it would make this report
    // disagree with margin by customer for no visible reason. It gets its own
    // row instead, so the two reports still reconcile and the gap is explained.
    if (!lines.length) {
      const value = Number(doc.subtotal) || 0
      if (value) {
        const { cost, exact } = documentCost(doc, journalEntries)
        bumpRow(UNATTRIBUTED, { label: 'Not attributed to an item', tracked: false, unattributed: true },
          { revenue: sign * value, cost: sign * cost, estimated: !exact })
      }
      return
    }

    const costs = lineCosts(doc, { journalEntries, inventoryItems })
    lines.forEach((l, i) => {
      const key = l.itemId || `desc:${l.description || 'Unnamed'}`
      const label = l.description || inventoryItems.find((it) => it.id === l.itemId)?.name || 'Unnamed'
      bumpRow(key, { label, tracked: !!l.itemId }, {
        qty: sign * (Number(l.quantity) || 0),
        revenue: sign * (Number(l.subtotal) || 0),
        cost: sign * (costs[i]?.cost || 0),
        estimated: !(costs[i]?.exact ?? true),
      })
    })
  }

  invoices.filter((i) => isLive(i) && inRange(i.date, from, to)).forEach((i) => walk(i, 1))
  creditNotes.filter((c) => isLive(c) && inRange(c.date, from, to)).forEach((c) => walk(c, -1))

  return [...rows.values()]
    .map((r) => ({
      ...r,
      profit: r2(r.revenue - r.cost),
      // A margin percentage on an unattributed amount is arithmetically
      // defined and completely meaningless — a lump-sum credit with no cost
      // reads as "100% margin", which is worse than showing nothing.
      pct: r.unattributed ? null : marginPct(r.revenue, r.cost),
    }))
    // The unattributed row is bookkeeping, not a product — it sorts last
    // regardless of size so it never tops a ranking of what sells well.
    .sort((a, b) => (a.unattributed ? 1 : b.unattributed ? -1 : b.profit - a.profit))
}

/**
 * Headline totals plus the concentration figures that prompt a decision:
 * how much of all gross profit the top few rows account for, and which rows
 * are actually losing money.
 */
export function marginSummary(rows = []) {
  const revenue = r2(rows.reduce((s, r) => s + r.revenue, 0))
  const cost = r2(rows.reduce((s, r) => s + r.cost, 0))
  const profit = r2(revenue - cost)
  const positive = rows.filter((r) => r.profit > 0)
  const topProfit = r2(positive.slice(0, 5).reduce((s, r) => s + r.profit, 0))
  return {
    revenue, cost, profit,
    pct: marginPct(revenue, cost),
    // Share of gross profit produced by the five strongest rows — the standard
    // read on how exposed the business is to losing one of them.
    top5Share: profit > 0 ? topProfit / profit : null,
    lossMakers: rows.filter((r) => r.revenue > 0 && r.profit < 0),
    estimatedRows: rows.filter((r) => r.estimated).length,
  }
}
