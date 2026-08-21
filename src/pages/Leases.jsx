import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import AttachmentButton from '../components/Attachments'
import { Plus, Trash2, CreditCard, Home, XCircle, Landmark, ListOrdered, Info } from 'lucide-react'
import { leaseSchedule, initialMeasurement, exemption, compareToStraightLine } from '../utils/ifrs16'

export default function Leases() {
  const t = useT()
  const { leases, bankAccounts, settings, addLease, recordLeasePayment, terminateLease, deleteLease,
          recogniseLease, postLeasePeriod, leaseTerms } = useStore()
  const sym = settings.company.currencySymbol

  const bankOpts = bankAccounts.map((b) => ({ id: b.accountId, name: b.name }))

  const [addModal,  setAddModal]  = useState(false)
  const [payModal,  setPayModal]  = useState(null)
  const [filter,    setFilter]    = useState('active')
  const [capModal,  setCapModal]  = useState(null)   // lease being capitalised
  const [schedFor,  setSchedFor]  = useState(null)   // lease whose schedule is open

  const emptyForm = () => ({
    name: '', landlord: '', leaseType: 'operating',
    startDate: today(), endDate: '', monthlyRent: '',
    bankAccountId: bankOpts[0]?.id || 'acc-bank1',
    expenseAccountId: 'acc-rent', notes: '',
    // IFRS 16 measurement inputs. Optional — a lease saved without them keeps
    // the straight-line rent treatment it would have had before.
    termMonths: '', discountRate: '', paymentTiming: 'advance',
    initialCosts: '', incentives: '', usefulLifeMonths: '',
  })
  const [form, setForm] = useState(emptyForm())
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const [payForm, setPayForm] = useState({ date: today(), amount: '', period: '', bankAccountId: bankOpts[0]?.id || 'acc-bank1' })

  const filtered = filter === 'all' ? leases : leases.filter((l) => l.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const activeLeases   = leases.filter((l) => l.status === 'active')
  const monthlyTotal   = activeLeases.reduce((s, l) => s + (parseFloat(l.monthlyRent) || 0), 0)
  const totalPayments  = leases.reduce((s, l) => s + (l.payments || []).reduce((a, p) => a + p.amount, 0), 0)

  const handleAdd = () => {
    if (!form.name.trim())    return alert('Lease name is required.')
    if (!form.startDate)      return alert('Start date is required.')
    if (!form.monthlyRent || parseFloat(form.monthlyRent) <= 0) return alert('Enter a valid monthly rent.')
    addLease({ ...form, monthlyRent: parseFloat(form.monthlyRent) })
    setAddModal(false)
    setForm(emptyForm())
  }

  const openPay = (lease) => {
    setPayModal(lease)
    setPayForm({ date: today(), amount: String(lease.monthlyRent || ''), period: '', bankAccountId: lease.bankAccountId || bankOpts[0]?.id })
  }

  const handlePay = () => {
    const amt = parseFloat(payForm.amount)
    if (!amt || amt <= 0)           return alert('Enter a valid payment amount.')
    if (!payForm.period.trim())     return alert('Enter the period (e.g. June 2026).')
    recordLeasePayment(payModal.id, {
      date: payForm.date, amount: amt, period: payForm.period,
      bankAccountId: payForm.bankAccountId,
      expenseAccountId: payModal.expenseAccountId || 'acc-rent',
    })
    setPayModal(null)
  }

  const STATUS_CLR = { active: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300', terminated: 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400', expired: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300' }

  const leaseStatus = (lease) => {
    if (lease.status === 'terminated') return 'terminated'
    if (lease.endDate && today() > lease.endDate) return 'expired'
    return 'active'
  }

  return (
    <div>
      <PageHeader
        title="Leases & Rent"
        subtitle="Track operating leases, office rent, and other recurring rental obligations"
        action={<Btn onClick={() => setAddModal(true)}><Plus size={15} /> {t('Add Lease')}</Btn>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Leases"     value={activeLeases.length}         color="blue"   icon={<Home size={18} />}       sub="current obligations" />
        <StatCard label="Monthly Commitment" value={fmtMoney(monthlyTotal, sym)} color="orange" icon={<CreditCard size={18} />}  sub="total monthly rent" />
        <StatCard label="Total Paid"         value={fmtMoney(totalPayments, sym)} color="green"  icon={<CreditCard size={18} />}  sub="all time payments" />
      </div>

      <div className="flex gap-2 mb-4">
        {[['active','Active'],['terminated','Terminated'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:focus:ring-offset-slate-900 ${filter === val ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-slate-500 hover:text-gray-900 dark:hover:text-slate-100'}`}>
            {label} ({val === 'all' ? leases.length : leases.filter(l => l.status === val).length})
          </button>
        ))}
      </div>

      <Card>
        {leases.length === 0 ? (
          <EmptyState icon="🏢" title="No leases recorded" desc="Add office space, equipment, or vehicle leases. Each rent payment automatically posts a journal entry (Dr Rent Expense / Cr Bank)."
            action={<Btn onClick={() => setAddModal(true)}><Plus size={14} /> {t('Add Lease')}</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 dark:text-slate-500 text-sm">No {filter} leases</div>
        ) : (
          <Table headers={['Number', 'Name', 'Landlord', 'Type', 'Start', 'End', { label: 'Monthly Rent', right: true }, { label: 'Total Paid', right: true }, 'Payments', 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((lease) => {
              const totalPaid  = (lease.payments || []).reduce((s, p) => s + p.amount, 0)
              const status     = leaseStatus(lease)
              return (
                <Tr key={lease.id}>
                  <Td><span className="font-mono text-xs text-gray-500 dark:text-slate-400">{lease.number}</span></Td>
                  <Td>
                    <p className="font-medium text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
                      {lease.name}
                      {lease.treatment === 'ifrs16' && (
                        <Badge className="bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">IFRS 16</Badge>
                      )}
                    </p>
                    {lease.notes && <p className="text-xs text-gray-400 dark:text-slate-500 truncate max-w-[120px]">{lease.notes}</p>}
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{lease.landlord || '—'}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm capitalize">{lease.leaseType}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{fmtDate(lease.startDate)}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{lease.endDate ? fmtDate(lease.endDate) : 'Open'}</Td>
                  <Td right className="font-medium text-gray-700 dark:text-slate-200">{fmtMoney(lease.monthlyRent, sym)}</Td>
                  <Td right className="text-gray-700 dark:text-slate-200">{fmtMoney(totalPaid, sym)}</Td>
                  <Td className="text-gray-500 dark:text-slate-400 text-sm">{(lease.payments || []).length} payment{(lease.payments || []).length !== 1 ? 's' : ''}</Td>
                  <Td><Badge className={STATUS_CLR[status] || 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400'}>{status}</Badge></Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      <AttachmentButton entityType="lease" entityId={lease.id} />
                      {status === 'active' && lease.treatment === 'ifrs16' && (
                        <Btn size="sm" variant="secondary" onClick={() => setSchedFor(lease)}>
                          <ListOrdered size={12} /> {t('Schedule')}
                        </Btn>
                      )}
                      {status === 'active' && lease.treatment !== 'ifrs16' && Number(lease.termMonths) > 0 && (
                        <Btn size="sm" variant="ghost" title={t('Capitalise under IFRS 16')}
                          onClick={() => setCapModal(lease)}>
                          <Landmark size={13} className="text-brand-500" />
                        </Btn>
                      )}
                      {status === 'active' && lease.treatment !== 'ifrs16' && (
                        <>
                          <Btn size="sm" variant="secondary" onClick={() => openPay(lease)}>
                            <CreditCard size={12} /> Pay
                          </Btn>
                          <Btn size="sm" variant="ghost" title="Terminate"
                            onClick={() => { if (confirm(`Terminate lease "${lease.name}"?`)) terminateLease(lease.id, today()) }}>
                            <XCircle size={13} className="text-amber-500" />
                          </Btn>
                        </>
                      )}
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Delete lease "${lease.name}"? Payment journal entries will remain.`)) deleteLease(lease.id) }}>
                        <Trash2 size={13} className="text-red-400" />
                      </Btn>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      {/* Add Lease Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Lease" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Lease Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Office – Level 3, Suite A" />
            <Input label="Landlord / Lessor" value={form.landlord} onChange={(e) => setField('landlord', e.target.value)} placeholder="Company or person name" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Lease Type" value={form.leaseType} onChange={(e) => setField('leaseType', e.target.value)}>
              <option value="operating">{t('Operating Lease')}</option>
              <option value="finance">{t('Finance Lease')}</option>
            </Select>
            <Input label="Start Date *" type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            <Input label="End Date" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={`Monthly Rent (${sym}) *`} type="number" min="0" step="0.01" value={form.monthlyRent} onChange={(e) => setField('monthlyRent', e.target.value)} />
            <Select label="Default Pay From" value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          {/* IFRS 16 measurement. Filling these in does not capitalise the
              lease — it only makes the option available, because capitalising
              changes the balance sheet and should be a deliberate act. */}
          <div className="rounded-xl border border-gray-200 dark:border-surface-700 p-3 space-y-3">
            <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 flex items-center gap-1.5">
              <Landmark size={13} /> {t('IFRS 16 measurement (optional)')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label={t('Lease term (months)')} type="number" min="0" step="1" value={form.termMonths}
                onChange={(e) => setField('termMonths', e.target.value)} />
              <Input label={t('Discount rate (% a year)')} type="number" min="0" step="0.01" value={form.discountRate}
                onChange={(e) => setField('discountRate', e.target.value)} />
              <Select label={t('Payment timing')} value={form.paymentTiming} onChange={(e) => setField('paymentTiming', e.target.value)}>
                <option value="advance">{t('Start of period (in advance)')}</option>
                <option value="arrears">{t('End of period (in arrears)')}</option>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label={`${t('Initial direct costs')} (${sym})`} type="number" min="0" step="0.01" value={form.initialCosts}
                onChange={(e) => setField('initialCosts', e.target.value)} />
              <Input label={`${t('Lease incentives received')} (${sym})`} type="number" min="0" step="0.01" value={form.incentives}
                onChange={(e) => setField('incentives', e.target.value)} />
              <Input label={t('Useful life (months)')} type="number" min="0" step="1" value={form.usefulLifeMonths}
                onChange={(e) => setField('usefulLifeMonths', e.target.value)} />
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {t('Leave blank to keep this lease as a straight-line rent expense.')}
            </p>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Property address, lease reference, contact details..." />
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setAddModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={handleAdd}>{t('Save Lease')}</Btn>
          </div>
        </div>
      </Modal>

      {/* Capitalise under IFRS 16 — shows the measurement before committing,
          because this permanently changes the shape of the balance sheet. */}
      <Modal open={!!capModal} onClose={() => setCapModal(null)}
        title={`${t('Capitalise under IFRS 16')} – ${capModal?.name || ''}`} width="max-w-lg">
        {capModal && (() => {
          const terms = leaseTerms(capModal)
          const m = initialMeasurement(terms)
          const cmp = compareToStraightLine(terms)
          const ex = exemption(terms)
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 dark:bg-surface-800 p-3">
                  <p className="text-xs text-gray-500 dark:text-slate-400">{t('Right-of-use asset')}</p>
                  <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-slate-100">{fmtMoney(m.rouAsset, sym)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-surface-800 p-3">
                  <p className="text-xs text-gray-500 dark:text-slate-400">{t('Lease liability')}</p>
                  <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-slate-100">{fmtMoney(m.liability, sym)}</p>
                </div>
              </div>

              {ex.exempt && (
                <div className="rounded-xl bg-warning-50 dark:bg-warning-500/10 p-3 text-xs text-warning-700 dark:text-warning-300 flex gap-2">
                  <Info size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{t('This lease qualifies for the')} {ex.reason === 'short-term' ? t('short-term') : t('low-value')} {t('exemption, so you may keep it as a rent expense instead. Capitalising is still permitted.')}</span>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 dark:border-surface-700 p-3 text-sm space-y-1">
                <p className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5">{t('What changes')}</p>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">{t('Year 1 expense under IFRS 16')}</span><span className="tabular-nums">{fmtMoney(cmp.firstYearIfrs16, sym)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">{t('Year 1 as straight-line rent')}</span><span className="tabular-nums">{fmtMoney(cmp.firstYearStraightLine, sym)}</span></div>
                <div className="flex justify-between font-medium border-t border-gray-100 dark:border-surface-750 pt-1 mt-1">
                  <span>{t('Total cost over the lease')}</span><span className="tabular-nums">{fmtMoney(cmp.ifrs16Total, sym)}</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 pt-1">
                  {t('Total cost is unchanged — IFRS 16 moves expense earlier, it does not add any.')}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Btn variant="secondary" onClick={() => setCapModal(null)}>{t('Cancel')}</Btn>
                <Btn onClick={() => {
                  try {
                    recogniseLease(capModal.id, { date: capModal.startDate })
                    setCapModal(null)
                  } catch (e) { alert(t('Could not capitalise this lease: ') + e.message) }
                }}>{t('Capitalise')}</Btn>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Amortisation schedule + period posting */}
      <Modal open={!!schedFor} onClose={() => setSchedFor(null)}
        title={`${t('Lease schedule')} – ${schedFor?.name || ''}`} width="max-w-3xl">
        {schedFor && (() => {
          const live = leases.find((l) => l.id === schedFor.id) || schedFor
          const { rows } = leaseSchedule(leaseTerms(live))
          const posted = new Set((live.postedPeriods || []).map((p) => p.period))
          const nextUnposted = rows.find((r) => !posted.has(r.period))
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {posted.size} {t('of')} {rows.length} {t('periods posted')}
                </p>
                {nextUnposted && (
                  <Btn size="sm" onClick={() => {
                    try { postLeasePeriod(live.id, nextUnposted.period) }
                    catch (e) { alert(t('Could not post this period: ') + e.message) }
                  }}>
                    {t('Post period')} {nextUnposted.period}
                  </Btn>
                )}
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <Table headers={[t('Period'), { label: t('Opening'), right: true }, { label: t('Payment'), right: true },
                  { label: t('Interest'), right: true }, { label: t('Closing'), right: true },
                  { label: t('Depreciation'), right: true }, t('Posted')]}>
                  {rows.map((r) => (
                    <Tr key={r.period} className={posted.has(r.period) ? 'opacity-60' : ''}>
                      <Td>{r.period}</Td>
                      <Td right className="tabular-nums">{fmtMoney(r.opening, sym)}</Td>
                      <Td right className="tabular-nums">{fmtMoney(r.payment, sym)}</Td>
                      <Td right className="tabular-nums">{fmtMoney(r.interest, sym)}</Td>
                      <Td right className="tabular-nums">{fmtMoney(r.closing, sym)}</Td>
                      <Td right className="tabular-nums">{fmtMoney(r.depreciation, sym)}</Td>
                      <Td>{posted.has(r.period)
                        ? <Badge className="bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300">{t('Posted')}</Badge>
                        : <span className="text-gray-300 dark:text-slate-600">—</span>}</Td>
                    </Tr>
                  ))}
                </Table>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Pay Modal */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Record Payment – ${payModal?.name}`}>
        <div className="space-y-4">
          <div className="bg-brand-50 dark:bg-brand-500/10 rounded-lg p-3 text-sm text-brand-700 dark:text-brand-300">
            <p>Monthly rent: <strong>{fmtMoney(payModal?.monthlyRent || 0, sym)}</strong></p>
            <p className="text-xs mt-0.5 text-blue-500">Posts: Dr Rent Expense → Cr Bank</p>
          </div>
          <Input label="Period *" value={payForm.period} onChange={(e) => setPayForm((f) => ({ ...f, period: e.target.value }))} placeholder="e.g. June 2026" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Payment Date" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <Select label="Pay From" value={payForm.bankAccountId} onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}>
            {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setPayModal(null)}>{t('Cancel')}</Btn>
            <Btn onClick={handlePay}>{t('Record Payment')}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
