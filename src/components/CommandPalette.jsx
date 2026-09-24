import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { useT } from '../i18n'

const COMMANDS = [
  { label: 'Dashboard', path: '/', group: 'Go to' },
  { label: 'Chart of accounts', path: '/accounts', group: 'Go to' },
  { label: 'Cash & bank accounts', path: '/bank-accounts', group: 'Go to' },
  { label: 'Bank transactions', path: '/banking', group: 'Go to' },
  { label: 'Bank reconciliation', path: '/reconciliation', group: 'Go to' },
  { label: 'Journal entries', path: '/journals', group: 'Go to' },
  { label: 'Sales pipeline (CRM)', path: '/pipeline', group: 'Go to' },
  { label: 'Point of sale (POS)', path: '/pos', group: 'Go to' },
  { label: 'Customers', path: '/customers', group: 'Go to' },
  { label: 'Quotations', path: '/quotations', group: 'Go to' },
  { label: 'Sales invoices', path: '/invoices', group: 'Go to' },
  { label: 'Recurring / subscription invoices', path: '/recurring-invoices', group: 'Go to' },
  { label: 'Delivery notes', path: '/delivery-notes', group: 'Go to' },
  { label: 'Credit notes', path: '/credit-notes', group: 'Go to' },
  { label: 'Suppliers', path: '/suppliers', group: 'Go to' },
  { label: 'Purchase requisitions', path: '/requisitions', group: 'Go to' },
  { label: 'Purchase orders', path: '/purchase-orders', group: 'Go to' },
  { label: 'Purchase invoices', path: '/purchases', group: 'Go to' },
  { label: 'Debit notes', path: '/debit-notes', group: 'Go to' },
  { label: 'Recurring expenses', path: '/recurring-expenses', group: 'Go to' },
  { label: 'Inventory items', path: '/inventory', group: 'Go to' },
  { label: 'Warehouses & stock transfers', path: '/warehouses', group: 'Go to' },
  { label: 'Stock adjustments', path: '/stock-adjustments', group: 'Go to' },
  { label: 'Manufacturing', path: '/manufacturing', group: 'Go to' },
  { label: 'Projects & job costing', path: '/projects', group: 'Go to' },
  { label: 'Budgets vs actuals', path: '/budgets', group: 'Go to' },
  { label: 'Prepaid expenses', path: '/prepaid-expenses', group: 'Go to' },
  { label: 'Leases & rent', path: '/leases', group: 'Go to' },
  { label: 'Expense claims', path: '/expense-claims', group: 'Go to' },
  { label: 'Fixed assets', path: '/fixed-assets', group: 'Go to' },
  { label: 'Departments', path: '/departments', group: 'Go to' },
  { label: 'Employees', path: '/employees', group: 'Go to' },
  { label: 'Payroll', path: '/payroll', group: 'Go to' },
  { label: 'Business analytics', path: '/analytics', group: 'Go to' },
  { label: 'Cash forecast', path: '/cash-forecast', group: 'Go to' },
  { label: 'Currencies & exchange rates', path: '/currencies', group: 'Go to' },
  { label: 'Statements of account', path: '/statements', group: 'Go to' },
  { label: 'Year-end close', path: '/year-end', group: 'Go to' },
  { label: 'Audit log', path: '/audit-log', group: 'Go to' },
  { label: 'Team & roles', path: '/team', group: 'Go to' },
  { label: 'Reports', path: '/reports', group: 'Go to' },
  { label: 'VAT return (ZATCA)', path: '/reports', group: 'Go to' },
  { label: 'Settings', path: '/settings', group: 'Go to' },
  // Quick actions
  { label: 'New sales invoice', path: '/invoices/new', group: 'Create' },
  { label: 'New quotation', path: '/quotations/new', group: 'Create' },
  { label: 'New purchase order', path: '/purchase-orders/new', group: 'Create' },
  { label: 'New purchase invoice', path: '/purchases/new', group: 'Create' },
  { label: 'New fixed asset', path: '/fixed-assets/new', group: 'Create' },
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

  const { invoices, purchases, quotations, creditNotes, customers, suppliers, inventoryItems, settings } = useStore()
  const sym = settings.company.currencySymbol

  // The tax-return entry's wording follows the company's configured tax
  // system, same rule as the Reports page picker.
  const taxReportLabel = !settings.tax?.enabled ? null
    : settings.tax?.system === 'sales_tax' ? 'Sales tax report'
    : settings.tax?.country === 'SA' ? 'VAT return (ZATCA)'
    : 'VAT / GST return'
  const COMMANDS_LIST = useMemo(
    () => COMMANDS.filter((c) => c.label !== 'VAT return (ZATCA)' || taxReportLabel).map((c) => (c.label === 'VAT return (ZATCA)' ? { ...c, label: taxReportLabel } : c)),
    [taxReportLabel]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COMMANDS_LIST
    const nav = COMMANDS_LIST.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
    if (q.length < 2) return nav

    // Live document search across the books. Amounts match on their digits,
    // so "1437" finds the $1,437.50 invoice.
    const qDigits = q.replace(/[^0-9.]/g, '')
    const amtHit = (n) => qDigits.length >= 3 && String(Math.round((n || 0) * 100) / 100).includes(qDigits)
    const txtHit = (...fields) => fields.some((f) => (f || '').toLowerCase().includes(q))
    const take = (arr, n = 5) => arr.slice(0, n)

    const docs = [
      ...take(invoices.filter((i) => txtHit(i.number, i.customerName) || amtHit(i.total))).map((i) => ({
        label: `${i.number} · ${i.customerName || '—'} · ${fmtMoney(i.total, sym)}`, path: `/invoices/${i.id}`, group: 'Invoices', raw: true,
      })),
      ...take(quotations.filter((d) => txtHit(d.number, d.customerName) || amtHit(d.total))).map((d) => ({
        label: `${d.number} · ${d.customerName || '—'} · ${fmtMoney(d.total, sym)}`, path: '/quotations', group: 'Quotations', raw: true,
      })),
      ...take(purchases.filter((p) => txtHit(p.number, p.supplierName) || amtHit(p.total))).map((p) => ({
        label: `${p.number} · ${p.supplierName || '—'} · ${fmtMoney(p.total, sym)}`, path: '/purchases', group: 'Purchases', raw: true,
      })),
      ...take(creditNotes.filter((c) => txtHit(c.number, c.customerName) || amtHit(c.total)), 3).map((c) => ({
        label: `${c.number} · ${c.customerName || '—'} · ${fmtMoney(c.total, sym)}`, path: '/credit-notes', group: 'Credit Notes', raw: true,
      })),
      ...take(customers.filter((c) => txtHit(c.name, c.email, c.phone))).map((c) => ({
        label: c.name, path: '/customers', group: 'Customers', raw: true,
      })),
      ...take(suppliers.filter((s) => txtHit(s.name, s.email)), 3).map((s) => ({
        label: s.name, path: '/suppliers', group: 'Suppliers', raw: true,
      })),
      ...take(inventoryItems.filter((it) => txtHit(it.name, it.code)), 3).map((it) => ({
        label: `${it.code ? it.code + ' · ' : ''}${it.name}`, path: '/inventory', group: 'Items', raw: true,
      })),
    ]
    return [...docs, ...nav]
  }, [query, invoices, purchases, quotations, creditNotes, customers, suppliers, inventoryItems, sym, COMMANDS_LIST])

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
          <Search size={17} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Search modules or actions…')}
            className="flex-1 bg-transparent outline-none text-[15px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <kbd className="hidden sm:inline-block text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/[0.05] border border-slate-200/90 dark:border-surface-700 rounded-md px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2 px-2">
          {results.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('No matches')}</p>}
          {results.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup
            lastGroup = cmd.group
            return (
              <div key={cmd.path + cmd.label}>
                {showGroup && <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{t(cmd.group)}</p>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(cmd)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-start rounded-lg transition-colors duration-100 ${
                    active === i
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/[0.12] dark:text-brand-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span className="truncate">{cmd.raw ? cmd.label : t(cmd.label)}</span>
                  {active === i && <CornerDownLeft size={14} className="flex-shrink-0 opacity-70 rtl:-scale-x-100" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 dark:border-surface-750 bg-slate-50/60 dark:bg-surface-900/40 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5"><kbd className="font-sans font-semibold bg-white dark:bg-white/[0.06] border border-slate-200/90 dark:border-surface-700 rounded px-1 py-px">↑↓</kbd> {t('Navigate')}</span>
          <span className="inline-flex items-center gap-1.5"><kbd className="font-sans font-semibold bg-white dark:bg-white/[0.06] border border-slate-200/90 dark:border-surface-700 rounded px-1 py-px">↵</kbd> {t('Open')}</span>
        </div>
      </div>
    </div>
  )
}
