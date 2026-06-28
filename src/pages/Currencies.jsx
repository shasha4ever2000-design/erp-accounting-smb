import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select } from '../components/UI'
import { Plus, Trash2, Pencil, Coins, ArrowRightLeft } from 'lucide-react'

const COMMON = [
  { code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' }, { code: 'GBP', name: 'British Pound' },
  { code: 'SAR', name: 'Saudi Riyal' }, { code: 'AED', name: 'UAE Dirham' }, { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'QAR', name: 'Qatari Riyal' }, { code: 'BHD', name: 'Bahraini Dinar' }, { code: 'OMR', name: 'Omani Rial' },
  { code: 'EGP', name: 'Egyptian Pound' }, { code: 'JOD', name: 'Jordanian Dinar' }, { code: 'INR', name: 'Indian Rupee' },
  { code: 'CNY', name: 'Chinese Yuan' }, { code: 'TRY', name: 'Turkish Lira' }, { code: 'JPY', name: 'Japanese Yen' },
]

const emptyForm = { code: '', name: '', rate: '' }

export default function Currencies() {
  const t = useT()
  const { currencies, addCurrency, updateCurrency, deleteCurrency, settings } = useStore()
  const base = settings.company.currency

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // converter
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState(base)
  const [to, setTo] = useState(currencies[0]?.code || base)

  const rateOf = (code) => (code === base ? 1 : (currencies.find((c) => c.code === code)?.rate || 1))
  // value in base = amount / rate(from) ... rate is units-per-base, so base = amount / rate
  const convert = () => {
    const a = parseFloat(amount) || 0
    const inBase = a / rateOf(from)
    return inBase * rateOf(to)
  }

  const openNew = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (c) => { setEditing(c); setForm({ code: c.code, name: c.name, rate: String(c.rate) }); setModal(true) }

  const save = () => {
    if (!form.code.trim()) return alert('Currency code is required.')
    const data = { code: form.code.toUpperCase(), name: form.name, rate: parseFloat(form.rate) || 1 }
    if (editing) updateCurrency(editing.id, data)
    else addCurrency(data)
    setModal(false)
  }

  const quickAdd = (c) => {
    if (c.code === base || currencies.some((x) => x.code === c.code)) return
    addCurrency({ code: c.code, name: c.name, rate: 1 })
  }

  return (
    <div>
      <PageHeader
        title="Currencies & Exchange Rates"
        subtitle={`Base currency: ${base} · maintain rates for foreign-currency reporting`}
        action={<Btn onClick={openNew}><Plus size={15} /> {t('Add Currency')}</Btn>}
      />

      {/* Converter */}
      <Card className="p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <ArrowRightLeft size={16} className="text-gray-400" />
          <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-200">{t('Quick Converter')}</h3>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Select label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-32">
            <option value={base}>{base} (base)</option>
            {currencies.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
          </Select>
          <Select label="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-32">
            <option value={base}>{base} (base)</option>
            {currencies.map((c) => <option key={c.id} value={c.code}>{c.code}</option>)}
          </Select>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg px-4 py-2">
            <p className="text-[11px] text-blue-500 dark:text-blue-300 uppercase">Result</p>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-200">{convert().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {to}</p>
          </div>
        </div>
      </Card>

      {/* Quick add */}
      <div className="flex flex-wrap gap-2 mb-4">
        {COMMON.filter((c) => c.code !== base && !currencies.some((x) => x.code === c.code)).slice(0, 10).map((c) => (
          <button key={c.code} onClick={() => quickAdd(c)} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600">
            + {c.code}
          </button>
        ))}
      </div>

      <Card>
        {currencies.length === 0 ? (
          <div className="py-12 text-center">
            <Coins size={30} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="text-gray-400 dark:text-slate-500 text-sm">No foreign currencies yet. Add one above, or click a suggestion.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/60">
              <tr className="text-xs text-gray-400 dark:text-slate-500 uppercase">
                <th className="text-left px-5 py-2">Code</th>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-right px-4 py-2">Rate (per 1 {base})</th>
                <th className="text-left px-4 py-2">Updated</th>
                <th className="text-right px-5 py-2">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 dark:border-slate-700/50">
                  <td className="px-5 py-2.5 font-mono font-semibold text-gray-800 dark:text-slate-100">{c.code}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300">{c.name}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-800 dark:text-slate-100">{c.rate}</td>
                  <td className="px-4 py-2.5 text-gray-400 dark:text-slate-500 text-xs">{c.updatedAt ? fmtDate(c.updatedAt.slice(0, 10)) : '—'}</td>
                  <td className="px-5 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil size={13} /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => { if (confirm(`Remove ${c.code}?`)) deleteCurrency(c.id) }}><Trash2 size={13} className="text-red-400" /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Currency' : 'Add Currency'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Code *" value={form.code} onChange={(e) => setF('code', e.target.value)} placeholder="USD" maxLength={3} />
            <Input label={`Rate per 1 ${base}`} type="number" step="0.0001" value={form.rate} onChange={(e) => setF('rate', e.target.value)} placeholder="3.75" />
          </div>
          <Input label="Name" value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="US Dollar" />
          <p className="text-xs text-gray-400 dark:text-slate-500">Example: if 1 {base} = 3.75 SAR, set the SAR rate to 3.75.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>{t('Cancel')}</Btn>
            <Btn onClick={save}>{editing ? 'Save' : 'Add'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
