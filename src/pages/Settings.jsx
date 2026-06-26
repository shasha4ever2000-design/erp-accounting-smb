import { useState } from 'react'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Input, Select } from '../components/UI'
import { Save, AlertTriangle, Sparkles, Eye, EyeOff } from 'lucide-react'

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
  const { settings, updateCompany, updateTax, updateInvoiceSettings, updateAiSettings } = useStore()

  const [company, setCompany] = useState({ ...settings.company })
  const [tax, setTax] = useState({ ...settings.tax })
  const [invoice, setInvoice] = useState({ ...settings.invoice })
  const [ai, setAi] = useState({ apiKey: settings.ai?.apiKey || '', model: settings.ai?.model || 'claude-haiku-4-5-20251001' })
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const setCompanyField = (k, v) => setCompany((c) => ({ ...c, [k]: v }))
  const setTaxField = (k, v) => setTax((t) => ({ ...t, [k]: v }))
  const setInvoiceField = (k, v) => setInvoice((i) => ({ ...i, [k]: v }))
  const setAiField = (k, v) => setAi((a) => ({ ...a, [k]: v }))

  const handleSave = () => {
    const curr = CURRENCIES.find((c) => c.code === company.currency)
    updateCompany({ ...company, currencySymbol: curr?.symbol || company.currencySymbol })
    updateTax(tax)
    updateInvoiceSettings(invoice)
    updateAiSettings(ai)
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

        {/* AI Assistant */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800">AI Assistant</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Claude API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={ai.apiKey}
                  onChange={(e) => setAiField('apiKey', e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent font-mono"
                />
                <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Your key is stored locally in the browser only. Get a key at console.anthropic.com.</p>
            </div>
            <Select label="Model" value={ai.model} onChange={(e) => setAiField('model', e.target.value)}>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 – Fast &amp; Economical (Recommended)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 – Balanced</option>
              <option value="claude-opus-4-8">Claude Opus 4.8 – Most Capable</option>
            </Select>
            <div className="bg-violet-50 rounded-lg p-3 text-xs text-violet-700 space-y-1">
              <p className="font-medium">What the AI assistant can do:</p>
              <p>• Answer questions about your live financial data (AR, AP, balances, invoices)</p>
              <p>• Explain accounting concepts and double-entry bookkeeping</p>
              <p>• Guide you through ERP modules and workflows</p>
              <p>• Help with VAT calculations, payroll deductions, and more</p>
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
