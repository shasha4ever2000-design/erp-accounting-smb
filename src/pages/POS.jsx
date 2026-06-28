import { useState } from 'react'
import { useT } from '../i18n'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fmtMoney, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Select } from '../components/UI'
import { Plus, Minus, Trash2, ShoppingCart, Search, CheckCircle2, Package } from 'lucide-react'

export default function POS() {
  const t = useT()
  const navigate = useNavigate()
  const {
    inventoryItems, customers, bankAccounts, warehouses, settings,
    addInvoice, recordInvoicePayment, addJournalEntry, updateInventoryItem,
  } = useStore()
  const sym = settings.company.currencySymbol
  const taxOn = settings.tax.enabled
  const rate = settings.tax.rate || 0

  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [payAcc, setPayAcc] = useState(bankAccounts.find((b) => b.id === 'ba-cash')?.accountId || bankAccounts[0]?.accountId || 'acc-cash')
  const [lastSale, setLastSale] = useState(null)

  const filtered = inventoryItems.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.code || '').toLowerCase().includes(search.toLowerCase()))

  const addToCart = (item) => {
    setLastSale(null)
    setCart((c) => {
      const ex = c.find((x) => x.itemId === item.id)
      if (ex) return c.map((x) => (x.itemId === item.id ? { ...x, qty: x.qty + 1 } : x))
      return [...c, { itemId: item.id, name: item.name, price: item.salePrice || 0, qty: 1 }]
    })
  }
  const setQty = (itemId, delta) => setCart((c) => c.map((x) => (x.itemId === itemId ? { ...x, qty: Math.max(1, x.qty + delta) } : x)))
  const removeLine = (itemId) => setCart((c) => c.filter((x) => x.itemId !== itemId))

  const subtotal = cart.reduce((s, x) => s + x.qty * x.price, 0)
  const taxAmount = taxOn ? subtotal * (rate / 100) : 0
  const total = subtotal + taxAmount

  const checkout = () => {
    if (cart.length === 0) return
    const customer = customers.find((c) => c.id === customerId)
    const items = cart.map((c) => ({
      description: c.name, quantity: c.qty, unitPrice: c.price, taxRate: taxOn ? rate : 0,
      subtotal: c.qty * c.price, accountId: 'acc-sales',
    }))
    const inv = addInvoice({
      customerId: customerId || null, customerName: customer?.name || 'Walk-in Customer',
      date: today(), dueDate: today(), items, subtotal, taxAmount, total, notes: 'POS Sale',
    })
    recordInvoicePayment(inv.id, { date: today(), amount: total, bankAccountId: payAcc, notes: 'POS payment' })

    // COGS + stock reduction
    let cogs = 0
    const defWh = warehouses.find((w) => w.isDefault)?.id || 'wh-main'
    cart.forEach((c) => {
      const it = inventoryItems.find((i) => i.id === c.itemId)
      if (!it) return
      cogs += c.qty * (it.costPrice || 0)
      const patch = { quantity: (it.quantity || 0) - c.qty }
      if (it.stockByWarehouse) {
        const map = { ...it.stockByWarehouse }
        map[defWh] = (map[defWh] || 0) - c.qty
        patch.stockByWarehouse = map
      }
      updateInventoryItem(it.id, patch)
    })
    if (cogs > 0) {
      addJournalEntry({
        date: today(), description: `POS Cost of Sale – ${inv.number}`, reference: inv.number, type: 'cogs',
        lines: [
          { accountId: 'acc-cogs', debit: cogs, credit: 0, description: 'Cost of goods sold' },
          { accountId: 'acc-inv', debit: 0, credit: cogs, description: 'Inventory reduction' },
        ],
      })
    }

    setLastSale({ number: inv.number, id: inv.id, total })
    setCart([])
  }

  return (
    <div>
      <PageHeader title="Point of Sale" subtitle="Fast retail checkout — creates a paid invoice, posts COGS and reduces stock" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products */}
        <div className="lg:col-span-2">
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-3 text-gray-400" />
            <input className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {inventoryItems.length === 0 ? (
            <Card className="p-12 text-center text-gray-400 dark:text-slate-500">
              <Package size={30} className="mx-auto mb-3 opacity-40" />
              {t('Add products in the Inventory module to sell them here.')}
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((item) => (
                <button key={item.id} onClick={() => addToCart(item)}
                  className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-3 text-left hover:border-blue-400 hover:shadow-md transition-all">
                  <div className="w-full h-12 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-700 flex items-center justify-center mb-2">
                    <Package size={18} className="text-blue-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">{item.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{fmtMoney(item.salePrice || 0, sym)}</span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500">{item.quantity || 0} {item.unit}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <Card className="p-4 h-fit lg:sticky lg:top-4">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={17} className="text-gray-500 dark:text-slate-400" />
            <h2 className="font-semibold text-gray-800 dark:text-slate-100">{t('Current Sale')}</h2>
            {cart.length > 0 && <span className="ml-auto text-xs text-gray-400">{cart.length} item(s)</span>}
          </div>

          {lastSale && (
            <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3 mb-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-500" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-green-700 dark:text-green-300">Sale complete · {lastSale.number}</p>
                <button onClick={() => navigate(`/invoices/${lastSale.id}`)} className="text-xs text-green-600 dark:text-green-400 underline">View / print receipt</button>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-8">{t('Tap products to add them.')}</p>
          ) : (
            <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
              {cart.map((c) => (
                <div key={c.itemId} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 dark:text-slate-100 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400">{fmtMoney(c.price, sym)} × {c.qty}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(c.itemId, -1)} className="w-6 h-6 rounded bg-gray-100 dark:bg-slate-700 flex items-center justify-center"><Minus size={12} /></button>
                    <span className="w-6 text-center">{c.qty}</span>
                    <button onClick={() => setQty(c.itemId, 1)} className="w-6 h-6 rounded bg-gray-100 dark:bg-slate-700 flex items-center justify-center"><Plus size={12} /></button>
                  </div>
                  <span className="w-16 text-right font-medium text-gray-800 dark:text-slate-100">{fmtMoney(c.qty * c.price, sym)}</span>
                  <button onClick={() => removeLine(c.itemId)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t border-gray-100 dark:border-slate-700 pt-3 text-sm">
            <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>Subtotal</span><span>{fmtMoney(subtotal, sym)}</span></div>
            {taxOn && <div className="flex justify-between text-gray-600 dark:text-slate-300"><span>{settings.tax.name} ({rate}%)</span><span>{fmtMoney(taxAmount, sym)}</span></div>}
            <div className="flex justify-between font-bold text-base text-gray-900 dark:text-slate-100"><span>Total</span><span>{fmtMoney(total, sym)}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t('Walk-in Customer')}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={payAcc} onChange={(e) => setPayAcc(e.target.value)}>
              {bankAccounts.map((b) => <option key={b.id} value={b.accountId}>{b.name}</option>)}
            </Select>
          </div>

          <Btn className="w-full justify-center mt-3" size="lg" disabled={cart.length === 0} onClick={checkout}>
            Charge {fmtMoney(total, sym)}
          </Btn>
        </Card>
      </div>
    </div>
  )
}
