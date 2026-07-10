import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { useI18n, useT } from '../i18n'
import AIAssistant from './AIAssistant'
import CommandPalette from './CommandPalette'
import InstallButton from './InstallButton'
import ErrorBoundary from './ErrorBoundary'
import {
  LayoutDashboard, BookOpen, Users, FileText, ShoppingCart,
  Package, Landmark, BarChart3, Settings, Building2, TrendingUp,
  ClipboardList, FileCheck, FileMinus, FilePlus, Truck,
  UserCheck, Building, DollarSign, Wrench, Sliders, Wallet,
  Home, Clock, Receipt, Factory, Briefcase, Target, Search,
  Sun, Moon, Menu, Repeat, Warehouse, Filter, Store, CheckSquare,
  Truck as TruckIcon, Coins, ChevronDown, LogOut, Check, Plus,
  PieChart, History, ClipboardCheck, UsersRound, Globe, ArrowLeftRight, BellRing, Layers,
} from 'lucide-react'

const NAV = [
  { label: 'Dashboard',          path: '/',                icon: LayoutDashboard },
  { label: 'Chart of Accounts',  path: '/accounts',        icon: BookOpen },

  { divider: 'Cash & Banking' },
  { label: 'Cash & Bank Accounts', path: '/bank-accounts', icon: Wallet },
  { label: 'Cash Flow',            path: '/cash-flow',      icon: ArrowLeftRight },
  { label: 'Bank Transactions',    path: '/banking',        icon: Landmark },
  { label: 'Bank Reconciliation',  path: '/reconciliation', icon: CheckSquare },
  { label: 'Journal Entries',      path: '/journals',       icon: ClipboardList },
  { label: 'Recurring Journals',   path: '/recurring-journals', icon: Repeat },

  { divider: 'Sales' },
  { label: 'Sales Pipeline (CRM)',path: '/pipeline',        icon: Filter },
  { label: 'Point of Sale',      path: '/pos',              icon: Store },
  { label: 'Customers',          path: '/customers',        icon: Users },
  { label: 'Quotations',         path: '/quotations',       icon: FileCheck },
  { label: 'Sales Invoices',     path: '/invoices',         icon: FileText },
  { label: 'Recurring Invoices', path: '/recurring-invoices', icon: Repeat },
  { label: 'Payment Reminders',  path: '/payment-reminders', icon: BellRing },
  { label: 'Delivery Notes',     path: '/delivery-notes',   icon: TruckIcon },
  { label: 'Credit Notes',       path: '/credit-notes',     icon: FileMinus },

  { divider: 'Purchases' },
  { label: 'Requisitions',       path: '/requisitions',     icon: ClipboardCheck },
  { label: 'Suppliers',          path: '/suppliers',        icon: Building2 },
  { label: 'Purchase Orders',    path: '/purchase-orders',  icon: Truck },
  { label: 'Purchase Invoices',  path: '/purchases',        icon: ShoppingCart },
  { label: 'Debit Notes',        path: '/debit-notes',      icon: FilePlus },

  { divider: 'Inventory & Production' },
  { label: 'Inventory Items',    path: '/inventory',        icon: Package },
  { label: 'Inventory Control',  path: '/inventory-control',icon: BarChart3 },
  { label: 'Warehouses',         path: '/warehouses',       icon: Warehouse },
  { label: 'Stock Adjustments',  path: '/stock-adjustments',icon: Sliders },
  { label: 'Manufacturing',      path: '/manufacturing',    icon: Factory },

  { divider: 'Projects & Financials' },
  { label: 'Projects',           path: '/projects',         icon: Briefcase },
  { label: 'Budgets',            path: '/budgets',          icon: Target },
  { label: 'Prepaid Expenses',   path: '/prepaid-expenses', icon: Clock },
  { label: 'Leases & Rent',      path: '/leases',           icon: Home },
  { label: 'Expense Claims',     path: '/expense-claims',   icon: Receipt },

  { divider: 'Fixed Assets' },
  { label: 'Fixed Assets',       path: '/fixed-assets',     icon: Wrench },

  { divider: 'HR & Payroll' },
  { label: 'Departments',        path: '/departments',       icon: Building },
  { label: 'Employees',          path: '/employees',         icon: UserCheck },
  { label: 'Payroll',            path: '/payroll',           icon: DollarSign },

  { divider: 'Reports & System' },
  { label: 'Analytics',          path: '/analytics',         icon: PieChart },
  { label: 'Group Consolidation',path: '/consolidation',     icon: Layers },
  { label: 'Currencies',         path: '/currencies',        icon: Coins },
  { label: 'FX Revaluation',     path: '/revaluation',       icon: ArrowLeftRight },
  { label: 'Statements',         path: '/statements',        icon: FileText },
  { label: 'Reports',            path: '/reports',           icon: BarChart3 },
  { label: 'Audit Log',          path: '/audit-log',         icon: History },
  { label: 'Team & Roles',       path: '/team',              icon: UsersRound },
  { label: 'Settings',           path: '/settings',          icon: Settings },
]

export default function Layout({ children }) {
  const company = useStore((s) => s.settings.company)
  const theme = useStore((s) => s.settings.theme || 'light')
  const setTheme = useStore((s) => s.setTheme)
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const toggleLang = useI18n((s) => s.toggle)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [storageWarn, setStorageWarn] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onErr = () => setStorageWarn(true)
    window.addEventListener('erp-storage-error', onErr)
    return () => window.removeEventListener('erp-storage-error', onErr)
  }, [])

  const openPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
  }

  return (
    <div className="flex h-screen bg-transparent overflow-hidden">
      {/* Sidebar */}
      <aside className={`w-60 bg-surface-925 border-e border-white/[0.06] flex flex-col flex-shrink-0 overflow-y-auto fixed lg:static inset-y-0 start-0 z-40 transform transition-transform duration-200 ease-spring lg:transform-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 rtl:translate-x-full rtl:lg:translate-x-0'}`}>
        {/* Logo / Company */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-xl">
            <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-accent-600 rounded-[10px] flex items-center justify-center flex-shrink-0 shadow-glow ring-1 ring-white/20">
              <TrendingUp size={17} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate tracking-snug">{company.name}</p>
              <p className="text-slate-500 text-[10.5px] font-medium tracking-[0.08em] uppercase mt-0.5">{t('Accounting ERP')}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 pb-3">
          {NAV.map((item, i) => {
            if (item.divider) {
              return (
                <p key={i} className="px-5 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500/90">
                  {t(item.divider)}
                </p>
              )
            }
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 mx-2.5 px-3 py-[7px] my-px rounded-lg text-sm transition-colors duration-100 ${
                    isActive
                      ? 'bg-white/[0.07] text-white font-semibold ring-1 ring-inset ring-white/[0.06]'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute inset-y-[7px] start-0 w-[3px] rounded-full bg-gradient-to-b from-brand-400 to-accent-500" />}
                    <Icon size={16} strokeWidth={isActive ? 2.25 : 2} className={`flex-shrink-0 transition-colors ${isActive ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    <span className="flex-1 truncate text-[13px]">{t(item.label)}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.06]">
          <p className="text-[10px] font-medium tracking-[0.08em] text-slate-600 text-center">ERP ACCOUNTING v3.0</p>
        </div>
      </aside>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && <div className="fixed inset-0 bg-surface-950/50 backdrop-blur-[2px] z-30 lg:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="no-print h-16 flex-shrink-0 bg-white/70 dark:bg-surface-900/70 backdrop-blur-xl border-b border-slate-200/70 dark:border-surface-800 flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-20">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ms-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] transition-colors">
            <Menu size={20} />
          </button>
          <button
            onClick={openPalette}
            className="group flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500 bg-slate-100/70 dark:bg-surface-800/80 border border-slate-200/80 dark:border-surface-700 rounded-lg px-3 py-1.5 hover:border-slate-300 hover:bg-white dark:hover:border-surface-600 dark:hover:bg-surface-800 hover:shadow-xs transition-all w-full max-w-xs"
          >
            <Search size={15} className="group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
            <span className="flex-1 text-start">{t('Search…')}</span>
            <kbd className="hidden sm:inline text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-white dark:bg-surface-900 border border-slate-200 dark:border-surface-600 rounded-md px-1.5 py-0.5 shadow-xs dark:shadow-none">⌘K</kbd>
          </button>
          <CompanySwitcher />
          <div className="flex-1" />
          <InstallButton />
          <button
            onClick={toggleLang}
            className="flex items-center gap-1.5 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 transition-colors text-sm font-medium"
            title={lang === 'ar' ? 'English' : 'العربية'}
          >
            <Globe size={18} /><span className="hidden sm:inline">{lang === 'ar' ? 'EN' : 'ع'}</span>
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-900/[0.05] hover:text-slate-700 dark:hover:bg-white/[0.06] dark:hover:text-slate-200 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <UserMenu />
        </header>

        {/* Storage-full warning */}
        {storageWarn && (
          <div className="no-print bg-warning-50 dark:bg-warning-900/30 text-warning-800 dark:text-warning-200 border-b border-warning-200/70 dark:border-warning-800/50 text-sm px-4 py-2 flex items-center justify-between gap-3">
            <span>⚠️ Your browser storage is full — recent changes may not be saved. Open <strong>Settings → Backup</strong> to download your data, then free up space.</span>
            <button onClick={() => setStorageWarn(false)} className="font-bold px-2">✕</button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full p-6 lg:p-8">
            <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Command palette + AI Assistant */}
      <CommandPalette />
      <AIAssistant />
    </div>
  )
}

function useOutside(onClose) {
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return ref
}

function CompanySwitcher() {
  const companies = useAuth((s) => s.companies)
  const currentCompanyId = useAuth((s) => s.currentCompanyId)
  const switchCompany = useAuth((s) => s.switchCompany)
  const createCompany = useAuth((s) => s.createCompany)
  const exitToCompanies = useAuth((s) => s.exitToCompanies)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const ref = useOutside(() => setOpen(false))
  const current = companies.find((c) => c.id === currentCompanyId)
  const t = useT()

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100/70 dark:bg-surface-800/80 border border-slate-200/80 dark:border-surface-700 rounded-lg px-3 py-1.5 hover:border-slate-300 hover:bg-white dark:hover:border-surface-600 dark:hover:bg-surface-800 hover:shadow-xs transition-all max-w-[200px]">
        <Building2 size={15} className="text-brand-600 dark:text-brand-400 flex-shrink-0" />
        <span className="truncate">{current?.name || 'Company'}</span>
        <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute start-0 mt-1.5 w-64 bg-white dark:bg-surface-850 rounded-xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 border border-slate-100 dark:border-surface-750 z-50 py-1.5 animate-slide-down">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">{t('Companies')}</p>
          <div className="max-h-60 overflow-y-auto">
            {companies.map((c) => (
              <button key={c.id} onClick={() => switchCompany(c.id)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
                <span className="truncate">{c.name}</span>
                {c.id === currentCompanyId && <Check size={15} className="text-brand-600 dark:text-brand-400 flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 dark:border-surface-750 mt-1 pt-1">
            {creating ? (
              <div className="px-3 py-2 flex gap-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && createCompany(name.trim())} placeholder="Company name" className="flex-1 min-w-0 border border-slate-300 dark:border-surface-600 dark:bg-surface-800 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15" />
                <button onClick={() => name.trim() && createCompany(name.trim())} className="text-sm text-brand-600 dark:text-brand-400 font-semibold hover:text-brand-700 dark:hover:text-brand-300 transition-colors">Add</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"><Plus size={15} /> {t('New company')}</button>
            )}
            <button onClick={() => exitToCompanies()} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"><Building2 size={15} /> {t('Manage companies…')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const logout = useAuth((s) => s.logout)
  const user = useAuth((s) => s.users.find((u) => u.id === s.currentUserId))
  const [open, setOpen] = useState(false)
  const ref = useOutside(() => setOpen(false))
  const t = useT()
  const initials = (user?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-600 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white/80 dark:ring-surface-700 shadow-xs hover:shadow-glow transition-shadow duration-200">
        {initials}
      </button>
      {open && (
        <div className="absolute end-0 mt-1.5 w-56 bg-white dark:bg-surface-850 rounded-xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 border border-slate-100 dark:border-surface-750 z-50 py-1.5 animate-slide-down">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-surface-750">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{user?.name}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{user?.email}</p>
          </div>
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"><LogOut size={15} /> {t('Log out')}</button>
        </div>
      )}
    </div>
  )
}
