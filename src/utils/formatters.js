import { format, parseISO, isValid } from 'date-fns'

export function fmtMoney(amount, symbol = '$') {
  const n = Number(amount) || 0
  return `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = parseISO(dateStr)
    return isValid(d) ? format(d, 'dd MMM yyyy') : dateStr
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

export function statusColor(status) {
  const map = {
    draft:    'bg-gray-100 text-gray-700',
    sent:     'bg-blue-100 text-blue-700',
    partial:  'bg-yellow-100 text-yellow-700',
    paid:     'bg-green-100 text-green-700',
    overdue:  'bg-red-100 text-red-700',
    received: 'bg-blue-100 text-blue-700',
    cancelled:'bg-gray-100 text-gray-500',
    money_in: 'bg-green-100 text-green-700',
    money_out:'bg-red-100 text-red-700',
    manual:   'bg-purple-100 text-purple-700',
  }
  return map[status] || 'bg-gray-100 text-gray-600'
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
    asset:     'text-blue-700 bg-blue-50',
    liability: 'text-orange-700 bg-orange-50',
    equity:    'text-purple-700 bg-purple-50',
    revenue:   'text-green-700 bg-green-50',
    expense:   'text-red-700 bg-red-50',
  }
  return map[type] || 'text-gray-700 bg-gray-50'
}
