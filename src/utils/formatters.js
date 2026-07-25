import { format, parseISO, isValid } from 'date-fns'
import { ar } from 'date-fns/locale'
import { useI18n, localizeDigits } from '../i18n'

export function fmtMoney(amount, symbol = '$') {
  const n = Number(amount) || 0
  // Sign goes before the currency symbol (−$3,870.00, not $-3,870.00) — also
  // keeps the sign attached to the amount in RTL layouts.
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return localizeDigits(`${n < 0 ? '-' : ''}${symbol}${abs}`)
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

export function statusColor(status) {
  const map = {
    draft:    tone.neutral,
    sent:     tone.brand,
    partial:  tone.warning,
    paid:     tone.success,
    overdue:  tone.danger,
    received: tone.brand,
    cancelled: tone.muted,
    void:     `${tone.danger} line-through`,
    money_in: tone.success,
    money_out: tone.danger,
    manual:   tone.accent,
  }
  return map[status] || tone.neutral
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
