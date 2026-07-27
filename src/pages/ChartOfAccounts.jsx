import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { accountTypeLabel, accountTypeColor } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState } from '../components/UI'
import { buildTree, flattenGroups, groupUsage, TYPE_ORDER, COST_OF_SALES } from '../utils/accountTree'
import { CONTROL_KINDS } from '../utils/controlAccounts'
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown, AlertTriangle, RotateCcw } from 'lucide-react'

const TYPES = TYPE_ORDER
const SUBTYPES = {
  asset:     ['current', 'non_current'],
  liability: ['current', 'non_current'],
  equity:    ['equity'],
  revenue:   ['revenue'],
  expense:   ['expense'],
}

const emptyForm = { code: '', name: '', type: 'asset', subtype: 'current', description: '', currency: '', groupId: '', controlFor: '' }
const emptyGroup = { name: '', code: '', type: 'asset', parentId: '', role: '' }

const INDENT = ['ps-0', 'ps-5', 'ps-10', 'ps-14', 'ps-20', 'ps-24']
const pad = (d) => INDENT[Math.min(d, INDENT.length - 1)]

export default function ChartOfAccounts() {
  const t = useT()
  const {
    accounts, accountGroups = [], addAccount, updateAccount, deleteAccount,
    addAccountGroup, updateAccountGroup, deleteAccountGroup, restoreDefaultGroups,
    currencies, settings,
  } = useStore()
  const base = settings.company.currency

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const [groupModal, setGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [gForm, setGForm] = useState(emptyGroup)
  const [gError, setGError] = useState('')

  const [filter, setFilter] = useState('all')
  const [collapsed, setCollapsed] = useState({})

  const toggle = (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (a) => {
    setEditing(a)
    setForm({
      code: a.code, name: a.name, type: a.type, subtype: a.subtype,
      description: a.description || '', currency: a.currency || '', groupId: a.groupId || '',
      controlFor: a.controlFor || '',
    })
    setModal(true)
  }
  const close = () => setModal(false)

  const handleSave = () => {
    if (!form.code || !form.name) return
    if (editing) updateAccount(editing.id, form)
    else addAccount(form)
    close()
  }

  const handleDelete = (a) => {
    if (a.isSystem) return alert(t('System accounts cannot be deleted.'))
    if (!confirm(t('Delete "{n}"?').replace('{n}', a.name))) return
    // The store enforces this too — see ACCOUNT_IS_SYSTEM in deleteAccount —
    // so this catch is a backstop for the check above, not the only guard.
    try { deleteAccount(a.id) } catch (err) {
      if (String(err.message || err).startsWith('ACCOUNT_IS_SYSTEM')) return alert(t('System accounts cannot be deleted.'))
      throw err
    }
  }

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setGField = (k, v) => { setGForm((f) => ({ ...f, [k]: v })); setGError('') }

  // ─── Groups ──────────────────────────────────────────────────────
  const openNewGroup = (type = 'asset', parentId = '') => {
    setEditingGroup(null)
    setGForm({ ...emptyGroup, type, parentId })
    setGError('')
    setGroupModal(true)
  }

  const openEditGroup = (g) => {
    setEditingGroup(g)
    setGForm({ name: g.name, code: g.code || '', type: g.type, parentId: g.parentId || '', role: g.role || '' })
    setGError('')
    setGroupModal(true)
  }

  const saveGroup = () => {
    try {
      const payload = { ...gForm, parentId: gForm.parentId || null }
      if (editingGroup) updateAccountGroup(editingGroup.id, payload)
      else addAccountGroup(payload)
      setGroupModal(false)
    } catch (e) {
      // The store validates; surface its reason rather than a generic failure.
      setGError(String(e.message || e).replace('GROUP_INVALID:', '').trim())
    }
  }

  const deleteGroup = (g) => {
    const use = groupUsage(accountGroups, accounts, g.id)
    const where = g.parentId ? t('moved up one level') : t('left ungrouped')
    const detail = use.total || use.subgroups
      ? t('{a} account(s) and {g} subgroup(s) will be {w}. Nothing is deleted.')
          .replace('{a}', use.total).replace('{g}', use.subgroups).replace('{w}', where)
      : t('It is empty.')
    if (!confirm(`${t('Delete the group "{n}"?').replace('{n}', g.name)}\n\n${detail}`)) return
    deleteAccountGroup(g.id)
  }

  const handleRestore = () => {
    if (!confirm(t('Put every account back into its default group? Groups you added are kept.'))) return
    restoreDefaultGroups()
  }

  // ─── Rows ────────────────────────────────────────────────────────
  // One flat list per type carrying a depth number: the same approach the
  // reports use, so the chart and the statements indent identically.
  const sections = useMemo(() => {
    const wanted = filter === 'all' ? TYPES : [filter]
    return wanted.map((type) => {
      const tree = buildTree(accountGroups, accounts, type)
      const rows = []
      const walk = (node, depth) => {
        rows.push({ kind: 'group', depth, group: node, count: node.accounts.length })
        if (collapsed[node.id]) return
        node.accounts.forEach((a) => rows.push({ kind: 'account', depth: depth + 1, account: a }))
        node.groups.forEach((c) => walk(c, depth + 1))
      }
      tree.groups.forEach((g) => walk(g, 0))
      if (tree.ungrouped.length) {
        rows.push({ kind: 'ungrouped', depth: 0, count: tree.ungrouped.length })
        tree.ungrouped.forEach((a) => rows.push({ kind: 'account', depth: 1, account: a }))
      }
      return { type, rows, total: accounts.filter((a) => a.type === type).length }
    }).filter((s) => s.total > 0 || s.rows.length > 0)
  }, [accounts, accountGroups, filter, collapsed])

  // Parent options for the group modal: same type only, and never the group
  // itself or anything below it — that would make it its own ancestor.
  const parentOptions = useMemo(() => {
    const rows = flattenGroups(accountGroups, gForm.type)
    if (!editingGroup) return rows
    const banned = new Set([editingGroup.id])
    let grew = true
    while (grew) {
      grew = false
      accountGroups.forEach((g) => {
        if (!banned.has(g.id) && banned.has(g.parentId)) { banned.add(g.id); grew = true }
      })
    }
    return rows.filter((r) => !banned.has(r.id))
  }, [accountGroups, gForm.type, editingGroup])

  const groupOptionsForAccount = useMemo(
    () => flattenGroups(accountGroups, form.type),
    [accountGroups, form.type]
  )

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        subtitle="Your accounting structure, grouped the way your statements read"
        action={
          <>
            <Btn variant="secondary" onClick={handleRestore} title={t('Restore the default grouping')}>
              <RotateCcw size={15} /> {t('Reset grouping')}
            </Btn>
            <Btn variant="secondary" onClick={() => openNewGroup(filter === 'all' ? 'asset' : filter)}>
              <FolderTree size={15} /> {t('New Group')}
            </Btn>
            <Btn onClick={openNew}><Plus size={15} /> {t('New Account')}</Btn>
          </>
        }
      />

      {/* Filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {['all', ...TYPES].map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${
              filter === k ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'
            }`}
          >
            {k === 'all' ? t('All Accounts') : accountTypeLabel(k)}
          </button>
        ))}
      </div>

      {sections.length === 0 && (
        <EmptyState icon="📒" title="No accounts" desc="Add your first account to get started." action={<Btn onClick={openNew}><Plus size={14} />{t('Add Account')}</Btn>} />
      )}

      <div className="space-y-4">
        {sections.map(({ type, rows, total }) => (
          <Card key={type}>
            <div className="px-5 py-3 border-b border-gray-100 dark:border-surface-750 flex items-center gap-2">
              <Badge className={accountTypeColor(type)}>{accountTypeLabel(type)}</Badge>
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {t('{n} accounts').replace('{n}', total)}
              </span>
              <button onClick={() => openNewGroup(type)}
                className="ms-auto text-xs text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> {t('Group')}
              </button>
            </div>

            <div className="divide-y divide-gray-50 dark:divide-surface-800">
              {rows.map((row, i) => {
                if (row.kind === 'group') {
                  const g = row.group
                  const isOpen = !collapsed[g.id]
                  return (
                    <div key={g.id} className={`flex items-center gap-2 px-5 py-2 bg-gray-50/60 dark:bg-surface-800/40 ${pad(row.depth)}`}>
                      <button onClick={() => toggle(g.id)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      {g.code && <span className="font-mono text-[11px] text-gray-400 dark:text-slate-500">{g.code}</span>}
                      <span className={`font-semibold ${row.depth === 0 ? 'text-gray-800 dark:text-slate-100 text-sm' : 'text-gray-600 dark:text-slate-300 text-[13px]'}`}>
                        {t(g.name)}
                      </span>
                      {g.role === COST_OF_SALES && (
                        <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-1.5 py-0.5 rounded">
                          {t('gross profit')}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 dark:text-slate-500">
                        {row.count > 0 ? row.count : ''}
                      </span>
                      <div className="ms-auto flex items-center gap-1">
                        <button onClick={() => openNewGroup(type, g.id)} title={t('Add a subgroup')}
                          className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                          <Plus size={13} />
                        </button>
                        <button onClick={() => openEditGroup(g)} title={t('Edit group')}
                          className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteGroup(g)} title={t('Delete group')}
                          className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                }

                if (row.kind === 'ungrouped') {
                  return (
                    <div key="__ungrouped" className="flex items-center gap-2 px-5 py-2 bg-warning-50/60 dark:bg-warning-500/[0.07]">
                      <AlertTriangle size={13} className="text-warning-600 dark:text-warning-400" />
                      <span className="font-semibold text-[13px] text-warning-800 dark:text-warning-300">{t('Ungrouped')}</span>
                      <span className="text-[11px] text-warning-700/70 dark:text-warning-400/70">
                        {t('{n} account(s) — still counted in every total').replace('{n}', row.count)}
                      </span>
                    </div>
                  )
                }

                const a = row.account
                return (
                  <div key={a.id} className={`flex items-center gap-3 px-5 py-2 hover:bg-gray-50/70 dark:hover:bg-surface-800/50 transition-colors ${pad(row.depth)}`}>
                    <span className="font-mono font-semibold text-gray-700 dark:text-slate-200 text-[13px] w-16 flex-shrink-0">{a.code}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-800 dark:text-slate-100 text-sm">{a.name}</span>
                      {a.currency && a.currency !== base && <span className="ms-2 text-[10px] bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300 px-1.5 py-0.5 rounded font-semibold">{a.currency}</span>}
                      {a.isSystem && <span className="ms-2 text-[10px] bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400 px-1.5 py-0.5 rounded">{t('system')}</span>}
                      {a.controlFor && <span className="ms-2 text-[10px] bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 px-1.5 py-0.5 rounded font-medium">{t(CONTROL_KINDS[a.controlFor]?.label || 'control')}</span>}
                      {a.description && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 truncate">{a.description}</p>}
                    </div>
                    <span className="text-gray-400 dark:text-slate-500 capitalize text-xs hidden sm:inline">{a.subtype?.replace('_', ' ')}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(a)} className="p-1 rounded text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                        <Pencil size={13} />
                      </button>
                      {!a.isSystem && (
                        <button onClick={() => handleDelete(a)} className="p-1 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>

      {/* Account modal */}
      <Modal open={modal} onClose={close} title={editing ? 'Edit Account' : 'New Account'}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Account Code" value={form.code} onChange={(e) => setField('code', e.target.value)} placeholder="e.g. 1001" />
            <Select label="Type" value={form.type} onChange={(e) => {
              // Changing type invalidates the chosen group, which belongs to
              // the old type — clear it rather than save a mismatch.
              setForm((f) => ({ ...f, type: e.target.value, subtype: SUBTYPES[e.target.value][0], groupId: '', controlFor: '' }))
            }}>
              {TYPES.map((k) => <option key={k} value={k}>{accountTypeLabel(k)}</option>)}
            </Select>
          </div>
          <Input label="Account Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Cash on Hand" />
          <Select label={t('Group')} value={form.groupId} onChange={(e) => setField('groupId', e.target.value)}>
            <option value="">{t('— Ungrouped —')}</option>
            {groupOptionsForAccount.map((g) => (
              <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>
            ))}
          </Select>
          <Select label="Subtype" value={form.subtype} onChange={(e) => setField('subtype', e.target.value)}>
            {(SUBTYPES[form.type] || []).map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </Select>
          {(form.type === 'asset' || form.type === 'liability') && (
            <>
              <Select label={t('Use as a control account for')} value={form.controlFor || ''}
                onChange={(e) => setField('controlFor', e.target.value)}>
                <option value="">{t('— Ordinary account —')}</option>
                {form.type === 'asset' && <option value="customers">{t('Receivables')}</option>}
                {form.type === 'asset' && <option value="inventoryItems">{t('Inventory')}</option>}
                {form.type === 'liability' && <option value="suppliers">{t('Payables')}</option>}
              </Select>
              <p className="text-xs text-gray-400 dark:text-slate-500 -mt-2">
                {t('A control account holds balances for a group of customers, suppliers or items — so you can show, say, local and export receivables as separate lines on the balance sheet.')}
              </p>
            </>
          )}
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

      {/* Group modal */}
      <Modal open={groupModal} onClose={() => setGroupModal(false)} title={editingGroup ? 'Edit Group' : 'New Group'}>
        <div className="space-y-4">
          <Input label="Group Name *" value={gForm.name} onChange={(e) => setGField('name', e.target.value)} placeholder="e.g. Current Assets" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Code (optional)" value={gForm.code} onChange={(e) => setGField('code', e.target.value)} placeholder="e.g. 1000" />
            <Select label="Type" value={gForm.type} disabled={!!editingGroup}
              onChange={(e) => setGForm((f) => ({ ...f, type: e.target.value, parentId: '' }))}>
              {TYPES.map((k) => <option key={k} value={k}>{accountTypeLabel(k)}</option>)}
            </Select>
          </div>
          {editingGroup && (
            <p className="text-xs text-gray-400 dark:text-slate-500 -mt-2">
              {t('A group\'s type cannot change — the accounts inside it would end up on the wrong statement.')}
            </p>
          )}
          <Select label={t('Inside')} value={gForm.parentId} onChange={(e) => setGField('parentId', e.target.value)}>
            <option value="">{t('— Top level —')}</option>
            {parentOptions.map((g) => (
              <option key={g.id} value={g.id}>{' '.repeat(g.depth * 3)}{g.name}</option>
            ))}
          </Select>
          {gForm.type === 'expense' && (
            <label className="flex items-start gap-2.5 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 mt-0.5 rounded border-gray-300 dark:border-slate-600"
                checked={gForm.role === COST_OF_SALES}
                onChange={(e) => setGField('role', e.target.checked ? COST_OF_SALES : '')} />
              <span className="text-gray-700 dark:text-slate-200">
                {t('This is cost of sales')}
                <span className="block text-xs text-gray-400 dark:text-slate-500">
                  {t('Subtracted from revenue to show gross profit on the income statement.')}
                </span>
              </span>
            </label>
          )}
          {gError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {gError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={() => setGroupModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={saveGroup}>{editingGroup ? 'Save Changes' : 'Create Group'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
