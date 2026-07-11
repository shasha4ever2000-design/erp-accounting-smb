import { useState } from 'react'
import { useAuth } from '../auth'
import { useT } from '../i18n'
import { Building2, Plus, LogOut, Pencil, Trash2, ArrowRight, TrendingUp } from 'lucide-react'

export default function CompanyScreen() {
  const { companies, createCompany, switchCompany, renameCompany, deleteCompany, logout, currentUser, isManager } = useAuth()
  const user = currentUser()
  const manager = isManager()
  const t = useT()
  const [creating, setCreating] = useState(companies.length === 0)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')

  const create = () => {
    if (!name.trim()) return
    createCompany(name.trim()) // reloads into the new company
  }

  const saveRename = (id) => {
    if (editName.trim()) renameCompany(id, editName.trim())
    setEditing(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="h-16 bg-white/85 dark:bg-slate-900/85 backdrop-blur border-b border-gray-200/70 dark:border-slate-800 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-brand-500 to-accent-600 rounded-xl flex items-center justify-center text-white shadow-btn-primary">
            <TrendingUp size={18} strokeWidth={2.25} />
          </div>
          <span className="font-bold tracking-tight text-gray-800 dark:text-slate-100">{t('ERP Accounting')}</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {user && <span className="hidden sm:inline text-sm font-medium text-gray-600 dark:text-slate-300">{user.name}</span>}
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <LogOut size={15} className="rtl:rotate-180" /> {t('Log out')}
          </button>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center p-4 sm:p-6 relative overflow-hidden">
        {/* Subtle backdrop wash */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-[42rem] h-[20rem] rounded-full bg-brand-100/50 dark:bg-brand-900/15 blur-3xl" />
        </div>

        <div className="relative w-full max-w-2xl mt-6 sm:mt-10 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100">{t('Your Companies')}</h1>
              <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">{t('Pick a company to work on, or create a new one. Each company keeps its own books.')}</p>
            </div>
            {!creating && (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-btn-primary transition-all duration-150 active:scale-[.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 flex-shrink-0"
              >
                <Plus size={16} /> {t('New Company')}
              </button>
            )}
          </div>

          {creating && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/70 dark:border-slate-800 shadow-card p-5 sm:p-6 mb-6 animate-scale-in">
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">{t('Company name')}</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
                  placeholder="e.g. Al-Noor Trading Est." className="flex-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 transition-shadow" />
                <div className="flex gap-2">
                  <button onClick={create} className="flex-1 sm:flex-none bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl px-5 py-2.5 text-sm font-semibold shadow-btn-primary transition-all duration-150 active:scale-[.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">{t('Create')}</button>
                  {companies.length > 0 && <button onClick={() => setCreating(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 px-3 py-2.5 text-sm font-medium rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t('Cancel')}</button>}
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-2.5">A fresh chart of accounts and settings are created automatically. You can change everything later in Settings.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {companies.map((c) => (
              <div key={c.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/70 dark:border-slate-800 shadow-card hover:shadow-card-hover hover:border-brand-200 dark:hover:border-slate-700 hover:-translate-y-0.5 transition-all duration-150 p-5 group">
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-50 to-blue-100 dark:from-brand-900/40 dark:to-slate-800 ring-1 ring-brand-100 dark:ring-brand-900/50 flex items-center justify-center">
                    <Building2 size={20} className="text-brand-600 dark:text-brand-400" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => { setEditing(c.id); setEditName(c.name) }} className="text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 p-1.5 rounded-lg hover:bg-brand-50 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:opacity-100"><Pencil size={14} /></button>
                    {manager && <button onClick={() => { if (confirm(`Delete "${c.name}" and ALL its data? This cannot be undone.`)) deleteCompany(c.id) }} className="text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:opacity-100"><Trash2 size={14} /></button>}
                  </div>
                </div>
                {editing === c.id ? (
                  <div className="mt-3 flex gap-2">
                    <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRename(c.id)} className="flex-1 min-w-0 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/20 transition-shadow" />
                    <button onClick={() => saveRename(c.id)} className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-semibold px-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Save</button>
                  </div>
                ) : (
                  <>
                    <h3 className="font-semibold text-gray-900 dark:text-slate-100 mt-3.5 truncate">{c.name}</h3>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Created {new Date(c.createdAt).toLocaleDateString()}</p>
                  </>
                )}
                <button
                  onClick={() => switchCompany(c.id)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-gray-50 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-300 text-gray-700 dark:text-slate-200 border border-gray-200/80 dark:border-slate-700 hover:border-brand-200 dark:hover:border-brand-800 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {t('Open')} <ArrowRight size={15} className="rtl:rotate-180 transition-transform duration-150 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                </button>
              </div>
            ))}

            {!creating && (
              <button
                onClick={() => setCreating(true)}
                className="min-h-[10rem] rounded-2xl border-2 border-dashed border-gray-300 dark:border-slate-700 hover:border-brand-400 dark:hover:border-brand-500 text-gray-400 dark:text-slate-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-900/10 flex flex-col items-center justify-center gap-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
              >
                <span className="w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                  <Plus size={18} />
                </span>
                {t('New Company')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
