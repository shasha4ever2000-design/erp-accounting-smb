import { useState } from 'react'
import { useStore } from '../store'
import { controlAccountsFor, defaultFor } from '../utils/controlAccounts'
import { TERM_PRESETS, describeTerms, resolveTerms } from '../utils/paymentTerms'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, EmptyState, Table, Tr, Td } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { useT } from '../i18n'
import { CustomFieldInputs } from '../components/CustomFields'
import { validateValues, exportColumns } from '../utils/customFields'
import ExportMenu from '../components/ExportMenu'
import { Plus, Pencil, Trash2, Users, Search } from 'lucide-react'

const emptyForm = { name: '', email: '', phone: '', address: '', taxId: '', creditLimit: '', priceListPct: '', notes: '', controlAccountId: '', paymentTerms: '', customFields: {} }

export default function Customers() {
  const { customers, invoices, addCustomer, updateCustomer, deleteCustomer, settings, accounts, setRecordControlAccount, customFieldsFor } = useStore()
  const controlOptions = controlAccountsFor(accounts, 'customers')
  const sym = settings.company.currencySymbol
  const t = useT()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', taxId: c.taxId || '', creditLimit: c.creditLimit ?? '', priceListPct: c.priceListPct ?? '', notes: c.notes || '', controlAccountId: c.controlAccountId || '', paymentTerms: typeof c.paymentTerms === 'string' ? c.paymentTerms : '', customFields: c.customFields || {} }); setModal(true) }
  const close = () => setModal(false)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setCustom = (id, v) => setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [id]: v } }))

  const handleSave = () => {
    if (!form.name.trim()) return
    const cf = validateValues(customFieldsFor('customer'), form.customFields)
    if (!cf.ok) return alert(cf.errors.join('\n'))
    const { controlAccountId, ...rest } = form
    const data = { ...rest, creditLimit: parseFloat(form.creditLimit) || 0, priceListPct: parseFloat(form.priceListPct) || 0 }
    if (editing) {
      updateCustomer(editing.id, data)
      // Routed through the store action rather than saved as a plain field:
      // a customer who still owes money takes that balance with them, as a
      // reclassification entry.
      const current = editing.controlAccountId || ''
      if ((controlAccountId || '') !== current) {
        try {
          const res = setRecordControlAccount('customers', editing.id, controlAccountId)
          if (res.moved) alert(t('Moved {a} of outstanding balance to the new control account.').replace('{a}', res.moved.toFixed(2)))
        } catch (err) { alert(String(err.message || err).replace('CONTROL_INVALID:', '').trim()) }
      }
    } else {
      const created = addCustomer(data)
      if (controlAccountId) {
        const id = created?.id || (useStore.getState().customers.slice(-1)[0] || {}).id
        if (id) { try { setRecordControlAccount('customers', id, controlAccountId) } catch { /* keeps the default */ } }
      }
    }
    close()
  }

  const handleDelete = (c) => {
    if (confirm(`Delete customer "${c.name}"?`)) deleteCustomer(c.id)
  }

  const getBalance = (customerId) => {
    return invoices
      .filter((i) => i.customerId === customerId && i.status !== 'cancelled' && i.status !== 'void')
      .reduce((sum, i) => sum + (i.total - i.amountPaid), 0)
  }

  const filtered = customers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const exportCols = [
    { key: 'name', label: t('Name') },
    { key: 'email', label: t('Email') },
    { key: 'phone', label: t('Phone') },
    { key: 'taxId', label: t('Tax / VAT ID') },
    { key: 'address', label: t('Address') },
    { key: 'balance', label: t('Balance'), right: true, map: (_, c) => getBalance(c.id).toFixed(2) },
    ...exportColumns(customFieldsFor('customer'), { fmtDate }),
  ]

  return (
    <div>
      <PageHeader
        title={t('Customers')}
        subtitle={`${customers.length} ${t('customers')}`}
        action={
          <div className="flex items-center gap-2">
            {customers.length > 0 && <ExportMenu filename="customers" title={t('Customers')} rows={customers} columns={exportCols} />}
            <Btn onClick={openNew}><Plus size={15} /> {t('New Customer')}</Btn>
          </div>
        }
      />

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
        <input
          className="w-full ps-9 pe-3 py-2 text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:focus:ring-brand-400/20"
          placeholder={t('Search customers...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {filtered.length === 0 && customers.length === 0 ? (
          <EmptyState
            icon="👥"
            title={t('No customers yet')}
            desc={t('Add your first customer to start creating invoices.')}
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Add Customer')}</Btn>}
          />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500 text-sm">{t('No customers match your search')}</div>
        ) : (
          <Table headers={[t('Customer'), t('Contact'), t('Tax ID'), { label: t('Balance Due'), right: true }, { label: t('Actions'), right: true }]}>
            {filtered.map((c) => {
              const balance = getBalance(c.id)
              return (
                <Tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 shrink-0 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300 font-semibold text-sm ring-1 ring-blue-200/60 dark:ring-blue-800/60">
                        {c.name[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-slate-100 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400 dark:text-slate-500">Since {fmtDate(c.createdAt)}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {c.email && <p className="text-sm text-gray-600 dark:text-slate-300">{c.email}</p>}
                    {c.phone && <p className="text-xs text-gray-400 dark:text-slate-500">{c.phone}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm tabular-nums">{c.taxId || '—'}</Td>
                  <Td right>
                    <span className={`font-semibold tabular-nums ${balance > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-slate-300'}`}>
                      {fmtMoney(balance, sym)}
                    </span>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <AttachmentButton entityType="customer" entityId={c.id} />
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => handleDelete(c)}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? 'Edit Customer' : 'New Customer'}>
        <div className="space-y-4">
          <Input label="Customer Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Full name or company name" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="email@company.com" />
            <Input label="Phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+1 234 567 890" />
          </div>
          <Input label="Tax / VAT ID" value={form.taxId} onChange={(e) => setField('taxId', e.target.value)} placeholder="Tax registration number" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={`${t('Credit limit')} (${sym})`} type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setField('creditLimit', e.target.value)} placeholder={t('0 = no limit')} />
            <Select label={t('Payment terms')} value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)}>
              <option value="">{t('Company default')}</option>
              {TERM_PRESETS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
            </Select>
            {controlOptions.length > 1 && (
              <Select label={t('Receivables account')} value={form.controlAccountId} onChange={(e) => setField('controlAccountId', e.target.value)}>
                {controlOptions.map((a) => (
                  <option key={a.id} value={a.id === defaultFor('customers') ? '' : a.id}>{a.code} — {a.name}</option>
                ))}
              </Select>
            )}
            <Input label={`${t('Price level')} (%)`} type="number" step="0.1" value={form.priceListPct} onChange={(e) => setField('priceListPct', e.target.value)} placeholder={t('e.g. -10 = 10% off')} />
          </div>
          <Textarea label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)} rows={2} placeholder="Street, City, Country" />
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Internal notes..." />
          <CustomFieldInputs
            entityId="customer"
            values={form.customFields}
            onChange={setCustom}
            className="pt-3 border-t border-gray-100 dark:border-slate-700"
          />
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Customer'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
