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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white"><TrendingUp size={18} /></div>
          <span className="font-bold text-gray-800">ERP Accounting</span>
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-gray-500">{user.name}</span>}
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><LogOut size={15} /> {t('Log out')}</button>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center p-6">
        <div className="w-full max-w-2xl mt-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('Your Companies')}</h1>
              <p className="text-gray-500 text-sm">{t('Pick a company to work on, or create a new one. Each company keeps its own books.')}</p>
            </div>
            {!creating && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium"><Plus size={16} /> {t('New Company')}</button>}
          </div>

          {creating && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('Company name')}</label>
              <div className="flex gap-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()}
                  placeholder="e.g. Al-Noor Trading Est." className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={create} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-medium">{t('Create')}</button>
                {companies.length > 0 && <button onClick={() => setCreating(false)} className="text-gray-500 px-3 text-sm">{t('Cancel')}</button>}
              </div>
              <p className="text-xs text-gray-400 mt-2">A fresh chart of accounts and settings are created automatically. You can change everything later in Settings.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {companies.map((c) => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 group">
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-lg bg-blue-50 flex items-center justify-center"><Building2 size={20} className="text-blue-600" /></div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditing(c.id); setEditName(c.name) }} className="text-gray-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                    {manager && <button onClick={() => { if (confirm(`Delete "${c.name}" and ALL its data? This cannot be undone.`)) deleteCompany(c.id) }} className="text-gray-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>}
                  </div>
                </div>
                {editing === c.id ? (
                  <div className="mt-3 flex gap-2">
                    <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRename(c.id)} className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => saveRename(c.id)} className="text-sm text-blue-600 font-medium">Save</button>
                  </div>
                ) : (
                  <>
                    <h3 className="font-semibold text-gray-800 mt-3">{c.name}</h3>
                    <p className="text-xs text-gray-400">Created {new Date(c.createdAt).toLocaleDateString()}</p>
                  </>
                )}
                <button onClick={() => switchCompany(c.id)} className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors">
                  {t('Open')} <ArrowRight size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
