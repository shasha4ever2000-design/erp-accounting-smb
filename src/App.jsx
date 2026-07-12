import { useEffect, useState, lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import { useAuth } from './auth'
import { useT } from './i18n'
import { CalendarClock, X } from 'lucide-react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard' // eager: default landing route

// Every other page is code-split into its own chunk and loaded on demand,
// so the initial bundle only carries the dashboard + shared runtime.
const ChartOfAccounts = lazy(() => import('./pages/ChartOfAccounts'))
const Customers = lazy(() => import('./pages/Customers'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Invoices = lazy(() => import('./pages/Invoices'))
const InvoiceForm = lazy(() => import('./pages/InvoiceForm'))
const InvoiceView = lazy(() => import('./pages/InvoiceView'))
const Quotations = lazy(() => import('./pages/Quotations'))
const QuotationForm = lazy(() => import('./pages/QuotationForm'))
const CreditNotes = lazy(() => import('./pages/CreditNotes'))
const Purchases = lazy(() => import('./pages/Purchases'))
const PurchaseForm = lazy(() => import('./pages/PurchaseForm'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'))
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'))
const DebitNotes = lazy(() => import('./pages/DebitNotes'))
const BankAccounts = lazy(() => import('./pages/BankAccounts'))
const Banking = lazy(() => import('./pages/Banking'))
const CashFlow = lazy(() => import('./pages/CashFlow'))
const Inventory = lazy(() => import('./pages/Inventory'))
const InventoryControl = lazy(() => import('./pages/InventoryControl'))
const StockAdjustments = lazy(() => import('./pages/StockAdjustments'))
const PrepaidExpenses = lazy(() => import('./pages/PrepaidExpenses'))
const Leases = lazy(() => import('./pages/Leases'))
const ExpenseClaims = lazy(() => import('./pages/ExpenseClaims'))
const Manufacturing = lazy(() => import('./pages/Manufacturing'))
const FixedAssets = lazy(() => import('./pages/FixedAssets'))
const FixedAssetForm = lazy(() => import('./pages/FixedAssetForm'))
const Departments = lazy(() => import('./pages/Departments'))
const Employees = lazy(() => import('./pages/Employees'))
const Payroll = lazy(() => import('./pages/Payroll'))
const JournalEntries = lazy(() => import('./pages/JournalEntries'))
const RecurringJournals = lazy(() => import('./pages/RecurringJournals'))
const PaymentReminders = lazy(() => import('./pages/PaymentReminders'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Projects = lazy(() => import('./pages/Projects'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Warehouses = lazy(() => import('./pages/Warehouses'))
const RecurringInvoices = lazy(() => import('./pages/RecurringInvoices'))
const Statements = lazy(() => import('./pages/Statements'))
const Pipeline = lazy(() => import('./pages/Pipeline'))
const POS = lazy(() => import('./pages/POS'))
const Reconciliation = lazy(() => import('./pages/Reconciliation'))
const DeliveryNotes = lazy(() => import('./pages/DeliveryNotes'))
const Currencies = lazy(() => import('./pages/Currencies'))
const Revaluation = lazy(() => import('./pages/Revaluation'))
const Analytics = lazy(() => import('./pages/Analytics'))
const TradeAnalytics = lazy(() => import('./pages/TradeAnalytics'))
const Commissions = lazy(() => import('./pages/Commissions'))
const LandedCosts = lazy(() => import('./pages/LandedCosts'))
const FinancialHealth = lazy(() => import('./pages/FinancialHealth'))
const Consolidation = lazy(() => import('./pages/Consolidation'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const Requisitions = lazy(() => import('./pages/Requisitions'))
const Team = lazy(() => import('./pages/Team'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24 text-gray-400 dark:text-slate-500">
      <div className="h-8 w-8 rounded-full border-2 border-gray-200 dark:border-slate-600 border-t-blue-500 animate-spin" />
    </div>
  )
}

export default function App() {
  const theme = useStore((s) => s.settings.theme || 'light')
  const companyName = useStore((s) => s.settings.company.name)
  const updateCompany = useStore((s) => s.updateCompany)
  const t = useT()
  const [schedulerResult, setSchedulerResult] = useState(null)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

  // Boot-time scheduler: catch up any due recurring invoices/journals once the
  // company's data has hydrated (App only mounts post-hydration). Runs at most
  // once per day; surfaces a dismissible toast when it actually posts something.
  useEffect(() => {
    const res = useStore.getState().runScheduler()
    if (res?.ran) {
      setSchedulerResult(res)
      const timer = setTimeout(() => setSchedulerResult(null), 8000)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Daily auto-snapshot: one browser-local restore point per day.
  useEffect(() => {
    useStore.getState().runBackupScheduler()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A freshly created company inherits its name from the company picker label
  useEffect(() => {
    const auth = useAuth.getState()
    const comp = auth.companies.find((c) => c.id === auth.currentCompanyId)
    if (comp && comp.name && (!companyName || companyName === 'My Company') && comp.name !== companyName) {
      updateCompany({ name: comp.name })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Force light mode while printing so PDFs/invoices are clean, then restore
  useEffect(() => {
    const before = () => document.documentElement.classList.remove('dark')
    const after = () => {
      if ((useStore.getState().settings.theme || 'light') === 'dark') document.documentElement.classList.add('dark')
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<ChartOfAccounts />} />

        {/* Cash & Banking */}
        <Route path="/bank-accounts" element={<BankAccounts />} />
        <Route path="/cash-flow" element={<CashFlow />} />
        <Route path="/banking" element={<Banking />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/journals" element={<JournalEntries />} />
        <Route path="/recurring-journals" element={<RecurringJournals />} />

        {/* Sales */}
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/quotations" element={<Quotations />} />
        <Route path="/quotations/new" element={<QuotationForm />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/new" element={<InvoiceForm />} />
        <Route path="/invoices/:id" element={<InvoiceView />} />
        <Route path="/recurring-invoices" element={<RecurringInvoices />} />
        <Route path="/commissions" element={<Commissions />} />
        <Route path="/payment-reminders" element={<PaymentReminders />} />
        <Route path="/delivery-notes" element={<DeliveryNotes />} />
        <Route path="/credit-notes" element={<CreditNotes />} />

        {/* Purchases */}
        <Route path="/requisitions" element={<Requisitions />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/purchases/new" element={<PurchaseForm />} />
        <Route path="/debit-notes" element={<DebitNotes />} />
        <Route path="/landed-costs" element={<LandedCosts />} />

        {/* Inventory */}
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory-control" element={<InventoryControl />} />
        <Route path="/warehouses" element={<Warehouses />} />
        <Route path="/stock-adjustments" element={<StockAdjustments />} />
        <Route path="/manufacturing" element={<Manufacturing />} />

        {/* Financials */}
        <Route path="/prepaid-expenses" element={<PrepaidExpenses />} />
        <Route path="/leases" element={<Leases />} />
        <Route path="/expense-claims" element={<ExpenseClaims />} />
        <Route path="/budgets" element={<Budgets />} />

        {/* Projects */}
        <Route path="/projects" element={<Projects />} />

        {/* Fixed Assets */}
        <Route path="/fixed-assets" element={<FixedAssets />} />
        <Route path="/fixed-assets/new" element={<FixedAssetForm />} />

        {/* HR & Payroll */}
        <Route path="/departments" element={<Departments />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/payroll" element={<Payroll />} />

        {/* Reports & System */}
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/trade-analytics" element={<TradeAnalytics />} />
        <Route path="/financial-health" element={<FinancialHealth />} />
        <Route path="/consolidation" element={<Consolidation />} />
        <Route path="/currencies" element={<Currencies />} />
        <Route path="/revaluation" element={<Revaluation />} />
        <Route path="/statements" element={<Statements />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/team" element={<Team />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      </Suspense>

      {schedulerResult?.ran && (
        <div className="fixed bottom-6 end-6 z-50 max-w-sm animate-slide-up">
          <div className="flex items-start gap-3 rounded-xl bg-gradient-to-b from-success-500 to-success-600 text-white shadow-elevated ring-1 ring-black/5 ps-4 pe-3 py-3">
            <CalendarClock size={18} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm leading-snug">
              <p className="font-semibold">{t('Scheduled entries posted')}</p>
              <p className="text-white/85">
                {[
                  schedulerResult.invoices > 0 && `${schedulerResult.invoices} ${t('recurring invoice(s)')}`,
                  schedulerResult.journals > 0 && `${schedulerResult.journals} ${t('recurring journal(s)')}`,
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={() => setSchedulerResult(null)} className="ms-1 -me-1 p-1 rounded-lg hover:bg-white/15 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60" aria-label={t('Dismiss')}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
