import { useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { Card, Btn, Input, Select } from './UI'
import { Scale } from 'lucide-react'
import { STRAIGHT_LINE, DECLINING_BALANCE } from '../utils/deferredTax'

// IAS 12 settings.
//
// Everything here is a fact about the jurisdiction the business files in, not
// about its books, which is why none of it can be inferred and all of it is
// off until somebody fills it in. The two rates are the part worth being
// careful about: they are different numbers doing different jobs, and swapping
// them produces a schedule that looks entirely plausible and is wrong in every
// row. The labels say so rather than assuming it is obvious.

export default function DeferredTaxCard() {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateDeferredTaxSettings)
  const cfg = settings.deferredTax || {}
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    enabled: !!cfg.enabled,
    ratePct: cfg.ratePct ?? 0,
    allowanceRatePct: cfg.allowanceRatePct ?? 0,
    assetTaxMethod: cfg.assetTaxMethod || DECLINING_BALANCE,
    lossesCarriedForward: cfg.lossesCarriedForward ?? 0,
    recognitionPct: cfg.recognitionPct ?? 100,
    offset: cfg.offset !== false,
  })

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false) }
  const save = () => {
    update({
      ...form,
      ratePct: Number(form.ratePct) || 0,
      allowanceRatePct: Number(form.allowanceRatePct) || 0,
      lossesCarriedForward: Number(form.lossesCarriedForward) || 0,
      recognitionPct: Math.max(0, Math.min(100, Number(form.recognitionPct) || 0)),
    })
    setSaved(true)
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
          <Scale size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Deferred Tax (IAS 12)')}</h2>
      </div>

      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 max-w-2xl">
        {t('Tax is charged on taxable profit while the accounts report accounting profit, and the two rarely agree in a given year. Deferred tax puts the difference in the year it arises rather than the year it is paid.')}
      </p>

      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
          checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="text-sm">
          <span className="font-medium text-gray-800 dark:text-slate-100">{t('Recognise deferred tax')}</span>
          <span className="block text-gray-500 dark:text-slate-400 mt-0.5">
            {t('Off by default — recognising deferred tax changes reported profit and the balance sheet, so it is an accounting policy decision rather than a setting to switch on casually.')}
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input label={t('Tax rate on profits (%)')} type="number" step="0.01" value={form.ratePct}
            onChange={(e) => set('ratePct', e.target.value)} />
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            {t('The rate expected to apply when the differences reverse (IAS 12.47).')}
          </p>
        </div>
        <div>
          <Input label={t('Capital allowance rate (%)')} type="number" step="0.01" value={form.allowanceRatePct}
            onChange={(e) => set('allowanceRatePct', e.target.value)} />
          {/* Spelled out because the two rates are easy to transpose and the
              result of doing so looks perfectly reasonable. */}
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            {t('The rate the tax authority writes assets down at — a different number from the tax rate above.')}
          </p>
        </div>
        <div>
          <Select label={t('Capital allowance method')} value={form.assetTaxMethod}
            onChange={(e) => set('assetTaxMethod', e.target.value)}>
            <option value={DECLINING_BALANCE}>{t('Declining balance')}</option>
            <option value={STRAIGHT_LINE}>{t('Straight line')}</option>
          </Select>
        </div>
        <div>
          <Input label={t('Tax losses carried forward')} type="number" step="0.01" value={form.lossesCarriedForward}
            onChange={(e) => set('lossesCarriedForward', e.target.value)} />
        </div>
        <div>
          <Input label={t('Deferred tax assets recognised (%)')} type="number" step="1" min="0" max="100"
            value={form.recognitionPct} onChange={(e) => set('recognitionPct', e.target.value)} />
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            {t('How much of the asset left over after setting it against deferred tax liabilities is probable enough to recognise (IAS 12.24). The part covered by liabilities is always recognised.')}
          </p>
        </div>
        <div>
          <label className="flex items-start gap-3 cursor-pointer mt-6">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              checked={form.offset} onChange={(e) => set('offset', e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium text-gray-800 dark:text-slate-100">{t('Offset assets against liabilities')}</span>
              <span className="block text-gray-500 dark:text-slate-400 mt-0.5">
                {t('Only where there is a legally enforceable right of set-off and the same taxing authority (IAS 12.74).')}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <Btn onClick={save}>{t('Save')}</Btn>
        {saved && <span className="text-xs text-success-600 dark:text-success-400">{t('Saved')}</span>}
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {t('The schedule and the tax reconciliation are under Reports → Deferred Tax.')}
        </span>
      </div>
    </Card>
  )
}
