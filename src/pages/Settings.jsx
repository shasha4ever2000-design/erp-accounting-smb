import { useState } from 'react'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Input, Select } from '../components/UI'
import { Save, AlertTriangle } from 'lucide-react'

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyal' },
  { code: 'EGP', symbol: 'EGP', name: 'Egyptian Pound' },
  { code: 'JOD', symbol: 'JD', name: 'Jordanian Dinar' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
]

export default function Settings() {
  const { settings, updateCompany, updateTax, updateInvoiceSettings } = useStore()

  const [company, setCompany] = useState({ ...settings.company })
  const [tax, setTax] = useState({ ...settings.tax })
  const [invoice, setInvoice] = useState({ ...settings.invoice })
  const [saved, setSaved] = useState(false)

  const setCompanyField = (k, v) => setCompany((c) => ({ ...c, [k]: v }))
  const setTaxField = (k, v) => setTax((t) => ({ ...t, [k]: v }))
  const setInvoiceField = (k, v) => setInvoice((i) => ({ ...i, [k]: v }))

  const handleSave = () => {
    const curr = CURRENCIES.find((c) => c.code === company.currency)
    updateCompany({ ...company, currencySymbol: curr?.symbol || company.currencySymbol })
    updateTax(tax)
    updateInvoiceSettings(invoice)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => {
    if (confirm('This will permanently erase ALL data (invoices, customers, transactions, etc.). Are you absolutely sure?')) {
      localStorage.removeItem('erp-v1')
      window.location.reload()
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure your company and accounting preferences"
        action={
          <Btn onClick={handleSave}>
            <Save size={15} /> {saved ? 'Saved!' : 'Save Settings'}
          </Btn>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Info */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Company Information</h2>
          <div className="space-y-4">
            <Input label="Company Name *" value={company.name} onChange={(e) => setCompanyField('name', e.target.value)} />
            <Input label="Email" type="email" value={company.email} onChange={(e) => setCompanyField('email', e.target.value)} />
            <Input label="Phone" value={company.phone} onChange={(e) => setCompanyField('phone', e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                value={company.address}
                onChange={(e) => setCompanyField('address', e.target.value)}
                placeholder="Street, City, Country"
              />
            </div>
            <Input label="Tax Registration Number" value={company.taxId} onChange={(e) => setCompanyField('taxId', e.target.value)} placeholder="e.g. VAT / GST number" />
          </div>
        </Card>

        {/* Currency & Fiscal Year */}
        <div className="space-y-5">
          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Currency & Fiscal Year</h2>
            <div className="space-y-4">
              <Select label="Currency" value={company.currency} onChange={(e) => setCompanyField('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} – {c.name} ({c.symbol})</option>
                ))}
              </Select>
              <Select label="Fiscal Year Start Month" value={company.fiscalYearStart} onChange={(e) => setCompanyField('fiscalYearStart', e.target.value)}>
                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m, i) => {
                  const labels = ['January','February','March','April','May','June','July','August','September','October','November','December']
                  return <option key={m} value={m}>{labels[i]}</option>
                })}
              </Select>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Tax Settings</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="taxEnabled"
                  checked={tax.enabled}
                  onChange={(e) => setTaxField('enabled', e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="taxEnabled" className="text-sm font-medium text-gray-700">Enable Tax (VAT / GST)</label>
              </div>
              {tax.enabled && (
                <>
                  <Input label="Tax Name" value={tax.name} onChange={(e) => setTaxField('name', e.target.value)} placeholder="VAT, GST, Sales Tax..." />
                  <Input label="Default Tax Rate (%)" type="number" min="0" max="100" step="0.1" value={tax.rate} onChange={(e) => setTaxField('rate', parseFloat(e.target.value) || 0)} />
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Invoice Settings */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Invoice Settings</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Invoice Prefix" value={invoice.prefix} onChange={(e) => setInvoiceField('prefix', e.target.value)} placeholder="INV-" />
              <Input label="Next Invoice Number" type="number" min="1" value={invoice.next} onChange={(e) => setInvoiceField('next', parseInt(e.target.value) || 1)} />
            </div>
            <Input label="Default Payment Terms (days)" type="number" min="0" value={invoice.dueDays} onChange={(e) => setInvoiceField('dueDays', parseInt(e.target.value) || 30)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Invoice Notes</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                value={invoice.notes}
                onChange={(e) => setInvoiceField('notes', e.target.value)}
                placeholder="e.g. Thank you for your business! Payment due within 30 days."
              />
            </div>
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className="p-6 border-red-100">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
              <p className="text-sm text-gray-500 mt-1">These actions are irreversible. Please proceed with caution.</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-800">Reset All Data</p>
                <p className="text-xs text-gray-500">Erase all invoices, transactions, customers, and settings. Keeps the app.</p>
              </div>
              <Btn variant="danger" size="sm" onClick={handleReset}>Reset Data</Btn>
            </div>
          </div>
        </Card>
      </div>

      {saved && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 animate-bounce">
          <Save size={15} /> Settings saved!
        </div>
      )}
    </div>
  )
}
