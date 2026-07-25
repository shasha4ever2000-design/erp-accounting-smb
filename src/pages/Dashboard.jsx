import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { StatCard, Card, Badge } from '../components/UI'
import AccountLedgerModal from '../components/AccountLedgerModal'
import { seedDemoData, isCompanyEmpty } from '../utils/demoData'
import BudgetAlertStrip from '../components/BudgetAlertStrip'
import { useT } from '../i18n'
import {
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2,
  FileText, ShoppingCart, Clock, DollarSign, ArrowRight, Sparkles, ChevronRight,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, subMonths, parseISO, isValid } from 'date-fns'

export default function Dashboard() {
  const { invoices, purchases, accounts, journalEntries, getAllBalances, settings, recurringInvoices, leases } = useStore()
  const sym = settings.company.currencySymbol
  const t = useT()

  // Click a money tile → its ledger's Statement of Account (same drawer as Reports).
  const [drill, setDrill] = useState(null)
  const today = new Date().toISOString().slice(0, 10)

  // journalEntries must be a dep: getAllBalances is a stable reference, so
  // without it the KPIs freeze until the page remounts.
  const balances = useMemo(() => getAllBalances(), [getAllBalances, journalEntries])

  const accountBalance = (id) => {
    const b = balances[id]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === id)
    if (!acc) return 0
    return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr
  }

  const totalRevenue = useMemo(() => {
    return accounts
      .filter((a) => a.type === 'revenue')
      .reduce((sum, a) => sum + accountBalance(a.id), 0)
  }, [balances, accounts])

  const totalExpenses = useMemo(() => {
    return accounts
      .filter((a) => a.type === 'expense')
      .reduce((sum, a) => sum + accountBalance(a.id), 0)
  }, [balances, accounts])

  const totalAssets = useMemo(() => {
    return accounts
      .filter((a) => a.type === 'asset')
      .reduce((sum, a) => sum + accountBalance(a.id), 0)
  }, [balances, accounts])

  const cashBalance = accountBalance('acc-cash') + accountBalance('acc-bank1')

  const arBalance = accountBalance('acc-ar')
  const apBalance = accountBalance('acc-ap')

  // Balance Sheet & P&L groupings (Manager-style summaries)
  const groupBy = (type) => accounts
    .filter((a) => a.type === type)
    .map((a) => ({ ...a, balance: accountBalance(a.id) }))
    .filter((a) => Math.abs(a.balance) > 0.009)
  const assetAccs = useMemo(() => groupBy('asset'), [balances, accounts])
  const liabAccs = useMemo(() => groupBy('liability'), [balances, accounts])
  const equityAccs = useMemo(() => groupBy('equity'), [balances, accounts])
  const revenueAccs = useMemo(() => groupBy('revenue'), [balances, accounts])
  const expenseAccs = useMemo(() => groupBy('expense'), [balances, accounts])
  const sumBal = (arr) => arr.reduce((s, a) => s + a.balance, 0)
  const netProfit = totalRevenue - totalExpenses
  const totalLiab = sumBal(liabAccs)
  const totalEquityBase = sumBal(equityAccs)
  const totalEquity = totalEquityBase + netProfit
  const balanced = Math.abs(totalAssets - (totalLiab + totalEquity)) < 0.01

  const overdueInvoices = invoices.filter((i) => {
    if (i.status === 'paid') return false
    return i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10)
  })

  const recentInvoices = [...invoices].sort((a, b) => b.createdAt?.localeCompare(a.createdAt)).slice(0, 5)

  // Monthly revenue chart (last 6 months)
  const chartData = useMemo(() => {
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i)
      const label = format(d, 'MMM')
      const yearMonth = format(d, 'yyyy-MM')
      let rev = 0, exp = 0
      invoices.forEach((inv) => {
        if (inv.date?.startsWith(yearMonth) && inv.status !== 'cancelled' && inv.status !== 'void') rev += inv.total || 0
      })
      purchases.forEach((pur) => {
        if (pur.date?.startsWith(yearMonth) && pur.status !== 'cancelled' && pur.status !== 'void') exp += pur.total || 0
      })
      months.push({ month: label, Revenue: rev, Expenses: exp })
    }
    return months
  }, [invoices, purchases])

  // 6-month projected cash position: opening cash + expected AR/AP due,
  // recurring invoice inflows and active lease outflows.
  const forecast = useMemo(() => {
    const today = new Date()
    const months = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
      months.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM'), inflow: 0, outflow: 0 })
    }
    const bucket = (dateStr) => {
      if (!dateStr) return -1
      const ym = String(dateStr).slice(0, 7)
      if (ym < months[0].key) return 0 // overdue / due now → current month
      return months.findIndex((m) => m.key === ym)
    }
    invoices.forEach((inv) => {
      if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'void') return
      const bal = (inv.total || 0) - (inv.amountPaid || 0)
      const i = bucket(inv.dueDate || inv.date)
      if (bal > 0 && i >= 0) months[i].inflow += bal
    })
    purchases.forEach((p) => {
      if (p.status === 'paid') return
      const bal = (p.total || 0) - (p.amountPaid || 0)
      const i = bucket(p.dueDate || p.date)
      if (bal > 0 && i >= 0) months[i].outflow += bal
    })
    recurringInvoices.forEach((r) => {
      if (r.status !== 'active') return
      const amt = r.total || 0
      const mult = r.frequency === 'weekly' ? 4 : r.frequency === 'biweekly' ? 2 : r.frequency === 'quarterly' ? 1 / 3 : r.frequency === 'yearly' ? 1 / 12 : 1
      months.forEach((m, i) => { if (i > 0) m.inflow += amt * mult })
    })
    leases.forEach((l) => {
      if (l.status !== 'active') return
      months.forEach((m, i) => { if (i > 0) m.outflow += (l.monthlyRent || 0) })
    })
    let running = cashBalance
    return months.map((m) => {
      running += m.inflow - m.outflow
      return { month: m.label, Projected: Math.round(running) }
    })
  }, [invoices, purchases, recurringInvoices, leases, cashBalance])

  const forecastLow = forecast.length ? Math.min(...forecast.map((f) => f.Projected)) : 0

  // Month-over-month trend chips for the headline KPIs
  const pctTrend = (cur, prev) => {
    // Compare only when BOTH months have activity — a month with no postings
    // yet would otherwise always read "▼100%".
    if (!prev || !cur) return null
    const p = ((cur - prev) / Math.abs(prev)) * 100
    return { label: `${Math.abs(p).toFixed(0)}%`, up: p >= 0 }
  }
  const cm = chartData[chartData.length - 1] || { Revenue: 0, Expenses: 0 }
  const pm = chartData[chartData.length - 2] || { Revenue: 0, Expenses: 0 }
  const revTrend = pctTrend(cm.Revenue, pm.Revenue)
  const expTrend = pctTrend(cm.Expenses, pm.Expenses)

  // Theme-aware chart colors
  const dark = (settings.theme || 'light') === 'dark'
  const gridStroke = dark ? '#1e293b' : '#eef2f7'
  const tickFill = dark ? '#94a3b8' : '#6b7280'

  const statusBadge = (status) => {
    const map = {
      paid:    'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
      sent:    'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
      partial: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
      overdue: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
      draft:   'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
    }
    return map[status] || 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'
  }

  // Shared premium tooltip treatment for all charts (theme-aware)
  const tooltipStyle = {
    contentStyle: {
      background: dark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.97)',
      border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.06)',
      borderRadius: 12,
      boxShadow: '0 8px 24px -8px rgba(15,23,42,0.25)',
      padding: '10px 14px',
      fontSize: 12.5,
    },
    labelStyle: { color: dark ? '#e2e8f0' : '#0f172a', fontWeight: 600, marginBottom: 4 },
    itemStyle: { padding: 0 },
    cursor: { stroke: dark ? '#334155' : '#cbd5e1', strokeDasharray: '3 3' },
  }

  const navigate = useNavigate()

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl mb-6 p-6 lg:p-8 bg-gradient-to-br from-surface-900 via-surface-925 to-accent-950 text-white shadow-elevated ring-1 ring-white/[0.08]">
        <div className="absolute -top-20 -end-12 w-80 h-80 rounded-full bg-brand-500/[0.18] blur-3xl" />
        <div className="absolute -bottom-24 -start-12 w-80 h-80 rounded-full bg-accent-500/[0.12] blur-3xl" />
        <div className="absolute inset-0 opacity-[0.035] bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-slate-400 text-[13px] font-medium tracking-wide">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tightest mt-1.5">{settings.company.name}</h1>
            <p className="text-slate-300/90 text-sm mt-2 max-w-xl leading-relaxed">
              {netProfit >= 0
                ? t('You are profitable this period — net {v}.').replace('{v}', fmtMoney(netProfit, sym))
                : t('Watch your spending — net loss of {v} this period.').replace('{v}', fmtMoney(Math.abs(netProfit), sym))}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate('/invoices/new')} className="inline-flex items-center gap-2 bg-white text-surface-900 font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-brand-50 active:scale-[.98] transition-all shadow-elevated">
              <FileText size={16} /> {t('New Invoice')}
            </button>
            <button onClick={() => navigate('/reports')} className="group inline-flex items-center gap-2 bg-white/[0.08] text-white font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-white/[0.14] active:scale-[.98] transition-all ring-1 ring-inset ring-white/[0.14] backdrop-blur-sm">
              {t('Reports')} <ArrowRight size={15} className="transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>

      {/* First-run: offer sample data while the books are empty */}
      {isCompanyEmpty(useStore.getState()) && (
        <div className="mb-6 rounded-2xl border-2 border-dashed border-brand-200 dark:border-brand-500/30 bg-brand-50/50 dark:bg-brand-500/[0.06] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 dark:text-slate-100">{t('New here? Explore with sample data')}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 max-w-lg">
                {t('Load a realistic demo company — customers, stock, invoices in every state, and four months of activity. Erase it anytime from Settings.')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => { try { seedDemoData(useStore.getState) } catch { /* already has data */ } }}
              className="inline-flex items-center gap-2 bg-brand-600 text-white font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-brand-700 active:scale-[.98] transition-all shadow-card">
              <Sparkles size={15} /> {t('Load sample data')}
            </button>
            <button onClick={() => navigate('/invoices/new')} className="text-sm font-semibold text-brand-600 dark:text-brand-400 hover:underline">
              {t('or start from scratch')}
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t('Total Revenue')}
          value={fmtMoney(totalRevenue, sym)}
          color="green"
          icon={<TrendingUp size={18} />}
          trend={revTrend?.label} trendUp={revTrend?.up}
          sub={revTrend ? t('vs last month') : undefined}
        />
        <StatCard
          label={t('Total Expenses')}
          value={fmtMoney(totalExpenses, sym)}
          color="red"
          icon={<TrendingDown size={18} />}
          trend={expTrend?.label} trendUp={expTrend ? !expTrend.up : undefined}
          sub={expTrend ? t('vs last month') : undefined}
        />
        <StatCard
          label={t('Net Profit')}
          value={fmtMoney(totalRevenue - totalExpenses, sym)}
          color={totalRevenue - totalExpenses >= 0 ? 'blue' : 'orange'}
          icon={<DollarSign size={18} />}
        />
        <StatCard
          label={t('Cash & Bank')}
          value={fmtMoney(cashBalance, sym)}
          color="purple"
          icon={<DollarSign size={18} />}
          onClick={() => setDrill({ id: '__cashbank__', name: t('Cash & Bank'), type: 'asset', memberIds: ['acc-cash', 'acc-bank1'] })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={t('Accounts Receivable')}
          value={fmtMoney(arBalance, sym)}
          sub={t('Amount owed to you')}
          color="blue"
          icon={<FileText size={18} />}
          onClick={() => setDrill(accounts.find((a) => a.id === 'acc-ar'))}
        />
        <StatCard
          label={t('Accounts Payable')}
          value={fmtMoney(apBalance, sym)}
          sub={t('Amount you owe')}
          color="orange"
          icon={<ShoppingCart size={18} />}
          onClick={() => setDrill(accounts.find((a) => a.id === 'acc-ap'))}
        />
        <StatCard
          label={t('Overdue Invoices')}
          value={overdueInvoices.length}
          sub={overdueInvoices.length ? t('Require attention') : t('All clear')}
          color={overdueInvoices.length ? 'red' : 'green'}
          icon={<AlertCircle size={18} />}
        />
        <StatCard
          label={t('Total Assets')}
          value={fmtMoney(totalAssets, sym)}
          color="blue"
          icon={<CheckCircle2 size={18} />}
        />
      </div>

      {/* Budget warnings — renders nothing when everything is on pace */}
      <BudgetAlertStrip />

      {/* Balance Sheet (left) & Profit and Loss (right) — Manager-style summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Balance Sheet')}</h2>
            <button onClick={() => navigate('/reports')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 px-2 py-1 -me-2 rounded-md hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors">{t('Full report →')}</button>
          </div>
          <div className="p-5 text-sm">
            <BSPLSection title="Assets" rows={assetAccs} total={totalAssets} sym={sym} color="text-blue-700 dark:text-blue-400" onOpen={setDrill} />
            <BSPLSection title="Liabilities" rows={liabAccs} total={totalLiab} sym={sym} color="text-orange-700 dark:text-orange-400" onOpen={setDrill} />
            <BSPLSection title="Equity" rows={[...equityAccs, netProfit !== 0 && { id: 'np', code: '', name: 'Net Profit (to date)', balance: netProfit }].filter(Boolean)} total={totalEquity} sym={sym} color="text-purple-700 dark:text-purple-400" onOpen={setDrill} />
            <div className="flex justify-between border-t-2 border-gray-800 dark:border-slate-400 pt-2 mt-2 font-bold text-gray-900 dark:text-slate-100">
              <span>{t('Liabilities + Equity')}</span>
              <span className={balanced ? '' : 'text-red-600 dark:text-red-400'}>{fmtMoney(totalLiab + totalEquity, sym)}</span>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Profit & Loss')}</h2>
            <button onClick={() => navigate('/reports')} className="text-xs font-semibold text-brand-600 dark:text-brand-400 px-2 py-1 -me-2 rounded-md hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors">{t('Full report →')}</button>
          </div>
          <div className="p-5 text-sm">
            <BSPLSection title="Revenue" rows={revenueAccs} total={totalRevenue} sym={sym} color="text-green-700 dark:text-green-400" onOpen={setDrill} />
            <BSPLSection title="Expenses" rows={expenseAccs} total={totalExpenses} sym={sym} color="text-red-700 dark:text-red-400" onOpen={setDrill} />
            <div className={`flex justify-between border-t-2 border-gray-800 dark:border-slate-400 pt-2 mt-2 font-black text-base ${netProfit >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
              <span className="text-gray-900 dark:text-slate-100">{netProfit >= 0 ? t('Net Profit') : t('Net Loss')}</span>
              <span>{fmtMoney(Math.abs(netProfit), sym)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue vs Expenses chart */}
        <Card className="xl:col-span-2 p-6">
          <div className="flex items-center gap-4 mb-5">
            <h2 className="text-base font-semibold tracking-snug text-slate-800 dark:text-slate-100 flex-1">{t('Revenue vs Expenses — Last 6 Months')}</h2>
            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-500" /> {t('Revenue')}</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger-500" /> {t('Expenses')}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} dy={4} />
              <YAxis tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} tickFormatter={(v) => `${sym}${v.toLocaleString()}`} width={72} />
              <Tooltip formatter={(v) => fmtMoney(v, sym)} {...tooltipStyle} />
              <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" fill="url(#rev)" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? '#0f172a' : '#fff' }} />
              <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#exp)" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? '#0f172a' : '#fff' }} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Quick links */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Quick Actions')}</h2>
          <div className="space-y-2">
            {[
              { label: 'New Sales Invoice', path: '/invoices/new', color: 'text-blue-600 dark:text-blue-400' },
              { label: 'New Purchase Invoice', path: '/purchases/new', color: 'text-orange-600 dark:text-orange-400' },
              { label: 'New Project', path: '/projects', color: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Budgets vs Actuals', path: '/budgets', color: 'text-green-600 dark:text-green-400' },
              { label: 'Record Bank Transaction', path: '/banking', color: 'text-teal-600 dark:text-teal-400' },
              { label: 'View Reports', path: '/reports', color: 'text-gray-600 dark:text-slate-300' },
            ].map((q) => (
              <button
                key={q.path}
                onClick={() => navigate(q.path)}
                className="group w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ring-1 ring-inset ring-transparent hover:ring-slate-200/80 dark:hover:ring-surface-700 hover:bg-slate-50/80 dark:hover:bg-white/[0.04] hover:shadow-xs transition-all"
              >
                <span className={`font-medium ${q.color}`}>{t(q.label)}</span>
                <ArrowRight size={14} className="text-slate-300 dark:text-slate-600 transition-all duration-150 group-hover:text-slate-500 dark:group-hover:text-slate-400 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Cash-flow forecast */}
      <Card className="mt-6 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Cash-Flow Forecast — Next 6 Months')}</h2>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{t('Projected from receivables, payables, recurring invoices and leases')}</p>
          </div>
          {forecastLow < 0 && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">
              <AlertCircle size={13} /> {t('Projected cash shortfall')}: {fmtMoney(forecastLow, sym)}
            </div>
          )}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={forecast} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} dy={4} />
            <YAxis tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false} tickFormatter={(v) => `${sym}${v.toLocaleString()}`} width={72} />
            <Tooltip formatter={(v) => fmtMoney(v, sym)} labelFormatter={(l) => l} {...tooltipStyle} />
            <Area type="monotone" dataKey="Projected" stroke="#0d9488" fill="url(#fc)" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? '#0f172a' : '#fff' }} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Recent Invoices */}
      <Card className="mt-6">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Recent Sales Invoices')}</h2>
          <button onClick={() => navigate('/invoices')} className="group text-sm font-medium text-brand-600 dark:text-brand-400 flex items-center gap-1 px-2 py-1 -me-2 rounded-md hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors">
            {t('View all')} <ArrowRight size={13} className="transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
          </button>
        </div>
        {recentInvoices.length === 0 ? (
          <div className="py-10 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No invoices yet')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide border-b border-gray-50 dark:border-slate-700">
                <th className="px-6 py-3">Invoice #</th>
                <th className="px-4 py-3">{t('Customer')}</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className="border-b border-gray-50 dark:border-slate-700/50 hover:bg-blue-50/40 dark:hover:bg-slate-700/40 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3 font-medium text-blue-600 dark:text-blue-400">{inv.number}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{inv.customerName}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{fmtDate(inv.date)}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{fmtDate(inv.dueDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(inv.total, sym)}</td>
                  <td className="px-4 py-3">
                    <Badge className={statusBadge(inv.status)}>{inv.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AccountLedgerModal
        open={!!drill}
        onClose={() => setDrill(null)}
        account={drill}
        accounts={accounts}
        journalEntries={journalEntries}
        sym={sym}
        startDate={today}
        endDate={today}
        mode="todate"
        companyName={settings.company.name}
        onOpenAccount={(id) => setDrill(accounts.find((a) => a.id === id) || null)}
      />
    </div>
  )
}

function BSPLSection({ title, rows, total, sym, color, onOpen }) {
  const t = useT()
  return (
    <div className="mb-4">
      <p className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${color}`}>{t(title)}</p>
      {rows.length === 0 ? (
        <p className="text-gray-400 dark:text-slate-500 text-xs mb-1">{t('None')}</p>
      ) : rows.map((a) => {
        // Synthetic aggregate rows (e.g. the injected "Net Profit (to date)"
        // equity line) carry no account code and aren't a real ledger — leave
        // those as plain text instead of drilling into a non-existent account.
        const clickable = !!(onOpen && a.code)
        const body = (
          <>
            <span className="truncate pe-2 flex items-center gap-1">
              {a.name}
              {clickable && <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 text-brand-400 transition-opacity flex-shrink-0" />}
            </span>
            <span className="text-gray-800 dark:text-slate-100 whitespace-nowrap">{fmtMoney(a.balance, sym)}</span>
          </>
        )
        return clickable ? (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a)}
            className="group w-full flex justify-between items-center py-0.5 text-gray-600 dark:text-slate-300 text-start rounded-md hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.07] hover:text-brand-700 dark:hover:text-brand-300 transition-colors -mx-1.5 px-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {body}
          </button>
        ) : (
          <div key={a.id} className="flex justify-between py-0.5 text-gray-600 dark:text-slate-300">
            {body}
          </div>
        )
      })}
      <div className="flex justify-between border-t border-gray-100 dark:border-slate-700 mt-1 pt-1 font-semibold text-gray-800 dark:text-slate-100">
        <span>{t('Total')} {t(title)}</span><span>{fmtMoney(total, sym)}</span>
      </div>
    </div>
  )
}
