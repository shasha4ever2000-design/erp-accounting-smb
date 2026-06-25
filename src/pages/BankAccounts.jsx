import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, StatCard, EmptyState, Table, Tr, Td, Badge } from '../components/UI'
import { Plus, Pencil, Trash2, Landmark, Wallet, CreditCard, ArrowDownLeft, ArrowUpRight } from 'lucide-react'

const TYPE_LABELS = { bank: 'Bank Account', cash: 'Cash Account', credit_card: 'Credit Card' }
const TYPE_ICONS  = { bank: Landmark, cash: Wallet, credit_card: CreditCard }

const emptyForm = { name: '', type: 'bank', bankName: '', accountNumber: '', code: '' }

export default function BankAccounts() {
  const { bankAccounts, accounts, bankTransactions, invoices, purchases, getAllBalances, settings,
          addBankAccount, updateBankAccount, deleteBankAccount } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]     = useState(emptyForm)
  const [selected, setSelected] = useState(null)
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const balances = getAllBalances()
  const getBalance = (accountId) => {
    const b = balances[accountId]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === accountId)
    return acc ? b.dr - b.cr : 0
  }

  const totalCash = bankAccounts.reduce((sum, ba) => sum + getBalance(ba.accountId), 0)

  const openNew  = () => { setEditing(null); setForm(emptyForm); setModal(true) }
  const openEdit = (ba) => { setEditing(ba); setForm({ name: ba.name, type: ba.type, bankName: ba.bankName || '', accountNumber: ba.accountNumber || '', code: '' }); setModal(true) }
  const close    = () => setModal(false)

  const handleSave = () => {
    if (!form.name.trim()) return alert('Account name is required.')
    if (editing) {
      updateBankAccount(editing.id, { name: form.name, type: form.type, bankName: form.bankName, accountNumber: form.accountNumber })
    } else {
      addBankAccount(form)
    }
    close()
  }

  const handleDelete = (ba) => {
    if (confirm(`Delete "${ba.name}"? The journal entry history will be preserved.`)) deleteBankAccount(ba.id)
  }

  // Recent transactions for selected account
  const allTxns = [
    ...bankTransactions.map((t) => ({ ...t, kind: 'bank' })),
    ...(invoices.flatMap((inv) => (inv.payments || []).map((p) => ({
      ...p, bankAccountId: p.bankAccountId, date: p.date, description: `Receipt: ${inv.number}`, amount: p.amount, type: 'money_in', kind: 'receipt',
    })))),
    ...(purchases.flatMap((pur) => (pur.payments || []).map((p) => ({
      ...p, bankAccountId: p.bankAccountId, date: p.date, description: `Payment: ${pur.number}`, amount: p.amount, type: 'money_out', kind: 'payment',
    })))),
  ]

  const filteredTxns = selected
    ? allTxns.filter((t) => t.bankAccountId === selected.accountId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50)
    : []

  return (
    <div>
      <PageHeader
        title="Cash & Cash Equivalents"
        subtitle={`Total balance: ${fmtMoney(totalCash, sym)} across ${bankAccounts.length} account${bankAccounts.length !== 1 ? 's' : ''}`}
        action={<Btn onClick={openNew}><Plus size={15} /> New Account</Btn>}
      />

      {/* Account cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {bankAccounts.map((ba) => {
          const balance = getBalance(ba.accountId)
          const Icon = TYPE_ICONS[ba.type] || Landmark
          const isSelected = selected?.id === ba.id
          return (
            <div
              key={ba.id}
              onClick={() => setSelected(isSelected ? null : ba)}
              className={`bg-white rounded-xl border-2 p-5 cursor-pointer transition-all ${
                isSelected ? 'border-blue-500 shadow-md' : 'border-gray-100 shadow-sm hover:border-blue-200'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2.5 rounded-lg ${balance >= 0 ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                  <Icon size={18} />
                </div>
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(ba) }}><Pencil size={13} /></Btn>
                  <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleDelete(ba) }}><Trash2 size={13} className="text-red-400" /></Btn>
                </div>
              </div>
              <p className="font-semibold text-gray-900">{ba.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{TYPE_LABELS[ba.type] || ba.type}{ba.bankName ? ` · ${ba.bankName}` : ''}</p>
              {ba.accountNumber && <p className="text-xs text-gray-400 font-mono">···{ba.accountNumber.slice(-4)}</p>}
              <p className={`text-2xl font-bold mt-3 ${balance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                {fmtMoney(balance, sym)}
              </p>
              {ba.isDefault && <Badge className="mt-1 bg-blue-100 text-blue-700">Default</Badge>}
            </div>
          )
        })}
        {bankAccounts.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon="🏦" title="No bank accounts" desc="Add your bank and cash accounts to track balances." action={<Btn onClick={openNew}><Plus size={14} /> Add Account</Btn>} />
          </div>
        )}
      </div>

      {/* Recent transactions for selected account */}
      {selected && (
        <Card>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Recent Transactions – {selected.name}</h3>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
          </div>
          {filteredTxns.length === 0 ? (
            <div className="py-10 text-center text-gray-400 text-sm">No transactions yet for this account.</div>
          ) : (
            <Table headers={['Date', 'Description', 'Type', { label: 'Amount', right: true }]}>
              {filteredTxns.map((tx, i) => (
                <Tr key={tx.id || i}>
                  <Td className="text-gray-500 text-sm">{fmtDate(tx.date)}</Td>
                  <Td className="font-medium text-gray-800">{tx.description}</Td>
                  <Td>
                    {tx.type === 'money_in' || tx.type === 'receipt'
                      ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><ArrowDownLeft size={12} /> In</span>
                      : <span className="inline-flex items-center gap-1 text-red-600 text-xs"><ArrowUpRight size={12} /> Out</span>
                    }
                  </Td>
                  <Td right>
                    <span className={`font-semibold ${tx.type === 'money_in' || tx.type === 'receipt' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'money_in' || tx.type === 'receipt' ? '+' : '-'}{fmtMoney(tx.amount, sym)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Add / Edit Modal */}
      <Modal open={modal} onClose={close} title={editing ? 'Edit Account' : 'New Bank / Cash Account'}>
        <div className="space-y-4">
          <Input label="Account Name *" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Operating Account, Petty Cash" />
          <Select label="Account Type" value={form.type} onChange={(e) => setField('type', e.target.value)}>
            <option value="bank">Bank Account</option>
            <option value="cash">Cash Account</option>
            <option value="credit_card">Credit Card</option>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Bank Name" value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} placeholder="e.g. HSBC" />
            <Input label="Account Number" value={form.accountNumber} onChange={(e) => setField('accountNumber', e.target.value)} placeholder="Last 4 digits" />
          </div>
          {!editing && (
            <Input label="GL Account Code (optional)" value={form.code} onChange={(e) => setField('code', e.target.value)} placeholder="Auto-assigned if blank" />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={handleSave}>{editing ? 'Save Changes' : 'Add Account'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
