import { format, parseISO, isValid } from 'date-fns'
import { ar } from 'date-fns/locale'
import { useI18n, localizeDigits } from '../i18n'

export function fmtMoney(amount, symbol = '$') {
  const n = Number(amount) || 0
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Show a sign only when there is something to be negative about. A balance
  // built from many postings lands a hair below zero in floating point — a
  // lease liability settled over 36 monthly entries comes out at -1e-11 — and
  // rendering that as "-$0.00" makes a correctly cleared account look wrong.
  const negative = n < 0 && Math.abs(n) >= 0.005
  // Sign goes before the currency symbol (−$3,870.00, not $-3,870.00) — also
  // keeps the sign attached to the amount in RTL layouts.
  return localizeDigits(`${negative ? '-' : ''}${symbol}${abs}`)
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = parseISO(dateStr)
    if (!isValid(d)) return dateStr
    const lang = useI18n.getState().lang
    return localizeDigits(format(d, 'dd MMM yyyy', lang === 'ar' ? { locale: ar } : undefined))
  } catch {
    return dateStr
  }
}

export function fmtDateInput(dateStr) {
  if (!dateStr) return ''
  try {
    const d = parseISO(dateStr)
    return isValid(d) ? format(d, 'yyyy-MM-dd') : dateStr
  } catch {
    return dateStr
  }
}

export function today() {
  return format(new Date(), 'yyyy-MM-dd')
}

export function addDays(dateStr, days) {
  const d = parseISO(dateStr)
  d.setDate(d.getDate() + days)
  return format(d, 'yyyy-MM-dd')
}

// Semantic, theme-aware chip recipes — one voice for state colors in light AND dark mode.
export const tone = {
  neutral: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
  muted:   'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
  brand:   'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  accent:  'bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300',
  success: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  danger:  'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300',
}

// One colour per meaning, for every document and record in the app:
//   grey   — not started yet, or finished and handed on (draft, invoiced, posted)
//   blue   — under way (sent, open, received, approved-but-unpaid)
//   amber  — needs someone (partial, pending, paused)
//   green  — the good outcome (paid, accepted, active)
//   red    — a problem (overdue, rejected, void)
// Screens used to keep their own maps, so "draft" was amber on one list and
// grey on the next. Every status badge now comes from here.
const STATUS_TONE = {
  // not started / finished
  draft: 'neutral', invoiced: 'muted', ordered: 'muted', posted: 'muted', closed: 'muted',
  cancelled: 'muted', converted: 'muted', delivered: 'muted', settled: 'muted',
  inactive: 'muted', disposed: 'muted', terminated: 'muted',
  // under way
  sent: 'brand', open: 'brand', received: 'brand', issued: 'brand', approved: 'brand',
  in_progress: 'brand', counting: 'brand', processed: 'brand',
  // needs someone
  partial: 'warning', pending: 'warning', paused: 'warning', awaiting: 'warning', on_hold: 'warning',
  expired: 'warning', low_stock: 'warning',
  // good outcome
  paid: 'success', accepted: 'success', active: 'success', completed: 'success', cleared: 'success',
  money_in: 'success', won: 'success', in_stock: 'success',
  // problem
  overdue: 'danger', rejected: 'danger', bounced: 'danger', money_out: 'danger', lost: 'danger', out_of_stock: 'danger',
  // other
  manual: 'accent', overstock: 'accent',
}

export function statusColor(status) {
  if (status === 'void') return `${tone.danger} line-through`
  return tone[STATUS_TONE[status]] || tone.neutral
}

export function accountTypeLabel(type) {
  const map = {
    asset:     'Asset',
    liability: 'Liability',
    equity:    'Equity',
    revenue:   'Revenue',
    expense:   'Expense',
  }
  return map[type] || type
}

export function accountTypeColor(type) {
  const map = {
    asset:     tone.brand,
    liability: tone.warning,
    equity:    tone.accent,
    revenue:   tone.success,
    expense:   tone.danger,
  }
  return map[type] || tone.neutral
}
