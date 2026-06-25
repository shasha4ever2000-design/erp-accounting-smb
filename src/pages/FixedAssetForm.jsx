import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { today } from '../utils/formatters'
import { PageHeader, Card, Btn, Input, Select, Textarea } from '../components/UI'

const CATEGORIES = ['Building', 'Land', 'Machinery & Equipment', 'Motor Vehicles', 'Furniture & Fixtures', 'Computer Equipment', 'Leasehold Improvements', 'Other']

export default function FixedAssetForm() {
  const navigate = useNavigate()
  const { bankAccounts, settings, addFixedAsset } = useStore()
  const sym = settings.company.currencySymbol

  const bankOpts = bankAccounts.map((ba) => ({ id: ba.accountId, name: ba.name }))

  const [form, setForm] = useState({
    name: '', description: '', category: 'Machinery & Equipment',
    purchaseDate: today(), purchaseCost: '', salvageValue: '',
    usefulLifeYears: 5, depreciationMethod: 'straight_line',
    paymentType: 'cash', bankAccountId: bankOpts[0]?.id || 'acc-bank1',
    notes: '',
  })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const purchaseCost    = parseFloat(form.purchaseCost)    || 0
  const salvageValue    = parseFloat(form.salvageValue)    || 0
  const usefulLife      = parseFloat(form.usefulLifeYears) || 5
  const annualDep       = usefulLife > 0 ? (purchaseCost - salvageValue) / usefulLife : 0

  const handleSave = () => {
    if (!form.name.trim())        return alert('Asset name is required.')
    if (!purchaseCost || purchaseCost <= 0) return alert('Purchase cost must be greater than zero.')
    if (!form.purchaseDate)       return alert('Purchase date is required.')
    addFixedAsset({
      ...form,
      purchaseCost, salvageValue,
      usefulLifeYears: usefulLife,
    })
    navigate('/fixed-assets')
  }

  return (
    <div>
      <PageHeader title="Add Fixed Asset" subtitle="Record a new long-term asset in the asset register" />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-5">
          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Asset Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Asset Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Delivery Truck, MacBook Pro" />
              <Select label="Category" value={form.category} onChange={(e) => setField('category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <Textarea label="Description" value={form.description} onChange={(e) => setField('description', e.target.value)} rows={2} placeholder="Serial number, make, model, location..." />
          </Card>

          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Purchase Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Purchase Date *" type="date" value={form.purchaseDate} onChange={(e) => setField('purchaseDate', e.target.value)} />
              <Input label={`Purchase Cost (${sym}) *`} type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setField('purchaseCost', e.target.value)} />
            </div>
            <Select label="Payment Method" value={form.paymentType} onChange={(e) => setField('paymentType', e.target.value)}>
              <option value="cash">Cash / Bank Transfer</option>
              <option value="credit">On Credit (Accounts Payable)</option>
            </Select>
            {form.paymentType === 'cash' && (
              <Select label="Paid From" value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
                {bankOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Depreciation</h3>
            <div className="grid grid-cols-3 gap-3">
              <Select label="Method" value={form.depreciationMethod} onChange={(e) => setField('depreciationMethod', e.target.value)}>
                <option value="straight_line">Straight-Line</option>
              </Select>
              <Input label="Useful Life (years)" type="number" min="1" step="1" value={form.usefulLifeYears} onChange={(e) => setField('usefulLifeYears', e.target.value)} />
              <Input label={`Salvage Value (${sym})`} type="number" min="0" step="0.01" value={form.salvageValue} onChange={(e) => setField('salvageValue', e.target.value)} />
            </div>
            {purchaseCost > 0 && (
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                <p>Annual depreciation: <strong>{sym}{annualDep.toFixed(2)}</strong> per year</p>
                <p className="text-xs mt-0.5 text-blue-500">({sym}{(annualDep/12).toFixed(2)} per month · Dr Depreciation Expense / Cr Accumulated Depreciation)</p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <Textarea label="Notes" value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={2} placeholder="Insurance details, warranty, supplier info..." />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Journal Entry Preview</h3>
            {purchaseCost > 0 ? (
              <div className="text-sm space-y-1">
                <div className="flex justify-between text-gray-600">
                  <span>Dr Fixed Assets – Cost</span>
                  <span className="font-medium">{sym}{purchaseCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600 ml-4">
                  <span>Cr {form.paymentType === 'credit' ? 'Accounts Payable' : 'Bank Account'}</span>
                  <span className="font-medium">{sym}{purchaseCost.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">Enter purchase cost to preview</p>
            )}
          </Card>

          <Btn className="w-full justify-center" onClick={handleSave}>Save Asset</Btn>
          <Btn variant="secondary" className="w-full justify-center" onClick={() => navigate('/fixed-assets')}>Cancel</Btn>
        </div>
      </div>
    </div>
  )
}
