import { useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, StatCard } from '../components/UI'
import { salesAnalytics, quotationStats, purchaseAnalytics, poStats, monthlyTrend } from '../utils/tradeAnalytics'
import { TrendingUp, ShoppingCart, Percent, Truck, FileText, PackageCheck, GitCompareArrows, Trophy } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

function TopList({ title, icon, rows, sym, valueKey = 'value' }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0))
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">{icon}<h3 className="font-semibold text-gray-800 dark:text-slate-100">{title}</h3></div>
      {rows.length === 0 ? <p className="text-sm text-gray-400 dark:text-slate-500 py-4 text-center">—</p> : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700 dark:text-slate-200 truncate pe-2">{r.name}</span>
                <span className="font-medium text-gray-900 dark:text-slate-100 tabular-nums flex-shrink-0">{fmtMoney(r[valueKey], sym)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-surface-700 overflow-hidden">
                <div className="h-full rounded-full bg-brand-500 dark:bg-brand-400" style={{ width: `${((Number(r[valueKey]) || 0) / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function TradeAnalytics() {
  const t = useT()
  const { invoices, purchases, quotations, purchaseOrders, creditNotes, debitNotes, accounts, getAllBalances, settings } = useStore()
  const sym = settings.company.currencySymbol

  const a = useMemo(() => {
    const sales = salesAnalytics(invoices, creditNotes)
    const quotes = quotationStats(quotations)
    const purch = purchaseAnalytics(purchases, debitNotes)
    const po = poStats(purchaseOrders)
    const trend = monthlyTrend(invoices, purchases, 12)
    // Ledger-derived figures: COGS (for gross margin) and the GRNI accrual balance.
    const bals = getAllBalances()
    const natBal = (id) => { const b = bals[id] || { dr: 0, cr: 0 }; const acc = accounts.find((x) => x.id === id); if (!acc) return 0; return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr }
    const cogs = accounts.filter((x) => x.type === 'expense' && (x.id === 'acc-cogs' || /cost of (goods|sales)/i.test(x.name || ''))).reduce((s, x) => s + natBal(x.id), 0)
    const grni = natBal('acc-grni')
    const grossProfit = Math.round((sales.netSales - cogs) * 100) / 100
    const grossMargin = sales.netSales ? Math.round((grossProfit / sales.netSales) * 1000) / 10 : 0
    return { sales, quotes, purch, po, trend, cogs, grni, grossProfit, grossMargin }
  }, [invoices, purchases, quotations, purchaseOrders, creditNotes, debitNotes, accounts, getAllBalances])

  const trendMax = Math.max(1, ...a.trend.map((m) => Math.max(m.sales, m.purchases)))
  const money = (v) => fmtMoney(v, sym)

  return (
    <div>
      <PageHeader title={t('Sales & Purchasing Analytics')} subtitle={t('Order-to-cash and procure-to-pay at a glance')} />

      {/* Sales KPIs */}
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-3">{t('Sales')}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('Net Sales')} value={money(a.sales.netSales)} sub={`${t('Gross')} ${money(a.sales.grossSales)}`} color="green" icon={<TrendingUp size={18} />} />
        <StatCard label={t('Gross Margin')} value={`${a.grossMargin}%`} sub={money(a.grossProfit)} color="blue" icon={<Percent size={18} />} />
        <StatCard label={t('Discounts Given')} value={money(a.sales.totalDiscount)} sub={`${t('Returns')} ${money(a.sales.returns)}`} color="orange" icon={<Percent size={18} />} />
        <StatCard label={t('Quote Conversion')} value={`${a.quotes.conversionRate}%`} sub={`${t('Open')} ${money(a.quotes.openValue)}`} color="purple" icon={<FileText size={18} />} />
        <StatCard label={t('Receivable')} value={money(a.sales.outstanding)} sub={`${a.sales.count} ${t('invoices')}`} color="blue" icon={<FileText size={18} />} />
        <StatCard label={t('Avg. Invoice')} value={money(a.sales.avgInvoice)} color="green" icon={<TrendingUp size={18} />} />
        <StatCard label={t('Shipping Income')} value={money(a.sales.shipping)} color="purple" icon={<Truck size={18} />} />
        <StatCard label={t('Open Quotes')} value={money(a.quotes.openValue)} sub={`${a.quotes.total} ${t('total')}`} color="amber" icon={<FileText size={18} />} />
      </div>

      {/* Purchasing KPIs */}
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-3">{t('Purchasing')}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('Net Purchases')} value={money(a.purch.netPurchases)} sub={`${t('Gross')} ${money(a.purch.grossPurchases)}`} color="orange" icon={<ShoppingCart size={18} />} />
        <StatCard label={t('Payable')} value={money(a.purch.payable)} color="red" icon={<ShoppingCart size={18} />} />
        <StatCard label={t('Discounts Received')} value={money(a.purch.discount)} sub={`${t('Freight')} ${money(a.purch.freight)}`} color="green" icon={<Percent size={18} />} />
        <StatCard label={t('Open POs')} value={money(a.po.openValue)} sub={`${a.po.openCount} ${t('orders')}`} color="blue" icon={<PackageCheck size={18} />} />
        <StatCard label={t('GRNI (uninvoiced)')} value={money(a.grni)} sub={t('goods received, not billed')} color="amber" icon={<PackageCheck size={18} />} />
        <StatCard label={t('Match Variances')} value={String(a.po.variance)} sub={t('POs needing review')} color={a.po.variance > 0 ? 'red' : 'green'} icon={<GitCompareArrows size={18} />} />
        <StatCard label={t('Purchase Returns')} value={money(a.purch.returns)} color="orange" icon={<ShoppingCart size={18} />} />
        <StatCard label={t('Awaiting Bill')} value={String(a.po.awaitingBill)} sub={t('units received, not billed')} color="purple" icon={<PackageCheck size={18} />} />
      </div>

      {/* Trend */}
      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Sales vs Purchases — Last 12 Months')}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={a.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-gray-100 dark:stroke-surface-700" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(m) => m.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 30px -10px rgb(15 23 42 / .25)' }} />
            <Legend />
            <Bar dataKey="sales" name={t('Sales')} fill="#16a34a" radius={[4, 4, 0, 0]} />
            <Bar dataKey="purchases" name={t('Purchases')} fill="#ea580c" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Top lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-2">
        <TopList title={t('Top Customers')} icon={<Trophy size={16} className="text-brand-500" />} rows={a.sales.topCustomers} sym={sym} />
        <TopList title={t('Top Suppliers')} icon={<Trophy size={16} className="text-orange-500" />} rows={a.purch.topSuppliers} sym={sym} />
        <TopList title={t('Top Products by Revenue')} icon={<Trophy size={16} className="text-success-500" />} rows={a.sales.topProducts} sym={sym} valueKey="revenue" />
      </div>
    </div>
  )
}
