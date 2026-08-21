import { ShieldCheck, ShieldAlert, ShieldQuestion, HardDrive } from 'lucide-react'
import { useT } from '../i18n'
import { AT_RISK, FRAGILE, LEVEL_TEXT, REASON_TEXT, fmtBytes } from '../utils/durability'

// Says plainly whether this business would still have its books tomorrow.
//
// It sits at the top of Backup & Restore rather than on its own page for one
// reason: the answer to "your books exist in only one place" is a button that
// is already right here. A warning the user has to navigate away from to act
// on is a warning they learn to dismiss.
//
// The tone is deliberate. When the books are genuinely at risk it says so in
// those words, without softening — because the failure it is describing is
// silent, total, and permanent, and a user who reads this as routine
// housekeeping has been misled.

const TONE = {
  [AT_RISK]: {
    box: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900',
    title: 'text-rose-800 dark:text-rose-200',
    body: 'text-rose-700/90 dark:text-rose-300/90',
    Icon: ShieldAlert,
    iconClass: 'text-rose-500',
  },
  [FRAGILE]: {
    box: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
    title: 'text-amber-800 dark:text-amber-200',
    body: 'text-amber-700/90 dark:text-amber-300/90',
    Icon: ShieldQuestion,
    iconClass: 'text-amber-500',
  },
  default: {
    box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900',
    title: 'text-emerald-800 dark:text-emerald-200',
    body: 'text-emerald-700/90 dark:text-emerald-300/90',
    Icon: ShieldCheck,
    iconClass: 'text-emerald-500',
  },
}

export default function DurabilityStatus({ report }) {
  const t = useT()
  // An empty company has nothing to lose yet, and nagging now would only teach
  // the user to ignore this box before it ever means anything.
  if (!report || report.empty) return null

  const tone = TONE[report.level] || TONE.default
  const { Icon } = tone
  const { estimate } = report

  return (
    <div className={`mb-4 rounded-xl border p-4 ${tone.box}`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${tone.iconClass} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${tone.title}`}>{t(LEVEL_TEXT[report.level])}</p>

          {report.reasons.length > 0 && (
            <ul className={`mt-1.5 space-y-1 text-xs ${tone.body}`}>
              {report.reasons.map((r) => (
                <li key={r.code} className="flex gap-1.5">
                  <span aria-hidden="true">•</span>
                  <span>
                    {t(REASON_TEXT[r.code] || r.code)}
                    {/* The age is what makes a stale backup feel real. */}
                    {r.days != null && ' ' + t('({n} days ago)').replace('{n}', r.days)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {report.exportAge === 0 && (
            <p className={`mt-1.5 text-xs ${tone.body}`}>{t('You downloaded a backup today.')}</p>
          )}

          {estimate?.supported && estimate.quota > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
              <HardDrive size={12} />
              {/* One key rather than four fragments: Arabic puts these in a
                  different order, and a sentence assembled from pieces cannot
                  be reordered by a translator. */}
              {t('Using {used} of {total} browser storage')
                .replace('{used}', fmtBytes(estimate.usage))
                .replace('{total}', fmtBytes(estimate.quota))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
