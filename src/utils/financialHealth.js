// Financial-health ratios computed from the ledger. Pure functions over a set
// of already-summed figures, so they're trivially testable and never touch the
// store. Each metric is rated good / watch / risk against common SMB benchmarks
// (rules of thumb — thresholds are deliberately conservative, not gospel).

const safe = (num, den) => (Math.abs(den || 0) > 0.005 ? num / den : null)

// Rate a value against two thresholds. dir 'high' = bigger is healthier,
// 'low' = smaller is healthier. Returns 'good' | 'watch' | 'risk' | 'na'.
function band(v, good, watch, dir = 'high') {
  if (v == null || Number.isNaN(v)) return 'na'
  if (dir === 'high') return v >= good ? 'good' : v >= watch ? 'watch' : 'risk'
  return v <= good ? 'good' : v <= watch ? 'watch' : 'risk'
}

const fmtX = (v) => (v == null ? '—' : `${v.toFixed(2)}×`)
const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const fmtDays = (v) => (v == null ? '—' : `${Math.round(v)} ${v === 1 ? 'day' : 'days'}`)

/**
 * Gather the figures the ratios are built from, as at a date.
 *
 * Extracted from the Financial Health page so the trend view can compute the
 * same ratios at earlier dates without a second implementation. That matters
 * more than it looks: half of what follows is *classification* — which
 * accounts count as inventory, as cash, as cost of sales — and a trend built
 * on a slightly different notion of "cash" would draw a line that contradicts
 * the number printed beside it.
 *
 * Balance-sheet figures are cumulative to `asOf`; P&L figures are the twelve
 * months ending there, so last year's ratio is computed exactly as this
 * year's was, on that year's own trailing window.
 *
 * `groupIdsWithRole` and `otherIncomeRole` are injected rather than imported
 * to keep this module free of the account-tree dependency it otherwise has no
 * use for.
 */
export function healthInputs({ accounts = [], accountGroups = [], getAllBalances }, asOf, groupIdsWithRole, otherIncomeRole) {
  const at = asOf || new Date().toISOString().slice(0, 10)
  const ttmStart = (() => {
    const d = new Date(at)
    d.setUTCFullYear(d.getUTCFullYear() - 1)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const allBal = getAllBalances(undefined, at)   // cumulative → balance sheet
  const ttmBal = getAllBalances(ttmStart, at)    // trailing 12 months → P&L

  const acc = (id) => accounts.find((a) => a.id === id)
  const nat = (a, bals) => {
    const b = bals[a.id] || { dr: 0, cr: 0 }
    return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
  }
  const sumType = (type, subtype, bals) => accounts
    .filter((a) => a.type === type && (!subtype || a.subtype === subtype))
    .reduce((s, a) => s + nat(a, bals), 0)

  const invIds = new Set(['acc-inv', 'acc-rawmat', 'acc-wip', 'acc-fingoods'])
  const isInventory = (a) => a.type === 'asset' && (invIds.has(a.id) || /inventory|raw material|finished goods|work.?in.?progress|stock/i.test(a.name || ''))
  const isCash = (a) => a.type === 'asset' && a.subtype === 'current' && (['acc-cash', 'acc-bank1'].includes(a.id) || /cash|bank/i.test(a.name || ''))
  const isCogs = (a) => a.type === 'expense' && (a.id === 'acc-cogs' || /cost of (goods|sales)|cogs/i.test(a.name || ''))

  const totalAssets = sumType('asset', null, allBal)
  const totalLiabilities = sumType('liability', null, allBal)

  // Every ratio that divides by revenue means *trading* revenue: gross and net
  // margin per riyal of sales, and DSO against the sales that create
  // receivables. Other income — an FX movement, a gain on selling a van — is
  // none of those, so it comes out, exactly as it does on the P&L. Net income
  // still counts it, because it genuinely is part of the bottom line.
  const otherIncomeGroups = groupIdsWithRole ? groupIdsWithRole(accountGroups, otherIncomeRole) : new Set()
  const allRevenue = sumType('revenue', null, ttmBal)
  const otherIncome = accounts
    .filter((a) => a.type === 'revenue' && otherIncomeGroups.has(a.groupId))
    .reduce((s, a) => s + nat(a, ttmBal), 0)
  const revenue = allRevenue - otherIncome
  const cogs = accounts.filter(isCogs).reduce((s, a) => s + nat(a, ttmBal), 0)
  const expenses = sumType('expense', null, ttmBal)

  return {
    asOf: at,
    ttmStart,
    currentAssets: sumType('asset', 'current', allBal),
    inventory: accounts.filter(isInventory).reduce((s, a) => s + nat(a, allBal), 0),
    cash: accounts.filter(isCash).reduce((s, a) => s + nat(a, allBal), 0),
    currentLiabilities: sumType('liability', 'current', allBal),
    totalAssets,
    totalLiabilities,
    // The accounting identity, so this carries retained earnings and the
    // current period's profit without either having to be posted.
    equity: totalAssets - totalLiabilities,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    netIncome: allRevenue - expenses,
    ar: acc('acc-ar') ? nat(acc('acc-ar'), allBal) : 0,
    ap: acc('acc-ap') ? nat(acc('acc-ap'), allBal) : 0,
  }
}

// m: { currentAssets, inventory, cash, currentLiabilities, totalAssets,
//      totalLiabilities, equity, revenue, cogs, grossProfit, netIncome, ar, ap }
export function computeFinancialHealth(m = {}) {
  const currentRatio = safe(m.currentAssets, m.currentLiabilities)
  const quickRatio = safe((m.currentAssets || 0) - (m.inventory || 0), m.currentLiabilities)
  const cashRatio = safe(m.cash, m.currentLiabilities)
  const workingCapital = (m.currentAssets || 0) - (m.currentLiabilities || 0)

  const grossMargin = safe(m.grossProfit, m.revenue)
  const netMargin = safe(m.netIncome, m.revenue)
  const roe = safe(m.netIncome, m.equity)
  const roa = safe(m.netIncome, m.totalAssets)

  const dso = m.revenue ? safe(m.ar, m.revenue) * 365 : null
  const dpo = m.cogs ? safe(m.ap, m.cogs) * 365 : null
  const invTurnover = m.inventory ? safe(m.cogs, m.inventory) : null

  const debtToEquity = safe(m.totalLiabilities, m.equity)
  const debtRatio = safe(m.totalLiabilities, m.totalAssets)

  const groups = [
    {
      group: 'Liquidity',
      blurb: 'Can the business cover its short-term obligations?',
      metrics: [
        { key: 'current', label: 'Current Ratio', value: currentRatio, display: fmtX(currentRatio), formula: 'Current Assets ÷ Current Liabilities', rating: band(currentRatio, 1.5, 1.0, 'high'), hint: 'Aim ≥ 1.5. Below 1 means short-term debts exceed short-term assets.' },
        { key: 'quick', label: 'Quick Ratio', value: quickRatio, display: fmtX(quickRatio), formula: '(Current Assets − Inventory) ÷ Current Liabilities', rating: band(quickRatio, 1.0, 0.7, 'high'), hint: 'Liquidity excluding inventory. Aim ≥ 1.0.' },
        { key: 'cash', label: 'Cash Ratio', value: cashRatio, display: fmtX(cashRatio), formula: 'Cash & Bank ÷ Current Liabilities', rating: band(cashRatio, 0.5, 0.2, 'high'), hint: 'The most conservative liquidity test.' },
        { key: 'wc', label: 'Working Capital', value: workingCapital, display: null, isMoney: true, formula: 'Current Assets − Current Liabilities', rating: workingCapital > 0.005 ? 'good' : workingCapital < -0.005 ? 'risk' : 'na', hint: 'The cash buffer funding day-to-day operations.' },
      ],
    },
    {
      group: 'Profitability',
      blurb: 'How much profit the business keeps from its sales.',
      metrics: [
        { key: 'gm', label: 'Gross Margin', value: grossMargin, display: fmtPct(grossMargin), formula: '(Revenue − COGS) ÷ Revenue', rating: band(grossMargin, 0.4, 0.2, 'high'), hint: 'Profit after direct costs. Varies widely by industry.' },
        { key: 'nm', label: 'Net Margin', value: netMargin, display: fmtPct(netMargin), formula: 'Net Profit ÷ Revenue', rating: band(netMargin, 0.1, 0, 'high'), hint: 'Bottom-line profit per sales riyal.' },
        { key: 'roe', label: 'Return on Equity', value: roe, display: fmtPct(roe), formula: 'Net Profit ÷ Equity', rating: band(roe, 0.15, 0, 'high'), hint: 'Return the owners earn on their capital.' },
        { key: 'roa', label: 'Return on Assets', value: roa, display: fmtPct(roa), formula: 'Net Profit ÷ Total Assets', rating: band(roa, 0.05, 0, 'high'), hint: 'How efficiently assets generate profit.' },
      ],
    },
    {
      group: 'Efficiency',
      blurb: 'How quickly the business turns activity into cash (trailing 12 months).',
      metrics: [
        { key: 'dso', label: 'Days Sales Outstanding', value: dso, display: fmtDays(dso), formula: 'Receivables ÷ Revenue × 365', rating: band(dso, 30, 60, 'low'), hint: 'Average days customers take to pay. Lower is better.' },
        { key: 'dpo', label: 'Days Payable Outstanding', value: dpo, display: fmtDays(dpo), formula: 'Payables ÷ COGS × 365', rating: 'na', hint: 'Average days you take to pay suppliers (informational).' },
        { key: 'invturn', label: 'Inventory Turnover', value: invTurnover, display: fmtX(invTurnover), formula: 'COGS ÷ Inventory', rating: band(invTurnover, 6, 3, 'high'), hint: 'Times inventory sells through a year. Higher is leaner.' },
      ],
    },
    {
      group: 'Leverage',
      blurb: 'How much the business relies on debt.',
      metrics: [
        { key: 'de', label: 'Debt-to-Equity', value: debtToEquity, display: fmtX(debtToEquity), formula: 'Total Liabilities ÷ Equity', rating: band(debtToEquity, 1.0, 2.0, 'low'), hint: 'Debt funding relative to owner capital. Lower is safer.' },
        { key: 'dr', label: 'Debt Ratio', value: debtRatio, display: fmtPct(debtRatio), formula: 'Total Liabilities ÷ Total Assets', rating: band(debtRatio, 0.5, 0.7, 'low'), hint: 'Share of assets financed by debt.' },
      ],
    },
  ]

  const rated = groups.flatMap((g) => g.metrics).filter((x) => x.rating !== 'na')
  const points = rated.reduce((s, x) => s + (x.rating === 'good' ? 2 : x.rating === 'watch' ? 1 : 0), 0)
  const score = rated.length ? Math.round((points / (rated.length * 2)) * 100) : null
  const counts = rated.reduce((c, x) => ((c[x.rating] = (c[x.rating] || 0) + 1), c), { good: 0, watch: 0, risk: 0 })

  return { groups, score, counts, ratedCount: rated.length }
}

export const healthLabel = (score) =>
  score == null ? 'No data yet' : score >= 75 ? 'Healthy' : score >= 50 ? 'Fair' : score >= 30 ? 'Watch' : 'At risk'
