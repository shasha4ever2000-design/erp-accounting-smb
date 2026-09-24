// Requisitions, purchase orders, goods receipts, bills, payments and returns.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { docFulfillment, defaultSelection, buildConversion } from '../utils/fulfillment'
import { editBlock } from '../utils/docEdit'
import { documentDue, notesAgainst } from '../utils/partyBalance'
import { weightedAverageCost } from '../utils/inventoryCost'
import { receiveInto, layersFromBalance } from '../utils/fifo'
import { needsApproval, amountOf } from '../utils/approvals'
import { todayISO } from '../utils/localDate'
import { nextNum, keepEntries, restockAtCost, whPatch, isStocked, unstockAtCost, debitNoteStock, stockReceivedBy, assertNoPostedFields, defaultWh, whOf } from './shared'

export const createPurchasesSlice = (set, get) => ({
  // ─── PURCHASE QUOTES (supplier offers) ─────────────────────────
  // What a supplier says they will charge, before anything is committed.
  // Also posts nothing: asking three suppliers for a price creates no
  // liability, and only the one that turns into a purchase order does.
  purchaseQuotes: [],

  addPurchaseQuote: (q) => {
    const s = get()
    const { prefix, next } = s.settings.purchaseQuote
    const number = nextNum(prefix, next)
    const newQ = { ...q, id: uuid(), number, status: q.status || 'open', createdAt: new Date().toISOString() }
    set((st) => ({
      purchaseQuotes: [...st.purchaseQuotes, newQ],
      settings: { ...st.settings, purchaseQuote: { ...st.settings.purchaseQuote, next: next + 1 } },
    }))
    get().logActivity('Recorded purchase quote', `${number} · ${q.supplierName || ''}`.trim(), { entity: 'purchaseQuote', entityId: newQ.id, entityRef: number })
    return newQ
  },

  updatePurchaseQuote: (id, patch) =>
    set((s) => ({ purchaseQuotes: s.purchaseQuotes.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),

  deletePurchaseQuote: (id) => {
    get().recycleRecord('purchaseQuotes', id)
    return set((s) => ({ purchaseQuotes: s.purchaseQuotes.filter((q) => q.id !== id) }))
  },

  /** Purchase quote → purchase order. */
  convertPurchaseQuoteToOrder: (id, selections) => {
    const q = get().purchaseQuotes.find((x) => x.id === id)
    if (!q || q.status === 'ordered') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(q.items || [], 'orderedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'orderedQty', taxEnabled })
    if (items.length === 0) return null
    const po = get().addPurchaseOrder({
      supplierId: q.supplierId, supplierName: q.supplierName,
      purchaseQuoteId: q.id,
      date: todayISO(),
      expectedDate: q.validUntil || '',
      currency: q.currency, exchangeRate: q.exchangeRate,
      items, subtotal, taxAmount, total, notes: q.notes || '',
    })
    const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, orderedQty: (Number(l.orderedQty) || 0) + applied[l.id] } : l))
    const done = docFulfillment(newItems, 'orderedQty').status === 'complete'
    get().updatePurchaseQuote(id, { items: newItems, status: done ? 'ordered' : 'partial', purchaseOrderId: po.id })
    return po
  },

  // ─── PURCHASE ORDERS ───────────────────────────────────────────
  purchaseOrders: [],

  addPurchaseOrder: (po) => {
    const s = get()
    const { prefix, next } = s.settings.purchaseOrder
    const number = nextNum(prefix, next)
    const newPO = { ...po, id: uuid(), number, status: 'sent', createdAt: new Date().toISOString() }
    set((st) => ({
      purchaseOrders: [...st.purchaseOrders, newPO],
      settings: { ...st.settings, purchaseOrder: { ...st.settings.purchaseOrder, next: next + 1 } },
    }))
    return newPO
  },

  updatePurchaseOrder: (id, patch) =>
    set((s) => ({ purchaseOrders: s.purchaseOrders.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

  deletePurchaseOrder: (id) => {
    get().recycleRecord('purchaseOrders', id)
    return set((s) => ({ purchaseOrders: s.purchaseOrders.filter((p) => p.id !== id) }))
  },

  // Receive/bill a purchase order — in full, or partially via a { lineId:
  // qty } selection. Each line tracks receivedQty, so undelivered quantities
  // remain open. Omitting `selections` bills everything remaining.
  convertPOToPurchase: (id, selections) => {
    const po = get().purchaseOrders.find((p) => p.id === id)
    if (!po || po.status === 'invoiced') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(po.items || [], 'receivedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(po.items || [], sel, { key: 'receivedQty', taxEnabled })
    if (items.length === 0) return null
    const purchase = get().addPurchase({
      supplierId: po.supplierId, supplierName: po.supplierName,
      date: todayISO(),
      dueDate: po.deliveryDate || todayISO(),
      departmentId: po.departmentId || null,
      currency: po.currency, exchangeRate: po.exchangeRate,
      items, subtotal, taxAmount, total, notes: po.notes || '',
    })
    // Direct path receives and bills together, so both counters advance.
    const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, receivedQty: (Number(l.receivedQty) || 0) + applied[l.id], billedQty: (Number(l.billedQty) || 0) + applied[l.id] } : l))
    const status = docFulfillment(newItems, 'billedQty').status === 'complete' ? 'invoiced' : 'partial'
    get().updatePurchaseOrder(id, { items: newItems, status, purchaseId: purchase.id, purchaseIds: [...(po.purchaseIds || []), purchase.id] })
    return purchase
  },

  // ─── GOODS RECEIPTS (GRN) + 3-WAY MATCH ────────────────────────
  // Procure-to-pay separates the physical receipt of goods from the vendor
  // bill. A GRN records what arrived: it puts stock in and accrues the cost
  // to "Goods Received Not Invoiced" (GRNI). The later bill clears GRNI into
  // Accounts Payable. Comparing PO ↔ GRN ↔ Bill quantities is the 3-way match.
  goodsReceipts: [],

  receiveGoods: (poId, selections, { date } = {}) => {
    const po = get().purchaseOrders.find((p) => p.id === poId)
    if (!po) return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(po.items || [], 'receivedQty')
    const { items, applied } = buildConversion(po.items || [], sel, { key: 'receivedQty', taxEnabled })
    if (items.length === 0) return null
    const rate = Number(po.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const recvDate = date || todayISO()
    const { prefix, next } = get().settings.goodsReceipt

    // JE: Dr inventory (stock) / expense (non-stock) at cost, Cr GRNI accrual.
    const debitByAcc = {}
    const recv = {} // itemId -> { qty, cost(base) }
    items.forEach((l) => {
      const item = l.itemId ? get().inventoryItems.find((i) => i.id === l.itemId) : null
      const stocked = isStocked(item)
      const acc = stocked ? (item.inventoryAccountId || 'acc-inv') : (l.accountId || 'acc-admin')
      const amt = toBase(l.subtotal)
      debitByAcc[acc] = (debitByAcc[acc] || 0) + amt
      if (stocked) { recv[l.itemId] = recv[l.itemId] || { qty: 0, cost: 0 }; recv[l.itemId].qty += l.quantity; recv[l.itemId].cost += amt }
    })
    const netBase = Object.values(debitByAcc).reduce((s, v) => s + v, 0)
    const lines = [
      ...Object.entries(debitByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Goods received' })),
      { accountId: 'acc-grni', debit: 0, credit: netBase, description: 'Goods received not invoiced' },
    ]
    const number = nextNum(prefix, next)
    const je = get().addJournalEntry({ date: recvDate, description: `Goods Receipt ${number} – ${po.supplierName || ''}`, reference: number, type: 'goods_receipt', lines })

    // Perpetual receipt into stock (weighted-average, base cost).
    const defWh = defaultWh(get())
    const wh = whOf(get(), po)
    set((st) => ({
      inventoryItems: st.inventoryItems.map((it) => {
        const u = recv[it.id]; if (!u) return it
        const oldQty = it.quantity || 0
        const newCost = weightedAverageCost({
          onHand: oldQty, unitCost: it.costPrice, receivedQty: u.qty, receivedValue: u.cost,
        })
        const seeded = { ...it, costLayers: it.costLayers || layersFromBalance(oldQty, it.costPrice) }
        const patch = { quantity: oldQty + u.qty, ...receiveInto(seeded, {
          qty: u.qty, value: u.cost, date: recvDate, ref: number,
          method: get().costingMethod(), wacCost: newCost,
        }), ...whPatch(it, wh, u.qty, defWh) }
        return { ...it, ...patch }
      }),
      settings: { ...st.settings, goodsReceipt: { ...st.settings.goodsReceipt, next: next + 1 } },
    }))
    Object.entries(recv).forEach(([itemId, u]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: recvDate, type: 'purchase', qtyChange: u.qty, ref: number, note: `GRN from ${po.supplierName || 'supplier'}` })
    })

    const grn = { id: uuid(), number, poId, poNumber: po.number, supplierId: po.supplierId, supplierName: po.supplierName, date: recvDate, items, journalEntryId: je.id, createdAt: new Date().toISOString() }
    const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, receivedQty: (Number(l.receivedQty) || 0) + applied[l.id] } : l))
    const fullyBilled = docFulfillment(newItems, 'billedQty').status === 'complete'
    set((st) => ({ goodsReceipts: [...st.goodsReceipts, grn] }))
    get().updatePurchaseOrder(poId, { items: newItems, status: fullyBilled ? 'invoiced' : 'partial', grnIds: [...(po.grnIds || []), grn.id] })
    get().logActivity('Received goods', `${number} · ${po.number}`)
    return grn
  },

  // Bill the received-but-not-yet-billed quantities of a PO: Dr GRNI + input
  // VAT, Cr AP. No stock movement (the GRN already received it).
  billReceivedPO: (poId, selections, { date, dueDate } = {}) => {
    const po = get().purchaseOrders.find((p) => p.id === poId)
    if (!po) return null
    const rate = Number(po.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const taxEnabled = get().settings?.tax?.enabled !== false
    // Clamp each line to what's received but not billed.
    const billable = {}
    ;(po.items || []).forEach((l) => {
      const cap = Math.max(0, (Number(l.receivedQty) || 0) - (Number(l.billedQty) || 0))
      const want = selections ? (Number(selections[l.id]) || 0) : cap
      const q = Math.min(want, cap)
      if (q > 1e-9) billable[l.id] = q
    })
    const { items, applied, subtotal, taxAmount, total } = buildConversion(po.items || [], billable, { key: 'billedQty', taxEnabled })
    if (items.length === 0) return null

    const netBase = items.reduce((s, l) => s + toBase(l.subtotal), 0)
    const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
    const apBase = Math.round((netBase + vatBase) * 100) / 100
    const lines = [{ accountId: 'acc-grni', debit: netBase, credit: 0, description: 'Clear GRNI' }]
    if (vatBase > 0) lines.push({ accountId: 'acc-vatin', debit: vatBase, credit: 0, description: 'Input Tax' })
    lines.push({ accountId: get().controlAccountFor('suppliers', po.supplierId), debit: 0, credit: apBase, description: `Bill for ${po.number}` })

    const { prefix, next } = get().settings.purchase
    const number = nextNum(prefix, next)
    const billDate = date || todayISO()
    const je = get().addJournalEntry({ date: billDate, description: `Purchase Invoice ${number} – ${po.supplierName || ''}`, reference: number, type: 'purchase', departmentId: po.departmentId || null, lines })

    const newPurchase = {
      id: uuid(), number, supplierId: po.supplierId, supplierName: po.supplierName,
      date: billDate, dueDate: dueDate || po.deliveryDate || billDate,
      departmentId: po.departmentId || null, currency: po.currency, exchangeRate: rate,
      items, subtotal, taxAmount, total, baseTotal: apBase, notes: `From ${po.number} (GRNI)`,
      status: 'received', amountPaid: 0, payments: [], journalEntryId: je.id, poId, fromGrni: true,
      createdAt: new Date().toISOString(),
    }
    set((st) => ({ purchases: [...st.purchases, newPurchase], settings: { ...st.settings, purchase: { ...st.settings.purchase, next: next + 1 } } }))

    const newItems = (po.items || []).map((l) => (applied[l.id] ? { ...l, billedQty: (Number(l.billedQty) || 0) + applied[l.id] } : l))
    const status = docFulfillment(newItems, 'billedQty').status === 'complete' ? 'invoiced' : 'partial'
    get().updatePurchaseOrder(poId, { items: newItems, status, purchaseId: newPurchase.id, purchaseIds: [...(po.purchaseIds || []), newPurchase.id] })
    get().logActivity('Billed received goods', `${number} · ${po.number}`)
    return newPurchase
  },

  // ─── PURCHASE INVOICES ─────────────────────────────────────────
  purchases: [],

  addPurchase: (purchase, opts = {}) => {
    const s = get()
    if (!opts.approved && needsApproval(s.settings?.approvals, 'purchase', amountOf('purchase', purchase))) {
      return { pendingApproval: true, request: get().submitForApproval('purchase', purchase) }
    }
    // See addInvoice: `opts.reissue` re-posts an existing bill under its own
    // identity, so revisePurchase can correct a bill without a second copy of
    // the posting logic and without burning a document number.
    const reissue = opts.reissue || null
    const { prefix, next } = s.settings.purchase
    const number = reissue ? reissue.number : nextNum(prefix, next)
    // Foreign-currency bills are entered in their own currency; convert every
    // amount to base at the bill's rate (1 for base-currency bills) for the ledger.
    const rate = Number(purchase.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const expMap = {}
    purchase.items.forEach((item) => {
      const acc = item.accountId || 'acc-admin'
      expMap[acc] = (expMap[acc] || 0) + item.subtotal
    })
    const expLines = Object.entries(expMap).map(([accId, amount]) =>
      ({ accountId: accId, debit: toBase(amount), credit: 0, description: `Purchase – ${number}` }))
    const vatBase = purchase.taxAmount > 0 ? toBase(purchase.taxAmount) : 0
    // Optional whole-bill discount (contra-expense credit) and freight-in charge (added cost).
    const docDiscBase = toBase(purchase.docDiscountAmount || 0)
    const freightBase = toBase(purchase.shipping || 0)
    const lines = [...expLines]
    if (vatBase > 0)
      lines.push({ accountId: 'acc-vatin', debit: vatBase, credit: 0, description: 'Input Tax' })
    if (docDiscBase > 0) lines.push({ accountId: 'acc-purchdisc', debit: 0, credit: docDiscBase, description: 'Bill discount' })
    if (freightBase > 0) lines.push({ accountId: 'acc-freightin', debit: freightBase, credit: 0, description: 'Freight-in' })
    // AP = expenses − discount + freight + VAT (all base), so the entry balances.
    const apBase = Math.round((expLines.reduce((s, l) => s + l.debit, 0) - docDiscBase + freightBase + vatBase) * 100) / 100
    lines.push({ accountId: get().controlAccountFor('suppliers', purchase.supplierId), debit: 0, credit: apBase, description: `Purchase ${number}` })
    const je = get().addJournalEntry({
      date: purchase.date,
      description: `Purchase Invoice ${number} – ${purchase.supplierName || ''}`,
      reference: number, type: 'purchase', departmentId: purchase.departmentId || null, lines,
    })
    const newPurchase = {
      ...purchase, id: reissue?.id || uuid(), number, status: 'received', amountPaid: 0, payments: [],
      exchangeRate: rate, baseTotal: apBase,
      journalEntryId: je.id,
      warehouseId: whOf(get(), purchase),
      createdAt: reissue?.createdAt || new Date().toISOString(),
      ...(reissue ? { revisedAt: new Date().toISOString(), revision: (reissue.revision || 0) + 1 } : {}),
    }

    // Perpetual inventory: receive tracked lines into stock at weighted-average cost.
    const recv = {} // itemId -> { qty, cost }
    purchase.items.forEach((line) => {
      if (!line.itemId) return
      // Services and kits are bought but never shelved.
      if (!isStocked(get().inventoryItems.find((i) => i.id === line.itemId))) return
      const q = parseFloat(line.quantity) || 0
      if (q <= 0) return
      recv[line.itemId] = recv[line.itemId] || { qty: 0, cost: 0 }
      recv[line.itemId].qty += q
      // Weighted-average cost is held in base currency, so convert FC line costs.
      recv[line.itemId].cost += toBase(line.subtotal || 0)
    })
    // Exactly what this bill put on the shelf and at what value, so a void
    // or an edit takes back the same units at the same cost.
    newPurchase.stockReceived = recv
    const defWh = defaultWh(get())
    const wh = newPurchase.warehouseId
    set((st) => ({
      purchases: [...st.purchases, newPurchase],
      inventoryItems: st.inventoryItems.map((it) => {
        const u = recv[it.id]
        if (!u) return it
        const oldQty = it.quantity || 0
        const newCost = weightedAverageCost({
          onHand: oldQty, unitCost: it.costPrice, receivedQty: u.qty, receivedValue: u.cost,
        })
        const seeded = { ...it, costLayers: it.costLayers || layersFromBalance(oldQty, it.costPrice) }
        const patch = { quantity: oldQty + u.qty, ...receiveInto(seeded, {
          qty: u.qty, value: u.cost, date: purchase.date, ref: number,
          method: get().costingMethod(), wacCost: newCost,
        }), ...whPatch(it, wh, u.qty, defWh) }
        return { ...it, ...patch }
      }),
      // A reissue reuses its own number, so the sequence must not advance.
      settings: reissue ? st.settings : { ...st.settings, purchase: { ...st.settings.purchase, next: next + 1 } },
    }))
    // Movement ledger entries for each received item.
    Object.entries(recv).forEach(([itemId, u]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: purchase.date, type: 'purchase', qtyChange: u.qty, ref: number, note: `Received from ${purchase.supplierName || 'supplier'}` })
    })
    return newPurchase
  },

  recordPurchasePayment: (purchaseId, payment, opts = {}) => {
    const s = get()
    const purchase = s.purchases.find((p) => p.id === purchaseId)
    if (!purchase) return
    // Overpayment guard: never pay more than the outstanding balance (keeps AP ≥ 0)
    // Returns raised against the bill have already debited AP.
    const debited = notesAgainst(purchase, s.debitNotes, 'purchaseId')
    const remaining = documentDue(purchase, s.debitNotes, 'purchaseId')
    const amount = Math.round(Math.min(Number(payment.amount) || 0, remaining) * 100) / 100
    if (amount <= 0) return
    // Money leaving the business is the sharpest edge of all — gate it on the
    // capped amount, so an overpayment attempt can't clear a lower threshold.
    if (!opts.approved && needsApproval(s.settings?.approvals, 'payment', amount)) {
      return { pendingApproval: true, request: get().submitForApproval('payment', { purchaseId, payment: { ...payment, amount }, targetRef: purchase.number }) }
    }
    const { prefix, next } = s.settings.payment
    const number = nextNum(prefix, next)
    const newAmountPaid = Math.round(((Number(purchase.amountPaid) || 0) + amount) * 100) / 100
    const status = newAmountPaid + debited >= purchase.total - 0.005 ? 'paid' : 'partial'
    const wht = Math.max(0, Math.min(amount, Number(payment.wht) || 0))
    const netCash = amount - wht
    // Multi-currency settlement: AP and WHT are relieved at the bill's rate; cash
    // leaves at the payment-date rate. The difference is a realized FX gain/loss.
    // (Both rates default to 1, so base-currency payments post exactly as before.)
    const purRate = Number(purchase.exchangeRate) || 1
    const payRate = Number(payment.exchangeRate) || purRate
    const apBase = Math.round(amount * purRate * 100) / 100
    const whtBase = Math.round(wht * purRate * 100) / 100
    const cashBase = Math.round(netCash * payRate * 100) / 100
    const fx = Math.round((apBase - whtBase - cashBase) * 100) / 100
    const lines = [
      { accountId: get().controlAccountFor('suppliers', purchase.supplierId), debit: apBase, credit: 0, description: `Payment for ${purchase.number}` },
      { accountId: payment.bankAccountId, debit: 0, credit: cashBase, description: `Payment for ${purchase.number}` },
    ]
    if (whtBase > 0) lines.push({ accountId: 'acc-wht', debit: 0, credit: whtBase, description: `Withholding tax – ${purchase.number}` })
    if (fx > 0) lines.push({ accountId: 'acc-fxreal', debit: 0, credit: fx, description: `Realized FX gain – ${purchase.number}` })
    else if (fx < 0) lines.push({ accountId: 'acc-fxreal', debit: -fx, credit: 0, description: `Realized FX loss – ${purchase.number}` })
    const je = get().addJournalEntry({
      date: payment.date,
      description: `Payment ${number} for ${purchase.number}`,
      reference: number, type: 'payment_out', lines,
    })
    set((st) => ({
      purchases: st.purchases.map((p) =>
        p.id === purchaseId
          ? { ...p, amountPaid: newAmountPaid, status, payments: [...(p.payments || []), { ...payment, amount, id: uuid(), number, journalEntryId: je.id }] }
          : p
      ),
      settings: { ...st.settings, payment: { ...st.settings.payment, next: next + 1 } },
    }))
  },

  // See updateInvoice.
  updatePurchase: (id, patch) => {
    assertNoPostedFields(patch)
    set((s) => ({ purchases: s.purchases.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  },

  /** Why this bill cannot be edited, or null when it can. See utils/docEdit. */
  purchaseEditBlock: (id) => {
    const s = get()
    const pur = s.purchases.find((p) => p.id === id)
    const fromOrder = !!pur && (
      !!pur.poId ||
      (s.purchaseOrders || []).some((po) => (po.purchaseIds || []).includes(pur.id) || po.purchaseId === pur.id)
    )
    return editBlock(pur, { kind: 'purchase', lockDate: s.settings?.accounting?.lockDate || '', fromOrder })
  },

  /** Correct a posted purchase bill in place — the mirror of reviseInvoice. */
  revisePurchase: (id, doc) => {
    const block = get().purchaseEditBlock(id)
    if (block) throw new Error(`EDIT_BLOCKED:${block}`)
    const pur = get().purchases.find((p) => p.id === id)
    const keep = { id: pur.id, number: pur.number, createdAt: pur.createdAt, revision: pur.revision || 0 }
    get().deletePurchase(id, { silent: true })
    // `approved` so a bill that was already approved once is not sent back
    // round the approval loop by an edit that may even reduce its value.
    const next = get().addPurchase({ ...doc }, { reissue: keep, approved: true })
    get().logActivity('Edited purchase bill', `${keep.number} · revision ${keep.revision + 1}`)
    return next
  },

  // Void a purchase bill: reverse its bill + payment entries and back out the
  // received stock, marking it 'void' (kept for the audit trail).
  voidPurchase: (id, { date, reason } = {}) => {
    const pur = get().purchases.find((p) => p.id === id)
    if (!pur || pur.status === 'void') return
    const voidDate = date || todayISO()
    // Returns against the bill first — see voidInvoice.
    ;(get().debitNotes || [])
      .filter((d) => d.purchaseId === id && d.status !== 'void')
      .forEach((d) => get().voidDebitNote(d.id, { date: voidDate, reason: reason || `Void bill ${pur.number}` }))
    const jeIds = [pur.journalEntryId, ...(pur.payments || []).map((p) => p.journalEntryId)].filter(Boolean)
    jeIds.forEach((jeId) => {
      const je = get().journalEntries.find((j) => j.id === jeId)
      if (je && !je.reversedBy) get().voidJournalEntry(jeId, { date: voidDate, reason: reason || `Void bill ${pur.number}` })
    })
    const recv = stockReceivedBy(pur, get().inventoryItems)
    const back = Object.fromEntries(Object.entries(recv).map(([k, u]) => [k, u.qty]))
    const defWh = defaultWh(get())
    const wh = whOf(get(), pur)
    const method = get().costingMethod()
    set((s) => ({
      purchases: s.purchases.map((p) => (p.id === id ? { ...p, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString(), amountPaid: 0 } : p)),
      // The reversal credits inventory with what the bill debited, so the
      // units leave at that value: off the bill's own FIFO layer and out
      // of the weighted average. (Stock is allowed to go negative, as
      // everywhere else; flooring it at zero here put quantity and the
      // inventory account out of step.)
      inventoryItems: s.inventoryItems.map((it) => {
        const u = recv[it.id]
        if (!u) return it
        return unstockAtCost(it, u.qty, u.cost, { method, ref: pur.number, warehouseId: wh, defaultWarehouseId: defWh })
      }),
    }))
    Object.entries(back).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: -q, ref: pur.number, note: 'Bill voided' })
    })
    get().logActivity('Voided purchase bill', `${pur.number}${reason ? ' · ' + reason : ''}`)
  },

  deletePurchase: (id, opts = {}) => {
    const pur0 = get().purchases.find((p) => p.id === id)
    // Returns against the bill are deleted with it — see deleteInvoice.
    const linked = (get().debitNotes || []).filter((d) => d.purchaseId === id)
    get().assertJEsUnlocked(...linked.map((d) => d.journalEntryId))
    if (pur0) linked.forEach((d) => get().deleteDebitNote(d.id))
    const pur = get().purchases.find((p) => p.id === id)
    const payJEs = (pur?.payments || []).map((p) => p.journalEntryId)
    const jeIds = new Set([pur?.journalEntryId, ...payJEs].filter(Boolean))
    get().assertJEsUnlocked(...jeIds)
    // See deleteInvoice: revisePurchase unposts through here before re-posting.
    if (!opts.silent) get().logActivity('Deleted purchase', pur?.number || id)
    // Reverse any perpetual stock received by this purchase.
    const recv = pur ? stockReceivedBy(pur, get().inventoryItems) : {}
    const defWh = defaultWh(get())
    const wh = whOf(get(), pur)
    const method = get().costingMethod()
    set((s) => ({
      purchases: s.purchases.filter((p) => p.id !== id),
      journalEntries: keepEntries(s.journalEntries, (j) => !jeIds.has(j.id)),
      stockMovements: s.stockMovements.filter((m) => m.ref !== pur?.number),
      inventoryItems: s.inventoryItems.map((it) => {
        const u = recv[it.id]
        if (!u) return it
        return unstockAtCost(it, u.qty, u.cost, { method, ref: pur.number, warehouseId: wh, defaultWarehouseId: defWh })
      }),
    }))
  },

  // ─── DEBIT NOTES (Purchase Returns) ────────────────────────────
  debitNotes: [],

  addDebitNote: (dn) => {
    const s = get()
    const { prefix, next } = s.settings.debitNote
    const number = nextNum(prefix, next)
    const lines = [
      { accountId: get().controlAccountFor('suppliers', dn.supplierId), debit: dn.total, credit: 0, description: `Debit Note ${number}` },
      { accountId: 'acc-purret', debit: 0,           credit: dn.subtotal, description: `Purchase Return – ${number}` },
    ]
    if (dn.taxAmount > 0)
      lines.push({ accountId: 'acc-vatin', debit: 0, credit: dn.taxAmount, description: 'Input Tax reversal' })
    const je = get().addJournalEntry({
      date: dn.date,
      description: `Debit Note ${number} – ${dn.supplierName || ''}`,
      reference: number, type: 'debit_note', lines,
    })
    const newDN = { ...dn, id: uuid(), number, status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString() }
    set((st) => ({
      debitNotes: [...st.debitNotes, newDN],
      settings: { ...st.settings, debitNote: { ...st.settings.debitNote, next: next + 1 } },
    }))
    return newDN
  },

  // The mirror of deleteCreditNote: a purchase return took stock off the
  // shelf and marked the bill lines returned, so deleting it puts both back.
  deleteDebitNote: (id) => {
    const dn = get().debitNotes.find((d) => d.id === id)
    if (!dn) return
    get().assertJEsUnlocked(dn.journalEntryId)
    const { back, giveBack } = debitNoteStock(dn, get().inventoryItems)
    const defWh = defaultWh(get())
    const wh = whOf(get(), get().purchases.find((p) => p.id === dn.purchaseId))
    const method = get().costingMethod()
    set((s) => ({
      debitNotes: s.debitNotes.filter((d) => d.id !== id),
      journalEntries: keepEntries(s.journalEntries, (j) => j.id !== dn.journalEntryId),
      stockMovements: dn.purchaseId ? s.stockMovements.filter((m) => m.ref !== dn.number) : s.stockMovements,
      inventoryItems: s.inventoryItems.map((it) => {
        const q = back[it.id]
        if (!q) return it
        const value = dn.valueByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return restockAtCost(it, q, value, { method, date: dn.date, ref: dn.purchaseNumber, warehouseId: wh, defaultWarehouseId: defWh })
      }),
      purchases: dn.purchaseId ? s.purchases.map((p) => (p.id !== dn.purchaseId ? p : {
        ...p,
        items: (p.items || []).map((l) => (giveBack[l.id]
          ? { ...l, returnedQty: Math.max(0, Math.round(((Number(l.returnedQty) || 0) - giveBack[l.id]) * 1e6) / 1e6) }
          : l)),
        debitNoteIds: (p.debitNoteIds || []).filter((x) => x !== id),
      })) : s.purchases,
    }))
    get().logActivity('Deleted debit note', `${dn.number}${dn.purchaseNumber ? ' · ' + dn.purchaseNumber : ''}`)
  },

  /** The mirror of voidCreditNote for a purchase return. */
  voidDebitNote: (id, { date, reason } = {}) => {
    const dn = get().debitNotes.find((d) => d.id === id)
    if (!dn || dn.status === 'void') return
    const voidDate = date || todayISO()
    const je = get().journalEntries.find((j) => j.id === dn.journalEntryId)
    if (je && !je.reversedBy) get().voidJournalEntry(je.id, { date: voidDate, reason: reason || `Void ${dn.number}` })
    const { back, giveBack } = debitNoteStock(dn, get().inventoryItems)
    const defWh = defaultWh(get())
    const wh = whOf(get(), get().purchases.find((p) => p.id === dn.purchaseId))
    const method = get().costingMethod()
    set((s) => ({
      debitNotes: s.debitNotes.map((d) => (d.id === id ? { ...d, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString() } : d)),
      inventoryItems: s.inventoryItems.map((it) => {
        const q = back[it.id]
        if (!q) return it
        const value = dn.valueByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return restockAtCost(it, q, value, { method, date: voidDate, ref: dn.purchaseNumber, warehouseId: wh, defaultWarehouseId: defWh })
      }),
      purchases: dn.purchaseId ? s.purchases.map((p) => (p.id !== dn.purchaseId ? p : {
        ...p,
        items: (p.items || []).map((l) => (giveBack[l.id]
          ? { ...l, returnedQty: Math.max(0, Math.round(((Number(l.returnedQty) || 0) - giveBack[l.id]) * 1e6) / 1e6) }
          : l)),
      })) : s.purchases,
    }))
    Object.entries(back).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: q, ref: dn.number, note: 'Debit note voided' })
    })
    get().logActivity('Voided debit note', `${dn.number}${reason ? ' · ' + reason : ''}`)
  },

  // ─── RECURRING EXPENSES / BILLS ────────────────────────────────
  // Rent, utilities, subscriptions — the payables side of recurring
  // invoices. Each posting creates a real supplier bill so it lands in AP
  // and flows through the normal payment workflow, rather than a bare
  // journal that could never be "paid".
  recurringExpenses: [],

  addRecurringExpense: (r) =>
    set((s) => ({ recurringExpenses: [...s.recurringExpenses, {
      id: uuid(),
      name: r.name || 'Recurring expense',
      supplierId: r.supplierId || '', supplierName: r.supplierName || '',
      frequency: r.frequency || 'monthly',
      nextDate: r.nextDate, endDate: r.endDate || '',
      amount: Number(r.amount) || 0,
      taxRate: Number(r.taxRate) || 0,
      expenseAccountId: r.expenseAccountId || 'acc-admin',
      notes: r.notes || '',
      status: 'active', lastPosted: null, generatedCount: 0,
      createdAt: new Date().toISOString(),
    }] })),

  updateRecurringExpense: (id, patch) =>
    set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

  deleteRecurringExpense: (id) => {
    get().recycleRecord('recurringExpenses', id)
    return set((s) => ({ recurringExpenses: s.recurringExpenses.filter((x) => x.id !== id) }))
  },

  postRecurringExpense: (id, { onDate } = {}) => {
    const r = get().recurringExpenses.find((x) => x.id === id)
    if (!r) return null
    const date = onDate || r.nextDate
    const subtotal = Math.round((Number(r.amount) || 0) * 100) / 100
    const taxAmount = Math.round(subtotal * ((Number(r.taxRate) || 0) / 100) * 100) / 100
    const bill = get().addPurchase({
      supplierId: r.supplierId, supplierName: r.supplierName || r.name,
      date, dueDate: date,
      items: [{
        description: r.name, quantity: 1, unitPrice: subtotal,
        taxRate: Number(r.taxRate) || 0, subtotal,
        accountId: r.expenseAccountId || 'acc-admin',
      }],
      subtotal, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100,
      notes: (r.notes ? r.notes + ' ' : '') + '(Recurring)',
    })
    const nextDate = get().advanceDate(date, r.frequency)
    set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) =>
      (x.id === id ? { ...x, nextDate, lastPosted: date, generatedCount: (x.generatedCount || 0) + 1 } : x)) }))
    return bill
  },

  // Post every active recurring expense whose nextDate has arrived, catching
  // up missed periods. Bounded, honours endDate, and stops on any posting
  // error (e.g. a locked period) so one bad schedule can't block the rest.
  generateDueRecurringExpenses: () => {
    const today = todayISO()
    let count = 0
    get().recurringExpenses.filter((r) => r.status === 'active' && r.nextDate <= today).forEach((r) => {
      let guard = 0
      while (guard++ < 60) {
        const cur = get().recurringExpenses.find((x) => x.id === r.id)
        if (!cur || cur.status !== 'active' || cur.nextDate > today) break
        if (cur.endDate && cur.nextDate > cur.endDate) {
          set((s) => ({ recurringExpenses: s.recurringExpenses.map((x) => (x.id === r.id ? { ...x, status: 'ended' } : x)) }))
          break
        }
        try { get().postRecurringExpense(r.id, { onDate: cur.nextDate }); count += 1 }
        catch { break }
      }
    })
    return count
  },

  // Boot-time scheduler: on app load, catch up any due recurring journals and
  // recurring invoices automatically, at most once per calendar day per company.
  // Both underlying actions already bound their catch-up and skip locked periods,
  // so this is safe to run unattended; depreciation stays manual (a deliberate
  // month-end posting). Returns what it posted so the UI can confirm it.
  schedulerLastRun: null,
  runScheduler: () => {
    const today = todayISO()
    if (get().schedulerLastRun === today) return { journals: 0, invoices: 0, expenses: 0, ran: false }
    if (get().settings?.accounting?.autoPostRecurring === false) {
      set({ schedulerLastRun: today })
      return { journals: 0, invoices: 0, expenses: 0, ran: false }
    }
    let journals = 0, invoices = 0, expenses = 0
    try { journals = get().generateDueRecurringJournals() } catch { /* never block boot */ }
    try { invoices = get().generateDueRecurring() } catch { /* never block boot */ }
    try { expenses = get().generateDueRecurringExpenses() } catch { /* never block boot */ }
    set({ schedulerLastRun: today })
    if (journals || invoices || expenses)
      get().logActivity('Auto-posted scheduled entries', `${invoices} invoice(s), ${journals} journal(s), ${expenses} bill(s)`)
    return { journals, invoices, expenses, ran: journals > 0 || invoices > 0 || expenses > 0 }
  },

  // Generate real invoices for every active schedule whose nextDate has arrived
  generateDueRecurring: () => {
    const today = todayISO()
    const due = get().recurringInvoices.filter((r) => r.status === 'active' && r.nextDate <= today)
    let created = 0
    due.forEach((r) => {
      let nextDate = r.nextDate
      let count = r.generatedCount || 0
      // catch up on any missed cycles, up to a sane cap
      let guard = 0
      while (nextDate <= today && r.status === 'active' && guard < 60) {
        if (r.endDate && nextDate > r.endDate) break
        const due30 = get().advanceDate(nextDate, 'monthly')
        // don't let a locked period (or any posting error) crash the page —
        // skip this schedule and let it retry once the block clears
        try {
          get().addInvoice({
            customerId: r.customerId, customerName: r.customerName,
            date: nextDate, dueDate: due30,
            items: r.items, subtotal: r.subtotal, taxAmount: r.taxAmount, total: r.total,
            notes: (r.notes ? r.notes + ' ' : '') + `(Recurring ${r.number})`,
          })
        } catch { break }
        created++
        count++
        nextDate = get().advanceDate(nextDate, r.frequency)
        guard++
      }
      const ended = r.endDate && nextDate > r.endDate
      get().updateRecurringInvoice(r.id, { nextDate, generatedCount: count, lastGenerated: today, status: ended ? 'completed' : 'active' })
    })
    return created
  },

  // ─── PURCHASE REQUISITIONS & APPROVALS ─────────────────────────
  requisitions: [],

  addRequisition: (req) => {
    const s = get()
    const { prefix, next } = s.settings.requisition
    const number = nextNum(prefix, next)
    const newReq = { ...req, id: uuid(), number, status: 'pending', createdAt: new Date().toISOString() }
    set((st) => ({
      requisitions: [...st.requisitions, newReq],
      settings: { ...st.settings, requisition: { ...st.settings.requisition, next: next + 1 } },
    }))
    get().logActivity('Created requisition', `${number} · ${req.requestedBy || ''}`.trim())
    return newReq
  },

  approveRequisition: (id, approver) => {
    const req = get().requisitions.find((r) => r.id === id)
    if (!req || req.status !== 'pending') return
    set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'approved', approvedBy: approver, approvedAt: new Date().toISOString() } : r)) }))
    get().logActivity('Approved requisition', req.number)
  },

  rejectRequisition: (id, approver, reason) => {
    const req = get().requisitions.find((r) => r.id === id)
    if (!req || req.status !== 'pending') return
    set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'rejected', approvedBy: approver, rejectedReason: reason || '', approvedAt: new Date().toISOString() } : r)) }))
    get().logActivity('Rejected requisition', req.number)
  },

  deleteRequisition: (id) => {
    get().recycleRecord('requisitions', id)
    return set((s) => ({ requisitions: s.requisitions.filter((r) => r.id !== id) }))
  },

  convertRequisitionToPO: (id) => {
    const req = get().requisitions.find((r) => r.id === id)
    if (!req || req.status !== 'approved') return null
    const items = (req.items || []).map((i) => ({
      description: i.description, quantity: i.quantity || 0, unitPrice: i.estPrice || 0,
      taxRate: 0, subtotal: (i.quantity || 0) * (i.estPrice || 0), accountId: 'acc-admin',
    }))
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
    const po = get().addPurchaseOrder({
      supplierId: req.supplierId || null, supplierName: req.supplierName || 'Supplier',
      date: todayISO(), deliveryDate: req.neededBy || '',
      items, subtotal, taxAmount: 0, total: subtotal, notes: `From requisition ${req.number}`,
    })
    set((s) => ({ requisitions: s.requisitions.map((r) => (r.id === id ? { ...r, status: 'ordered', purchaseOrderId: po.id } : r)) }))
    get().logActivity('Requisition → PO', `${req.number} → ${po.number}`)
    return po
  },
})
