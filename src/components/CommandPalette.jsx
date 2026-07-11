import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { useT } from '../i18n'

const COMMANDS = [
  { label: 'Dashboard', path: '/', group: 'Go to' },
  { label: 'Chart of Accounts', path: '/accounts', group: 'Go to' },
  { label: 'Cash & Bank Accounts', path: '/bank-accounts', group: 'Go to' },
  { label: 'Bank Transactions', path: '/banking', group: 'Go to' },
  { label: 'Bank Reconciliation', path: '/reconciliation', group: 'Go to' },
  { label: 'Journal Entries', path: '/journals', group: 'Go to' },
  { label: 'Sales Pipeline (CRM)', path: '/pipeline', group: 'Go to' },
  { label: 'Point of Sale (POS)', path: '/pos', group: 'Go to' },
  { label: 'Customers', path: '/customers', group: 'Go to' },
  { label: 'Quotations', path: '/quotations', group: 'Go to' },
  { label: 'Sales Invoices', path: '/invoices', group: 'Go to' },
  { label: 'Recurring / Subscription Invoices', path: '/recurring-invoices', group: 'Go to' },
  { label: 'Delivery Notes', path: '/delivery-notes', group: 'Go to' },
  { label: 'Credit Notes', path: '/credit-notes', group: 'Go to' },
  { label: 'Suppliers', path: '/suppliers', group: 'Go to' },
  { label: 'Purchase Requisitions', path: '/requisitions', group: 'Go to' },
  { label: 'Purchase Orders', path: '/purchase-orders', group: 'Go to' },
  { label: 'Purchase Invoices', path: '/purchases', group: 'Go to' },
  { label: 'Debit Notes', path: '/debit-notes', group: 'Go to' },
  { label: 'Inventory Items', path: '/inventory', group: 'Go to' },
  { label: 'Warehouses & Stock Transfers', path: '/warehouses', group: 'Go to' },
  { label: 'Stock Adjustments', path: '/stock-adjustments', group: 'Go to' },
  { label: 'Manufacturing', path: '/manufacturing', group: 'Go to' },
  { label: 'Projects & Job Costing', path: '/projects', group: 'Go to' },
  { label: 'Budgets vs Actuals', path: '/budgets', group: 'Go to' },
  { label: 'Prepaid Expenses', path: '/prepaid-expenses', group: 'Go to' },
  { label: 'Leases & Rent', path: '/leases', group: 'Go to' },
  { label: 'Expense Claims', path: '/expense-claims', group: 'Go to' },
  { label: 'Fixed Assets', path: '/fixed-assets', group: 'Go to' },
  { label: 'Departments', path: '/departments', group: 'Go to' },
  { label: 'Employees', path: '/employees', group: 'Go to' },
  { label: 'Payroll', path: '/payroll', group: 'Go to' },
  { label: 'Business Analytics', path: '/analytics', group: 'Go to' },
  { label: 'Currencies & Exchange Rates', path: '/currencies', group: 'Go to' },
  { label: 'Statements of Account', path: '/statements', group: 'Go to' },
  { label: 'Audit Log', path: '/audit-log', group: 'Go to' },
  { label: 'Team & Roles', path: '/team', group: 'Go to' },
  { label: 'Reports', path: '/reports', group: 'Go to' },
  { label: 'VAT Return (ZATCA)', path: '/reports', group: 'Go to' },
  { label: 'Settings', path: '/settings', group: 'Go to' },
  // Quick actions
  { label: 'New Sales Invoice', path: '/invoices/new', group: 'Create' },
  { label: 'New Quotation', path: '/quotations/new', group: 'Create' },
  { label: 'New Purchase Order', path: '/purchase-orders/new', group: 'Create' },
  { label: 'New Purchase Invoice', path: '/purchases/new', group: 'Create' },
  { label: 'New Fixed Asset', path: '/fixed-assets/new', group: 'Create' },
]

export default function CommandPalette() {
  const navigate = useNavigate()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
  }, [query])

  useEffect(() => { setActive(0) }, [query])

  const go = (cmd) => {
    if (!cmd) return
    navigate(cmd.path)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
  }

  if (!open) return null

  let lastGroup = null

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-surface-950/55 backdrop-blur-[3px] animate-fade-in" />
      <div className="relative w-full max-w-xl bg-white dark:bg-surface-850 rounded-2xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 overflow-hidden animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-surface-750">
          <Search size={17} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Search modules or actions…')}
            className="flex-1 bg-transparent outline-none text-[15px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <kbd className="hidden sm:inline-block text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-white/[0.05] border border-slate-200/90 dark:border-surface-700 rounded-md px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2 px-2">
          {results.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">{t('No matches')}</p>}
          {results.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup
            lastGroup = cmd.group
            return (
              <div key={cmd.path + cmd.label}>
                {showGroup && <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{t(cmd.group)}</p>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(cmd)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-start rounded-lg transition-colors duration-100 ${
                    active === i
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/[0.12] dark:text-brand-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span className="truncate">{t(cmd.label)}</span>
                  {active === i && <CornerDownLeft size={14} className="flex-shrink-0 opacity-70 rtl:-scale-x-100" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 dark:border-surface-750 bg-slate-50/60 dark:bg-surface-900/40 text-[11px] text-slate-400 dark:text-slate-500">
          <span className="inline-flex items-center gap-1.5"><kbd className="font-sans font-semibold bg-white dark:bg-white/[0.06] border border-slate-200/90 dark:border-surface-700 rounded px-1 py-px">↑↓</kbd> {t('Navigate')}</span>
          <span className="inline-flex items-center gap-1.5"><kbd className="font-sans font-semibold bg-white dark:bg-white/[0.06] border border-slate-200/90 dark:border-surface-700 rounded px-1 py-px">↵</kbd> {t('Open')}</span>
        </div>
      </div>
    </div>
  )
}
