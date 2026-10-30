// GOSI on a contract or employee record: whether it applies, the employee's
// category, and — only for "Custom rates" — the percentages by hand. For the
// other categories the rates come from the law on the payroll month (see
// gosiRates in utils/contracts.js), shown here as of today.
import { Select, Input } from './UI'
import { useT } from '../i18n'
import { GOSI_CATEGORIES, gosiRates } from '../utils/contracts'

export default function GosiFields({ form, setField, asAt }) {
  const t = useT()
  if (!form.gosiApplicable) return null
  // A record from before categories existed has none: it keeps its typed rates.
  const category = form.gosiCategory || 'custom'
  const rates = gosiRates(category, asAt, { employee: form.gosiEmployeeRate, employer: form.gosiEmployerRate })
  return (
    <div className="space-y-2">
      <Select label={t('GOSI category')} value={category} onChange={(e) => setField('gosiCategory', e.target.value)}>
        {GOSI_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
      </Select>
      {category === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <Input label={`${t('Employee')} %`} type="number" min="0" step="0.01" value={form.gosiEmployeeRate} onChange={(e) => setField('gosiEmployeeRate', e.target.value)} />
          <Input label={`${t('Employer')} %`} type="number" min="0" step="0.01" value={form.gosiEmployerRate} onChange={(e) => setField('gosiEmployerRate', e.target.value)} />
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('Today: employee {e}%, employer {r}%. Payroll uses the rates in force for each pay month.')
            .replace('{e}', rates.employee).replace('{r}', rates.employer)}
        </p>
      )}
    </div>
  )
}
