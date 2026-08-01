import { useMemo } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { fmtMoney } from '../utils/formatters'
import { computeFinancialHealth, healthLabel } from '../utils/financialHealth'
import { groupIdsWithRole, OTHER_INCOME } from '../utils/accountTree'
import { PageHeader, Card } from '../components/UI'
import { Activity, Droplets, TrendingUp, Gauge, Scale } from 'lucide-react'

const GROUP_ICON = { Liquidity: Droplets, Profitability: TrendingUp, Efficiency: Gauge, Leverage: Scale }

// good / watch / risk / na → theme-aware chip + dot classes
const RATING = {
  good:  { dot: 'bg-success-500', chip: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300', label: 'Healthy' },
  watch: { dot: 'bg-warning-500', chip: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300', label: 'Watch' },
  risk:  { dot: 'bg-danger-500',  chip: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300', label: 'At risk' },
  na:    { dot: 'bg-slate-300 dark:bg-slate-600', chip: 'bg-slate-100 text-slate-500 dark:bg-surface-700 dark:text-slate-400', label: '—' },
}

export default function FinancialHealth() {
  const t = useT()
  const { accounts, accountGroups = [], getAllBalances, settings } = useStore()
  const sym = settings.company.currencySymbol

  const { result, asOf } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const ttmStart = (() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
    const allBal = getAllBalances()                 // cumulative to date → balance sheet
    const ttmBal = getAllBalances(ttmStart, today)  // trailing 12 months → P&L

    const acc = (id) => accounts.find((a) => a.id === id)
    const nat = (a, bals) => { const b = bals[a.id] || { dr: 0, cr: 0 }; return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr }
    const sumType = (type, subtype, bals) => accounts.filter((a) => a.type === type && (!subtype || a.subtype === subtype)).reduce((s, a) => s + nat(a, bals), 0)

    const invIds = new Set(['acc-inv', 'acc-rawmat', 'acc-wip', 'acc-fingoods'])
    const isInventory = (a) => a.type === 'asset' && (invIds.has(a.id) || /inventory|raw material|finished goods|work.?in.?progress|stock/i.test(a.name || ''))
    const isCash = (a) => a.type === 'asset' && a.subtype === 'current' && (['acc-cash', 'acc-bank1'].includes(a.id) || /cash|bank/i.test(a.name || ''))
    const isCogs = (a) => a.type === 'expense' && (a.id === 'acc-cogs' || /cost of (goods|sales)|cogs/i.test(a.name || ''))

    const currentAssets = sumType('asset', 'current', allBal)
    const inventory = accounts.filter(isInventory).reduce((s, a) => s + nat(a, allBal), 0)
    const cash = accounts.filter(isCash).reduce((s, a) => s + nat(a, allBal), 0)
    const currentLiabilities = sumType('liability', 'current', allBal)
    const totalAssets = sumType('asset', null, allBal)
    const totalLiabilities = sumType('liability', null, allBal)
    const equity = totalAssets - totalLiabilities // accounting identity → includes retained earnings + current profit

    // Every ratio here that divides by revenue means *trading* revenue: gross
    // and net margin per riyal of sales, and DSO against the sales that create
    // receivables. Other income — an FX movement, a gain on selling a van — is
    // none of those, so it comes out, exactly as it does on the P&L. Net income
    // still counts it, because it genuinely is part of the bottom line.
    const otherIncomeGroups = groupIdsWithRole(accountGroups, OTHER_INCOME)
    const allRevenue = sumType('revenue', null, ttmBal)
    const otherIncome = accounts
      .filter((a) => a.type === 'revenue' && otherIncomeGroups.has(a.groupId))
      .reduce((s, a) => s + nat(a, ttmBal), 0)
    const revenue = allRevenue - otherIncome
    const cogs = accounts.filter(isCogs).reduce((s, a) => s + nat(a, ttmBal), 0)
    const expenses = sumType('expense', null, ttmBal)
    const netIncome = allRevenue - expenses
    const grossProfit = revenue - cogs
    const ar = acc('acc-ar') ? nat(acc('acc-ar'), allBal) : 0
    const ap = acc('acc-ap') ? nat(acc('acc-ap'), allBal) : 0

    return {
      asOf: today,
      result: computeFinancialHealth({ currentAssets, inventory, cash, currentLiabilities, totalAssets, totalLiabilities, equity, revenue, cogs, grossProfit, netIncome, ar, ap }),
    }
  }, [accounts, accountGroups, getAllBalances])

  const { groups, score, counts } = result
  const scoreColor = score == null ? 'text-slate-400' : score >= 75 ? 'text-success-600 dark:text-success-400' : score >= 50 ? 'text-brand-600 dark:text-brand-400' : score >= 30 ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'
  const ringColor = score == null ? '#94a3b8' : score >= 75 ? '#16a34a' : score >= 50 ? '#2563eb' : score >= 30 ? '#d97706' : '#dc2626'

  return (
    <div>
      <PageHeader title={t('Financial Health')} subtitle={t('Key ratios that turn your ledger into a check-up — trailing 12 months for P&L, current balances for the balance sheet')} />

      {/* Overall score */}
      <Card className="p-6 mb-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
            <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" className="stroke-gray-100 dark:stroke-surface-700" />
              {score != null && <circle cx="60" cy="60" r="52" fill="none" strokeWidth="12" stroke={ringColor} strokeLinecap="round" strokeDasharray={`${(score / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`} />}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold tracking-tightest ${scoreColor}`}>{score == null ? '—' : score}</span>
              {score != null && <span className="text-[11px] text-gray-400 dark:text-slate-500">/ 100</span>}
            </div>
          </div>
          <div className="text-center sm:text-start">
            <div className="flex items-center gap-2 justify-center sm:justify-start">
              <Activity size={18} className={scoreColor} />
              <h2 className={`text-xl font-bold ${scoreColor}`}>{t(healthLabel(score))}</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md">{t('A weighted read across liquidity, profitability, efficiency and leverage. Not a substitute for professional advice.')}</p>
            <div className="flex items-center gap-3 mt-3 justify-center sm:justify-start text-xs">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-success-500" /> {counts.good} {t('healthy')}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-warning-500" /> {counts.watch} {t('watch')}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger-500" /> {counts.risk} {t('at risk')}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Ratio groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.group] || Activity
          return (
            <Card key={g.group} className="p-5">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/10 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20 flex items-center justify-center"><Icon size={16} /></div>
                <h3 className="font-semibold text-gray-800 dark:text-slate-100">{t(g.group)}</h3>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-4 ps-10">{t(g.blurb)}</p>
              <div className="divide-y divide-gray-50 dark:divide-surface-700/50">
                {g.metrics.map((m) => {
                  const r = RATING[m.rating] || RATING.na
                  const display = m.isMoney ? fmtMoney(m.value || 0, sym) : m.display
                  return (
                    <div key={m.key} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.dot}`} />
                          <span className="font-medium text-gray-800 dark:text-slate-100 text-sm">{t(m.label)}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 ps-4">{m.formula}</p>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 ps-4">{t(m.hint)}</p>
                      </div>
                      <div className="text-end flex-shrink-0">
                        <div className="text-lg font-bold text-gray-900 dark:text-slate-100 tabular">{display}</div>
                        {m.rating !== 'na' && <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${r.chip}`}>{t(r.label)}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
