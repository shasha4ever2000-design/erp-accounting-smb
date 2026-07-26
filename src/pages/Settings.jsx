import { useState, useRef, useEffect, useCallback } from 'react'
import BrandingPanel from '../components/BrandingPanel'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { PageHeader, Card, Btn, Input, Select } from '../components/UI'
import { useT, useI18n } from '../i18n'
import { Save, AlertTriangle, Sparkles, Eye, EyeOff, Download, Upload, Database, Lock, Unlock, CalendarClock, Shield, ShieldCheck, Clock, Trash2, RotateCcw, KeyRound } from 'lucide-react'
import { encryptBackup, decryptBackup, parseBackupText } from '../utils/backup'
import { TAX_REGIONS, findTaxRegion } from '../utils/taxRegions'
import { APPROVAL_KINDS, defaultApprovalSettings } from '../utils/approvals'
import CloudSyncCard from '../components/CloudSyncCard'
import IntegrityCheckCard from '../components/IntegrityCheckCard'
import CustomFieldsManager from '../components/CustomFieldsManager'
import HrSettingsCard from '../components/HrSettingsCard'

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
  const { settings, updateCompany, updateTax, updateInvoiceSettings, updateAiSettings, updateZatca, updateWht, setPeriodLock, setAutoPostRecurring, updateApprovals, exportData, importData, snapshotNow, listSnapshots, restoreSnapshot, deleteSnapshot } = useStore()
  const t = useT()
  const numerals = useI18n((s) => s.numerals)
  const setNumerals = useI18n((s) => s.setNumerals)

  const [company, setCompany] = useState({ ...settings.company })
  const [tax, setTax] = useState({ ...settings.tax })
  const [invoice, setInvoice] = useState({ ...settings.invoice })
  const [ai, setAi] = useState({ apiKey: settings.ai?.apiKey || '', model: settings.ai?.model || 'claude-haiku-4-5-20251001' })
  const [zatca, setZatca] = useState({ enabled: false, vatNumber: '', crNumber: '', showQr: true, ...(settings.zatca || {}) })
  const [wht, setWht] = useState({ enabled: false, rate: 5, name: 'Withholding Tax', ...(settings.wht || {}) })
  const setWhtField = (k, v) => setWht((w) => ({ ...w, [k]: v }))
  // Custom fields save through the store as they are edited — see
  // CustomFieldsManager — so there is no local copy to reconcile here.
  const [showKey, setShowKey] = useState(false)
  const [lockInput, setLockInput] = useState(settings.accounting?.lockDate || '')
  const approvals = { ...defaultApprovalSettings(), ...(settings.approvals || {}) }
  const [saved, setSaved] = useState(false)
  const fileRef = useRef(null)

  const isManager = useAuth((s) => s.isManager())

  // Data now lives in IndexedDB (no ~5 MB cap). Report real usage/quota when the
  // Storage API is available; otherwise fall back to a localStorage estimate.
  const [storage, setStorage] = useState({ usedKB: 0, quotaKB: 0 })
  useEffect(() => {
    let alive = true
    if (navigator?.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        if (alive) setStorage({ usedKB: Math.round((est.usage || 0) / 1024), quotaKB: Math.round((est.quota || 0) / 1024) })
      }).catch(() => {})
    } else {
      let total = 0
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); total += (localStorage.getItem(k) || '').length } } catch { /* ignore */ }
      setStorage({ usedKB: Math.round(total / 1024), quotaKB: 5120 })
    }
    return () => { alive = false }
  }, [])
  const storageKB = storage.usedKB
  const quotaKB = storage.quotaKB || 5120
  const storagePct = Math.min(100, Math.round((storageKB / quotaKB) * 100))

  const setZatcaField = (k, v) => setZatca((z) => ({ ...z, [k]: v }))

  // Applying a region preset fills tax name/rate/system and, only for Saudi
  // Arabia, offers to switch on ZATCA e-invoicing — it never turns ZATCA on
  // for any other region.
  const applyTaxRegion = (id) => {
    const r = findTaxRegion(id)
    if (!r) return
    setTax((t) => ({ ...t, enabled: r.system !== 'none', name: r.taxName, rate: r.rate, system: r.system, country: r.id }))
    if (r.currency) setCompany((c) => ({ ...c, currency: r.currency, currencySymbol: CURRENCIES.find((cu) => cu.code === r.currency)?.symbol || r.currency }))
    if (r.zatca) setZatca((z) => ({ ...z, enabled: true, showQr: true }))
    else if (tax.country && tax.country !== id) setZatca((z) => ({ ...z, enabled: false }))
  }

  const [encryptExport, setEncryptExport] = useState(false)
  const [exportPass, setExportPass] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [importModal, setImportModal] = useState(null) // { envelope } when encrypted file needs passphrase
  const [importPass, setImportPass] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importErr, setImportErr] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [snapBusy, setSnapBusy] = useState(false)

  const loadSnapshots = useCallback(async () => { setSnapshots(await listSnapshots()) }, [listSnapshots])
  useEffect(() => { if (snapshotsOpen) loadSnapshots() }, [snapshotsOpen, loadSnapshots])

  const handleExport = async () => {
    const data = exportData()
    setExportBusy(true)
    try {
      let payload, filename
      if (encryptExport && exportPass) {
        payload = await encryptBackup(data, exportPass)
        filename = `erp-backup-${new Date().toISOString().slice(0, 10)}-encrypted.json`
      } else {
        payload = data
        filename = `erp-backup-${new Date().toISOString().slice(0, 10)}.json`
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setExportPass('')
    } catch (err) {
      alert(t('Export failed') + ': ' + err.message)
    } finally {
      setExportBusy(false)
    }
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseBackupText(ev.target.result)
        if (parsed.encrypted) {
          setImportModal({ envelope: parsed.envelope })
          setImportPass('')
          setImportErr('')
        } else {
          if (!confirm(t('Restoring will REPLACE all current data with the backup. Continue?'))) return
          importData(parsed.data)
          alert(t('Backup restored successfully! The page will reload.'))
          window.location.reload()
        }
      } catch (err) {
        alert(t('Could not read this backup file') + ': ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleDecryptImport = async () => {
    if (!importModal || !importPass) return
    setImportBusy(true)
    setImportErr('')
    try {
      const data = await decryptBackup(importModal.envelope, importPass)
      if (!confirm(t('Restoring will REPLACE all current data with the backup. Continue?'))) { setImportBusy(false); return }
      importData(data)
      setImportModal(null)
      alert(t('Backup restored successfully! The page will reload.'))
      window.location.reload()
    } catch (err) {
      setImportErr(err.message === 'WRONG_PASSWORD' ? t('Wrong passphrase — please try again.') : err.message)
    } finally {
      setImportBusy(false)
    }
  }

  const handleSnapshot = async () => {
    setSnapBusy(true)
    try { await snapshotNow('Manual'); await loadSnapshots() } finally { setSnapBusy(false) }
  }

  const handleRestoreSnap = async (id) => {
    if (!confirm(t('Restoring will REPLACE all current data with this snapshot. Continue?'))) return
    await restoreSnapshot(id)
  }

  const handleDeleteSnap = async (id) => {
    if (!confirm(t('Delete this snapshot?'))) return
    await deleteSnapshot(id)
    await loadSnapshots()
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
    updateWht(wht)
    // keep the company-picker label in sync with the company name
    try {
      const auth = useAuth.getState()
      if (auth.currentCompanyId && company.name) auth.renameCompany(auth.currentCompanyId, company.name)
    } catch { /* ignore */ }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => {
    if (confirm(t('This will permanently erase ALL data (invoices, customers, transactions, etc.). Are you absolutely sure?'))) {
      useStore.getState().resetAllData()
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
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Company Information')}</h2>
          <div className="space-y-4">
            <Input label="Company Name *" value={company.name} onChange={(e) => setCompanyField('name', e.target.value)} />
            <Input label="Company Name (Arabic) · الاسم بالعربية" value={company.arabicName || ''} onChange={(e) => setCompanyField('arabicName', e.target.value)} dir="rtl" placeholder="اسم الشركة" />
            <Input label="Email" type="email" value={company.email} onChange={(e) => setCompanyField('email', e.target.value)} />
            <Input label="Phone" value={company.phone} onChange={(e) => setCompanyField('phone', e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Address')}</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all duration-150 resize-none"
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
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Currency & Fiscal Year')}</h2>
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
              <Select label="Number Format" value={numerals} onChange={(e) => setNumerals(e.target.value)}>
                <option value="latin">{t('Western digits (0 1 2 3)')}</option>
                <option value="arabic">{t('Arabic-Indic digits (٠ ١ ٢ ٣)')}</option>
              </Select>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Tax Settings')}</h2>
            <div className="space-y-4">
              <div>
                <Select label={t('Tax region')} value={tax.country || 'XX'} onChange={(e) => applyTaxRegion(e.target.value)}>
                  {TAX_REGIONS.map((r) => <option key={r.id} value={r.id}>{r.country}{r.system === 'vat' ? ` — ${r.taxName} ${r.rate}%` : r.system === 'sales_tax' ? ` — ${r.taxName}` : ''}</option>)}
                </Select>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('Fills in the tax name, rate and currency below — every field stays editable after.')}</p>
                {findTaxRegion(tax.country)?.note && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-1.5">{t(findTaxRegion(tax.country).note)}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="taxEnabled"
                  checked={tax.enabled}
                  onChange={(e) => setTaxField('enabled', e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                />
                <label htmlFor="taxEnabled" className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('Enable Tax (VAT / GST / Sales Tax)')}</label>
              </div>
              {tax.enabled && (
                <>
                  <Input label={t('Tax Name')} value={tax.name} onChange={(e) => setTaxField('name', e.target.value)} placeholder="VAT, GST, Sales Tax..." />
                  <Input label={t('Default Tax Rate (%)')} type="number" min="0" max="100" step="0.1" value={tax.rate} onChange={(e) => setTaxField('rate', parseFloat(e.target.value) || 0)} />
                  <Select label={t('Tax system')} value={tax.system || 'vat'} onChange={(e) => setTaxField('system', e.target.value)}>
                    <option value="vat">{t('VAT / GST — input tax recoverable')}</option>
                    <option value="sales_tax">{t('Sales tax — collected on final sale only')}</option>
                  </Select>
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    {tax.system === 'sales_tax'
                      ? t('Reports show a Sales Tax Report: tax collected on sales, due to remit. No input-tax recovery on purchases.')
                      : t('Reports show a VAT/GST Return with recoverable input tax on purchases, matching how most countries outside the US work.')}
                  </p>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Invoice Settings */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Invoice Settings')}</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Invoice Prefix" value={invoice.prefix} onChange={(e) => setInvoiceField('prefix', e.target.value)} placeholder="INV-" />
              <Input label="Next Invoice Number" type="number" min="1" value={invoice.next} onChange={(e) => setInvoiceField('next', parseInt(e.target.value) || 1)} />
            </div>
            <Input label="Default Payment Terms (days)" type="number" min="0" value={invoice.dueDays} onChange={(e) => setInvoiceField('dueDays', parseInt(e.target.value) || 30)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Default Invoice Notes')}</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all duration-150 resize-none"
                value={invoice.notes}
                onChange={(e) => setInvoiceField('notes', e.target.value)}
                placeholder="e.g. Thank you for your business! Payment due within 30 days."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Bank Details / Payment Instructions')}</label>
              <textarea
                rows={3}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all duration-150 resize-none"
                value={invoice.bankDetails || ''}
                onChange={(e) => setInvoiceField('bankDetails', e.target.value)}
                placeholder="Bank name, IBAN, account number, SWIFT… — shown at the bottom of every invoice."
              />
            </div>
          </div>
        </Card>

        {/* AI Assistant */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500 to-brand-600 flex items-center justify-center">
              <Sparkles size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('AI Assistant')}</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Claude API Key')}</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={ai.apiKey}
                  onChange={(e) => setAiField('apiKey', e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full border border-gray-300 dark:border-surface-600 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent font-mono"
                />
                <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Your key is stored locally in the browser only. Get a key at console.anthropic.com.</p>
            </div>
            <Select label="Model" value={ai.model} onChange={(e) => setAiField('model', e.target.value)}>
              <option value="claude-haiku-4-5-20251001">{t('Claude Haiku 4.5 – Fast & Economical (Recommended)')}</option>
              <option value="claude-sonnet-4-6">{t('Claude Sonnet 4.6 – Balanced')}</option>
              <option value="claude-opus-4-8">{t('Claude Opus 4.8 – Most Capable')}</option>
            </Select>
            <div className="bg-accent-50 dark:bg-accent-500/10 rounded-lg p-3 text-xs text-accent-700 dark:text-accent-300 space-y-1">
              <p className="font-medium">{t('What the AI assistant can do:')}</p>
              <p>• Answer questions about your live financial data (AR, AP, balances, invoices)</p>
              <p>{t('• Explain accounting concepts and double-entry bookkeeping')}</p>
              <p>{t('• Guide you through ERP modules and workflows')}</p>
              <p>{t('• Help with VAT calculations, payroll deductions, and more')}</p>
            </div>
          </div>
        </Card>

        {/* Invoice Branding */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-4">{t('Invoice Branding')}</h2>
          <div className="space-y-4">
            {/* Branding — logo, colour, layout and per-document wording.
                The logo is stored outside the settings object; see
                utils/brandAssets.js for why. */}
            <BrandingPanel />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Accent Color')}</label>
              <div className="flex items-center gap-3">
                <input type="color" value={company.accentColor || '#2563eb'} onChange={(e) => setCompanyField('accentColor', e.target.value)} className="w-12 h-9 rounded border border-gray-200 dark:border-slate-600 cursor-pointer" />
                <span className="text-sm text-gray-500 dark:text-slate-400 font-mono">{company.accentColor || '#2563eb'}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Saudi Arabia · ZATCA E-Invoicing — optional, only relevant to Saudi filers */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center text-white text-xs font-bold">KSA</div>
              <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Saudi Arabia · ZATCA E-Invoicing')}</h2>
            </div>
            <Btn size="sm" variant="secondary" onClick={() => applyTaxRegion('SA')}>{t('Apply Saudi preset')}</Btn>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            {t('Generate ZATCA (Fatoorah) compliant simplified tax invoices with a scannable QR code and a bilingual Arabic/English layout. Only relevant if you file VAT in Saudi Arabia — every other tax region above ignores this section.')}
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="zatcaEnabled" checked={zatca.enabled} onChange={(e) => setZatcaField('enabled', e.target.checked)} className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500" />
              <label htmlFor="zatcaEnabled" className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('Enable ZATCA e-invoicing')}</label>
            </div>
            {zatca.enabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="VAT Registration Number" value={zatca.vatNumber} onChange={(e) => setZatcaField('vatNumber', e.target.value)} placeholder="3xxxxxxxxxxxxx3" />
                  <Input label="Commercial Registration (CR)" value={zatca.crNumber} onChange={(e) => setZatcaField('crNumber', e.target.value)} placeholder="10xxxxxxxx" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="zatcaQr" checked={zatca.showQr} onChange={(e) => setZatcaField('showQr', e.target.checked)} className="w-4 h-4 rounded text-green-600 dark:text-green-400 focus:ring-green-500" />
                  <label htmlFor="zatcaQr" className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('Show ZATCA QR code on invoices')}</label>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-xs text-green-700 dark:text-green-300 space-y-1">
                  <p className="font-medium">{t('The QR code encodes (per ZATCA Phase 1):')}</p>
                  <p>{t('• Seller name & VAT number · Invoice timestamp · Total with VAT · VAT amount')}</p>
                  <p>{t('Use the "Apply Saudi preset" button above to set SAR, 15% VAT and this section together, then Save.')}</p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Withholding Tax */}
        <Card className="p-6">
          <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-1">{t('Withholding Tax (WHT)')}</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Deduct withholding tax on supplier payments (e.g. KSA WHT on payments to non-residents). The withheld amount is posted to a “Withholding Tax Payable” account to remit later.</p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input type="checkbox" id="whtEnabled" checked={wht.enabled} onChange={(e) => setWhtField('enabled', e.target.checked)} className="w-4 h-4 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500" />
              <label htmlFor="whtEnabled" className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('Enable withholding tax on payments')}</label>
            </div>
            {wht.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="WHT Name" value={wht.name} onChange={(e) => setWhtField('name', e.target.value)} placeholder="Withholding Tax" />
                <Input label="Default Rate (%)" type="number" min="0" max="100" step="0.5" value={wht.rate} onChange={(e) => setWhtField('rate', parseFloat(e.target.value) || 0)} />
              </div>
            )}
          </div>
        </Card>

        <CustomFieldsManager />

        <HrSettingsCard />

        {/* Backup & Restore */}
        {/* Period Close / Lock */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center">
              {settings.accounting?.lockDate ? <Lock size={14} className="text-white" /> : <Unlock size={14} className="text-white" />}
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Period Close / Lock')}</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            {t('Lock closed periods so no journal entry can be posted, edited or deleted on or before the lock date. Protects reported figures after a period is finalized.')}
          </p>
          {settings.accounting?.lockDate ? (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 mb-4 text-sm">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
                <Lock size={13} /> {t('Books are locked through')} {settings.accounting.lockDate}
              </div>
              {settings.accounting.lockedBy && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('Locked by')} {settings.accounting.lockedBy}</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">{t('No period is currently locked — all dates are open for posting.')}</p>
          )}
          {isManager ? (
            <div className="flex flex-wrap items-end gap-3">
              <Input label={t('Lock date (inclusive)')} type="date" value={lockInput} onChange={(e) => setLockInput(e.target.value)} className="w-48" />
              <Btn onClick={() => { if (!lockInput) return alert(t('Choose a lock date first.')); if (confirm(t('Lock all periods through {d}? Entries on or before this date will be read-only.').replace('{d}', lockInput))) { setPeriodLock({ lockDate: lockInput, lockedBy: useAuth.getState().currentUser()?.name || '' }); setSaved(true); setTimeout(() => setSaved(false), 1500) } }}>
                <Lock size={14} /> {t('Lock Period')}
              </Btn>
              {settings.accounting?.lockDate && (
                <Btn variant="secondary" onClick={() => { if (confirm(t('Unlock all periods? Closed entries will become editable again.'))) { setPeriodLock({ lockDate: '' }); setLockInput('') } }}>
                  <Unlock size={14} /> {t('Unlock')}
                </Btn>
              )}
            </div>
          ) : (
            <span className="text-xs text-gray-400 dark:text-slate-500">{t('Owners / Admins only')}</span>
          )}
        </Card>

        {/* Approval thresholds */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <ShieldCheck size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Approvals')}</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            {t('Hold large documents for a second pair of eyes. Anything at or above a threshold is parked in Approvals and does not touch the ledger until an owner or admin approves it. Leave a threshold at 0 to never gate that type.')}
          </p>

          {isManager ? (
            <>
              <label className="flex items-start gap-3 cursor-pointer mb-4">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
                  checked={!!approvals.enabled}
                  onChange={(e) => updateApprovals({ enabled: e.target.checked })} />
                <span className="text-sm">
                  <span className="font-medium text-gray-800 dark:text-slate-100">{t('Require approval above a threshold')}</span>
                  <span className="block text-gray-500 dark:text-slate-400 mt-0.5">{t('Applies to new documents only — anything already posted is unaffected.')}</span>
                </span>
              </label>

              <div className={`space-y-3 ${approvals.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                {Object.entries(APPROVAL_KINDS).map(([kind, cfg]) => (
                  <div key={kind} className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-slate-100">{t(cfg.label)}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500">{t(cfg.hint)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 dark:text-slate-500">{settings.company.currencySymbol}</span>
                      <Input type="number" min="0" step="any" className="w-36"
                        id={`approval-threshold-${kind}`} aria-label={t(cfg.label)}
                        value={approvals.thresholds?.[kind] ?? 0}
                        onChange={(e) => updateApprovals({ thresholds: { [kind]: e.target.value === '' ? 0 : Number(e.target.value) } })} />
                    </div>
                  </div>
                ))}

                <label className="flex items-start gap-3 cursor-pointer pt-2 border-t border-gray-100 dark:border-surface-750">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
                    checked={approvals.requireDifferentUser !== false}
                    onChange={(e) => updateApprovals({ requireDifferentUser: e.target.checked })} />
                  <span className="text-sm">
                    <span className="font-medium text-gray-800 dark:text-slate-100">{t('The submitter cannot approve their own request')}</span>
                    <span className="block text-gray-500 dark:text-slate-400 mt-0.5">
                      {t('Segregation of duties. Turn this off only if you are the sole manager — a threshold you can wave through yourself is not a control.')}
                    </span>
                  </span>
                </label>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">{t('Approval settings apply immediately — no need to press Save.')}</p>
            </>
          ) : (
            <span className="text-xs text-gray-400 dark:text-slate-500">{t('Owners / Admins only')}</span>
          )}
        </Card>

        {/* Automation / scheduler */}
        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-accent-600 flex items-center justify-center">
              <CalendarClock size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Automation')}</h2>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              checked={settings.accounting?.autoPostRecurring !== false}
              onChange={(e) => setAutoPostRecurring(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium text-gray-800 dark:text-slate-100">{t('Auto-post recurring entries on start-up')}</span>
              <span className="block text-gray-500 dark:text-slate-400 mt-0.5">
                {t('When you open the app, any due recurring invoices and journals are posted automatically (catching up missed periods, skipping locked ones). Turn off to post them manually from their pages.')}
              </span>
            </span>
          </label>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Database size={14} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Backup & Restore')}</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            {t('Your data lives in this browser. Download a backup regularly so you never lose it — and restore it on any device or browser.')}
          </p>

          {/* Encrypt toggle */}
          <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none">
            <input type="checkbox" checked={encryptExport} onChange={(e) => setEncryptExport(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500" />
            <Shield size={14} className="text-brand-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{t('Encrypt backup with passphrase')}</span>
          </label>
          {encryptExport && (
            <div className="mb-4 flex items-end gap-3">
              <div className="flex-1">
                <Input label={t('Passphrase')} type="password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} placeholder={t('Enter a strong passphrase…')} />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-1 max-w-xs">{t('If you forget the passphrase, the backup cannot be recovered.')}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Btn variant="success" onClick={handleExport} disabled={exportBusy || (encryptExport && !exportPass)}>
              {encryptExport ? <ShieldCheck size={15} /> : <Download size={15} />}
              {exportBusy ? t('Encrypting…') : encryptExport ? t('Download Encrypted Backup') : t('Download Backup')}
            </Btn>
            <Btn variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} /> {t('Restore from File')}</Btn>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImportFile} className="hidden" />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">{t('Backup files contain all data in one portable file. Encrypted backups use AES-256-GCM.')}</p>

          {/* Local snapshots */}
          <div className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-gray-400 dark:text-slate-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{t('Local Snapshots')}</span>
                <span className="text-xs text-gray-400 dark:text-slate-500">({t('auto-saved daily, max 8')})</span>
              </div>
              <div className="flex gap-2">
                <Btn size="sm" variant="secondary" onClick={handleSnapshot} disabled={snapBusy}>
                  <RotateCcw size={13} /> {snapBusy ? t('Saving…') : t('Snapshot Now')}
                </Btn>
                <Btn size="sm" variant="secondary" onClick={() => setSnapshotsOpen(!snapshotsOpen)}>
                  {snapshotsOpen ? t('Hide') : t('Show')} ({snapshots.length || '…'})
                </Btn>
              </div>
            </div>

            {snapshotsOpen && (
              <div className="space-y-2">
                {snapshots.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">{t('No snapshots yet — one will be created automatically tomorrow.')}</p>}
                {snapshots.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 px-3 py-2 text-sm">
                    <div>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase me-2 ${s.label === 'Auto' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}>{s.label}</span>
                      <span className="text-gray-600 dark:text-slate-300">{new Date(s.at).toLocaleString()}</span>
                      <span className="text-gray-400 dark:text-slate-500 ms-2 text-xs">~{Math.round(s.bytes / 1024)} KB</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleRestoreSnap(s.id)} className="px-2 py-1 rounded text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/30 transition-colors" title={t('Restore')}>
                        <RotateCcw size={13} />
                      </button>
                      <button onClick={() => handleDeleteSnap(s.id)} className="px-2 py-1 rounded text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" title={t('Delete')}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Storage indicator */}
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
            <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400 mb-1">
              <span>{t('Browser storage used')} <span className="text-gray-400 dark:text-slate-500">({t('IndexedDB')})</span></span>
              <span>~{storageKB.toLocaleString()} KB {quotaKB ? `of ~${quotaKB.toLocaleString()} KB` : ''}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden">
              <div className={`h-full ${storagePct > 85 ? 'bg-red-500' : storagePct > 60 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${storagePct}%` }} />
            </div>
            {storagePct > 85 && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{t('Storage is nearly full — download a backup and consider archiving old data.')}</p>}
          </div>
        </Card>

        {/* Encrypted import modal */}
        {importModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setImportModal(null); setImportPass(''); setImportErr('') }}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-elevated w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-4">
                <KeyRound size={18} className="text-brand-500" />
                <h3 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Encrypted Backup')}</h3>
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{t('This backup is encrypted. Enter the passphrase to restore it.')}</p>
              <Input label={t('Passphrase')} type="password" value={importPass} onChange={(e) => { setImportPass(e.target.value); setImportErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleDecryptImport()} autoFocus />
              {importErr && <p className="text-sm text-red-500 mt-2">{importErr}</p>}
              <div className="flex justify-end gap-2 mt-5">
                <Btn variant="secondary" onClick={() => { setImportModal(null); setImportPass(''); setImportErr('') }}>{t('Cancel')}</Btn>
                <Btn onClick={handleDecryptImport} disabled={importBusy || !importPass}>
                  {importBusy ? t('Decrypting…') : t('Unlock & Restore')}
                </Btn>
              </div>
            </div>
          </div>
        )}

        <IntegrityCheckCard />

        <CloudSyncCard />

        {/* Danger Zone */}
        <Card className="p-6 border-danger-200/70 dark:border-danger-500/25">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={18} className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-red-700 dark:text-red-400">{t('Danger Zone')}</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{t('These actions are irreversible. Please proceed with caution.')}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-surface-750">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-slate-100">{t('Reset All Data')}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Erase all invoices, transactions, customers, and settings. Keeps the app.</p>
              </div>
              {isManager ? <Btn variant="danger" size="sm" onClick={handleReset}>{t('Reset Data')}</Btn> : <span className="text-xs text-gray-400 dark:text-slate-500">Owners / Admins only</span>}
            </div>
          </div>
        </Card>
      </div>

      {saved && (
        <div className="fixed bottom-6 end-6 z-50 bg-gradient-to-b from-success-500 to-success-600 text-white px-4 py-2.5 rounded-xl shadow-elevated text-sm font-semibold flex items-center gap-2 animate-slide-up">
          <Save size={15} /> Settings saved!
        </div>
      )}
    </div>
  )
}
