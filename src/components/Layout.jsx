import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useStore } from '../store'
import AIAssistant from './AIAssistant'
import CommandPalette from './CommandPalette'
import InstallButton from './InstallButton'
import {
  LayoutDashboard, BookOpen, Users, FileText, ShoppingCart,
  Package, Landmark, BarChart3, Settings, Building2, TrendingUp,
  ClipboardList, FileCheck, FileMinus, FilePlus, Truck,
  UserCheck, Building, DollarSign, Wrench, Sliders, Wallet,
  Home, Clock, Receipt, Factory, Briefcase, Target, Search,
  Sun, Moon, Menu, Repeat, Warehouse,
} from 'lucide-react'

const NAV = [
  { label: 'Dashboard',          path: '/',                icon: LayoutDashboard },
  { label: 'Chart of Accounts',  path: '/accounts',        icon: BookOpen },

  { divider: 'Cash & Banking' },
  { label: 'Cash & Bank Accounts', path: '/bank-accounts', icon: Wallet },
  { label: 'Bank Transactions',    path: '/banking',        icon: Landmark },
  { label: 'Journal Entries',      path: '/journals',       icon: ClipboardList },

  { divider: 'Sales' },
  { label: 'Customers',          path: '/customers',        icon: Users },
  { label: 'Quotations',         path: '/quotations',       icon: FileCheck },
  { label: 'Sales Invoices',     path: '/invoices',         icon: FileText },
  { label: 'Recurring Invoices', path: '/recurring-invoices', icon: Repeat },
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
  { label: 'Statements',         path: '/statements',        icon: FileText },
  { label: 'Reports',            path: '/reports',           icon: BarChart3 },
  { label: 'Settings',           path: '/settings',          icon: Settings },
]

export default function Layout({ children }) {
  const company = useStore((s) => s.settings.company)
  const theme = useStore((s) => s.settings.theme || 'light')
  const setTheme = useStore((s) => s.setTheme)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
          <div className="flex-1" />
          <InstallButton />
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="min-h-full p-6 lg:p-8">{children}</div>
        </main>
      </div>

      {/* Command palette + AI Assistant */}
      <CommandPalette />
      <AIAssistant />
    </div>
  )
}
