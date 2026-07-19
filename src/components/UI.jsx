// Shared UI primitives (light + dark mode aware)
import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '../i18n'

// Translate string children of buttons while preserving icons/layout.
function translateChildren(children, t) {
  const one = (c) => {
    if (typeof c !== 'string') return c
    const trimmed = c.trim()
    if (!trimmed) return c
    const out = t(trimmed)
    return out === trimmed ? c : c.replace(trimmed, out)
  }
  if (typeof children === 'string') return one(children)
  if (Array.isArray(children)) return children.map((c, i) => <Fragment key={i}>{one(c)}</Fragment>)
  return children
}

export function Card({ children, className = '', ...rest }) {
  return (
    <div {...rest} className={`bg-white dark:bg-surface-850/90 rounded-xl shadow-card border border-slate-200/80 dark:border-surface-750/80 dark:shadow-none dark:ring-1 dark:ring-white/[0.03] ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }) {
  const t = useT()
  return (
    <div className="flex items-start justify-between mb-7 gap-4 animate-slide-up">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tightest text-slate-900 dark:text-slate-50">{typeof title === 'string' ? t(title) : title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{typeof subtitle === 'string' ? t(subtitle) : subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', type = 'button', disabled = false, className = '', title }) {
  const t = useT()
  const base = 'group inline-flex items-center justify-center gap-2 font-semibold rounded-lg whitespace-nowrap select-none transition-all duration-150 ease-spring active:scale-[.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:brightness-100'
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  const variants = {
    primary:   'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary hover:from-brand-600 hover:to-brand-700 active:from-brand-700 active:to-brand-700 focus-visible:ring-brand-500',
    secondary: 'bg-white dark:bg-surface-800 text-slate-700 dark:text-slate-200 border border-slate-300/90 dark:border-surface-600 shadow-btn-secondary dark:shadow-none hover:bg-slate-50 hover:border-slate-400/80 hover:text-slate-900 dark:hover:bg-surface-750 dark:hover:border-surface-500 dark:hover:text-white focus-visible:ring-slate-400',
    danger:    'bg-gradient-to-b from-danger-500 to-danger-600 text-white shadow-sm hover:from-danger-600 hover:to-danger-700 focus-visible:ring-danger-500',
    ghost:     'text-slate-600 dark:text-slate-300 hover:bg-slate-900/[0.05] hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white focus-visible:ring-slate-400',
    success:   'bg-gradient-to-b from-success-500 to-success-600 text-white shadow-sm hover:from-success-600 hover:to-success-700 focus-visible:ring-success-500',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={typeof title === 'string' ? t(title) : title} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {translateChildren(children, t)}
    </button>
  )
}

export function Badge({ children, className = '' }) {
  const t = useT()
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-[0.01em] ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06] ${className}`}>
      {translateChildren(children, t)}
    </span>
  )
}

const fieldBase =
  'w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 dark:focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20'
const fieldOk = 'border-slate-300/90 dark:border-surface-600 hover:border-slate-400/80 dark:hover:border-surface-500'
const fieldErr = 'border-danger-400 dark:border-danger-500/70 bg-danger-50/60 dark:bg-danger-950/30 focus:border-danger-500 focus:ring-danger-500/15'

function FieldLabel({ label, t }) {
  if (!label) return null
  return <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">{typeof label === 'string' ? t(label) : label}</label>
}

function FieldError({ error }) {
  if (!error) return null
  return <p className="text-xs font-medium text-danger-600 dark:text-danger-400 mt-1.5 animate-fade-in">{error}</p>
}

export function Input({ label, error, className = '', ...props }) {
  const t = useT()
  if (typeof props.placeholder === 'string') props.placeholder = t(props.placeholder)
  return (
    <div className={className}>
      <FieldLabel label={label} t={t} />
      <input className={`${fieldBase} ${error ? fieldErr : fieldOk}`} {...props} />
      <FieldError error={error} />
    </div>
  )
}

export function Select({ label, error, children, className = '', ...props }) {
  const t = useT()
  return (
    <div className={className}>
      <FieldLabel label={label} t={t} />
      <select className={`${fieldBase} cursor-pointer ${error ? fieldErr : fieldOk}`} {...props}>
        {children}
      </select>
      <FieldError error={error} />
    </div>
  )
}

export function Textarea({ label, error, className = '', ...props }) {
  const t = useT()
  if (typeof props.placeholder === 'string') props.placeholder = t(props.placeholder)
  return (
    <div className={className}>
      <FieldLabel label={label} t={t} />
      <textarea className={`${fieldBase} resize-none leading-relaxed ${error ? fieldErr : fieldOk}`} {...props} />
      <FieldError error={error} />
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  const t = useT()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-950/55 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />
      <div className={`relative bg-white dark:bg-surface-850 rounded-2xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 w-full ${width} max-h-[90vh] flex flex-col animate-scale-in overflow-hidden`}>
        <div className="flex items-center justify-between ps-6 pe-4 py-4 border-b border-slate-100 dark:border-surface-750">
          <h2 className="text-lg font-semibold tracking-snug text-slate-900 dark:text-slate-50">{typeof title === 'string' ? t(title) : title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-white/[0.07] transition-colors text-xl leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            &times;
          </button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, desc, action }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="w-16 h-16 mb-5 flex items-center justify-center text-3xl rounded-2xl bg-gradient-to-b from-slate-50 to-slate-100 dark:from-surface-800 dark:to-surface-850 ring-1 ring-slate-200/80 dark:ring-surface-700 shadow-xs">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-snug text-slate-800 dark:text-slate-100 mb-1">{typeof title === 'string' ? t(title) : title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-5 leading-relaxed">{typeof desc === 'string' ? t(desc) : desc}</p>
      {action}
    </div>
  )
}

export function StatCard({ label, value, sub, color = 'blue', icon, trend, trendUp, onClick }) {
  const t = useT()
  if (typeof label === 'string') label = t(label)
  if (typeof sub === 'string') sub = t(sub)
  const clickProps = onClick
    ? { onClick, role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } }
    : {}
  // Soft tinted icon chips — quieter and more premium than saturated fills.
  const colors = {
    blue:   'bg-brand-50 text-brand-600 ring-brand-600/10 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20',
    green:  'bg-success-50 text-success-600 ring-success-600/10 dark:bg-success-500/10 dark:text-success-400 dark:ring-success-400/20',
    orange: 'bg-warning-50 text-warning-600 ring-warning-600/10 dark:bg-warning-500/10 dark:text-warning-400 dark:ring-warning-400/20',
    amber:  'bg-warning-50 text-warning-600 ring-warning-600/10 dark:bg-warning-500/10 dark:text-warning-400 dark:ring-warning-400/20',
    red:    'bg-danger-50 text-danger-600 ring-danger-600/10 dark:bg-danger-500/10 dark:text-danger-400 dark:ring-danger-400/20',
    purple: 'bg-accent-50 text-accent-600 ring-accent-600/10 dark:bg-accent-500/10 dark:text-accent-400 dark:ring-accent-400/20',
  }
  return (
    <Card {...clickProps} className={`group p-5 transition-all duration-200 ease-spring hover:shadow-card-hover hover:-translate-y-px ${onClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">{label}{onClick && <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 text-brand-400 transition-opacity" />}</p>
          {/* Long amounts shrink instead of truncating — money must stay fully readable. */}
          <p className={`${String(value ?? '').length > 15 ? 'text-lg' : String(value ?? '').length > 11 ? 'text-[1.35rem]' : 'text-[1.7rem]'} leading-tight font-bold tracking-tightest text-slate-900 dark:text-white mt-2 tabular whitespace-nowrap`}>{value}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {trend != null && (
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ${trendUp ? 'text-success-700 bg-success-50 ring-success-600/10 dark:text-success-300 dark:bg-success-500/10 dark:ring-success-400/20' : 'text-danger-600 bg-danger-50 ring-danger-600/10 dark:text-danger-300 dark:bg-danger-500/10 dark:ring-danger-400/20'}`}>
                {trendUp ? '▲' : '▼'} {trend}
              </span>
            )}
            {sub && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{sub}</p>}
          </div>
        </div>
        {icon && (
          <div className={`w-10 h-10 flex items-center justify-center flex-shrink-0 rounded-xl ring-1 ring-inset transition-transform duration-200 ease-spring group-hover:scale-105 ${colors[color] || colors.blue}`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}

export function Table({ headers, children, empty }) {
  const t = useT()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200/90 dark:border-surface-700 bg-slate-50/80 dark:bg-surface-900/40">
            {headers.map((h, i) => {
              const raw = (h && typeof h === 'object') ? h.label : h
              return (
              <th
                key={i}
                className={`px-4 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em] ${
                  h.right ? 'text-right' : 'text-left'
                }`}
              >
                {typeof raw === 'string' ? t(raw) : raw}
              </th>
            )})}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-surface-800/80">
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  )
}

export function Tr({ children, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`${onClick ? 'cursor-pointer hover:bg-brand-50/50 dark:hover:bg-brand-500/[0.06]' : 'hover:bg-slate-50/70 dark:hover:bg-white/[0.02]'} transition-colors duration-100 ${className}`}
    >
      {children}
    </tr>
  )
}

export function Td({ children, right = false, className = '', colSpan }) {
  return (
    <td colSpan={colSpan} className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${right ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  )
}

export function SectionDivider({ title }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3 my-6">
      <div className="flex-1 border-t border-slate-200/90 dark:border-surface-700" />
      <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-[0.12em]">{typeof title === 'string' ? t(title) : title}</span>
      <div className="flex-1 border-t border-slate-200/90 dark:border-surface-700" />
    </div>
  )
}
