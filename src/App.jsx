import { Routes, Route } from 'react-router-dom'
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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<ChartOfAccounts />} />

        {/* Cash & Banking */}
        <Route path="/bank-accounts" element={<BankAccounts />} />
        <Route path="/banking" element={<Banking />} />
        <Route path="/journals" element={<JournalEntries />} />

        {/* Sales */}
        <Route path="/customers" element={<Customers />} />
        <Route path="/quotations" element={<Quotations />} />
        <Route path="/quotations/new" element={<QuotationForm />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/new" element={<InvoiceForm />} />
        <Route path="/invoices/:id" element={<InvoiceView />} />
        <Route path="/credit-notes" element={<CreditNotes />} />

        {/* Purchases */}
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/purchases/new" element={<PurchaseForm />} />
        <Route path="/debit-notes" element={<DebitNotes />} />

        {/* Inventory */}
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/stock-adjustments" element={<StockAdjustments />} />
        <Route path="/manufacturing" element={<Manufacturing />} />

        {/* Financials */}
        <Route path="/prepaid-expenses" element={<PrepaidExpenses />} />
        <Route path="/leases" element={<Leases />} />
        <Route path="/expense-claims" element={<ExpenseClaims />} />

        {/* Fixed Assets */}
        <Route path="/fixed-assets" element={<FixedAssets />} />
        <Route path="/fixed-assets/new" element={<FixedAssetForm />} />

        {/* HR & Payroll */}
        <Route path="/departments" element={<Departments />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/payroll" element={<Payroll />} />

        {/* Reports & System */}
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}
