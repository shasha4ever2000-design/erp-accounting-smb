import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import { controlAccountsFor, defaultFor } from '../utils/controlAccounts'
import { TERM_PRESETS } from '../utils/paymentTerms'
import AttachmentButton from '../components/Attachments'
import { useT } from '../i18n'
import ExportMenu from '../components/ExportMenu'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'

const emptyForm = { name: '', email: '', phone: '', address: '', taxId: '', notes: '', controlAccountId: '', paymentTerms: '', customFields: {} }

export default function Suppliers() {
  const { suppliers, purchases, addSupplier, updateSupplier, deleteSupplier, settings, accounts, setRecordControlAccount } = useStore()
  const controlOptions = controlAccountsFor(accounts, 'suppliers')
  const sym = settings.company.currencySymbol
  const customDefs = settings.customFields?.supplier || []
  const t = useT()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, email: s.email || '', phone: s.phone || '', address: s.address || '', taxId: s.taxId || '', notes: s.notes || '', controlAccountId: s.controlAccountId || '', paymentTerms: typeof s.paymentTerms === 'string' ? s.paymentTerms : '', customFields: s.customFields || {} }); setModal(true) }
  const close = () => setModal(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setCustom = (label, v) => setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [label]: v } }))

  const handleSave = () => {
    if (!form.name.trim()) return
    const { controlAccountId, ...rest } = form
    if (editing) {
      updateSupplier(editing.id, rest)
      // Routed through the store action rather than saved as a plain field: a
      // supplier still owed money takes that balance with them, as a
      // reclassification entry.
      if ((controlAccountId || '') !== (editing.controlAccountId || '')) {
        try {
          const res = setRecordControlAccount('suppliers', editing.id, controlAccountId)
          if (res.moved) alert(t('Moved {a} of outstanding balance to the new control account.').replace('{a}', res.moved.toFixed(2)))
        } catch (err) { alert(String(err.message || err).replace('CONTROL_INVALID:', '').trim()) }
      }
    } else {
      const created = addSupplier(rest)
      if (controlAccountId) {
        const id = created?.id || (useStore.getState().suppliers.slice(-1)[0] || {}).id
        if (id) { try { setRecordControlAccount('suppliers', id, controlAccountId) } catch { /* keeps the default */ } }
      }
    }
    close()
  }

  const handleDelete = (s) => {
    if (confirm(`Delete supplier "${s.name}"?`)) deleteSupplier(s.id)
  }

  const getBalance = (supplierId) => {
    return purchases
      .filter((p) => p.supplierId === supplierId && p.status !== 'cancelled' && p.status !== 'void')
      .reduce((sum, p) => sum + (p.total - p.amountPaid), 0)
  }

  const filtered = suppliers.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const exportCols = [
    { key: 'name', label: t('Name') },
    { key: 'email', label: t('Email') },
    { key: 'phone', label: t('Phone') },
    { key: 'taxId', label: t('Tax / VAT ID') },
    { key: 'address', label: t('Address') },
    { key: 'balance', label: t('Balance'), right: true, map: (_, s) => getBalance(s.id).toFixed(2) },
  ]

  return (
    <div>
      <PageHeader
        title={t('Suppliers')}
        subtitle={`${suppliers.length} ${t('suppliers')}`}
        action={
          <div className="flex items-center gap-2">
            {suppliers.length > 0 && <ExportMenu filename="suppliers" title={t('Suppliers')} rows={suppliers} columns={exportCols} />}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Supplier')}</Btn>
          </div>
        }
      />

      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input
          className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search suppliers...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {filtered.length === 0 && suppliers.length === 0 ? (
          <EmptyState
            icon="🏭"
            title={t('No suppliers yet')}
            desc={t('Add your first supplier to start creating purchase invoices.')}
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Add Supplier')}</Btn>}
          />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No suppliers match your search')}</div>
        ) : (
          <Table headers={[t('Supplier'), t('Contact'), t('Tax ID'), { label: t('Amount Owed'), right: true }, { label: t('Actions'), right: true }]}>
            {filtered.map((s) => {
              const balance = getBalance(s.id)
              return (
                <Tr key={s.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/50 dark:to-orange-900/50 rounded-full flex items-center justify-center text-orange-600 dark:text-orange-300 font-semibold text-sm ring-1 ring-orange-200/60 dark:ring-orange-800/60">
                        {s.name[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">Since {fmtDate(s.createdAt)}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {s.email && <p className="text-sm text-gray-600 dark:text-slate-300">{s.email}</p>}
                    {s.phone && <p className="text-xs text-gray-400 dark:text-slate-500">{s.phone}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm tabular-nums">{s.taxId || '—'}</Td>
                  <Td right>
                    <span className={`font-semibold tabular-nums ${balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>
                      {fmtMoney(balance, sym)}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <AttachmentButton entityType="supplier" entityId={s.id} />
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(s)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(s)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Supplier' : 'New Supplier'}>
        <div className="space-y-4">
          <Input label="Supplier Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Supplier company name" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
          <Input label="Tax / VAT ID" value={form.taxId} onChange={(e) => setField('taxId', e.target.value)} />
          <Select label={t('Payment terms')} value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)}>
            <option value="">{t('Company default')}</option>
            {TERM_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
          </Select>
          {controlOptions.length > 1 && (
            <Select label={t('Payables account')} value={form.controlAccountId} onChange={(e) => setField('controlAccountId', e.target.value)}>
              {controlOptions.map((a) => (
                <option key={a.id} value={a.id === defaultFor('suppliers') ? '' : a.id}>{a.code} — {a.name}</option>
              ))}
            </Select>
          )}
          <Textarea label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)} rows={2} />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} />
          {customDefs.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase">{t('Custom Fields')}</p>
              {customDefs.map((label) => (
                <Input key={label} label={label} value={form.customFields?.[label] || ''} onChange={(e) => setCustom(label, e.target.value)} />
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Supplier'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
