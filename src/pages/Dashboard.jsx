import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { StatCard, Card, Badge } from '../components/UI'
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
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Financial overview — {format(new Date(), 'MMMM d, yyyy')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Revenue"
          value={fmtMoney(totalRevenue, sym)}
          color="green"
          icon={<TrendingUp size={18} />}
        />
        <StatCard
          label="Total Expenses"
          value={fmtMoney(totalExpenses, sym)}
          color="red"
          icon={<TrendingDown size={18} />}
        />
        <StatCard
          label="Net Profit"
          value={fmtMoney(totalRevenue - totalExpenses, sym)}
          color={totalRevenue - totalExpenses >= 0 ? 'blue' : 'orange'}
          icon={<DollarSign size={18} />}
        />
        <StatCard
          label="Cash & Bank"
          value={fmtMoney(cashBalance, sym)}
          color="purple"
          icon={<DollarSign size={18} />}
        />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Accounts Receivable"
          value={fmtMoney(arBalance, sym)}
          sub="Amount owed to you"
          color="blue"
          icon={<FileText size={18} />}
        />
        <StatCard
          label="Accounts Payable"
          value={fmtMoney(apBalance, sym)}
          sub="Amount you owe"
          color="orange"
          icon={<ShoppingCart size={18} />}
        />
        <StatCard
          label="Overdue Invoices"
          value={overdueInvoices.length}
          sub={overdueInvoices.length ? 'Require attention' : 'All clear'}
          color={overdueInvoices.length ? 'red' : 'green'}
          icon={<AlertCircle size={18} />}
        />
        <StatCard
          label="Total Assets"
          value={fmtMoney(totalAssets, sym)}
          color="blue"
          icon={<CheckCircle2 size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue vs Expenses chart */}
        <Card className="xl:col-span-2 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Revenue vs Expenses — Last 6 Months</h2>
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
          <h2 className="text-base font-semibold text-gray-800 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { label: 'New Sales Invoice', path: '/invoices/new', color: 'text-blue-600' },
              { label: 'New Purchase Invoice', path: '/purchases/new', color: 'text-orange-600' },
              { label: 'Add Customer', path: '/customers', color: 'text-green-600' },
              { label: 'Add Supplier', path: '/suppliers', color: 'text-purple-600' },
              { label: 'Record Bank Transaction', path: '/banking', color: 'text-teal-600' },
              { label: 'View Reports', path: '/reports', color: 'text-gray-600' },
            ].map((q) => (
              <button
                key={q.path}
                onClick={() => navigate(q.path)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                <span className={`font-medium ${q.color}`}>{q.label}</span>
                <ArrowRight size={14} className="text-gray-400" />
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Invoices */}
      <Card className="mt-6">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Recent Sales Invoices</h2>
          <button onClick={() => navigate('/invoices')} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
            View all <ArrowRight size={13} />
          </button>
        </div>
        {recentInvoices.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No invoices yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-50">
                <th className="px-6 py-3">Invoice #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3 font-medium text-blue-600">{inv.number}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.customerName}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(inv.date)}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(inv.dueDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmtMoney(inv.total, sym)}</td>
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
