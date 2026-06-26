import { useState } from 'react'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Input, Select, Textarea, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { Plus, Trash2, ArrowUpRight, ArrowDownLeft, Landmark } from 'lucide-react'

const BANK_IDS = ['acc-cash', 'acc-bank1']

const emptyForm = () => ({
  type: 'money_in',
  date: today(),
  description: '',
  amount: '',
  bankAccountId: 'acc-cash',
  accountId: 'acc-sales',
  reference: '',
})

export default function Banking() {
  const { accounts, bankTransactions, journalEntries, getAllBalances, deleteBankTransaction, addBankTransaction, settings } = useStore()
  const sym = settings.company.currencySymbol

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [selectedBank, setSelectedBank] = useState('all')
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const bankAccounts = accounts.filter((a) => a.type === 'asset' && a.subtype === 'current' && !['acc-ar', 'acc-vatin', 'acc-inv', 'acc-prepaid'].includes(a.id))
  const nonBankAccounts = accounts.filter((a) => !BANK_IDS.includes(a.id) && !['acc-ar', 'acc-vatin'].includes(a.id))

  const balances = getAllBalances()
  const getBalance = (accId) => {
    const b = balances[accId]
    if (!b) return 0
    const acc = accounts.find((a) => a.id === accId)
    if (!acc) return 0
    return ['asset', 'expense'].includes(acc.type) ? b.dr - b.cr : b.cr - b.dr
  }

  const handleSave = () => {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return alert('Enter a valid amount.')
    if (!form.description.trim()) return alert('Enter a description.')
    addBankTransaction({ ...form, amount })
    setModal(false)
    setForm(emptyForm())
  }

  const handleDelete = (tx) => {
    if (confirm('Delete this transaction?')) deleteBankTransaction(tx.id)
  }

  // Enrich bank transactions with account name
  const enriched = bankTransactions.map((tx) => ({
    ...tx,
    bankName: accounts.find((a) => a.id === tx.bankAccountId)?.name || tx.bankAccountId,
    accountName: accounts.find((a) => a.id === tx.accountId)?.name || tx.accountId,
  }))

  const filtered = selectedBank === 'all' ? enriched : enriched.filter((tx) => tx.bankAccountId === selectedBank)
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div>
      <PageHeader
        title="Bank & Cash"
        subtitle="Direct bank transactions and balances"
        action={<Btn onClick={() => setModal(true)}><Plus size={15} /> New Transaction</Btn>}
      />

      {/* Bank balance cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {bankAccounts.map((a) => (
          <StatCard
            key={a.id}
            label={a.name}
            value={fmtMoney(getBalance(a.id), sym)}
            color={getBalance(a.id) >= 0 ? 'blue' : 'red'}
            icon={<Landmark size={18} />}
          />
        ))}
      </div>

      {/* Filter by account */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setSelectedBank('all')} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${selectedBank === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
          All Accounts
        </button>
        {bankAccounts.map((a) => (
          <button key={a.id} onClick={() => setSelectedBank(a.id)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${selectedBank === a.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
            {a.name}
          </button>
        ))}
      </div>

      <Card>
        {sorted.length === 0 ? (
          <EmptyState icon="🏦" title="No transactions yet" desc="Record direct bank/cash transactions here." action={<Btn onClick={() => setModal(true)}><Plus size={14} /> Add Transaction</Btn>} />
        ) : (
          <Table headers={['Date', 'Description', 'Account', 'Bank Account', 'Type', { label: 'Amount', right: true }, { label: '', right: true }]}>
            {sorted.map((tx) => (
              <Tr key={tx.id}>
                <Td className="text-gray-500">{fmtDate(tx.date)}</Td>
                <Td className="font-medium text-gray-800">
                  {tx.description}
                  {tx.reference && <span className="text-xs text-gray-400 ml-2">({tx.reference})</span>}
                </Td>
                <Td className="text-gray-500 text-sm">{tx.accountName}</Td>
                <Td className="text-gray-500 text-sm">{tx.bankName}</Td>
                <Td>
                  {tx.type === 'money_in'
                    ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium"><ArrowDownLeft size={12} /> Money In</span>
                    : <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium"><ArrowUpRight size={12} /> Money Out</span>
                  }
                </Td>
                <Td right>
                  <span className={`font-semibold ${tx.type === 'money_in' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.type === 'money_in' ? '+' : '-'}{fmtMoney(tx.amount, sym)}
                  </span>
                </Td>
                <Td right>
                  <Btn size="sm" variant="ghost" onClick={() => handleDelete(tx)}>
                    <Trash2 size={13} className="text-red-400" />
                  </Btn>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="New Bank Transaction">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type" value={form.type} onChange={(e) => setField('type', e.target.value)}>
              <option value="money_in">Money In (Receipt)</option>
              <option value="money_out">Money Out (Payment)</option>
            </Select>
            <Input label="Date" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} />
          </div>
          <Input label="Description *" value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="e.g. Office rent payment, Customer cash receipt" />
          <div className="grid grid-cols-2 gap-3">
            <Input label={`Amount (${sym})`} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setField('amount', e.target.value)} />
            <Input label="Reference" value={form.reference} onChange={(e) => setField('reference', e.target.value)} placeholder="Cheque #, ref..." />
          </div>
          <Select label={form.type === 'money_in' ? 'Deposit Into' : 'Pay From'} value={form.bankAccountId} onChange={(e) => setField('bankAccountId', e.target.value)}>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
          </Select>
          <Select label={form.type === 'money_in' ? 'Income Account' : 'Expense Account'} value={form.accountId} onChange={(e) => setField('accountId', e.target.value)}>
            {nonBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} – {a.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2 pt-1">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn onClick={handleSave}>Save Transaction</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
