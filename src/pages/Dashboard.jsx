import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { StatCard, Card, Badge } from '../components/UI'
import { useT } from '../i18n'
import {
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2,
  FileText, ShoppingCart, Clock, DollarSign, ArrowRight,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { format, subMonths, parseISO, isValid } from 'date-fns'

export default function Dashboard() {
  const { invoices, purchases, accounts, getAllBalances, settings } = useStore()
  const sym = settings.company.currencySymbol
  const t = useT()

  const balances = useMemo(() => getAllBalances(), [getAllBalances])

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
        if (inv.date?.startsWith(yearMonth) && inv.status !== 'cancelled') rev += inv.total || 0
      })
      purchases.forEach((pur) => {
        if (pur.date?.startsWith(yearMonth) && pur.status !== 'cancelled') exp += pur.total || 0
      })
      months.push({ month: label, Revenue: rev, Expenses: exp })
    }
    return months
  }, [invoices, purchases])

  const statusBadge = (status) => {
    const map = {
      paid:    'bg-green-100 text-green-700',
      sent:    'bg-blue-100 text-blue-700',
      partial: 'bg-yellow-100 text-yellow-700',
      overdue: 'bg-red-100 text-red-700',
      draft:   'bg-gray-100 text-gray-600',
    }
    return map[status] || 'bg-gray-100 text-gray-600'
  }

  const navigate = useNavigate()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{t('Dashboard')}</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">{format(new Date(), 'MMMM d, yyyy')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={t('Total Revenue')}
          value={fmtMoney(totalRevenue, sym)}
          color="green"
          icon={<TrendingUp size={18} />}
        />
        <StatCard
          label={t('Total Expenses')}
          value={fmtMoney(totalExpenses, sym)}
          color="red"
          icon={<TrendingDown size={18} />}
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
        />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          label={t('Accounts Receivable')}
          value={fmtMoney(arBalance, sym)}
          sub={t('Amount owed to you')}
          color="blue"
          icon={<FileText size={18} />}
        />
        <StatCard
          label={t('Accounts Payable')}
          value={fmtMoney(apBalance, sym)}
          sub={t('Amount you owe')}
          color="orange"
          icon={<ShoppingCart size={18} />}
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

      {/* Balance Sheet (left) & Profit and Loss (right) — Manager-style summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Balance Sheet')}</h2>
            <button onClick={() => navigate('/reports')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('Full report →')}</button>
          </div>
          <div className="p-5 text-sm">
            <BSPLSection title="Assets" rows={assetAccs} total={totalAssets} sym={sym} color="text-blue-700 dark:text-blue-400" />
            <BSPLSection title="Liabilities" rows={liabAccs} total={totalLiab} sym={sym} color="text-orange-700 dark:text-orange-400" />
            <BSPLSection title="Equity" rows={[...equityAccs, netProfit !== 0 && { id: 'np', code: '', name: 'Net Profit (to date)', balance: netProfit }].filter(Boolean)} total={totalEquity} sym={sym} color="text-purple-700 dark:text-purple-400" />
            <div className="flex justify-between border-t-2 border-gray-800 dark:border-slate-400 pt-2 mt-2 font-bold text-gray-900 dark:text-slate-100">
              <span>{t('Liabilities + Equity')}</span>
              <span className={balanced ? '' : 'text-red-600'}>{fmtMoney(totalLiab + totalEquity, sym)}</span>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Profit & Loss')}</h2>
            <button onClick={() => navigate('/reports')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('Full report →')}</button>
          </div>
          <div className="p-5 text-sm">
            <BSPLSection title="Revenue" rows={revenueAccs} total={totalRevenue} sym={sym} color="text-green-700 dark:text-green-400" />
            <BSPLSection title="Expenses" rows={expenseAccs} total={totalExpenses} sym={sym} color="text-red-700 dark:text-red-400" />
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
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Revenue vs Expenses — Last 6 Months')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${sym}${v.toLocaleString()}`} />
              <Tooltip formatter={(v) => fmtMoney(v, sym)} />
              <Area type="monotone" dataKey="Revenue" stroke="#2563eb" fill="url(#rev)" strokeWidth={2} />
              <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#exp)" strokeWidth={2} />
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
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className={`font-medium ${q.color}`}>{t(q.label)}</span>
                <ArrowRight size={14} className="text-gray-400" />
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card className="mt-6">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Recent Sales Invoices')}</h2>
          <button onClick={() => navigate('/invoices')} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            {t('View all')} <ArrowRight size={13} />
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
    </div>
  )
}

function BSPLSection({ title, rows, total, sym, color }) {
  const t = useT()
  return (
    <div className="mb-4">
      <p className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${color}`}>{t(title)}</p>
      {rows.length === 0 ? (
        <p className="text-gray-400 dark:text-slate-500 text-xs mb-1">None</p>
      ) : rows.map((a) => (
        <div key={a.id} className="flex justify-between py-0.5 text-gray-600 dark:text-slate-300">
          <span className="truncate pr-2">{a.name}</span>
          <span className="text-gray-800 dark:text-slate-100 whitespace-nowrap">{fmtMoney(a.balance, sym)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-100 dark:border-slate-700 mt-1 pt-1 font-semibold text-gray-800 dark:text-slate-100">
        <span>{t('Total')} {t(title)}</span><span>{fmtMoney(total, sym)}</span>
      </div>
    </div>
  )
}
