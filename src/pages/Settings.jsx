import { useState, useRef } from 'react'
import { useStore } from '../store'
import { PageHeader, Card, Btn, Input, Select } from '../components/UI'
import { Save, AlertTriangle, Sparkles, Eye, EyeOff, Download, Upload, Database } from 'lucide-react'

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
  const { settings, updateCompany, updateTax, updateInvoiceSettings, updateAiSettings, updateZatca, exportData, importData } = useStore()

  const [company, setCompany] = useState({ ...settings.company })
  const [tax, setTax] = useState({ ...settings.tax })
  const [invoice, setInvoice] = useState({ ...settings.invoice })
  const [ai, setAi] = useState({ apiKey: settings.ai?.apiKey || '', model: settings.ai?.model || 'claude-haiku-4-5-20251001' })
  const [zatca, setZatca] = useState({ enabled: false, vatNumber: '', crNumber: '', showQr: true, ...(settings.zatca || {}) })
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef(null)
  const logoRef = useRef(null)

  const handleLogo = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) return alert('Please use a logo under 500 KB.')
    const reader = new FileReader()
    reader.onload = (ev) => setCompany((c) => ({ ...c, logo: ev.target.result }))
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const storageKB = (() => {
    try {
      const v = localStorage.getItem('erp-v1') || ''
      return Math.round(v.length / 1024)
    } catch { return 0 }
  })()
  const storagePct = Math.min(100, Math.round((storageKB / 5120) * 100))

  const setZatcaField = (k, v) => setZatca((z) => ({ ...z, [k]: v }))

  const applySaudiPreset = () => {
    setCompany((c) => ({ ...c, currency: 'SAR', currencySymbol: 'SAR' }))
    setTax((t) => ({ ...t, enabled: true, name: 'VAT', rate: 15 }))
    setZatca((z) => ({ ...z, enabled: true, showQr: true }))
  }

  const handleExport = () => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `erp-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!confirm('Restoring will REPLACE all current data with the backup. Continue?')) return
        importData(data)
        alert('Backup restored successfully! The page will reload.')
        window.location.reload()
      } catch (err) {
        alert('Could not read this backup file: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

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
    updateZatca(zatca)
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
            <Input label="Company Name (Arabic) · الاسم بالعربية" value={company.arabicName || ''} onChange={(e) => setCompanyField('arabicName', e.target.value)} dir="rtl" placeholder="اسم الشركة" />
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

        {/* Invoice Branding */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">Invoice Branding</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Logo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-slate-700/50">
                  {company.logo ? <img src={company.logo} alt="logo" className="max-w-full max-h-full object-contain" /> : <span className="text-xs text-gray-400">No logo</span>}
                </div>
                <div className="space-y-2">
                  <Btn size="sm" variant="secondary" onClick={() => logoRef.current?.click()}>Upload Logo</Btn>
                  {company.logo && <Btn size="sm" variant="ghost" onClick={() => setCompanyField('logo', '')}>Remove</Btn>}
                  <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogo} className="hidden" />
                  <p className="text-xs text-gray-400 dark:text-slate-500">PNG/JPG/SVG, under 500 KB. Appears on invoices &amp; delivery notes.</p>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Accent Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={company.accentColor || '#2563eb'} onChange={(e) => setCompanyField('accentColor', e.target.value)} className="w-12 h-9 rounded border border-gray-200 dark:border-slate-600 cursor-pointer" />
                <span className="text-sm text-gray-500 dark:text-slate-400 font-mono">{company.accentColor || '#2563eb'}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Saudi Arabia · ZATCA E-Invoicing */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center text-white text-xs font-bold">KSA</div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">Saudi Arabia · ZATCA E-Invoicing</h2>
            </div>
            <Btn size="sm" variant="secondary" onClick={applySaudiPreset}>Apply Saudi preset</Btn>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            Generate ZATCA (Fatoorah) compliant simplified tax invoices with a scannable QR code, bilingual Arabic/English layout, and 15% VAT.
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="zatcaEnabled" checked={zatca.enabled} onChange={(e) => setZatcaField('enabled', e.target.checked)} className="w-4 h-4 rounded text-green-600 focus:ring-green-500" />
              <label htmlFor="zatcaEnabled" className="text-sm font-medium text-gray-700 dark:text-slate-300">Enable ZATCA e-invoicing</label>
            </div>
            {zatca.enabled && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="VAT Registration Number" value={zatca.vatNumber} onChange={(e) => setZatcaField('vatNumber', e.target.value)} placeholder="3xxxxxxxxxxxxx3" />
                  <Input label="Commercial Registration (CR)" value={zatca.crNumber} onChange={(e) => setZatcaField('crNumber', e.target.value)} placeholder="10xxxxxxxx" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="zatcaQr" checked={zatca.showQr} onChange={(e) => setZatcaField('showQr', e.target.checked)} className="w-4 h-4 rounded text-green-600 focus:ring-green-500" />
                  <label htmlFor="zatcaQr" className="text-sm font-medium text-gray-700 dark:text-slate-300">Show ZATCA QR code on invoices</label>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-xs text-green-700 dark:text-green-300 space-y-1">
                  <p className="font-medium">The QR code encodes (per ZATCA Phase 1):</p>
                  <p>• Seller name &amp; VAT number · Invoice timestamp · Total with VAT · VAT amount</p>
                  <p>Set currency to SAR and VAT to 15% using “Apply Saudi preset”, then Save.</p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Backup & Restore */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Database size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">Backup &amp; Restore</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            Your data lives in this browser. Download a backup regularly so you never lose it — and restore it on any device or browser.
          </p>
          <div className="flex flex-wrap gap-3">
            <Btn variant="success" onClick={handleExport}><Download size={15} /> Download Backup</Btn>
            <Btn variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Restore from File</Btn>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImportFile} className="hidden" />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">Backup files contain all invoices, transactions, customers, settings and more in one portable file.</p>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
            <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400 mb-1">
              <span>Browser storage used</span>
              <span>~{storageKB} KB of ~5,120 KB</span>
            </div>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
              <div className={`h-full ${storagePct > 85 ? 'bg-red-500' : storagePct > 60 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${storagePct}%` }} />
            </div>
            {storagePct > 85 && <p className="text-xs text-red-500 mt-1">Storage is nearly full — download a backup and consider removing your logo or old data.</p>}
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
