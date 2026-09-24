// Quotations, orders, invoices, receipts, returns and customer advances.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { docFulfillment, defaultSelection, buildConversion } from '../utils/fulfillment'
import { editBlock } from '../utils/docEdit'
import { explodeLines } from '../utils/kits'
import { documentDue, notesAgainst } from '../utils/partyBalance'
import { issueFrom, layersFromBalance } from '../utils/fifo'
import { ADVANCE_ACCOUNT, validateAdvance, advanceBalance, appliedTotal, applicableAmount, customerCredit, receiveLines, refundLines } from '../utils/advances'
import { defaultBranding, validateBranding } from '../utils/branding'
import { defaultTerms, resolveTerms, dueDateFor, settlementDiscount, discountLines, validateTerms } from '../utils/paymentTerms'
import { advanceDate } from '../utils/cashForecast'
import { todayISO } from '../utils/localDate'
import { nextNum, keepEntries, restockAtCost, whPatch, isStocked, unstockAtCost, assertNoPostedFields, defaultWh, whOf, stockIssuedBy } from './shared'

export const createSalesSlice = (set, get) => ({
  // ─── SALES INVOICES ────────────────────────────────────────────
  invoices: [],

  /**
   * Which tracked items a set of document lines would drive below zero.
   *
   * Selling stock that is not there is allowed — the integrity check
   * reports it afterwards — but it distorts weighted-average cost on the
   * next receipt, so the forms warn first. This lives in the store, and
   * explodes kits through the same explodeLines the posting path uses, so
   * the warning can never disagree with what actually happens on save.
   *
   * @returns {Array<{itemId, name, onHand, required, shortBy}>} empty when fine
   */
  stockShortfall: (items = [], { creditFrom = null } = {}) => {
    const stock = get().inventoryItems
    // Editing a posted document: the version being replaced already took its
    // stock out, and revising puts it back before re-issuing. Crediting those
    // quantities here stops every edit warning about a shortfall that the
    // edit itself resolves.
    const credited = creditFrom ? explodeLines(creditFrom, stock) : {}
    return Object.entries(explodeLines(items, stock))
      .map(([itemId, qty]) => {
        const it = stock.find((i) => i.id === itemId)
        if (!it) return null
        const onHand = (Number(it.quantity) || 0) + (Number(credited[itemId]) || 0)
        const required = Number(qty) || 0
        if (required <= onHand) return null
        return { itemId, name: it.name || '', onHand, required, shortBy: Math.round((required - onHand) * 1000) / 1000 }
      })
      .filter(Boolean)
  },

  // `opts.reissue` re-posts an existing invoice under its own identity — same
  // id, same number, same created date — instead of raising a new one. That
  // is what makes editing a posted document possible without duplicating any
  // of the posting logic below: reviseInvoice unposts the old version and
  // sends the corrected one back through this exact path.
  addInvoice: (invoice, opts = {}) => {
    const s = get()
    const reissue = opts.reissue || null
    const { prefix, next } = s.settings.invoice
    const number = reissue ? reissue.number : nextNum(prefix, next)

    // Foreign-currency invoices are entered in their own currency; the ledger is
    // always in base currency, so each amount is converted at the invoice's rate
    // (base units per 1 unit of the invoice currency; 1 for base-currency invoices).
    const rate = Number(invoice.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const revenueMap = {}
    invoice.items.forEach((item) => {
      const acc = item.accountId || 'acc-sales'
      revenueMap[acc] = (revenueMap[acc] || 0) + item.subtotal
    })
    const revLines = Object.entries(revenueMap).map(([accId, amount]) =>
      ({ accountId: accId, debit: 0, credit: toBase(amount), description: `Revenue – ${number}` }))
    const vatBase = invoice.taxAmount > 0 ? toBase(invoice.taxAmount) : 0
    // Optional whole-invoice discount (contra-revenue) and shipping charge (income).
    // The form passes taxAmount already net of the discount and inclusive of any
    // shipping VAT, so the ledger just needs the extra debit/credit legs here.
    const docDiscBase = toBase(invoice.docDiscountAmount || 0)
    const shipBase = toBase(invoice.shipping || 0)
    // AR = revenue − doc discount + shipping + VAT (all base), so the entry balances.
    const arBase = Math.round((revLines.reduce((s, l) => s + l.credit, 0) - docDiscBase + shipBase + vatBase) * 100) / 100
    const arAcc = get().controlAccountFor('customers', invoice.customerId)
    const lines = [{ accountId: arAcc, debit: arBase, credit: 0, description: `Invoice ${number}` }, ...revLines]
    if (docDiscBase > 0) lines.push({ accountId: 'acc-salesdisc', debit: docDiscBase, credit: 0, description: 'Invoice discount' })
    if (shipBase > 0) lines.push({ accountId: 'acc-shipinc', debit: 0, credit: shipBase, description: 'Shipping & delivery' })
    if (vatBase > 0)
      lines.push({ accountId: 'acc-vatout', debit: 0, credit: vatBase, description: 'Output Tax' })

    const je = get().addJournalEntry({
      date: invoice.date,
      description: `Sales Invoice ${number} – ${invoice.customerName || ''}`,
      reference: number, type: 'invoice', departmentId: invoice.departmentId || null, lines,
    })

    // Perpetual issue: reduce stock + post COGS at weighted-average cost for tracked lines.
    // COGS/inventory relief respect each item's own COGS and inventory accounts.
    // Kits explode into their components first: a bundle is one line on
    // the invoice but there is no bundle on a shelf, so stock and cost of
    // sales have to follow the parts that actually left it.
    const issue = explodeLines(invoice.items, get().inventoryItems) // itemId -> qty
    const cogsByAcc = {}, invByAcc = {}
    const costPatch = {}   // itemId -> { costLayers, costPrice } from the issue
    // What each item actually cost on the day it was sold. Kept on the
    // document because cost is a moving target: re-deriving it later from
    // the item's current costPrice would re-price history every time a
    // purchase lands, and margin reporting would quietly drift. The
    // journal entry alone cannot answer it either — its lines are grouped
    // by account, so two items sharing one COGS account are indivisible.
    const cogsByItem = {}
    let cogs = 0
    const method = get().costingMethod()
    Object.entries(issue).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      if (!it) return
      // Under FIFO this is what the oldest units on the shelf actually
      // cost; under weighted average it is the carried price, exactly as
      // before. Either way the layers move, so the two stay switchable.
      const priced = issueFrom({ ...it, costLayers: it.costLayers || layersFromBalance(it.quantity, it.costPrice) },
        { qty: q, method })
      costPatch[itemId] = priced.patch
      const amt = priced.cost
      cogs += amt
      cogsByItem[itemId] = Math.round(((cogsByItem[itemId] || 0) + amt) * 100) / 100
      const cAcc = it.cogsAccountId || 'acc-cogs'
      const iAcc = it.inventoryAccountId || 'acc-inv'
      cogsByAcc[cAcc] = (cogsByAcc[cAcc] || 0) + amt
      invByAcc[iAcc] = (invByAcc[iAcc] || 0) + amt
    })
    let cogsJeId = null
    if (cogs > 0) {
      const cje = get().addJournalEntry({
        date: invoice.date, description: `Cost of Sales – ${number}`, reference: number, type: 'cogs',
        departmentId: invoice.departmentId || null,
        lines: [
          ...Object.entries(cogsByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Cost of goods sold' })),
          ...Object.entries(invByAcc).map(([a, amt]) => ({ accountId: a, debit: 0, credit: amt, description: 'Inventory reduction' })),
        ],
      })
      cogsJeId = cje.id
    }

    const newInvoice = {
      ...invoice, id: reissue?.id || uuid(), number, status: 'sent', amountPaid: 0, payments: [],
      exchangeRate: rate, baseTotal: arBase,
      journalEntryId: je.id, cogsJournalEntryId: cogsJeId,
      cogsTotal: Math.round(cogs * 100) / 100, cogsByItem,
      // Exactly what left the shelf, so a void or an edit puts back the
      // same units even if a kit's recipe has changed since.
      stockIssued: issue,
      warehouseId: whOf(get(), invoice),
      createdAt: reissue?.createdAt || new Date().toISOString(),
      ...(reissue ? { revisedAt: new Date().toISOString(), revision: (reissue.revision || 0) + 1 } : {}),
    }
    const defWh = defaultWh(get())
    const wh = newInvoice.warehouseId
    set((st) => ({
      invoices: [...st.invoices, newInvoice],
      inventoryItems: st.inventoryItems.map((it) => {
        const q = issue[it.id]
        if (!q) return it
        const patch = { quantity: (it.quantity || 0) - q, ...(costPatch[it.id] || {}), ...whPatch(it, wh, -q, defWh) }
        return { ...it, ...patch }
      }),
      // A reissue reuses its own number, so the sequence must not advance.
      settings: reissue ? st.settings : { ...st.settings, invoice: { ...st.settings.invoice, next: next + 1 } },
    }))
    Object.entries(issue).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: invoice.date, type: 'sale', qtyChange: -q, ref: number, note: `Sold to ${invoice.customerName || 'customer'}` })
    })
    return newInvoice
  },

  recordInvoicePayment: (invoiceId, payment) => {
    const s = get()
    const invoice = s.invoices.find((i) => i.id === invoiceId)
    if (!invoice) return
    // Overpayment guard: never receive more than the outstanding balance, so
    // the AR subledger can't go negative. Money beyond the invoice is not a
    // receipt against it — it belongs on account, which is what
    // receiveAdvance is for.
    // Returns raised against the invoice have already credited AR, so they
    // come off what can still be received against it.
    const credited = notesAgainst(invoice, s.creditNotes, 'invoiceId')
    const remaining = documentDue(invoice, s.creditNotes, 'invoiceId')
    const amount = Math.round(Math.min(Number(payment.amount) || 0, remaining) * 100) / 100
    if (amount <= 0) return
    const { prefix, next } = s.settings.receipt
    const number = nextNum(prefix, next)
    const newAmountPaid = Math.round(((Number(invoice.amountPaid) || 0) + amount) * 100) / 100
    const status = newAmountPaid + credited >= invoice.total - 0.005 ? 'paid' : 'partial'
    // Multi-currency settlement: AR was booked at the invoice rate; cash arrives
    // valued at the payment-date rate. The difference is a realized FX gain/loss.
    // (Both rates default to 1, so base-currency receipts post exactly as before.)
    const invRate = Number(invoice.exchangeRate) || 1
    const payRate = Number(payment.exchangeRate) || invRate
    const cashBase = Math.round(amount * payRate * 100) / 100
    const arBase = Math.round(amount * invRate * 100) / 100
    const fx = Math.round((cashBase - arBase) * 100) / 100
    // Normally the debit is the bank. Applying a customer advance reuses
    // this whole path — status, receipt numbering, FX — with the advance
    // account standing in, rather than growing a second payment mechanism
    // that could drift away from this one.
    const fromAccountId = payment.fromAccountId || payment.bankAccountId
    const payLines = [
      { accountId: fromAccountId, debit: cashBase, credit: 0, description: `Receipt for ${invoice.number}` },
      { accountId: get().controlAccountFor('customers', invoice.customerId), debit: 0, credit: arBase, description: `Receipt for ${invoice.number}` },
    ]
    if (fx > 0) payLines.push({ accountId: 'acc-fxreal', debit: 0, credit: fx, description: `Realized FX gain – ${invoice.number}` })
    else if (fx < 0) payLines.push({ accountId: 'acc-fxreal', debit: -fx, credit: 0, description: `Realized FX loss – ${invoice.number}` })
    const je = get().addJournalEntry({
      date: payment.date,
      description: `Receipt ${number} for ${invoice.number}`,
      reference: number, type: 'receipt', lines: payLines,
    })
    set((st) => ({
      invoices: st.invoices.map((i) =>
        i.id === invoiceId
          ? { ...i, amountPaid: newAmountPaid, status, payments: [...(i.payments || []), { ...payment, amount, id: uuid(), number, journalEntryId: je.id }] }
          : i
      ),
      settings: { ...st.settings, receipt: { ...st.settings.receipt, next: next + 1 } },
    }))
    // What actually landed — the caller asked for `payment.amount`, but the
    // overpayment guard may have clamped it to the outstanding balance.
    return { amount, number, journalEntryId: je.id }
  },

  // Notes, custom fields, references — anything that did not post. A field
  // that did (amounts, lines, party, date, rate, payments, the entries it
  // points at) is corrected by reviseInvoice or a void, never patched here:
  // a patch would leave the document and the ledger telling two stories.
  updateInvoice: (id, patch) => {
    assertNoPostedFields(patch)
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))
  },

  /**
   * Why this invoice cannot be edited, or null when it can. See utils/docEdit.
   * The UI asks this before offering an Edit button; reviseInvoice asks it
   * again before touching anything, so the rule holds even if the UI drifts.
   */
  invoiceEditBlock: (id) => {
    const s = get()
    const inv = s.invoices.find((i) => i.id === id)
    const fromOrder = !!inv && (
      !!inv.salesOrderId ||
      (s.quotations || []).some((q) => (q.invoiceIds || []).includes(inv.id)) ||
      (s.salesOrders || []).some((o) => (o.invoiceIds || []).includes(inv.id))
    )
    return editBlock(inv, { kind: 'invoice', lockDate: s.settings?.accounting?.lockDate || '', fromOrder })
  },

  /**
   * Correct a posted sales invoice in place.
   *
   * The invoice keeps its number, id and issue date; everything it posted is
   * unwound and posted again from the corrected document, so the ledger and
   * the stock ledger end up exactly as they would have had it been entered
   * right the first time. Refused — loudly — in any state where that would
   * not be true (see invoiceEditBlock).
   */
  reviseInvoice: (id, doc) => {
    const block = get().invoiceEditBlock(id)
    if (block) throw new Error(`EDIT_BLOCKED:${block}`)
    const inv = get().invoices.find((i) => i.id === id)
    const keep = { id: inv.id, number: inv.number, createdAt: inv.createdAt, revision: inv.revision || 0 }
    get().deleteInvoice(id, { silent: true })
    const next = get().addInvoice({ ...doc }, { reissue: keep })
    get().logActivity('Edited invoice', `${keep.number} · revision ${keep.revision + 1}`)
    return next
  },

  // Void an invoice the audit-safe way (ZATCA forbids deleting issued invoices):
  // reverse its sale, COGS and every receipt via reversal entries, put the stock
  // back, and mark it 'void' — the document stays in the list (no numbering gap).
  voidInvoice: (id, { date, reason } = {}) => {
    const inv = get().invoices.find((i) => i.id === id)
    if (!inv || inv.status === 'void') return
    const voidDate = date || todayISO()
    // Returns raised against the invoice go first. Voiding the sale reverses
    // all of it and puts every unit it issued back; a return left standing
    // would then count the returned units — and their credit — twice.
    ;(get().creditNotes || [])
      .filter((c) => c.invoiceId === id && c.status !== 'void')
      .forEach((c) => get().voidCreditNote(c.id, { date: voidDate, reason: reason || `Void invoice ${inv.number}` }))
    const jeIds = [inv.journalEntryId, inv.cogsJournalEntryId, ...(inv.payments || []).map((p) => p.journalEntryId)].filter(Boolean)
    jeIds.forEach((jeId) => {
      const je = get().journalEntries.find((j) => j.id === jeId)
      if (je && !je.reversedBy) get().voidJournalEntry(jeId, { date: voidDate, reason: reason || `Void invoice ${inv.number}` })
    })
    const restore = stockIssuedBy(inv, get().inventoryItems)
    const defWh = defaultWh(get())
    const wh = whOf(get(), inv)
    const method = get().costingMethod()
    set((s) => ({
      invoices: s.invoices.map((i) => (i.id === id ? { ...i, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString(), amountPaid: 0 } : i)),
      inventoryItems: s.inventoryItems.map((it) => {
        const q = restore[it.id]
        if (!q) return it
        // The COGS reversal debits inventory with what the sale cost, so
        // the units come back at that same value.
        const value = inv.cogsByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return restockAtCost(it, q, value, { method, date: voidDate, ref: `Void ${inv.number}`, warehouseId: wh, defaultWarehouseId: defWh })
      }),
    }))
    Object.entries(restore).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: q, ref: inv.number, note: 'Invoice voided' })
    })
    get().logActivity('Voided invoice', `${inv.number}${reason ? ' · ' + reason : ''}`)
  },

  deleteInvoice: (id, opts = {}) => {
    const inv0 = get().invoices.find((i) => i.id === id)
    // Returns raised against it are deleted with it (each fully undone), so
    // no credit note is left pointing at an invoice that no longer exists.
    const linked = (get().creditNotes || []).filter((c) => c.invoiceId === id)
    get().assertJEsUnlocked(...linked.flatMap((c) => [c.journalEntryId, c.cogsJournalEntryId]))
    if (inv0) linked.forEach((c) => get().deleteCreditNote(c.id))
    const inv = get().invoices.find((i) => i.id === id)
    // every JE this invoice produced: the sale, its COGS, and every receipt
    const payJEs = (inv?.payments || []).map((p) => p.journalEntryId)
    const jeIds = new Set([inv?.journalEntryId, inv?.cogsJournalEntryId, ...payJEs].filter(Boolean))
    get().assertJEsUnlocked(...jeIds)
    // reviseInvoice unposts through here before re-posting; logging a deletion
    // there would put an event in the audit trail that never happened.
    if (!opts.silent) get().logActivity('Deleted invoice', inv?.number || id)
    // Restore the stock this invoice issued — components, for a kit.
    const restore = inv ? stockIssuedBy(inv, get().inventoryItems) : {}
    const defWh = defaultWh(get())
    const wh = whOf(get(), inv)
    const method = get().costingMethod()
    set((s) => ({
      invoices: s.invoices.filter((i) => i.id !== id),
      journalEntries: keepEntries(s.journalEntries, (j) => !jeIds.has(j.id)),
      stockMovements: s.stockMovements.filter((m) => m.ref !== inv?.number),
      inventoryItems: s.inventoryItems.map((it) => {
        const q = restore[it.id]
        if (!q) return it
        // The COGS entry is removed with the invoice, so the units go
        // back at exactly what that entry had taken out of inventory.
        const value = inv.cogsByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return restockAtCost(it, q, value, { method, date: inv.date, ref: inv.number, warehouseId: wh, defaultWarehouseId: defWh })
      }),
    }))
  },

  // ─── CUSTOMER ADVANCES (deposits / money on account) ───────────
  //
  // A deposit is a liability, not revenue and not a negative receivable:
  // the cash is in the bank but the work is not done. See utils/advances.js.
  customerAdvances: [],

  receiveAdvance: (input) => {
    const check = validateAdvance(input)
    if (!check.ok) throw new Error(`ADVANCE_INVALID:${check.error}`)
    const amount = Math.round((Number(input.amount) || 0) * 100) / 100
    const ref = `Advance from ${input.customerName || ''}`.trim()

    const je = get().addJournalEntry({
      date: input.date, description: ref, type: 'advance',
      lines: receiveLines(amount, input.bankAccountId, ref),
    })

    const advance = {
      ...input, id: uuid(), amount, applications: [], refunded: 0,
      journalEntryId: je.id, createdAt: new Date().toISOString(),
    }
    set((s) => ({ customerAdvances: [...s.customerAdvances, advance] }))
    get().logActivity('Received customer advance', `${input.customerName || ''} · ${amount}`, {
      entity: 'advance', entityId: advance.id,
    })
    return advance
  },

  /**
   * Put some of an advance against an invoice.
   *
   * Routed through recordInvoicePayment with the advance account standing
   * in for the bank, so the invoice ends up with the same paid status,
   * receipt number and FX treatment as any other settlement.
   */
  applyAdvance: (advanceId, invoiceId, { amount, date } = {}) => {
    const advance = get().customerAdvances.find((a) => a.id === advanceId)
    const invoice = get().invoices.find((i) => i.id === invoiceId)
    if (!advance || !invoice) return
    if (invoice.customerId !== advance.customerId)
      throw new Error('ADVANCE_WRONG_CUSTOMER')

    const most = applicableAmount(advance, invoice)
    const want = amount == null ? most : Math.round((Number(amount) || 0) * 100) / 100
    const apply = Math.min(most, want)
    if (apply <= 0) return

    const when = date || todayISO()
    const res = get().recordInvoicePayment(invoiceId, {
      amount: apply, date: when, fromAccountId: ADVANCE_ACCOUNT,
      source: 'advance', advanceId, method: 'Advance applied',
    })
    if (!res || res.amount <= 0) return

    set((s) => ({
      customerAdvances: s.customerAdvances.map((a) => (a.id === advanceId ? {
        ...a,
        applications: [...(a.applications || []), {
          id: uuid(), invoiceId, invoiceNumber: invoice.number,
          amount: res.amount, date: when, journalEntryId: res.journalEntryId,
        }],
      } : a)),
    }))
    get().logActivity('Applied advance to invoice', `${invoice.number} · ${res.amount}`, {
      entity: 'advance', entityId: advanceId, entityRef: invoice.number,
    })
    return res
  },

  refundAdvance: (advanceId, { amount, date, bankAccountId } = {}) => {
    const advance = get().customerAdvances.find((a) => a.id === advanceId)
    if (!advance) return
    const available = advanceBalance(advance)
    const want = amount == null ? available : Math.round((Number(amount) || 0) * 100) / 100
    const give = Math.min(available, want)
    if (give <= 0) throw new Error('ADVANCE_NOTHING_TO_REFUND')
    const bank = bankAccountId || advance.bankAccountId
    if (!bank) throw new Error('ADVANCE_NO_BANK')

    const when = date || todayISO()
    const ref = `Refund of advance to ${advance.customerName || ''}`.trim()
    const je = get().addJournalEntry({
      date: when, description: ref, type: 'advance_refund',
      lines: refundLines(give, bank, ref),
    })
    set((s) => ({
      customerAdvances: s.customerAdvances.map((a) => (a.id === advanceId
        ? { ...a, refunded: Math.round(((Number(a.refunded) || 0) + give) * 100) / 100, refundJournalEntryId: je.id }
        : a)),
    }))
    get().logActivity('Refunded customer advance', `${advance.customerName || ''} · ${give}`, {
      entity: 'advance', entityId: advanceId, severity: 'warning',
    })
    return { amount: give, journalEntryId: je.id }
  },

  /** Credit a customer is holding with you, across every open advance. */
  customerCreditBalance: (customerId) => customerCredit(get().customerAdvances, customerId),

  deleteAdvance: (id) => {
    const advance = get().customerAdvances.find((a) => a.id === id)
    if (!advance) return
    // Once any of it has been applied or refunded the ledger has moved on;
    // removing the record would orphan those entries.
    if (appliedTotal(advance) > 0 || (Number(advance.refunded) || 0) > 0)
      throw new Error('ADVANCE_IN_USE')
    get().recycleRecord('customerAdvances', id)
    set((s) => ({ customerAdvances: s.customerAdvances.filter((a) => a.id !== id) }))
    get().logActivity('Deleted customer advance', `${advance.customerName || ''}`, {
      entity: 'advance', entityId: id, severity: 'warning',
    })
  },

  // ─── QUOTATIONS / ESTIMATES ────────────────────────────────────
  quotations: [],

  addQuotation: (q) => {
    const s = get()
    const { prefix, next } = s.settings.quotation
    const number = nextNum(prefix, next)
    const newQ = { ...q, id: uuid(), number, status: 'sent', createdAt: new Date().toISOString() }
    set((st) => ({
      quotations: [...st.quotations, newQ],
      settings: { ...st.settings, quotation: { ...st.settings.quotation, next: next + 1 } },
    }))
    return newQ
  },

  updateQuotation: (id, patch) =>
    set((s) => ({ quotations: s.quotations.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),

  deleteQuotation: (id) => {
    get().recycleRecord('quotations', id)
    return set((s) => ({ quotations: s.quotations.filter((q) => q.id !== id) }))
  },

  // Convert a quotation to an invoice — in full, or partially by passing a
  // { lineId: qty } selection. Each source line tracks how much has been
  // invoiced (invoicedQty), so the remainder stays an open backorder and can
  // be invoiced later. Omitting `selections` invoices everything remaining.
  convertQuotationToInvoice: (id, selections) => {
    const q = get().quotations.find((x) => x.id === id)
    if (!q || q.status === 'invoiced') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(q.items || [], 'invoicedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'invoicedQty', taxEnabled })
    if (items.length === 0) return null
    const invoice = get().addInvoice({
      customerId: q.customerId, customerName: q.customerName,
      date: todayISO(),
      dueDate: q.expiryDate || todayISO(),
      departmentId: q.departmentId || null,
      currency: q.currency, exchangeRate: q.exchangeRate,
      items, subtotal, taxAmount, total, notes: q.notes || '',
    })
    const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, invoicedQty: (Number(l.invoicedQty) || 0) + applied[l.id] } : l))
    const status = docFulfillment(newItems, 'invoicedQty').status === 'complete' ? 'invoiced' : 'partial'
    get().updateQuotation(id, { items: newItems, status, invoiceId: invoice.id, invoiceIds: [...(q.invoiceIds || []), invoice.id] })
    return invoice
  },

  // ─── PAYMENT TERMS ─────────────────────────────────────────────
  updatePaymentTerms: (patch) => {
    const merged = { ...defaultTerms(), ...get().settings.terms, ...patch }
    const check = validateTerms(merged)
    if (!check.ok) throw new Error(`TERMS_INVALID:${check.errors.join(' ')}`)
    set((s) => ({ settings: { ...s.settings, terms: merged } }))
  },

  /** The terms that apply to a customer or supplier, falling back to company default. */
  termsFor: (kind, partyId) => {
    const st = get()
    const slice = kind === 'customer' ? st.customers : st.suppliers
    const party = (slice || []).find((r) => r.id === partyId)
    return resolveTerms(party, { ...defaultTerms(), ...st.settings.terms })
  },

  /** Due date implied by the party's terms. */
  dueDateFrom: (kind, partyId, date) => dueDateFor(date, get().termsFor(kind, partyId)),

  /** What settling this invoice on `payDate` would cost, and the discount. */
  settlementOffer: (invoiceId, payDate) => {
    const st = get()
    const invoice = st.invoices.find((i) => i.id === invoiceId)
    if (!invoice) return null
    return settlementDiscount(invoice, payDate, st.termsFor('customer', invoice.customerId), {
      taxEnabled: st.settings?.tax?.enabled !== false,
    })
  },

  /**
   * Write off an early-settlement discount.
   *
   * Posted as its own entry rather than folded into the receipt, so the
   * discount and the tax it reverses are both visible in the ledger — and
   * so the receipt still shows the cash that actually arrived.
   */
  postSettlementDiscount: (invoiceId, payDate) => {
    const st = get()
    const invoice = st.invoices.find((i) => i.id === invoiceId)
    if (!invoice) throw new Error('INVOICE_NOT_FOUND')
    const disc = get().settlementOffer(invoiceId, payDate)
    if (!disc?.eligible) throw new Error(`DISCOUNT_NOT_AVAILABLE:${disc?.reason || 'unknown'}`)

    const je = get().addJournalEntry({
      date: payDate,
      description: `Settlement discount — ${invoice.number}`,
      reference: invoice.number,
      type: 'settlement_discount',
      lines: discountLines(disc, {
        receivableAccountId: get().controlAccountFor('customers', invoice.customerId),
        reference: invoice.number,
      }),
    })

    // The discount settles part of the invoice: it is no longer collectable.
    set((s) => ({
      invoices: s.invoices.map((i) => (i.id === invoiceId
        ? {
            ...i,
            amountPaid: Math.round((Number(i.amountPaid) || 0) * 100 + disc.discountGross * 100) / 100,
            settlementDiscount: disc.discountGross,
            settlementDiscountJournalEntryId: je.id,
          }
        : i)),
    }))
    get().logActivity('Allowed settlement discount', `${invoice.number} · ${disc.discountGross}`, {
      entity: 'invoice', entityId: invoiceId, entityRef: invoice.number,
    })
    return { journalEntryId: je.id, ...disc }
  },

  // ─── DOCUMENT BRANDING ─────────────────────────────────────────
  updateBranding: (patch) => {
    const check = validateBranding(patch)
    if (!check.ok) throw new Error(`BRANDING_INVALID:${check.errors.join(' ')}`)
    set((s) => ({
      settings: { ...s.settings, branding: { ...defaultBranding(), ...s.settings.branding, ...patch } },
    }))
  },

  /** Per-document overrides, merged rather than replaced. */
  updateDocBranding: (docType, patch) =>
    set((s) => {
      const base = { ...defaultBranding(), ...s.settings.branding }
      return {
        settings: {
          ...s.settings,
          branding: {
            ...base,
            perDoc: { ...(base.perDoc || {}), [docType]: { ...((base.perDoc || {})[docType] || {}), ...patch } },
          },
        },
      }
    }),

  /** Called once the old in-settings logo has been copied to IndexedDB. */
  clearLegacyLogo: () =>
    set((s) => ({ settings: { ...s.settings, company: { ...s.settings.company, logo: '' } } })),

  // ─── SALES ORDERS ──────────────────────────────────────────────
  // A confirmed order that has not been delivered or invoiced yet.
  //
  // It posts nothing. A customer agreeing to buy is not a sale — revenue
  // is earned when the goods go out or the invoice is raised, and booking
  // it earlier would overstate both income and receivables. The value of
  // the document is that it holds the commitment: what is owed to the
  // customer, what is still to ship, and what is left to bill.
  salesOrders: [],

  addSalesOrder: (o) => {
    const s = get()
    const { prefix, next } = s.settings.salesOrder
    const number = nextNum(prefix, next)
    const newSO = { ...o, id: uuid(), number, status: o.status || 'open', createdAt: new Date().toISOString() }
    set((st) => ({
      salesOrders: [...st.salesOrders, newSO],
      settings: { ...st.settings, salesOrder: { ...st.settings.salesOrder, next: next + 1 } },
    }))
    get().logActivity('Created sales order', `${number} · ${o.customerName || ''}`.trim(), { entity: 'salesOrder', entityId: newSO.id, entityRef: number })
    return newSO
  },

  updateSalesOrder: (id, patch) =>
    set((s) => ({ salesOrders: s.salesOrders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

  deleteSalesOrder: (id) => {
    get().recycleRecord('salesOrders', id)
    return set((s) => ({ salesOrders: s.salesOrders.filter((o) => o.id !== id) }))
  },

  /** Quotation → sales order, in full or partially. */
  convertQuotationToSalesOrder: (id, selections) => {
    const q = get().quotations.find((x) => x.id === id)
    if (!q) return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(q.items || [], 'orderedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(q.items || [], sel, { key: 'orderedQty', taxEnabled })
    if (items.length === 0) return null
    const order = get().addSalesOrder({
      customerId: q.customerId, customerName: q.customerName,
      quotationId: q.id,
      date: todayISO(),
      expectedDate: q.expiryDate || '',
      departmentId: q.departmentId || null,
      currency: q.currency, exchangeRate: q.exchangeRate,
      items, subtotal, taxAmount, total, notes: q.notes || '',
    })
    const newItems = (q.items || []).map((l) => (applied[l.id] ? { ...l, orderedQty: (Number(l.orderedQty) || 0) + applied[l.id] } : l))
    const status = docFulfillment(newItems, 'orderedQty').status === 'complete' ? 'ordered' : q.status
    get().updateQuotation(id, { items: newItems, status, salesOrderId: order.id })
    return order
  },

  /** Sales order → invoice. Each line remembers how much has been billed. */
  convertSalesOrderToInvoice: (id, selections) => {
    const o = get().salesOrders.find((x) => x.id === id)
    if (!o || o.status === 'invoiced') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(o.items || [], 'invoicedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(o.items || [], sel, { key: 'invoicedQty', taxEnabled })
    if (items.length === 0) return null
    const invoice = get().addInvoice({
      customerId: o.customerId, customerName: o.customerName,
      salesOrderId: o.id,
      date: todayISO(),
      dueDate: o.expectedDate || todayISO(),
      departmentId: o.departmentId || null,
      currency: o.currency, exchangeRate: o.exchangeRate,
      items, subtotal, taxAmount, total, notes: o.notes || '',
    })
    const newItems = (o.items || []).map((l) => (applied[l.id] ? { ...l, invoicedQty: (Number(l.invoicedQty) || 0) + applied[l.id] } : l))
    const done = docFulfillment(newItems, 'invoicedQty').status === 'complete'
    get().updateSalesOrder(id, {
      items: newItems,
      status: done ? 'invoiced' : 'partial',
      invoiceIds: [...(o.invoiceIds || []), invoice.id],
    })
    return invoice
  },

  /** Sales order → delivery note, tracked separately from billing. */
  convertSalesOrderToDeliveryNote: (id, selections) => {
    const o = get().salesOrders.find((x) => x.id === id)
    if (!o) return null
    const sel = selections || defaultSelection(o.items || [], 'deliveredQty')
    const { items, applied } = buildConversion(o.items || [], sel, { key: 'deliveredQty', taxEnabled: false })
    if (items.length === 0) return null
    const dn = get().addDeliveryNote({
      customerId: o.customerId, customerName: o.customerName,
      salesOrderId: o.id,
      date: todayISO(),
      items, notes: o.notes || '',
    })
    const newItems = (o.items || []).map((l) => (applied[l.id] ? { ...l, deliveredQty: (Number(l.deliveredQty) || 0) + applied[l.id] } : l))
    get().updateSalesOrder(id, {
      items: newItems,
      deliveryNoteIds: [...(o.deliveryNoteIds || []), dn.id],
    })
    return dn
  },

  // ─── CREDIT NOTES (Sales Returns) ──────────────────────────────
  creditNotes: [],

  addCreditNote: (cn) => {
    const s = get()
    const { prefix, next } = s.settings.creditNote
    const number = nextNum(prefix, next)
    const lines = [
      { accountId: 'acc-salesret', debit: cn.subtotal, credit: 0, description: `Credit Note ${number}` },
    ]
    if (cn.taxAmount > 0)
      lines.push({ accountId: 'acc-vatout', debit: cn.taxAmount, credit: 0, description: 'Output Tax reversal' })
    lines.push({ accountId: get().controlAccountFor('customers', cn.customerId), debit: 0, credit: cn.total, description: `CN ${number}` })
    const je = get().addJournalEntry({
      date: cn.date,
      description: `Credit Note ${number} – ${cn.customerName || ''}`,
      reference: number, type: 'credit_note', lines,
    })
    const newCN = { ...cn, id: uuid(), number, status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString() }
    set((st) => ({
      creditNotes: [...st.creditNotes, newCN],
      settings: { ...st.settings, creditNote: { ...st.settings.creditNote, next: next + 1 } },
    }))
    return newCN
  },

  // Sales return (RMA): raise a credit note FROM an invoice by picking the
  // quantities coming back. Reverses the sale proportionally (Dr Sales
  // Returns + Dr output VAT, Cr AR), and for stocked lines puts the goods
  // back and reverses COGS at current average cost. Tracks returnedQty so a
  // line can't be over-returned.
  createSalesReturn: (invoiceId, selections, { date, reason } = {}) => {
    const inv = get().invoices.find((i) => i.id === invoiceId)
    if (!inv || inv.status === 'void') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(inv.items || [], 'returnedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(inv.items || [], sel, { key: 'returnedQty', taxEnabled })
    if (items.length === 0) return null
    const rate = Number(inv.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const rDate = date || todayISO()
    const { prefix, next } = get().settings.creditNote
    const number = nextNum(prefix, next)

    const netBase = items.reduce((s, l) => s + toBase(l.subtotal), 0)
    const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
    const arBase = Math.round((netBase + vatBase) * 100) / 100
    const lines = [{ accountId: 'acc-salesret', debit: netBase, credit: 0, description: `Credit Note ${number}` }]
    if (vatBase > 0) lines.push({ accountId: 'acc-vatout', debit: vatBase, credit: 0, description: 'Output Tax reversal' })
    lines.push({ accountId: get().controlAccountFor('customers', inv.customerId), debit: 0, credit: arBase, description: `Credit Note ${number} for ${inv.number}` })
    const je = get().addJournalEntry({ date: rDate, description: `Sales Return ${number} – ${inv.customerName || ''}`, reference: number, type: 'credit_note', departmentId: inv.departmentId || null, lines })

    // Restock returned stock + reverse COGS at current average cost.
    const cogsByAcc = {}, invByAcc = {}, restock = {}, cogsByItem = {}
    let cogs = 0
    // A returned kit puts its components back, not the kit — the same
    // explosion the sale used, so what comes back matches what went out.
    Object.entries(explodeLines(items, get().inventoryItems)).forEach(([itemId, qty]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId); if (!it) return
      restock[itemId] = (restock[itemId] || 0) + qty
      // Goods coming back join the queue at the cost they are carried at,
      // rather than jumping to the front — the units are physically newer
      // than anything already on the shelf, and FIFO follows the shelf.
      const amt = Math.round(qty * (it.costPrice || 0) * 100) / 100
      if (amt <= 0) return
      cogs += amt
      cogsByItem[itemId] = Math.round(((cogsByItem[itemId] || 0) + amt) * 100) / 100
      const cAcc = it.cogsAccountId || 'acc-cogs', iAcc = it.inventoryAccountId || 'acc-inv'
      invByAcc[iAcc] = (invByAcc[iAcc] || 0) + amt
      cogsByAcc[cAcc] = (cogsByAcc[cAcc] || 0) + amt
    })
    let cogsJeId = null
    if (cogs > 0) {
      const cje = get().addJournalEntry({
        date: rDate, description: `Restock – Return ${number}`, reference: number, type: 'cogs',
        departmentId: inv.departmentId || null,
        lines: [
          ...Object.entries(invByAcc).map(([a, amt]) => ({ accountId: a, debit: amt, credit: 0, description: 'Inventory returned' })),
          ...Object.entries(cogsByAcc).map(([a, amt]) => ({ accountId: a, debit: 0, credit: amt, description: 'COGS reversal' })),
        ],
      })
      cogsJeId = cje.id
    }
    const defWh = defaultWh(get())
    const wh = whOf(get(), inv)
    const method = get().costingMethod()
    set((st) => ({ inventoryItems: st.inventoryItems.map((it) => {
      const q = restock[it.id]; if (!q) return it
      // Joins the back of the FIFO queue at the value just debited to
      // inventory, so layers and quantity stay in step.
      return restockAtCost(it, q, cogsByItem[it.id] || 0, { method, date: rDate, ref: number, warehouseId: wh, defaultWarehouseId: defWh })
    }) }))
    Object.entries(restock).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: rDate, type: 'return', qtyChange: q, ref: number, note: `Return from ${inv.customerName || 'customer'}` })
    })

    const cn = {
      id: uuid(), number, invoiceId, invoiceNumber: inv.number,
      customerId: inv.customerId, customerName: inv.customerName, date: rDate, reason: reason || '',
      currency: inv.currency, exchangeRate: rate, items, subtotal, taxAmount, total,
      status: 'issued', journalEntryId: je.id, cogsJournalEntryId: cogsJeId, createdAt: new Date().toISOString(),
      cogsTotal: Math.round(cogs * 100) / 100, cogsByItem,
    }
    const newItems = (inv.items || []).map((l) => (applied[l.id] ? { ...l, returnedQty: (Number(l.returnedQty) || 0) + applied[l.id] } : l))
    set((st) => ({
      creditNotes: [...st.creditNotes, cn],
      invoices: st.invoices.map((i) => (i.id === invoiceId ? { ...i, items: newItems, creditNoteIds: [...(i.creditNoteIds || []), cn.id] } : i)),
      settings: { ...st.settings, creditNote: { ...st.settings.creditNote, next: next + 1 } },
    }))
    get().logActivity('Sales return', `${number} · ${inv.number}`)
    return cn
  },

  // Purchase return: raise a debit note FROM a bill. Reverses the purchase
  // proportionally (Dr AP, Cr input VAT, Cr Inventory/Expense) and removes
  // the returned stock. Tracks returnedQty on the bill lines.
  createPurchaseReturn: (purchaseId, selections, { date, reason } = {}) => {
    const pur = get().purchases.find((p) => p.id === purchaseId)
    if (!pur || pur.status === 'void') return null
    const taxEnabled = get().settings?.tax?.enabled !== false
    const sel = selections || defaultSelection(pur.items || [], 'returnedQty')
    const { items, applied, subtotal, taxAmount, total } = buildConversion(pur.items || [], sel, { key: 'returnedQty', taxEnabled })
    if (items.length === 0) return null
    const rate = Number(pur.exchangeRate) || 1
    const toBase = (v) => Math.round((Number(v) || 0) * rate * 100) / 100
    const rDate = date || todayISO()
    const { prefix, next } = get().settings.debitNote
    const number = nextNum(prefix, next)

    const creditByAcc = {}, remove = {}, valueByItem = {}
    items.forEach((l) => {
      const item = l.itemId ? get().inventoryItems.find((i) => i.id === l.itemId) : null
      // A stocked line was debited to inventory on the bill, so the return
      // credits inventory; a service line was an expense, so it credits that.
      const stocked = isStocked(item)
      const acc = stocked ? (item.inventoryAccountId || 'acc-inv') : (l.accountId || 'acc-admin')
      creditByAcc[acc] = (creditByAcc[acc] || 0) + toBase(l.subtotal)
      if (stocked) {
        remove[l.itemId] = (remove[l.itemId] || 0) + (Number(l.quantity) || 0)
        valueByItem[l.itemId] = Math.round(((valueByItem[l.itemId] || 0) + toBase(l.subtotal)) * 100) / 100
      }
    })
    const netBase = Object.values(creditByAcc).reduce((s, v) => s + v, 0)
    const vatBase = items.reduce((s, l) => s + toBase(l.taxAmount), 0)
    const apBase = Math.round((netBase + vatBase) * 100) / 100
    const lines = [{ accountId: get().controlAccountFor('suppliers', pur.supplierId), debit: apBase, credit: 0, description: `Debit Note ${number} for ${pur.number}` }]
    if (vatBase > 0) lines.push({ accountId: 'acc-vatin', debit: 0, credit: vatBase, description: 'Input Tax reversal' })
    Object.entries(creditByAcc).forEach(([a, amt]) => lines.push({ accountId: a, debit: 0, credit: amt, description: 'Goods returned' }))
    const je = get().addJournalEntry({ date: rDate, description: `Purchase Return ${number} – ${pur.supplierName || ''}`, reference: number, type: 'debit_note', departmentId: pur.departmentId || null, lines })

    const defWh = defaultWh(get())
    const wh = whOf(get(), pur)
    const method = get().costingMethod()
    // The units go back out at what the bill put them in at: off the
    // bill's own FIFO layer, and out of the weighted average by the same
    // value just credited to inventory.
    set((st) => ({ inventoryItems: st.inventoryItems.map((it) => {
      const q = remove[it.id]; if (!q) return it
      return unstockAtCost(it, q, valueByItem[it.id] || 0, { method, ref: pur.number, warehouseId: wh, defaultWarehouseId: defWh })
    }) }))
    Object.entries(remove).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: rDate, type: 'return', qtyChange: -q, ref: number, note: `Return to ${pur.supplierName || 'supplier'}` })
    })

    const dn = {
      id: uuid(), number, purchaseId, purchaseNumber: pur.number,
      supplierId: pur.supplierId, supplierName: pur.supplierName, date: rDate, reason: reason || '',
      currency: pur.currency, exchangeRate: rate, items, subtotal, taxAmount, total,
      status: 'issued', journalEntryId: je.id, createdAt: new Date().toISOString(), valueByItem,
    }
    const newItems = (pur.items || []).map((l) => (applied[l.id] ? { ...l, returnedQty: (Number(l.returnedQty) || 0) + applied[l.id] } : l))
    set((st) => ({
      debitNotes: [...st.debitNotes, dn],
      purchases: st.purchases.map((p) => (p.id === purchaseId ? { ...p, items: newItems, debitNoteIds: [...(p.debitNoteIds || []), dn.id] } : p)),
      settings: { ...st.settings, debitNote: { ...st.settings.debitNote, next: next + 1 } },
    }))
    get().logActivity('Purchase return', `${number} · ${pur.number}`)
    return dn
  },

  // Deleting a credit note undoes all of it. A sales return also restocked
  // goods, reversed cost of sales and marked the invoice lines returned;
  // removing only the credit entry left the goods on the shelf, the COGS
  // reversal in the ledger and the invoice unable to be returned again.
  deleteCreditNote: (id) => {
    const cn = get().creditNotes.find((c) => c.id === id)
    if (!cn) return
    get().assertJEsUnlocked(cn.journalEntryId, cn.cogsJournalEntryId)
    const jeIds = new Set([cn.journalEntryId, cn.cogsJournalEntryId].filter(Boolean))
    const back = cn.invoiceId ? explodeLines(cn.items || [], get().inventoryItems) : {}
    const giveBack = {}
    ;(cn.items || []).forEach((l) => {
      if (l.sourceLineId) giveBack[l.sourceLineId] = (giveBack[l.sourceLineId] || 0) + (Number(l.quantity) || 0)
    })
    const defWh = defaultWh(get())
    const wh = whOf(get(), get().invoices.find((i) => i.id === cn.invoiceId))
    const method = get().costingMethod()
    set((s) => ({
      creditNotes: s.creditNotes.filter((c) => c.id !== id),
      journalEntries: keepEntries(s.journalEntries, (j) => !jeIds.has(j.id)),
      stockMovements: cn.invoiceId ? s.stockMovements.filter((m) => m.ref !== cn.number) : s.stockMovements,
      inventoryItems: s.inventoryItems.map((it) => {
        const q = back[it.id]
        if (!q) return it
        const value = cn.cogsByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return unstockAtCost(it, q, value, { method, ref: cn.number, warehouseId: wh, defaultWarehouseId: defWh })
      }),
      invoices: cn.invoiceId ? s.invoices.map((i) => (i.id !== cn.invoiceId ? i : {
        ...i,
        items: (i.items || []).map((l) => (giveBack[l.id]
          ? { ...l, returnedQty: Math.max(0, Math.round(((Number(l.returnedQty) || 0) - giveBack[l.id]) * 1e6) / 1e6) }
          : l)),
        creditNoteIds: (i.creditNoteIds || []).filter((x) => x !== id),
      })) : s.invoices,
    }))
    get().logActivity('Deleted credit note', `${cn.number}${cn.invoiceNumber ? ' · ' + cn.invoiceNumber : ''}`)
  },

  /**
   * Void a credit note the audit-safe way: reverse its entries on an open
   * date, take any restocked goods back off the shelf, reopen the invoice
   * lines it returned, and keep the note itself marked void.
   */
  voidCreditNote: (id, { date, reason } = {}) => {
    const cn = get().creditNotes.find((c) => c.id === id)
    if (!cn || cn.status === 'void') return
    const voidDate = date || todayISO()
    ;[cn.journalEntryId, cn.cogsJournalEntryId].filter(Boolean).forEach((jeId) => {
      const je = get().journalEntries.find((j) => j.id === jeId)
      if (je && !je.reversedBy) get().voidJournalEntry(jeId, { date: voidDate, reason: reason || `Void ${cn.number}` })
    })
    const back = cn.invoiceId ? explodeLines(cn.items || [], get().inventoryItems) : {}
    const giveBack = {}
    ;(cn.items || []).forEach((l) => {
      if (l.sourceLineId) giveBack[l.sourceLineId] = (giveBack[l.sourceLineId] || 0) + (Number(l.quantity) || 0)
    })
    const defWh = defaultWh(get())
    const wh = whOf(get(), get().invoices.find((i) => i.id === cn.invoiceId))
    const method = get().costingMethod()
    set((s) => ({
      creditNotes: s.creditNotes.map((c) => (c.id === id ? { ...c, status: 'void', voidReason: reason || '', voidedAt: new Date().toISOString() } : c)),
      inventoryItems: s.inventoryItems.map((it) => {
        const q = back[it.id]
        if (!q) return it
        const value = cn.cogsByItem?.[it.id] ?? q * (Number(it.costPrice) || 0)
        return unstockAtCost(it, q, value, { method, ref: cn.number, warehouseId: wh, defaultWarehouseId: defWh })
      }),
      invoices: cn.invoiceId ? s.invoices.map((i) => (i.id !== cn.invoiceId ? i : {
        ...i,
        items: (i.items || []).map((l) => (giveBack[l.id]
          ? { ...l, returnedQty: Math.max(0, Math.round(((Number(l.returnedQty) || 0) - giveBack[l.id]) * 1e6) / 1e6) }
          : l)),
      })) : s.invoices,
    }))
    Object.entries(back).forEach(([itemId, q]) => {
      const it = get().inventoryItems.find((i) => i.id === itemId)
      get().logStockMovement({ itemId, itemName: it?.name || '', date: voidDate, type: 'void', qtyChange: -q, ref: cn.number, note: 'Credit note voided' })
    })
    get().logActivity('Voided credit note', `${cn.number}${reason ? ' · ' + reason : ''}`)
  },

  // ─── RECURRING / SUBSCRIPTION INVOICES ─────────────────────────
  recurringInvoices: [],

  addRecurringInvoice: (rec) => {
    const s = get()
    const { prefix, next } = s.settings.recurring
    const number = nextNum(prefix, next)
    const newRec = { ...rec, id: uuid(), number, status: 'active', generatedCount: 0, lastGenerated: null, createdAt: new Date().toISOString() }
    set((st) => ({
      recurringInvoices: [...st.recurringInvoices, newRec],
      settings: { ...st.settings, recurring: { ...st.settings.recurring, next: next + 1 } },
    }))
    return newRec
  },

  updateRecurringInvoice: (id, patch) =>
    set((s) => ({ recurringInvoices: s.recurringInvoices.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  deleteRecurringInvoice: (id) => {
    get().recycleRecord('recurringInvoices', id)
    return set((s) => ({ recurringInvoices: s.recurringInvoices.filter((r) => r.id !== id) }))
  },

  // Month-based steps preserve the day-of-month, clamped to the target
  // month's last day so Jan 31 → Feb 28/29 (never drifts into March, never
  // skips February). The rule lives in utils/cashForecast.js because the
  // cash forecast has to predict exactly what this posts — sharing one
  // function is what stops the projection and the posting from diverging.
  advanceDate: (dateStr, frequency) => advanceDate(dateStr, frequency),

  // ─── DELIVERY NOTES ────────────────────────────────────────────
  deliveryNotes: [],

  addDeliveryNote: (dn) => {
    const s = get()
    const { prefix, next } = s.settings.delivery
    const number = nextNum(prefix, next)
    const newDN = { ...dn, id: uuid(), number, status: dn.status || 'pending', createdAt: new Date().toISOString() }
    set((st) => ({
      deliveryNotes: [...st.deliveryNotes, newDN],
      settings: { ...st.settings, delivery: { ...st.settings.delivery, next: next + 1 } },
    }))
    return newDN
  },

  updateDeliveryNote: (id, patch) =>
    set((s) => ({ deliveryNotes: s.deliveryNotes.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),

  deleteDeliveryNote: (id) => {
    get().recycleRecord('deliveryNotes', id)
    return set((s) => ({ deliveryNotes: s.deliveryNotes.filter((d) => d.id !== id) }))
  },

  // ─── CRM · SALES PIPELINE ──────────────────────────────────────
  leads: [],

  addLead: (lead) =>
    set((s) => ({ leads: [...s.leads, { ...lead, id: uuid(), stage: lead.stage || 'new', createdAt: new Date().toISOString() }] })),

  updateLead: (id, patch) =>
    set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

  deleteLead: (id) => {
    get().recycleRecord('leads', id)
    return set((s) => ({ leads: s.leads.filter((l) => l.id !== id) }))
  },

  convertLeadToCustomer: (id) => {
    const lead = get().leads.find((l) => l.id === id)
    if (!lead) return null
    const cust = get().addCustomer({
      name: lead.company || lead.name, email: lead.email || '', phone: lead.phone || '',
      address: lead.address || '', taxId: '', contactPerson: lead.name || '',
    })
    get().updateLead(id, { stage: 'won', convertedCustomerId: cust?.id })
    return cust
  },
})
