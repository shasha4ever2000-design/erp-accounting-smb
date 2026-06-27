import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useStore } from './store'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ChartOfAccounts from './pages/ChartOfAccounts'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Invoices from './pages/Invoices'
import InvoiceForm from './pages/InvoiceForm'
import InvoiceView from './pages/InvoiceView'
import Quotations from './pages/Quotations'
import QuotationForm from './pages/QuotationForm'
import CreditNotes from './pages/CreditNotes'
import Purchases from './pages/Purchases'
import PurchaseForm from './pages/PurchaseForm'
import PurchaseOrders from './pages/PurchaseOrders'
import PurchaseOrderForm from './pages/PurchaseOrderForm'
import DebitNotes from './pages/DebitNotes'
import BankAccounts from './pages/BankAccounts'
import Banking from './pages/Banking'
import Inventory from './pages/Inventory'
import StockAdjustments from './pages/StockAdjustments'
import PrepaidExpenses from './pages/PrepaidExpenses'
import Leases from './pages/Leases'
import ExpenseClaims from './pages/ExpenseClaims'
import Manufacturing from './pages/Manufacturing'
import FixedAssets from './pages/FixedAssets'
import FixedAssetForm from './pages/FixedAssetForm'
import Departments from './pages/Departments'
import Employees from './pages/Employees'
import Payroll from './pages/Payroll'
import JournalEntries from './pages/JournalEntries'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Projects from './pages/Projects'
import Budgets from './pages/Budgets'
import Warehouses from './pages/Warehouses'
import RecurringInvoices from './pages/RecurringInvoices'
import Statements from './pages/Statements'
import Pipeline from './pages/Pipeline'
import POS from './pages/POS'
import Reconciliation from './pages/Reconciliation'
import DeliveryNotes from './pages/DeliveryNotes'
import Currencies from './pages/Currencies'
import Analytics from './pages/Analytics'
import AuditLog from './pages/AuditLog'
import Requisitions from './pages/Requisitions'
import Team from './pages/Team'

export default function App() {
  const theme = useStore((s) => s.settings.theme || 'light')
  const companyName = useStore((s) => s.settings.company.name)
  const updateCompany = useStore((s) => s.updateCompany)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

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
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<ChartOfAccounts />} />

        {/* Cash & Banking */}
        <Route path="/bank-accounts" element={<BankAccounts />} />
        <Route path="/banking" element={<Banking />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/journals" element={<JournalEntries />} />

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

        {/* Inventory */}
        <Route path="/inventory" element={<Inventory />} />
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
        <Route path="/currencies" element={<Currencies />} />
        <Route path="/statements" element={<Statements />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/team" element={<Team />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
