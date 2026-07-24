import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { accountTypeLabel, accountTypeColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td } from '../components/UI'
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react'

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense']
const SUBTYPES = {
  asset:     ['current', 'non_current'],
  liability: ['current', 'non_current'],
  equity:    ['equity'],
  revenue:   ['revenue'],
  expense:   ['expense'],
}

const emptyForm = { code: '', name: '', type: 'asset', subtype: 'current', description: '', currency: '' }

export default function ChartOfAccounts() {
  const t = useT()
  const { accounts, addAccount, updateAccount, deleteAccount, currencies, settings } = useStore()
  const base = settings.company.currency
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filter, setFilter] = useState('all')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (a) => { setEditing(a); setForm({ code: a.code, name: a.name, type: a.type, subtype: a.subtype, description: a.description || '', currency: a.currency || '' }); setModal(true) }
  const close = () => setModal(false)

  const handleSave = () => {
    if (!form.code || !form.name) return
    if (editing) updateAccount(editing.id, form)
    else addAccount(form)
    close()
  }

  const handleDelete = (a) => {
    if (a.isSystem) return alert('System accounts cannot be deleted.')
    if (confirm(`Delete "${a.name}"?`)) deleteAccount(a.id)
  }

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const grouped = TYPES.map((type) => ({
    type,
    items: accounts
      .filter((a) => a.type === type && (filter === 'all' || filter === type))
      .sort((a, b) => a.code.localeCompare(b.code)),
  })).filter((g) => g.items.length > 0)

  const typeOrder = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 }

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        subtitle="Manage your accounting structure"
        action={
          <Btn onClick={openNew}>
            <Plus size={15} /> {t('New Account')}
          </Btn>
        }
      />

      {/* Filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {['all', ...TYPES].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
              filter === t ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'
            }`}
          >
            {t === 'all' ? 'All Accounts' : accountTypeLabel(t)}
          </button>
        ))}
      </div>

      {/* Account Groups */}
      {grouped.length === 0 && (
        <EmptyState icon="📒" title="No accounts" desc="Add your first account to get started." action={<Btn onClick={openNew}><Plus size={14}/>{t('Add Account')}</Btn>} />
      )}

      <div className="space-y-4">
        {grouped.map(({ type, items }) => (
          <Card key={type}>
            <div className={`px-5 py-3 border-b border-gray-100 dark:border-surface-750 flex items-center gap-2`}>
              <Badge className={accountTypeColor(type)}>{accountTypeLabel(type)}</Badge>
              <span className="text-xs text-gray-400 dark:text-slate-500">({items.length} accounts)</span>
            </div>
            <Table
              headers={[
                { label: 'Code' },
                { label: 'Account Name' },
                { label: 'Subtype' },
                { label: 'Actions', right: true },
              ]}
            >
              {items.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-mono font-semibold text-gray-800 dark:text-slate-100 w-24">{a.code}</Td>
                  <Td>
                    <span className="font-medium text-gray-800 dark:text-slate-100">{a.name}</span>
                    {a.currency && a.currency !== base && <span className="ml-2 text-[10px] bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300 px-1.5 py-0.5 rounded font-semibold">{a.currency}</span>}
                    {a.isSystem && <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400 px-1.5 py-0.5 rounded">system</span>}
                    {a.description && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{a.description}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400 capitalize text-xs">{a.subtype?.replace('_', ' ')}</Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(a)}>
                        <Pencil size={13} />
                      </Btn>
                      {!a.isSystem && (
                        <Btn size="sm" variant="ghost" onClick={() => handleDelete(a)}>
                          <Trash2 size={13} className="text-red-400" />
                        </Btn>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>

      {/* Modal */}
      <Modal open={modal} onClose={close} title={editing ? 'Edit Account' : 'New Account'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Account Code" value={form.code} onChange={(e) => setField('code', e.target.value)} placeholder="e.g. 1001" />
            <Select label="Type" value={form.type} onChange={(e) => { setField('type', e.target.value); setField('subtype', SUBTYPES[e.target.value][0]) }}>
              {TYPES.map((t) => <option key={t} value={t}>{accountTypeLabel(t)}</option>)}
            </Select>
          </div>
          <Input label="Account Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Cash on Hand" />
          <Select label="Subtype" value={form.subtype} onChange={(e) => setField('subtype', e.target.value)}>
            {(SUBTYPES[form.type] || []).map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </Select>
          <Input label="Description (optional)" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Brief description" />
          <Select label={t('Currency')} value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
            <option value="">{t('Base currency')} ({base})</option>
            {currencies.map((c) => <option key={c.id} value={c.code}>{c.code} — {c.name}</option>)}
          </Select>
          <p className="text-xs text-gray-400 dark:text-slate-500 -mt-2">{t('Set a foreign currency to include this account in FX revaluation.')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Create Account'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
