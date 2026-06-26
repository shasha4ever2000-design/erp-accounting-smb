import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Calculator, Trash2, TrendingDown, Package } from 'lucide-react'

const STATUS_CLR = { active: 'bg-green-100 text-green-700', disposed: 'bg-gray-100 text-gray-500' }

export default function FixedAssets() {
  const navigate = useNavigate()
  const { fixedAssets, assetDepreciations, bankAccounts, settings,
          recordDepreciation, disposeAsset, deleteFixedAsset } = useStore()
  const sym = settings.company.currencySymbol

  const [deprModal, setDeprModal] = useState(null)   // asset to depreciate
  const [dispModal, setDispModal] = useState(null)   // asset to dispose
  const [filter, setFilter]       = useState('active')

  const [deprForm, setDeprForm] = useState({ date: today(), amount: '', period: '' })
  const [dispForm, setDispForm] = useState({ date: today(), proceeds: '', bankAccountId: '' })

  const bankOpts = bankAccounts.map((ba) => ({ id: ba.accountId, name: ba.name }))

  const filtered = filter === 'all' ? fixedAssets : fixedAssets.filter((a) => a.status === filter)
  const sorted   = [...filtered].sort((a, b) => b.createdAt?.localeCompare(a.createdAt || '') || 0)

  const totalCost     = fixedAssets.filter(a=>a.status==='active').reduce((s,a)=>s+a.purchaseCost, 0)
  const totalAccDep   = fixedAssets.filter(a=>a.status==='active').reduce((s,a)=>s+a.accumulatedDepreciation, 0)
  const totalBookVal  = fixedAssets.filter(a=>a.status==='active').reduce((s,a)=>s+a.currentBookValue, 0)

  const openDepr = (asset) => {
    const yearlyDep = (asset.purchaseCost - (asset.salvageValue || 0)) / (asset.usefulLifeYears || 5)
    setDeprForm({ date: today(), amount: yearlyDep.toFixed(2), period: '' })
    setDeprModal(asset)
  }

  const handleDepr = () => {
    const amount = parseFloat(deprForm.amount)
    if (!amount || amount <= 0) return alert('Enter a valid depreciation amount.')
    if (!deprForm.period.trim()) return alert('Enter the depreciation period.')
    if (amount > deprModal.currentBookValue) return alert('Depreciation cannot exceed current book value.')
    recordDepreciation(deprModal.id, { date: deprForm.date, amount, period: deprForm.period })
    setDeprModal(null)
  }

  const handleDispose = () => {
    const proceeds = parseFloat(dispForm.proceeds) || 0
    if (!dispForm.bankAccountId && proceeds > 0) return alert('Select a bank account for proceeds.')
    disposeAsset(dispModal.id, { date: dispForm.date, proceeds, bankAccountId: dispForm.bankAccountId })
    setDispModal(null)
  }

  const handleDelete = (asset) => {
    if (confirm(`Delete asset "${asset.name}"? This also removes its journal entry.`)) deleteFixedAsset(asset.id)
  }

  return (
    <div>
      <PageHeader
        title="Fixed Assets"
        subtitle="Asset register — properties, equipment, vehicles, and more"
        action={<Btn onClick={() => navigate('/fixed-assets/new')}><Plus size={15} /> Add Asset</Btn>}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Cost"         value={fmtMoney(totalCost,    sym)} color="blue"   icon={<Package size={18} />} />
        <StatCard label="Accumulated Dep."   value={fmtMoney(totalAccDep,  sym)} color="orange" icon={<TrendingDown size={18} />} />
        <StatCard label="Net Book Value"     value={fmtMoney(totalBookVal, sym)} color="green"  icon={<Calculator size={18} />} />
      </div>

      <div className="flex gap-2 mb-4">
        {[['active','Active'],['disposed','Disposed'],['all','All']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${filter === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            {label} ({val==='all' ? fixedAssets.length : fixedAssets.filter(a=>a.status===val).length})
          </button>
        ))}
      </div>

      <Card>
        {fixedAssets.length === 0 ? (
          <EmptyState icon="🏗️" title="No fixed assets" desc="Add equipment, vehicles, buildings, and other long-term assets. Depreciation is tracked automatically."
            action={<Btn onClick={() => navigate('/fixed-assets/new')}><Plus size={14} /> Add Asset</Btn>} />
        ) : sorted.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No {filter} assets</div>
        ) : (
          <Table headers={['Number', 'Asset Name', 'Category', 'Purchase Date', { label: 'Cost', right: true }, { label: 'Acc. Dep.', right: true }, { label: 'Book Value', right: true }, 'Method', 'Status', { label: 'Actions', right: true }]}>
            {sorted.map((asset) => (
              <Tr key={asset.id}>
                <Td><span className="font-mono text-xs text-gray-500">{asset.number}</span></Td>
                <Td>
                  <p className="font-medium text-gray-800">{asset.name}</p>
                  {asset.description && <p className="text-xs text-gray-400 truncate max-w-[150px]">{asset.description}</p>}
                </Td>
                <Td className="text-gray-500 text-sm">{asset.category || '—'}</Td>
                <Td className="text-gray-500 text-sm">{fmtDate(asset.purchaseDate)}</Td>
                <Td right className="text-gray-700">{fmtMoney(asset.purchaseCost, sym)}</Td>
                <Td right className="text-orange-600">{fmtMoney(asset.accumulatedDepreciation, sym)}</Td>
                <Td right className="font-semibold text-gray-900">{fmtMoney(asset.currentBookValue, sym)}</Td>
                <Td className="text-xs text-gray-500">{asset.depreciationMethod === 'straight_line' ? 'SL' : asset.depreciationMethod || 'SL'}</Td>
                <Td><Badge className={STATUS_CLR[asset.status] || 'bg-gray-100 text-gray-600'}>{asset.status}</Badge></Td>
                <Td right>
                  <div className="flex justify-end gap-1">
                    {asset.status === 'active' && (
                      <>
                        <Btn size="sm" variant="secondary" onClick={() => openDepr(asset)} title="Record Depreciation">
                          <TrendingDown size={12} /> Dep.
                        </Btn>
                        <Btn size="sm" variant="ghost" onClick={() => { setDispModal(asset); setDispForm({ date: today(), proceeds: '', bankAccountId: bankOpts[0]?.id || '' }) }} title="Dispose Asset">
                          Dispose
                        </Btn>
                      </>
                    )}
                    {asset.status === 'disposed' && (
                      <span className="text-xs text-gray-400 px-2">Disposed {asset.disposalDate ? fmtDate(asset.disposalDate) : ''}</span>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => handleDelete(asset)}>
                      <Trash2 size={13} className="text-red-400" />
                    </Btn>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Depreciation Modal */}
      <Modal open={!!deprModal} onClose={() => setDeprModal(null)} title={`Record Depreciation – ${deprModal?.name}`}>
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <p>Book value: <strong>{fmtMoney(deprModal?.currentBookValue || 0, sym)}</strong></p>
            <p>Straight-line annual: <strong>{fmtMoney(((deprModal?.purchaseCost||0)-(deprModal?.salvageValue||0))/(deprModal?.usefulLifeYears||5), sym)}</strong></p>
          </div>
          <Input label="Period *" value={deprForm.period} onChange={(e) => setDeprForm((f)=>({...f,period:e.target.value}))} placeholder="e.g. Q2 2026, June 2026" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" value={deprForm.date} onChange={(e) => setDeprForm((f)=>({...f,date:e.target.value}))} />
            <Input label={`Amount (${sym}) *`} type="number" min="0" step="0.01" value={deprForm.amount} onChange={(e) => setDeprForm((f)=>({...f,amount:e.target.value}))} />
          </div>
          <p className="text-xs text-blue-600 bg-blue-50 rounded p-2">
            Posts: Dr Depreciation Expense → Cr Accumulated Depreciation
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setDeprModal(null)}>Cancel</Btn>
            <Btn onClick={handleDepr}>Record Depreciation</Btn>
          </div>
        </div>
      </Modal>

      {/* Dispose Modal */}
      <Modal open={!!dispModal} onClose={() => setDispModal(null)} title={`Dispose Asset – ${dispModal?.name}`}>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
            <p>Current book value: <strong>{fmtMoney(dispModal?.currentBookValue || 0, sym)}</strong></p>
            <p className="text-xs mt-1">Gain or loss will be calculated automatically based on disposal proceeds.</p>
          </div>
          <Input label="Disposal Date" type="date" value={dispForm.date} onChange={(e) => setDispForm((f)=>({...f,date:e.target.value}))} />
          <Input label={`Proceeds from Sale (${sym})`} type="number" min="0" step="0.01" value={dispForm.proceeds} onChange={(e) => setDispForm((f)=>({...f,proceeds:e.target.value}))} placeholder="0 if scrapped / donated" />
          {parseFloat(dispForm.proceeds) > 0 && (
            <Select label="Deposit Proceeds Into" value={dispForm.bankAccountId} onChange={(e) => setDispForm((f)=>({...f,bankAccountId:e.target.value}))}>
              <option value="">— Select bank account —</option>
              {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          {dispModal && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              {(() => {
                const proceeds = parseFloat(dispForm.proceeds) || 0
                const gl = proceeds - (dispModal.currentBookValue || 0)
                return gl >= 0
                  ? <p className="text-green-700">Gain on disposal: <strong>{fmtMoney(gl, sym)}</strong></p>
                  : <p className="text-red-600">Loss on disposal: <strong>({fmtMoney(Math.abs(gl), sym)})</strong></p>
              })()}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setDispModal(null)}>Cancel</Btn>
            <Btn variant="danger" onClick={handleDispose}>Dispose Asset</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
