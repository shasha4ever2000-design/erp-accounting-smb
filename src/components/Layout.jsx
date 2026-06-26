import { NavLink } from 'react-router-dom'
import { useStore } from '../store'
import AIAssistant from './AIAssistant'
import {
  LayoutDashboard, BookOpen, Users, FileText, ShoppingCart,
  Package, Landmark, BarChart3, Settings, Building2, TrendingUp,
  ClipboardList, FileCheck, FileMinus, FilePlus, Truck,
  UserCheck, Building, DollarSign, Wrench, Sliders, Wallet,
  Home, Clock, Receipt, Factory,
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
  { label: 'Credit Notes',       path: '/credit-notes',     icon: FileMinus },

  { divider: 'Purchases' },
  { label: 'Suppliers',          path: '/suppliers',        icon: Building2 },
  { label: 'Purchase Orders',    path: '/purchase-orders',  icon: Truck },
  { label: 'Purchase Invoices',  path: '/purchases',        icon: ShoppingCart },
  { label: 'Debit Notes',        path: '/debit-notes',      icon: FilePlus },

  { divider: 'Inventory & Production' },
  { label: 'Inventory Items',    path: '/inventory',        icon: Package },
  { label: 'Stock Adjustments',  path: '/stock-adjustments',icon: Sliders },
  { label: 'Manufacturing',      path: '/manufacturing',    icon: Factory },

  { divider: 'Financials' },
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
  { label: 'Reports',            path: '/reports',           icon: BarChart3 },
  { label: 'Settings',           path: '/settings',          icon: Settings },
]

export default function Layout({ children }) {
  const company = useStore((s) => s.settings.company)

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-900 flex flex-col flex-shrink-0 overflow-y-auto">
        {/* Logo / Company */}
        <div className="px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
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
        <div className="px-4 py-3 border-t border-slate-700">
          <p className="text-[10px] text-slate-500 text-center">ERP Accounting v2.0</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="min-h-full p-8">{children}</div>
      </main>

      {/* Floating AI Assistant */}
      <AIAssistant />
    </div>
  )
}
