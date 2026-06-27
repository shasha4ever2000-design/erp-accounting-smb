import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import { useAuth } from '../auth'
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
  PieChart, History,
} from 'lucide-react'

const NAV = [
  { label: 'Dashboard',          path: '/',                icon: LayoutDashboard },
  { label: 'Chart of Accounts',  path: '/accounts',        icon: BookOpen },

  { divider: 'Cash & Banking' },
  { label: 'Cash & Bank Accounts', path: '/bank-accounts', icon: Wallet },
  { label: 'Bank Transactions',    path: '/banking',        icon: Landmark },
  { label: 'Bank Reconciliation',  path: '/reconciliation', icon: CheckSquare },
  { label: 'Journal Entries',      path: '/journals',       icon: ClipboardList },

  { divider: 'Sales' },
  { label: 'Sales Pipeline (CRM)',path: '/pipeline',        icon: Filter },
  { label: 'Point of Sale',      path: '/pos',              icon: Store },
  { label: 'Customers',          path: '/customers',        icon: Users },
  { label: 'Quotations',         path: '/quotations',       icon: FileCheck },
  { label: 'Sales Invoices',     path: '/invoices',         icon: FileText },
  { label: 'Recurring Invoices', path: '/recurring-invoices', icon: Repeat },
  { label: 'Delivery Notes',     path: '/delivery-notes',   icon: TruckIcon },
  { label: 'Credit Notes',       path: '/credit-notes',     icon: FileMinus },

  { divider: 'Purchases' },
  { label: 'Suppliers',          path: '/suppliers',        icon: Building2 },
  { label: 'Purchase Orders',    path: '/purchase-orders',  icon: Truck },
  { label: 'Purchase Invoices',  path: '/purchases',        icon: ShoppingCart },
  { label: 'Debit Notes',        path: '/debit-notes',      icon: FilePlus },

  { divider: 'Inventory & Production' },
  { label: 'Inventory Items',    path: '/inventory',        icon: Package },
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
  { label: 'Currencies',         path: '/currencies',        icon: Coins },
  { label: 'Statements',         path: '/statements',        icon: FileText },
  { label: 'Reports',            path: '/reports',           icon: BarChart3 },
  { label: 'Audit Log',          path: '/audit-log',         icon: History },
  { label: 'Settings',           path: '/settings',          icon: Settings },
]

export default function Layout({ children }) {
  const company = useStore((s) => s.settings.company)
  const theme = useStore((s) => s.settings.theme || 'light')
  const setTheme = useStore((s) => s.setTheme)
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
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className={`w-60 bg-slate-900 dark:bg-slate-950 border-r border-transparent dark:border-slate-800 flex flex-col flex-shrink-0 overflow-y-auto fixed lg:static inset-y-0 left-0 z-40 transform transition-transform lg:transform-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Logo / Company */}
        <div className="px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate">{company.name}</p>
              <p className="text-slate-400 text-xs">Accounting ERP</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2">
          {NAV.map((item, i) => {
            if (item.divider) {
              return (
                <p key={i} className="px-5 pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {item.divider}
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
                  `flex items-center gap-3 mx-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white font-medium'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="flex-1 truncate text-[13px]">{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-700/60">
          <p className="text-[10px] text-slate-500 text-center">ERP Accounting v3.0</p>
        </div>
      </aside>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="no-print h-14 flex-shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-gray-100 dark:border-slate-800 flex items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-500 dark:text-slate-400">
            <Menu size={20} />
          </button>
          <button
            onClick={openPalette}
            className="flex items-center gap-2 text-sm text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:border-gray-300 dark:hover:border-slate-600 transition-colors w-full max-w-xs"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden sm:inline text-[10px] border border-gray-200 dark:border-slate-600 rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <CompanySwitcher />
          <div className="flex-1" />
          <InstallButton />
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <UserMenu />
        </header>

        {/* Storage-full warning */}
        {storageWarn && (
          <div className="no-print bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between gap-3">
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

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:border-gray-300 dark:hover:border-slate-600 max-w-[200px]">
        <Building2 size={15} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
        <span className="truncate">{current?.name || 'Company'}</span>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-100 dark:border-slate-700 z-50 py-1.5">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Companies</p>
          <div className="max-h-60 overflow-y-auto">
            {companies.map((c) => (
              <button key={c.id} onClick={() => switchCompany(c.id)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">
                <span className="truncate">{c.name}</span>
                {c.id === currentCompanyId && <Check size={15} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 dark:border-slate-700 mt-1 pt-1">
            {creating ? (
              <div className="px-3 py-2 flex gap-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && createCompany(name.trim())} placeholder="Company name" className="flex-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => name.trim() && createCompany(name.trim())} className="text-sm text-blue-600 font-medium">Add</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"><Plus size={15} /> New company</button>
            )}
            <button onClick={() => exitToCompanies()} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700"><Building2 size={15} /> Manage companies…</button>
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
  const initials = (user?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center">
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-100 dark:border-slate-700 z-50 py-1.5">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-slate-700">
            <p className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{user?.email}</p>
          </div>
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"><LogOut size={15} /> Log out</button>
        </div>
      )}
    </div>
  )
}
