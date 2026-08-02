import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Btn, Input, Select } from './UI'
import { TAX_REGIONS, findTaxRegion } from '../utils/taxRegions'
import { CheckCircle2, ArrowRight, ArrowLeft, X } from 'lucide-react'

// The three questions a new company cannot be right without.
//
// Before this, a new user landed on a dashboard with sixty-five menu items and
// no indication that anything needed setting. The consequences were quiet and
// expensive: tax is off until somebody turns it on, so invoices raised in the
// first week carry no VAT and nobody notices until a return is due. Country,
// currency and tax all follow from one question, and asking it once at the
// start costs twenty seconds.
//
// It is skippable, and re-openable from Settings, because a wizard that traps
// you is worse than no wizard at all.

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', AED: 'AED', SAR: 'SAR', EGP: 'EGP',
  JOD: 'JD', CAD: 'CA$', AUD: 'A$', INR: '₹', BHD: 'BHD', ZAR: 'R', SGD: 'S$',
}

export default function SetupWizard({ onClose }) {
  const t = useT()
  const { settings, updateCompany, updateTax, updateZatca, updateEta, markSetupDone } = useStore()
  const [step, setStep] = useState(0)
  const [region, setRegion] = useState(settings.tax?.country || '')
  const [company, setCompany] = useState({
    name: settings.company?.name || '',
    taxNumber: settings.company?.taxNumber || settings.zatca?.vatNumber || '',
    address: settings.company?.address || '',
  })

  const chosen = findTaxRegion(region)

  const finish = (skipped = false) => {
    if (!skipped && chosen) {
      updateTax({
        enabled: chosen.system !== 'none',
        name: chosen.taxName, rate: chosen.rate, system: chosen.system, country: chosen.id,
      })
      if (chosen.currency) {
        updateCompany({ currency: chosen.currency, currencySymbol: CURRENCY_SYMBOLS[chosen.currency] || chosen.currency })
      }
      if (chosen.zatca) updateZatca({ enabled: true, showQr: true, vatNumber: company.taxNumber || '' })
      if (chosen.id === 'EG') updateEta({ enabled: true, taxpayerId: company.taxNumber || '' })
    }
    if (!skipped) {
      updateCompany({
        ...(company.name.trim() ? { name: company.name.trim() } : {}),
        taxNumber: company.taxNumber, address: company.address,
      })
    }
    markSetupDone(skipped ? 'skipped' : 'done')
    onClose?.()
  }

  const steps = [
    {
      title: 'Where do you trade?',
      blurb: 'This sets your currency, your tax name and rate, and any e-invoicing your country requires. Everything here can be changed later in Settings.',
      body: (
        <div className="space-y-4">
          <Select label={t('Country / tax region')} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t('— Choose your country —')}</option>
            {TAX_REGIONS.map((r) => <option key={r.id} value={r.id}>{r.country}</option>)}
          </Select>
          {chosen && (
            <div className="rounded-xl bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 p-4 text-sm space-y-1.5">
              <p className="font-semibold text-brand-800 dark:text-brand-200">{t('This will set:')}</p>
              <ul className="text-brand-700 dark:text-brand-300 space-y-1">
                <li>• {t('Currency')}: <b>{chosen.currency || '—'}</b></li>
                <li>• {chosen.taxName}: <b>{chosen.system === 'none' ? t('not charged') : `${chosen.rate}%`}</b></li>
                {chosen.zatca && <li>• {t('ZATCA e-invoicing with a QR code on every invoice')}</li>}
                {chosen.id === 'EG' && <li>• {t('ETA e-invoicing documents')}</li>}
              </ul>
            </div>
          )}
          {!chosen && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('Without this, tax stays switched off and your invoices will carry none — which is easy to miss until a return is due.')}
            </p>
          )}
        </div>
      ),
      canNext: !!chosen,
    },
    {
      title: 'Your business details',
      blurb: 'These appear on every invoice you issue. You can leave any of them blank for now.',
      body: (
        <div className="space-y-4">
          <Input label={t('Business name')} value={company.name} onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))} placeholder="Al-Noor Trading Est." />
          <Input label={chosen?.zatca ? t('VAT registration number') : t('Tax registration number')}
            value={company.taxNumber} onChange={(e) => setCompany((c) => ({ ...c, taxNumber: e.target.value }))}
            placeholder={chosen?.zatca ? '3xxxxxxxxxxxxx3' : '100200300'} />
          <Input label={t('Address')} value={company.address} onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))} />
        </div>
      ),
      canNext: true,
    },
    {
      title: "You're ready",
      blurb: 'Two things worth knowing before you start entering work.',
      body: (
        <div className="space-y-3 text-sm">
          {/* The trap that catches everybody: stock typed onto an item is not
              an accounting entry, and the balance sheet will not show it. */}
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 p-4">
            <p className="font-semibold text-amber-800 dark:text-amber-200 mb-1">{t('Starting with stock or unpaid invoices?')}</p>
            <p className="text-amber-700 dark:text-amber-300 leading-relaxed">
              {t('Enter them through Opening Balances, not by typing a quantity onto an item. A quantity typed on an item puts goods on the shelf without putting their value on your balance sheet, and the two then disagree.')}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-surface-700 bg-slate-50 dark:bg-surface-800/60 p-4">
            <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{t('Finding your way around')}</p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('There is a lot here, and you will not need most of it. Press ⌘K (or Ctrl+K) to jump straight to any screen by name, and check Settings › Data Integrity Check any time you want proof the books add up.')}
            </p>
          </div>
        </div>
      ),
      canNext: true,
    },
  ]

  const cur = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-surface-850 rounded-2xl shadow-elevated w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-brand-500' : i < step ? 'w-3 bg-brand-300 dark:bg-brand-700' : 'w-3 bg-slate-200 dark:bg-surface-700'}`} />
            ))}
          </div>
          <button onClick={() => finish(true)} aria-label={t('Skip setup')}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-2">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t(cur.title)}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{t(cur.blurb)}</p>
        </div>

        <div className="px-6 py-5">{cur.body}</div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-surface-750">
          {step > 0
            ? <Btn variant="ghost" onClick={() => setStep((s) => s - 1)}><ArrowLeft size={15} /> {t('Back')}</Btn>
            : <button onClick={() => finish(true)} className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">{t("I'll set this up later")}</button>}
          {isLast
            ? <Btn onClick={() => finish(false)}><CheckCircle2 size={15} /> {t('Start using it')}</Btn>
            : <Btn disabled={!cur.canNext} onClick={() => setStep((s) => s + 1)}>{t('Continue')} <ArrowRight size={15} /></Btn>}
        </div>
      </div>
    </div>
  )
}
