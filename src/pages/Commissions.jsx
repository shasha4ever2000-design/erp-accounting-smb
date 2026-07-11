import { useMemo, useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, StatCard, Table, Tr, Td, EmptyState } from '../components/UI'
import { commissionReport } from '../utils/commissions'
import { Plus, Pencil, Trash2, BadgePercent, Users, Wallet, HelpCircle } from 'lucide-react'

const uid = () => 'rep-' + Math.random().toString(36).slice(2, 9)

export default function Commissions() {
  const t = useT()
  const { invoices, settings, updateSettings } = useStore()
  const sym = settings.company.currencySymbol
  const salesReps = settings.salesReps || []

  const [basis, setBasis] = useState('invoiced')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', rate: '', email: '' })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openNew = () => { setEditing(null); setForm({ name: '', rate: '', email: '' }); setModal(true) }
  const openEdit = (r) => { setEditing(r); setForm({ name: r.name, rate: String(r.rate ?? ''), email: r.email || '' }); setModal(true) }
  const close = () => setModal(false)

  const persist = (reps) => updateSettings({ salesReps: reps })

  const handleSave = () => {
    if (!form.name.trim()) return alert(t('Sales rep name is required.'))
    const rate = Number(form.rate) || 0
    if (rate < 0 || rate > 100) return alert(t('Commission rate must be between 0 and 100.'))
    const rep = { name: form.name.trim(), rate, email: form.email.trim() }
    if (editing) persist(salesReps.map((r) => (r.id === editing.id ? { ...r, ...rep } : r)))
    else persist([...salesReps, { id: uid(), ...rep }])
    close()
  }

  const handleDelete = (r) => {
    if (confirm(t('Delete sales rep "{n}"? Their past invoices keep the attribution.').replace('{n}', r.name)))
      persist(salesReps.filter((x) => x.id !== r.id))
  }

  const report = useMemo(() => commissionReport(invoices, salesReps, { basis }), [invoices, salesReps, basis])

  const money = (v) => fmtMoney(v, sym)

  return (
    <div>
      <PageHeader
        title={t('Sales Commissions')}
        subtitle={t('Attribute invoices to reps and track what they have earned')}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('New Sales Rep')}</Btn>}
      />

      {/* Basis toggle */}
      <Card className="p-4 mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-gray-600 dark:text-slate-300">{t('Commission basis')}</span>
        <div className="inline-flex rounded-lg bg-gray-100 dark:bg-surface-700 p-0.5">
          {[
            { id: 'invoiced', label: t('When invoiced') },
            { id: 'collected', label: t('When collected') },
          ].map((o) => (
            <button key={o.id} onClick={() => setBasis(o.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${basis === o.id ? 'bg-white dark:bg-surface-900 text-brand-600 dark:text-brand-300 shadow-sm font-medium' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-slate-500 ms-auto">
          {basis === 'collected' ? t('Earned on cash actually received (pro-rated).') : t('Earned on the full net amount when the invoice is raised.')} {t('Tax is never commissionable.')}
        </span>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={t('Total Commission')} value={money(report.totalCommission)} color="green" icon={<Wallet size={18} />} />
        <StatCard label={t('Commissionable Base')} value={money(report.totalBase)} color="blue" icon={<BadgePercent size={18} />} />
        <StatCard label={t('Active Reps')} value={String(salesReps.length)} color="purple" icon={<Users size={18} />} />
        <StatCard label={t('Unassigned Base')} value={money(report.unassignedBase)} sub={t('invoices with no rep')} color={report.unassignedBase > 0 ? 'amber' : 'green'} icon={<HelpCircle size={18} />} />
      </div>

      <Card>
        {salesReps.length === 0 ? (
          <EmptyState icon="🏅" title={t('No sales reps yet')}
            desc={t('Add your sales team, then assign a rep on each invoice to track commissions automatically.')}
            action={<Btn onClick={openNew}><Plus size={14} /> {t('Add Sales Rep')}</Btn>} />
        ) : (
          <Table headers={[t('Sales Rep'), t('Rate'), { label: t('Invoices'), right: true }, { label: t('Commissionable Base'), right: true }, { label: t('Commission'), right: true }, { label: t('Actions'), right: true }]}>
            {report.rows.map((r) => (
              <Tr key={r.repId}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-brand-50 dark:bg-brand-500/10 ring-1 ring-inset ring-brand-600/10 dark:ring-brand-400/20 rounded-lg flex items-center justify-center">
                      <BadgePercent size={14} className="text-brand-600 dark:text-brand-400" />
                    </div>
                    <span className="font-medium text-gray-800 dark:text-slate-100">{r.name}</span>
                  </div>
                </Td>
                <Td className="text-gray-600 dark:text-slate-300 tabular-nums">{r.rate}%</Td>
                <Td right className="text-gray-500 dark:text-slate-400 tabular-nums">{r.count}</Td>
                <Td right className="text-gray-700 dark:text-slate-200 tabular-nums">{money(r.base)}</Td>
                <Td right className="font-semibold text-success-600 dark:text-success-400 tabular-nums">{money(r.commission)}</Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    <Btn size="sm" variant="ghost" onClick={() => openEdit(salesReps.find((x) => x.id === r.repId))}><Pencil size={13} /></Btn>
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(salesReps.find((x) => x.id === r.repId))}><Trash2 size={13} className="text-red-400" /></Btn>
                  </div>
                </Td>
              </Tr>
            ))}
            <Tr>
              <Td className="font-bold text-gray-800 dark:text-slate-100">{t('Total')}</Td>
              <Td />
              <Td />
              <Td right className="font-bold text-gray-800 dark:text-slate-100 tabular-nums">{money(report.totalBase)}</Td>
              <Td right className="font-bold text-success-700 dark:text-success-300 tabular-nums">{money(report.totalCommission)}</Td>
              <Td />
            </Tr>
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={close} title={editing ? t('Edit Sales Rep') : t('New Sales Rep')}>
        <div className="space-y-4">
          <Input label={t('Name *')} value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('e.g. Sara Al-Otaibi')} />
          <Input label={t('Commission rate (%)')} type="number" min="0" max="100" step="0.1" value={form.rate} onChange={(e) => setField('rate', e.target.value)} placeholder="5" />
          <Input label={t('Email')} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="rep@company.com" />
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>{t('Cancel')}</Btn>
            <Btn onClick={handleSave}>{editing ? t('Save Changes') : t('Add Sales Rep')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
