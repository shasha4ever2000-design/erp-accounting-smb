// HR policy: the end-of-service scheme, the working week, and whether
// lateness is docked.
//
// Saves through the store as it is edited — these settings change what payroll
// computes, so a half-saved policy sitting in local state would mean the
// figures on screen disagree with the ones about to be posted.

import { useStore } from '../store'
import { EOSB_RULES } from '../utils/endOfService'
import { Card, Input, Select } from './UI'
import { useT } from '../i18n'
import { Users } from 'lucide-react'

const WEEKDAYS = [
  { id: 0, label: 'Sunday' }, { id: 1, label: 'Monday' }, { id: 2, label: 'Tuesday' },
  { id: 3, label: 'Wednesday' }, { id: 4, label: 'Thursday' }, { id: 5, label: 'Friday' },
  { id: 6, label: 'Saturday' },
]

export default function HrSettingsCard() {
  const settings = useStore((s) => s.settings)
  const updateHrSettings = useStore((s) => s.updateHrSettings)
  const t = useT()

  const hr = settings.hr || {}
  const eosb = hr.eosb || {}
  const restDays = Array.isArray(hr.restDays) ? hr.restDays : [5, 6]

  const toggleRest = (d) => {
    const next = restDays.includes(d) ? restDays.filter((x) => x !== d) : [...restDays, d].sort()
    updateHrSettings({ restDays: next })
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center">
          <Users size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('HR & Attendance')}</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        {t('The end-of-service scheme, your working week, and how lateness is treated. Changes here save straight away.')}
      </p>

      <div className="space-y-4">
        <div>
          <Select label={t('End-of-service scheme')} value={eosb.rule || 'none'} onChange={(e) => updateHrSettings({ eosb: { rule: e.target.value } })}>
            {EOSB_RULES.map((r) => <option key={r.id} value={r.id}>{t(r.label)}</option>)}
          </Select>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {eosb.rule === 'saudi' && t('Half a month per year for the first five years, a full month after. A resignation earns nothing under two years, a third to five, two thirds to ten.')}
            {eosb.rule === 'simple' && t('A flat number of days per year, with no resignation scaling.')}
            {(!eosb.rule || eosb.rule === 'none') && t('No provision is built and nothing is posted. Turn a scheme on to start accruing.')}
          </p>
        </div>

        {eosb.rule === 'simple' && (
          <Input label={t('Days per year')} type="number" min="0" max="60"
            value={eosb.daysPerYear ?? 21}
            onChange={(e) => updateHrSettings({ eosb: { daysPerYear: parseFloat(e.target.value) || 0 } })} />
        )}

        {eosb.rule && eosb.rule !== 'none' && (
          <div>
            <Select label={t('Computed on')} value={eosb.wageBasis || 'contributory'}
              onChange={(e) => updateHrSettings({ eosb: { wageBasis: e.target.value } })}>
              <option value="contributory">{t('Basic + housing')}</option>
              <option value="gross">{t('Full gross pay')}</option>
            </Select>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {t('Basic plus housing is the GCC convention. Computing on basic alone understates the award; on full gross it overstates it.')}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5">{t('Weekly rest days')}</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <button key={d.id} onClick={() => toggleRest(d.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${restDays.includes(d.id)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>
                {t(d.label)}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
            {t('New attendance sheets come pre-filled with these, so nobody has to mark eight rest days by hand every month.')}
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={!!hr.deductLate} onChange={(e) => updateHrSettings({ deductLate: e.target.checked })}
              className="rounded border-slate-300 dark:border-surface-700 text-blue-600 focus:ring-blue-500" />
            {t('Deduct pay for lateness')}
          </label>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            {t('Off by default. Docking pay by the minute has legal limits in most places, so it is never done unless you ask.')}
          </p>
          {hr.deductLate && (
            <Input label={t('Grace period (minutes a month)')} type="number" min="0" className="mt-2 max-w-[14rem]"
              value={hr.lateGraceMinutes ?? 0}
              onChange={(e) => updateHrSettings({ lateGraceMinutes: parseFloat(e.target.value) || 0 })} />
          )}
        </div>
      </div>
    </Card>
  )
}
