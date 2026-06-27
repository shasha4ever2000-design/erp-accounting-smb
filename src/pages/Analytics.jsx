import { useMemo } from 'react'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, StatCard } from '../components/UI'
import { TrendingUp, TrendingDown, DollarSign, Wallet, FileText, ShoppingCart } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { format, subMonths } from 'date-fns'

const PIE = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#dc2626', '#475569']

export default function Analytics() {
  const { invoices, purchases, accounts, customers, bankAccounts, getAllBalances, settings } = useStore()
  const sym = settings.company.currencySymbol
  const balances = useMemo(() => getAllBalances(), [getAllBalances])

  const bal = (id) => {
    const b = balances[id]; if (!b) return 0
    const a = accounts.find((x) => x.id === id); if (!a) return 0
    return ['asset', 'expense'].includes(a.type) ? b.dr - b.cr : b.cr - b.dr
  }

  const totalRevenue = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + bal(a.id), 0)
  const totalExpenses = accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + bal(a.id), 0)
  const netProfit = totalRevenue - totalExpenses
  const cash = bankAccounts.reduce((s, b) => s + bal(b.accountId), 0)
  const ar = bal('acc-ar')
  const ap = bal('acc-ap')

  const trend = useMemo(() => {
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = subMonths(new Date(), i)
      const ym = format(d, 'yyyy-MM')
      let rev = 0, exp = 0
      invoices.forEach((inv) => { if (inv.date?.startsWith(ym) && inv.status !== 'cancelled') rev += inv.total || 0 })
      purchases.forEach((p) => { if (p.date?.startsWith(ym) && p.status !== 'cancelled') exp += p.total || 0 })
      months.push({ month: format(d, 'MMM'), Revenue: Math.round(rev), Expenses: Math.round(exp) })
    }
    return months
  }, [invoices, purchases])

  const expenseBreakdown = useMemo(() =>
    accounts.filter((a) => a.type === 'expense').map((a) => ({ name: a.name, value: Math.round(bal(a.id)) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 9)
  , [balances, accounts])

  const topCustomers = useMemo(() => {
    const map = {}
    invoices.forEach((inv) => { if (inv.status !== 'cancelled') map[inv.customerName || 'Unknown'] = (map[inv.customerName || 'Unknown'] || 0) + (inv.total || 0) })
    return Object.entries(map).map(([name, value]) => ({ name: name.length > 16 ? name.slice(0, 16) + '…' : name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [invoices])

  const hasData = invoices.length > 0 || purchases.length > 0

  return (
    <div>
      <PageHeader title="Business Analytics" subtitle="Live insights across your company's finances" />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <StatCard label="Revenue" value={fmtMoney(totalRevenue, sym)} color="green" icon={<TrendingUp size={18} />} />
        <StatCard label="Expenses" value={fmtMoney(totalExpenses, sym)} color="red" icon={<TrendingDown size={18} />} />
        <StatCard label="Net Profit" value={fmtMoney(netProfit, sym)} color={netProfit >= 0 ? 'blue' : 'orange'} icon={<DollarSign size={18} />} />
        <StatCard label="Cash & Bank" value={fmtMoney(cash, sym)} color="purple" icon={<Wallet size={18} />} />
        <StatCard label="Receivable" value={fmtMoney(ar, sym)} color="blue" icon={<FileText size={18} />} />
        <StatCard label="Payable" value={fmtMoney(ap, sym)} color="orange" icon={<ShoppingCart size={18} />} />
      </div>

      {!hasData ? (
        <Card className="p-12 text-center text-gray-400 dark:text-slate-500">
          Add some invoices and purchases to see charts and insights here.
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Card className="xl:col-span-2 p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">Revenue vs Expenses — Last 12 Months</h2>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="aRev" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                  <linearGradient id="aExp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${sym}${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => fmtMoney(v, sym)} />
                <Area type="monotone" dataKey="Revenue" stroke="#2563eb" fill="url(#aRev)" strokeWidth={2} />
                <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fill="url(#aExp)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">Expense Breakdown</h2>
            {expenseBreakdown.length === 0 ? <p className="text-sm text-gray-400 py-12 text-center">No expenses yet</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45}>
                    {expenseBreakdown.map((e, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtMoney(v, sym)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="xl:col-span-3 p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">Top Customers by Revenue</h2>
            {topCustomers.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">No customer invoices yet</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topCustomers} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${sym}${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => fmtMoney(v, sym)} />
                  <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={70} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
