import { useState, useEffect, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { idbKvStorage } from '../utils/idbKvStorage'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Badge } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { Layers, Info } from 'lucide-react'

// Multi-company consolidation: reads each company's saved snapshot and combines
// their ledgers into a group-level summary and a consolidated P&L (by account).
// Balances are aggregated in each company's own base currency — a banner warns
// when companies use different currencies (true FX translation is out of scope).
export default function Consolidation() {
  const t = useT()
  const companies = useAuth((s) => s.companies)
  const liveSettings = useStore((s) => s.settings)
  const liveState = useStore.getState()
  const currentCompanyId = useAuth((s) => s.currentCompanyId)
  const sym = liveSettings.company.currencySymbol

  const [rows, setRows] = useState(null) // per-company computed summaries

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out = []
      for (const c of companies) {
        let state = null
        if (c.id === currentCompanyId) {
          // use the live store for the active company (freshest)
          state = { accounts: liveState.accounts, journalEntries: liveState.journalEntries, settings: liveState.settings }
        } else {
          try {
            const raw = await idbKvStorage.getItem(`erp-co-${c.id}`)
            state = raw ? JSON.parse(raw).state : null
          } catch { state = null }
        }
        out.push({ company: c, state })
      }
      if (alive) setRows(out)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, currentCompanyId])

  const data = useMemo(() => {
    if (!rows) return null
    const natural = (acc, b) => (['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr)
    const balancesOf = (state) => {
      const bal = {}
      ;(state.accounts || []).forEach((a) => { bal[a.id] = { dr: 0, cr: 0 } })
      ;(state.journalEntries || []).forEach((je) => (je.lines || []).forEach((l) => {
        if (!bal[l.accountId]) bal[l.accountId] = { dr: 0, cr: 0 }
        bal[l.accountId].dr += l.debit || 0; bal[l.accountId].cr += l.credit || 0
      }))
      return bal
    }
    const currencies = new Set()
    const companyRows = []
    const plMap = {} // code||name -> { name, type, byCompany:{}, total }
    rows.forEach(({ company, state }) => {
      if (!state) { companyRows.push({ name: company.name, missing: true }); return }
      currencies.add(state.settings?.company?.currency || 'USD')
      const bal = balancesOf(state)
      const sumType = (tp) => (state.accounts || []).filter((a) => a.type === tp).reduce((s, a) => s + natural(a, bal[a.id] || { dr: 0, cr: 0 }), 0)
      const revenue = sumType('revenue'), expense = sumType('expense')
      companyRows.push({
        id: company.id, name: company.name,
        revenue, expense, net: revenue - expense,
        assets: sumType('asset'), liabilities: sumType('liability'), equity: sumType('equity'),
      })
      // accumulate consolidated P&L by account (key on code so same codes merge)
      ;(state.accounts || []).filter((a) => a.type === 'revenue' || a.type === 'expense').forEach((a) => {
        const v = natural(a, bal[a.id] || { dr: 0, cr: 0 })
        if (Math.abs(v) < 0.005) return
        const key = a.code || a.name
        const row = plMap[key] || (plMap[key] = { name: `${a.code} ${a.name}`.trim(), type: a.type, byCompany: {}, total: 0 })
        row.byCompany[company.id] = (row.byCompany[company.id] || 0) + v
        row.total += v
      })
    })
    const valid = companyRows.filter((r) => !r.missing)
    const totals = {
      revenue: valid.reduce((s, r) => s + r.revenue, 0),
      expense: valid.reduce((s, r) => s + r.expense, 0),
      net: valid.reduce((s, r) => s + r.net, 0),
      assets: valid.reduce((s, r) => s + r.assets, 0),
      liabilities: valid.reduce((s, r) => s + r.liabilities, 0),
      equity: valid.reduce((s, r) => s + r.equity, 0),
    }
    const pl = Object.values(plMap).sort((a, b) => (a.type === b.type ? b.total - a.total : a.type === 'revenue' ? -1 : 1))
    return { companyRows, totals, pl, mixedCurrency: currencies.size > 1 }
  }, [rows])

  if (!data) return <div className="py-24 text-center text-gray-400 dark:text-slate-500">{t('Loading…')}</div>

  const exportRows = data.companyRows.filter((r) => !r.missing).map((r) => ({
    company: r.name, revenue: r.revenue, expense: r.expense, net: r.net, assets: r.assets, liabilities: r.liabilities, equity: r.equity,
  }))
  const exportCols = [
    { key: 'company', label: t('Company') },
    { key: 'revenue', label: t('Revenue'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'expense', label: t('Expenses'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'net', label: t('Net Profit'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'assets', label: t('Assets'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'liabilities', label: t('Liabilities'), right: true, map: (v) => Number(v).toFixed(2) },
    { key: 'equity', label: t('Equity'), right: true, map: (v) => Number(v).toFixed(2) },
  ]

  return (
    <div>
      <PageHeader title="Group Consolidation" subtitle="Combined performance and position across all your companies"
        action={<ExportMenu filename="consolidation" title={t('Group Consolidation')} rows={exportRows} columns={exportCols} />} />

      {data.mixedCurrency && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 mb-5 text-sm text-amber-700 dark:text-amber-300">
          <Info size={16} className="flex-shrink-0 mt-0.5" />
          <span>{t('Companies use different base currencies. Figures are summed at face value without FX translation.')}</span>
        </div>
      )}

      {/* Group KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Group Revenue', value: data.totals.revenue, tone: 'from-emerald-500 to-green-600' },
          { label: 'Group Expenses', value: data.totals.expense, tone: 'from-rose-500 to-red-600' },
          { label: 'Group Net Profit', value: data.totals.net, tone: 'from-brand-500 to-accent-600' },
          { label: 'Group Assets', value: data.totals.assets, tone: 'from-violet-500 to-purple-600' },
        ].map((k) => (
          <Card key={k.label} className="p-5">
            <div className={`inline-flex text-white text-xs font-semibold px-2 py-0.5 rounded-md bg-gradient-to-br ${k.tone} mb-2`}>{t('Group')}</div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 font-semibold">{t(k.label)}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1 tabular">{fmtMoney(k.value, sym)}</p>
          </Card>
        ))}
      </div>

      {/* Per-company summary */}
      <Card className="overflow-x-auto mb-6">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2">
          <Layers size={16} className="text-blue-500" /><h3 className="font-semibold text-gray-700 dark:text-slate-200">{t('By Company')}</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
              <th className="py-2.5 px-4 text-start font-semibold">{t('Company')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Revenue')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Expenses')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Net Profit')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Assets')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Equity')}</th>
            </tr>
          </thead>
          <tbody>
            {data.companyRows.map((r, i) => r.missing ? (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50 text-gray-400">
                <td className="py-2 px-4">{r.name}</td>
                <td className="py-2 px-4 text-end" colSpan={5}>{t('No saved data yet')}</td>
              </tr>
            ) : (
              <tr key={r.id} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-2 px-4 font-medium text-gray-800 dark:text-slate-100">{r.name}{r.id === currentCompanyId && <Badge className="ms-2 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{t('Active')}</Badge>}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.revenue, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.expense, sym)}</td>
                <td className={`py-2 px-4 text-end font-semibold ${r.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{fmtMoney(r.net, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.assets, sym)}</td>
                <td className="py-2 px-4 text-end text-gray-700 dark:text-slate-200">{fmtMoney(r.equity, sym)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 dark:border-slate-500 bg-gray-50/60 dark:bg-slate-700/40 font-bold">
              <td className="py-2.5 px-4 text-gray-900 dark:text-slate-100">{t('Group Total')}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(data.totals.revenue, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(data.totals.expense, sym)}</td>
              <td className={`py-2.5 px-4 text-end ${data.totals.net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(data.totals.net, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(data.totals.assets, sym)}</td>
              <td className="py-2.5 px-4 text-end">{fmtMoney(data.totals.equity, sym)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Consolidated P&L by account */}
      <Card className="overflow-x-auto">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 font-semibold text-gray-700 dark:text-slate-200">{t('Consolidated P&L by Account')}</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 text-xs uppercase">
              <th className="py-2.5 px-4 text-start font-semibold">{t('Account')}</th>
              <th className="py-2.5 px-4 text-start font-semibold">{t('Type')}</th>
              <th className="py-2.5 px-4 text-end font-semibold">{t('Group Total')}</th>
            </tr>
          </thead>
          <tbody>
            {data.pl.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('No data for this period')}</td></tr>}
            {data.pl.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 dark:border-slate-700/50">
                <td className="py-2 px-4 text-gray-700 dark:text-slate-200">{r.name}</td>
                <td className="py-2 px-4"><Badge className={r.type === 'revenue' ? 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300' : 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300'}>{t(r.type === 'revenue' ? 'Revenue' : 'Expense')}</Badge></td>
                <td className="py-2 px-4 text-end font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.total, sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
