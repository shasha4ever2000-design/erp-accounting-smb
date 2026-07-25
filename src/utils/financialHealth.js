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
