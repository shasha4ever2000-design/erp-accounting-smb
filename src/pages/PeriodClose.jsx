import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, MinusCircle, ChevronRight, Lock } from 'lucide-react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { PageHeader, Card, Btn, Input } from '../components/UI'
import { periodCloseChecklist, monthBounds } from '../utils/periodClose'
import { todayISO } from '../utils/localDate'
import { ask } from '../components/Dialogs'
import { fmtDate } from '../utils/formatters'

// Last month by default: that is the one being closed.
const lastMonthEnd = () => { const d = new Date(); return todayISO(new Date(d.getFullYear(), d.getMonth(), 0)) }

export default function PeriodClose() {
  const t = useT()
  const navigate = useNavigate()
  const state = useStore()
  const { setPeriodLock, currentUser } = state
  const [month, setMonth] = useState(lastMonthEnd().slice(0, 7))
  const { from, to } = monthBounds(`${month}-01`)
  const items = useMemo(() => periodCloseChecklist(state, { from, to }), [state, from, to])
  const open = items.filter((i) => i.status === 'todo' && i.id !== 'lock').length

  const lock = async () => {
    const msg = open
      ? t('{n} item(s) are still open. Lock the period through {d} anyway?').replace('{n}', open).replace('{d}', fmtDate(to))
      : t('Lock all periods through {d}? Entries on or before this date will be read-only.').replace('{d}', fmtDate(to))
    if (!(await ask(msg, { confirmLabel: 'Lock' }))) return
    setPeriodLock({ lockDate: to, lockedBy: currentUser?.()?.name || '' })
  }

  const icon = (st) => st === 'done'
    ? <CheckCircle2 size={20} className="text-success-700 dark:text-success-400" />
    : st === 'na'
      ? <MinusCircle size={20} className="text-slate-500 dark:text-slate-400" />
      : <Circle size={20} className="text-warning-700 dark:text-warning-400" />

  return (
    <div>
      <PageHeader title="Month-end close" subtitle="Everything that should be done before a month's numbers are reported, checked from the books." />
      <Card className="p-5 mb-5 flex flex-wrap items-end gap-4">
        <Input label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <p className="text-sm text-slate-600 dark:text-slate-300 pb-2">
          {fmtDate(from)} — {fmtDate(to)} · {open ? t('{n} open').replace('{n}', open) : t('Ready to lock')}
        </p>
      </Card>
      <Card className="divide-y divide-slate-100 dark:divide-surface-800">
        {items.map((i) => (
          <button key={i.id} onClick={() => i.link && navigate(i.link)}
            className="w-full flex items-center gap-4 px-5 py-4 text-start hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
            {icon(i.status)}
            <span className="flex-1 min-w-0">
              <span className="block font-medium text-slate-900 dark:text-slate-100">{t(i.label)}</span>
              <span className="block text-sm text-slate-600 dark:text-slate-300">
                {t(i.detail).replace('{n}', i.params?.n ?? '').replace('{p}', i.params?.p ?? '').replace('{d}', i.params?.d ? fmtDate(i.params.d) : '')}
              </span>
            </span>
            <span className="sr-only">{t(i.status === 'done' ? 'Done' : i.status === 'na' ? 'Not needed' : 'To do')}</span>
            <ChevronRight size={16} className="text-slate-500 dark:text-slate-400 rtl:rotate-180" />
          </button>
        ))}
      </Card>
      <div className="flex justify-end mt-5">
        <Btn onClick={lock}><Lock size={15} /> {t('Lock this period')}</Btn>
      </div>
    </div>
  )
}
