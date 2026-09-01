// Group consolidation.
//
// The page this replaces summed every company's ledger at face value and
// called the result "Group Revenue". That is an aggregation, not a
// consolidation, and the difference is not academic: if one company in the
// group invoices another, the sale is counted as revenue in the seller and as
// an expense in the buyer, and both appear in the group totals. Revenue is
// overstated, expenses are overstated, and the receivable and the payable
// between them are both sitting in group assets and liabilities for money the
// group does not owe itself.
//
// Net profit happens to survive — the overstated revenue and the overstated
// expense cancel — which is exactly why the error is easy to miss and
// dangerous to leave. Anyone reading group revenue, gross margin, total
// assets or any ratio built on them is reading an inflated number.
//
// ── What eliminating actually requires ────────────────────────────────
//
// The app cannot infer which customer is another group company. Each company
// keeps its own customer and supplier lists with free-text names, and "Al-Noor
// Trading" in one set of books is just a string. So the group has to be told,
// once, which parties represent which sister companies. Names are matched
// automatically to *suggest* the mapping, because typing it from scratch for
// twenty parties is how a feature goes unused — but a suggestion is never
// treated as a confirmation. Nothing is eliminated until somebody says so.
//
// ── The check that earns its place ───────────────────────────────────
//
// Once the mapping exists, one thing falls out for free and is worth more than
// the elimination itself: **what A says B owes it should equal what B says it
// owes A.** When those disagree, something is genuinely wrong — an invoice
// raised and never received, a credit note posted on one side only, two
// different amounts for the same transaction. Every group close hunts for
// this, usually in a spreadsheet. Here it is a subtraction.
//
// So a disagreement is reported as a finding, and the elimination still
// happens at the lower of the two figures with the difference left visible,
// rather than netting to zero and hiding it.
//
// ── What this deliberately does not do ───────────────────────────────
//
// Unrealised profit in stock. If A sells goods to B at a margin and B still
// holds them at the year end, group profit contains profit the group has not
// made outside itself, and a full consolidation strips it out. Doing that
// needs to know which of B's stock came from A and at what mark-up, and
// nothing in these books records that. It is reported as a limitation rather
// than estimated, for the same reason the maturity note refuses to guess a
// loan's repayment profile: a number invented to fill a gap is worse than an
// acknowledged gap.
//
// Nor does it translate currencies (IAS 21), recognise goodwill, or account
// for non-controlling interests. All are stated on the page.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const TOL = 0.02

/** Loose name matching, for *suggesting* a mapping only. */
export function normaliseName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')                 // Arabic diacritics
    // Dots go first, and close up rather than becoming spaces, so "L.L.C."
    // reaches the suffix list as "llc". Everything else keeps its word
    // boundaries until after that pass — strip all punctuation up front and
    // "Sub Trading LLC" becomes one long word no suffix can be found in.
    .replace(/\./g, '')
    .replace(/\b(llc|ltd|limited|inc|co|company|est|establishment|trading|group|holding|wll|sarl)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

/**
 * Parties that look like other companies in the group.
 *
 * A suggestion, never a decision — see the header. Returns one row per
 * plausible match so a human can confirm or reject it.
 */
export function suggestMappings(companies = [], statesByCompany = {}) {
  const out = []
  const others = (id) => companies.filter((c) => c.id !== id)

  companies.forEach((c) => {
    const state = statesByCompany[c.id]
    if (!state) return
    const check = (list, partyType) => {
      ;(list || []).forEach((p) => {
        const pn = normaliseName(p.name)
        if (!pn) return
        const hit = others(c.id).find((o) => {
          const on = normaliseName(o.name)
          return on && (on === pn || on.includes(pn) || pn.includes(on))
        })
        if (hit) {
          out.push({
            companyId: c.id, companyName: c.name,
            partyType, partyId: p.id, partyName: p.name,
            representsCompanyId: hit.id, representsCompanyName: hit.name,
            // Exact after normalisation is worth showing differently from a
            // substring hit, which can be a coincidence.
            confidence: normaliseName(hit.name) === pn ? 'exact' : 'partial',
          })
        }
      })
    }
    check(state.customers, 'customer')
    check(state.suppliers, 'supplier')
  })
  return out
}

// Documents are entered in their own currency; the ledger they will be
// eliminated from is in base currency. Converting at the document's own rate is
// what the posting path does, so the elimination is measured in the same units
// as the figure it comes off. (This is *not* IAS 21 translation — that is about
// a company whose whole ledger is in another currency, and is still a stated
// limitation.)
const rateOf = (doc) => Number(doc?.exchangeRate) || 1
const baseOf = (doc, v) => r2((Number(v) || 0) * rateOf(doc))
const openOf = (doc) => baseOf(doc, (Number(doc?.total) || 0) - (Number(doc?.amountPaid) || 0))
const DEAD = ['cancelled', 'void', 'draft']
const isLive = (doc) => !!doc && !DEAD.includes(doc.status) && !doc.isOpening

/**
 * What one company's books say about its dealings with each sister company.
 *
 * Trade is measured net of tax, because that is what revenue and expenses are
 * recorded at — eliminating a tax-inclusive figure would strip more from
 * revenue than was ever put there.
 */
export function intercompanyPositions(companyId, state = {}, mappings = []) {
  const mine = mappings.filter((m) => m.companyId === companyId && m.confirmed !== false)
  const customerMap = new Map(mine.filter((m) => m.partyType === 'customer').map((m) => [m.partyId, m.representsCompanyId]))
  const supplierMap = new Map(mine.filter((m) => m.partyType === 'supplier').map((m) => [m.partyId, m.representsCompanyId]))

  const byCounterparty = new Map()
  const bump = (id, key, amount) => {
    if (!id || !amount) return
    const row = byCounterparty.get(id) || { counterpartyId: id, receivable: 0, payable: 0, revenue: 0, expense: 0 }
    row[key] = r2(row[key] + amount)
    byCounterparty.set(id, row)
  }

  ;(state.invoices || []).filter(isLive).forEach((inv) => {
    const other = customerMap.get(inv.customerId)
    if (!other) return
    bump(other, 'receivable', openOf(inv))
    bump(other, 'revenue', baseOf(inv, inv.subtotal))
  })
  // A credit note reduces both, so it has to be netted or the elimination
  // removes revenue the company never ended up recognising.
  ;(state.creditNotes || []).filter(isLive).forEach((cn) => {
    const other = customerMap.get(cn.customerId)
    if (!other) return
    bump(other, 'receivable', -openOf(cn))
    bump(other, 'revenue', -baseOf(cn, cn.subtotal))
  })
  ;(state.purchases || []).filter(isLive).forEach((p) => {
    const other = supplierMap.get(p.supplierId)
    if (!other) return
    bump(other, 'payable', openOf(p))
    bump(other, 'expense', baseOf(p, p.subtotal))
  })
  ;(state.debitNotes || []).filter(isLive).forEach((dn) => {
    const other = supplierMap.get(dn.supplierId)
    if (!other) return
    bump(other, 'payable', -openOf(dn))
    bump(other, 'expense', -baseOf(dn, dn.subtotal))
  })

  return [...byCounterparty.values()]
}

/**
 * Put each pair of companies side by side and see whether they agree.
 *
 * The finding every group close is looking for. What A says B owes it should
 * equal what B says it owes A; a gap means a document exists on one side and
 * not the other, or exists at two different amounts.
 *
 * Both trade directions are reported, because A can sell to B and buy from B
 * in the same year and the two are separate agreements to check — netting
 * them would let a missing sale hide behind an unrelated purchase.
 */
export function reconcilePairs(positionsByCompany = {}, companies = []) {
  const nameOf = (id) => companies.find((c) => c.id === id)?.name || id
  const seen = new Set()
  const pairs = []

  Object.entries(positionsByCompany).forEach(([aId, rows]) => {
    rows.forEach((row) => {
      const bId = row.counterpartyId
      const key = [aId, bId].sort().join('|')
      if (seen.has(key)) return
      seen.add(key)

      const back = (positionsByCompany[bId] || []).find((r) => r.counterpartyId === aId) || {}
      // A's receivable from B should be B's payable to A, and vice versa.
      const arVsAp = r2((row.receivable || 0) - (back.payable || 0))
      const apVsAr = r2((row.payable || 0) - (back.receivable || 0))

      pairs.push({
        aId, aName: nameOf(aId), bId, bName: nameOf(bId),
        aReceivable: r2(row.receivable), bPayable: r2(back.payable || 0), receivableGap: arVsAp,
        aPayable: r2(row.payable), bReceivable: r2(back.receivable || 0), payableGap: apVsAr,
        // A → B: A's sales to B against B's purchases from A.
        aRevenue: r2(row.revenue), bExpense: r2(back.expense || 0),
        tradeGapAB: r2((row.revenue || 0) - (back.expense || 0)),
        // B → A: the same test the other way round.
        bRevenue: r2(back.revenue || 0), aExpense: r2(row.expense),
        tradeGapBA: r2((back.revenue || 0) - (row.expense || 0)),
        // Only meaningful when the other side has been mapped too; a
        // one-sided mapping is a setup problem, not a disagreement.
        mappedBothWays: (positionsByCompany[bId] || []).some((r) => r.counterpartyId === aId),
        agrees: Math.abs(arVsAp) <= TOL && Math.abs(apVsAr) <= TOL,
        tradeAgrees: Math.abs(r2((row.revenue || 0) - (back.expense || 0))) <= TOL
          && Math.abs(r2((back.revenue || 0) - (row.expense || 0))) <= TOL,
      })
    })
  })
  return pairs
}

/** Natural balance: debits less credits for assets and expenses. */
const naturalOf = (type, b = { dr: 0, cr: 0 }) => (
  ['asset', 'expense'].includes(type) ? r2((b.dr || 0) - (b.cr || 0)) : r2((b.cr || 0) - (b.dr || 0))
)

/** Totals by account type from a company's own ledger. */
export function companyTotals(state = {}) {
  const bal = {}
  ;(state.journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
    const b = bal[l.accountId] || (bal[l.accountId] = { dr: 0, cr: 0 })
    b.dr += Number(l.debit) || 0
    b.cr += Number(l.credit) || 0
  }))
  const sum = (t) => r2((state.accounts || [])
    .filter((a) => a.type === t)
    .reduce((s, a) => s + naturalOf(a.type, bal[a.id]), 0))

  const revenue = sum('revenue')
  const expenses = sum('expense')
  return {
    revenue, expenses, net: r2(revenue - expenses),
    assets: sum('asset'), liabilities: sum('liability'), equity: sum('equity'),
  }
}

/**
 * How much of a two-sided figure both books actually agree on.
 *
 * The lower of the two when they point the same way; nothing at all when they
 * point opposite ways, because then there is no agreed amount to remove — only
 * a finding to report. Netting a receivable against a contra balance would
 * quietly invent an elimination neither company's ledger supports.
 */
const matched = (x, y) => {
  const a = Number(x) || 0
  const b = Number(y) || 0
  if (a > 0 && b > 0) return Math.min(a, b)
  if (a < 0 && b < 0) return Math.max(a, b)  // smaller in magnitude, still a credit
  return 0
}

/**
 * Combine the group, and take out what it owes and sells to itself.
 *
 * Elimination is at the **lower** of the two sides of each pair when they
 * disagree. Taking the higher would remove more than one of the books
 * contains and push a company's balance through zero; taking the lower leaves
 * the unmatched remainder visible in the totals, where the finding beside it
 * explains why.
 */
export function consolidate({ companies = [], statesByCompany = {}, mappings = [], eliminate = true } = {}) {
  const positionsByCompany = {}
  const companyRows = []
  const currencies = new Set()

  companies.forEach((c) => {
    const state = statesByCompany[c.id]
    if (!state) { companyRows.push({ id: c.id, name: c.name, missing: true }); return }
    currencies.add(state.settings?.company?.currency || 'USD')
    positionsByCompany[c.id] = intercompanyPositions(c.id, state, mappings)
    companyRows.push({ id: c.id, name: c.name, ...companyTotals(state) })
  })

  const valid = companyRows.filter((r) => !r.missing)
  const combined = {
    revenue: r2(valid.reduce((s, r) => s + r.revenue, 0)),
    expenses: r2(valid.reduce((s, r) => s + r.expenses, 0)),
    net: r2(valid.reduce((s, r) => s + r.net, 0)),
    assets: r2(valid.reduce((s, r) => s + r.assets, 0)),
    liabilities: r2(valid.reduce((s, r) => s + r.liabilities, 0)),
    equity: r2(valid.reduce((s, r) => s + r.equity, 0)),
  }

  const pairs = reconcilePairs(positionsByCompany, companies)

  // One pass per pair, covering all four agreements: the debt each way and the
  // trade each way. Every pair appears once, so nothing is eliminated twice.
  let elimRevenue = 0
  let elimReceivable = 0
  pairs.forEach((p) => {
    elimReceivable += matched(p.aReceivable, p.bPayable)
    elimReceivable += matched(p.aPayable, p.bReceivable)
    elimRevenue += matched(p.aRevenue, p.bExpense)
    elimRevenue += matched(p.bRevenue, p.aExpense)
  })
  elimRevenue = r2(elimRevenue)
  elimReceivable = r2(elimReceivable)

  const eliminations = {
    revenue: eliminate ? elimRevenue : 0,
    expenses: eliminate ? elimRevenue : 0,   // the same trade, seen from the other side
    receivables: eliminate ? elimReceivable : 0,
    payables: eliminate ? elimReceivable : 0,
  }

  const group = {
    revenue: r2(combined.revenue - eliminations.revenue),
    expenses: r2(combined.expenses - eliminations.expenses),
    // Unchanged by design: an intercompany sale inflates revenue and expenses
    // by the same amount, so profit was never wrong. Saying so out loud is the
    // clearest way to show why the other figures were.
    net: combined.net,
    assets: r2(combined.assets - eliminations.receivables),
    liabilities: r2(combined.liabilities - eliminations.payables),
    equity: combined.equity,
  }

  const findings = []
  pairs.filter((p) => !p.agrees && p.mappedBothWays).forEach((p) => {
    findings.push({
      code: 'PAIR_DISAGREES', aName: p.aName, bName: p.bName,
      receivableGap: p.receivableGap, payableGap: p.payableGap,
    })
  })
  // A trade gap is its own finding: one side recorded a sale the other never
  // recorded as a purchase. The balances can still agree while this does not,
  // if the invoice was settled in cash.
  pairs.filter((p) => !p.tradeAgrees && p.mappedBothWays).forEach((p) => {
    findings.push({
      code: 'TRADE_DISAGREES', aName: p.aName, bName: p.bName,
      tradeGapAB: p.tradeGapAB, tradeGapBA: p.tradeGapBA,
    })
  })
  pairs.filter((p) => !p.mappedBothWays).forEach((p) => {
    findings.push({ code: 'ONE_SIDED_MAPPING', aName: p.aName, bName: p.bName })
  })
  if (currencies.size > 1) findings.push({ code: 'MIXED_CURRENCY', count: currencies.size })

  return {
    companyRows, combined, eliminations, group, pairs, findings,
    mixedCurrency: currencies.size > 1,
    eliminated: eliminate,
    hasMappings: mappings.filter((m) => m.confirmed !== false).length > 0,
    limitations: LIMITATIONS,
  }
}

/** Stated on the page, not buried here. */
export const LIMITATIONS = [
  'UNREALISED_PROFIT',
  'NO_FX_TRANSLATION',
  'NO_GOODWILL',
  'NO_NCI',
]

export const LIMITATION_TEXT = {
  UNREALISED_PROFIT: 'Profit on stock still held inside the group is not removed. Doing so requires knowing which of the buyer’s stock came from a sister company and at what mark-up, which these books do not record.',
  NO_FX_TRANSLATION: 'Companies with different base currencies are added at face value. There is no translation to a single presentation currency (IAS 21).',
  NO_GOODWILL: 'No goodwill is recognised on acquisition, and investments in sister companies are not eliminated against their equity.',
  NO_NCI: 'Every company is treated as wholly owned. There is no non-controlling interest.',
}

export const FINDING_TEXT = {
  PAIR_DISAGREES: '{a} and {b} do not agree on what they owe each other.',
  TRADE_DISAGREES: '{a} and {b} do not agree on how much they traded. One side has recorded a sale or purchase the other has not.',
  ONE_SIDED_MAPPING: 'Only {a} has been told that {b} is part of the group. Map it from both sides so the balances can be matched.',
  MIXED_CURRENCY: 'Companies use different base currencies and are added at face value.',
}
