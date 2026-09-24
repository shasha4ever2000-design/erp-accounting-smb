// Bank and cash accounts, cheques, transfers, reconciliation and currencies.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { CHEQUE_IN, canTransition, validateCheque, chequeLines, isTerminal } from '../utils/cheques'
import { todayISO } from '../utils/localDate'
import { DEFAULT_BANK_ACCOUNTS, keepEntries, addDaysISO } from './shared'

export const createBankingSlice = (set, get) => ({
  // ─── BANK ACCOUNTS (Cash & Cash Equivalents) ───────────────────
  bankAccounts: DEFAULT_BANK_ACCOUNTS,

  addBankAccount: (ba) => {
    const accId = uuid()
    const baId  = uuid()
    set((st) => {
      const usedCodes = new Set(st.accounts.map((a) => a.code))
      let n = 1003
      while (usedCodes.has(String(n))) n++
      const code = ba.code || String(n)
      return {
        // The currency lives on the GL account as well as the bank record.
        // FX revaluation walks the chart looking for accounts tagged with a
        // non-base currency (see Revaluation.jsx), so writing it through is
        // what makes a foreign-currency bank account revaluable at all —
        // rather than the user having to remember to tag it separately in
        // the Chart of Accounts.
        accounts: [...st.accounts, { id: accId, code, name: ba.name, type: 'asset', subtype: 'current', isSystem: false, currency: ba.currency || '' }],
        bankAccounts: [...st.bankAccounts, { id: baId, accountId: accId, name: ba.name, type: ba.type || 'bank', bankName: ba.bankName || '', accountNumber: ba.accountNumber || '', currency: ba.currency || '', isDefault: false }],
      }
    })
  },

  updateBankAccount: (id, patch) => {
    const before = get().bankAccounts.find((b) => b.id === id)
    set((s) => ({ bankAccounts: s.bankAccounts.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
    // Keep the GL account's currency in step, or revaluation would go on
    // using the old one — the two are one fact stored twice.
    if (before && 'currency' in patch && patch.currency !== before.currency) {
      set((s) => ({
        accounts: s.accounts.map((a) => (a.id === before.accountId ? { ...a, currency: patch.currency || '' } : a)),
      }))
    }
  },

  /**
   * The accounts money can actually be paid into or out of: cash on hand
   * and every bank account set up under Cash & Bank. Payment dialogs used
   * to build this list themselves — one offered only the two default
   * accounts, another every current asset, down to Accounts Receivable
   * and Inventory.
   */
  cashAccountOptions: () => {
    const s = get()
    const ids = new Set(['acc-cash', ...(s.bankAccounts || []).map((b) => b.accountId).filter(Boolean)])
    return s.accounts.filter((a) => ids.has(a.id))
  },

  deleteBankAccount: (id) =>
    set((s) => ({ bankAccounts: s.bankAccounts.filter((b) => b.id !== id) })),

  // ─── CHEQUE REGISTER (post-dated cheques) ──────────────────────
  //
  // A cheque is a promise, not cash. It sits in Cheques Under Collection
  // (received) or Cheques Payable (issued) until it actually clears, so a
  // drawer full of post-dated cheques never flatters the bank balance.
  // See utils/cheques.js for the full posting map.
  cheques: [],

  addCheque: (input) => {
    const check = validateCheque(input)
    if (!check.ok) throw new Error(`CHEQUE_INVALID:${check.error}`)

    const direction = input.direction
    const kind = direction === CHEQUE_IN ? 'customers' : 'suppliers'
    const partyAccountId = get().controlAccountFor(kind, input.partyId)
    const amount = Math.round((Number(input.amount) || 0) * 100) / 100
    const date = input.issueDate || input.dueDate

    const je = get().addJournalEntry({
      date,
      description: direction === CHEQUE_IN
        ? `Cheque ${input.number} received from ${input.partyName || ''}`.trim()
        : `Cheque ${input.number} issued to ${input.partyName || ''}`.trim(),
      reference: input.number, type: 'cheque',
      lines: chequeLines('receive', { direction, amount, partyAccountId, number: input.number }),
    })

    const cheque = {
      ...input, id: uuid(), amount, status: 'pending',
      partyAccountId, journalEntryId: je.id,
      events: [{ status: 'pending', date, journalEntryId: je.id }],
      createdAt: new Date().toISOString(),
    }
    set((s) => ({ cheques: [...s.cheques, cheque] }))
    get().logActivity(
      direction === CHEQUE_IN ? 'Recorded cheque received' : 'Recorded cheque issued',
      `${input.number} · ${input.partyName || ''} · due ${input.dueDate}`,
      { entity: 'cheque', entityId: cheque.id, entityRef: input.number },
    )
    return cheque
  },

  /**
   * Move a cheque along its lifecycle, posting whatever that costs.
   *
   * Depositing posts nothing — the cheque has left the drawer but not the
   * payer's account, so no balance has changed yet. Clearing, bouncing and
   * cancelling each post, and a bounce is a reversal rather than a delete,
   * so the debt returns and the history survives to inform the next credit
   * decision.
   */
  setChequeStatus: (id, to, { date, bankAccountId, reason } = {}) => {
    const cheque = get().cheques.find((c) => c.id === id)
    if (!cheque) return
    if (!canTransition(cheque.direction, cheque.status, to))
      throw new Error(`CHEQUE_BAD_TRANSITION:${cheque.status}->${to}`)

    const when = date || todayISO()
    let jeId = null

    if (to === 'cleared' || to === 'bounced' || to === 'cancelled') {
      const bank = bankAccountId || cheque.bankAccountId
      if (to === 'cleared' && !bank) throw new Error('CHEQUE_NO_BANK')
      const event = to === 'cleared' ? 'clear' : to === 'bounced' ? 'bounce' : 'cancel'
      const verb = to === 'cleared' ? 'cleared' : to === 'bounced' ? 'returned unpaid' : 'cancelled'
      const je = get().addJournalEntry({
        date: when,
        description: `Cheque ${cheque.number} ${verb}${reason ? ` - ${reason}` : ''}`,
        reference: cheque.number, type: 'cheque',
        lines: chequeLines(event, {
          direction: cheque.direction, amount: cheque.amount,
          partyAccountId: cheque.partyAccountId, bankAccountId: bank, number: cheque.number,
        }),
      })
      jeId = je.id
    }

    set((s) => ({
      cheques: s.cheques.map((c) => (c.id === id ? {
        ...c, status: to,
        bankAccountId: bankAccountId || c.bankAccountId,
        clearedDate: to === 'cleared' ? when : c.clearedDate,
        bounceReason: to === 'bounced' ? (reason || '') : c.bounceReason,
        events: [...(c.events || []), { status: to, date: when, journalEntryId: jeId, reason: reason || '' }],
      } : c)),
    }))
    get().logActivity('Cheque status changed', `${cheque.number} -> ${to}${reason ? ` · ${reason}` : ''}`, {
      entity: 'cheque', entityId: id, entityRef: cheque.number,
      severity: to === 'bounced' ? 'warning' : 'info',
    })
  },

  /** Cheques still in motion — nothing settled. */
  outstandingCheques: (direction) => get().cheques
    .filter((c) => !isTerminal(c.status) && (!direction || c.direction === direction)),

  deleteCheque: (id) => {
    const cheque = get().cheques.find((c) => c.id === id)
    if (!cheque) return
    // A settled cheque is history the ledger already reflects; removing it
    // would leave its journal entries pointing at nothing.
    if (isTerminal(cheque.status)) throw new Error(`CHEQUE_SETTLED:${cheque.number}`)
    get().recycleRecord('cheques', id)
    set((s) => ({ cheques: s.cheques.filter((c) => c.id !== id) }))
    get().logActivity('Deleted cheque', `${cheque.number} · ${cheque.partyName || ''}`, {
      entity: 'cheque', entityId: id, entityRef: cheque.number, severity: 'warning',
    })
  },

  // ─── DIRECT BANK TRANSACTIONS ──────────────────────────────────
  bankTransactions: [],

  addBankTransaction: (tx) => {
    const lines =
      tx.type === 'money_in'
        ? [
            { accountId: tx.bankAccountId, debit: tx.amount, credit: 0,          description: tx.description },
            { accountId: tx.accountId,      debit: 0,         credit: tx.amount, description: tx.description },
          ]
        : [
            { accountId: tx.accountId,      debit: tx.amount, credit: 0,          description: tx.description },
            { accountId: tx.bankAccountId,  debit: 0,         credit: tx.amount, description: tx.description },
          ]
    const je = get().addJournalEntry({
      date: tx.date, description: tx.description, reference: tx.reference || '', type: tx.type,
      projectId: tx.projectId || null, departmentId: tx.departmentId || null, lines,
    })
    const newTx = { ...tx, id: uuid(), journalEntryId: je.id, createdAt: new Date().toISOString() }
    set((s) => ({ bankTransactions: [...s.bankTransactions, newTx] }))
    return newTx
  },

  // ─── BANK-FEED MATCHING RULES ──────────────────────────────────
  // Rules that auto-categorize imported statement lines whose description
  // contains a keyword to a target account, so unmatched lines can be
  // booked and cleared in one click. flow: 'auto' | 'in' | 'out'.
  matchRules: [],
  addMatchRule: (rule) =>
    set((s) => ({ matchRules: [...s.matchRules, { flow: 'auto', ...rule, id: uuid(), contains: (rule.contains || '').trim() }] })),
  deleteMatchRule: (id) => {
    get().recycleRecord('matchRules', id)
    return set((s) => ({ matchRules: s.matchRules.filter((r) => r.id !== id) }))
  },

  deleteBankTransaction: (id) =>
    set((s) => {
      const tx = s.bankTransactions.find((t) => t.id === id)
      get().assertJEsUnlocked(tx?.journalEntryId)
      return {
        bankTransactions: s.bankTransactions.filter((t) => t.id !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => j.id !== tx?.journalEntryId),
      }
    }),

  // ─── INTRA-BANK / INTERNAL TRANSFERS ───────────────────────────
  // Move funds between two of the company's own bank/cash accounts.
  // Posts: Dr destination, Cr source (amount + fee), Dr bank charges (fee).
  // No revenue/expense impact except the optional bank fee.
  bankTransfers: [],

  addBankTransfer: (tf) => {
    const amount = Number(tf.amount) || 0
    const fee = Number(tf.fee) || 0
    if (amount <= 0 || !tf.fromAccountId || !tf.toAccountId || tf.fromAccountId === tf.toAccountId) return null
    const accs = get().accounts
    const fromName = accs.find((a) => a.id === tf.fromAccountId)?.name || tf.fromAccountId
    const toName = accs.find((a) => a.id === tf.toAccountId)?.name || tf.toAccountId
    const feeAccId = (fee > 0 && accs.some((a) => a.id === tf.feeAccountId)) ? tf.feeAccountId : 'acc-bankchg'
    const lines = [
      { accountId: tf.toAccountId,   debit: amount,        credit: 0,            description: `Transfer from ${fromName}` },
      { accountId: tf.fromAccountId, debit: 0,             credit: amount + fee, description: `Transfer to ${toName}` },
    ]
    if (fee > 0) lines.push({ accountId: feeAccId, debit: fee, credit: 0, description: `Transfer fee (${fromName})` })
    const je = get().addJournalEntry({
      date: tf.date, description: tf.notes || `Transfer: ${fromName} → ${toName}`,
      reference: tf.reference || '', type: 'transfer', lines,
    })
    const rec = { id: uuid(), date: tf.date, fromAccountId: tf.fromAccountId, toAccountId: tf.toAccountId, amount, fee, feeAccountId: fee > 0 ? feeAccId : null, reference: tf.reference || '', notes: tf.notes || '', journalEntryId: je.id, createdAt: new Date().toISOString() }
    set((s) => ({ bankTransfers: [...s.bankTransfers, rec] }))
    return rec
  },

  deleteBankTransfer: (id) =>
    set((s) => {
      const tf = s.bankTransfers.find((t) => t.id === id)
      get().assertJEsUnlocked(tf?.journalEntryId)
      return {
        bankTransfers: s.bankTransfers.filter((t) => t.id !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => j.id !== tf?.journalEntryId),
      }
    }),

  // ─── SCHEDULED (RECURRING) TRANSFERS ───────────────────────────
  // Define a transfer once; post it (and advance its next date) when due.
  scheduledTransfers: [],

  addScheduledTransfer: (sc) =>
    set((s) => ({
      scheduledTransfers: [...s.scheduledTransfers, {
        ...sc, id: uuid(), active: true, lastPosted: null, postedCount: 0, createdAt: new Date().toISOString(),
      }],
    })),

  updateScheduledTransfer: (id, patch) =>
    set((s) => ({ scheduledTransfers: s.scheduledTransfers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

  deleteScheduledTransfer: (id) => {
    get().recycleRecord('scheduledTransfers', id)
    return set((s) => ({ scheduledTransfers: s.scheduledTransfers.filter((x) => x.id !== id) }))
  },

  // Post a scheduled transfer now (on its scheduled date) and roll the next date forward.
  postScheduledTransfer: (id) => {
    const sc = get().scheduledTransfers.find((x) => x.id === id)
    if (!sc) return null
    const onDate = sc.nextDate || todayISO()
    const rec = get().addBankTransfer({
      date: onDate, fromAccountId: sc.fromAccountId, toAccountId: sc.toAccountId,
      amount: sc.amount, fee: sc.fee || 0, feeAccountId: sc.feeAccountId,
      reference: sc.reference || '', notes: (sc.notes ? sc.notes + ' ' : '') + '(Scheduled)',
    })
    if (rec) {
      const nextDate = get().advanceDate(onDate, sc.frequency)
      set((s) => ({
        scheduledTransfers: s.scheduledTransfers.map((x) =>
          x.id === id ? { ...x, nextDate, lastPosted: onDate, postedCount: (x.postedCount || 0) + 1 } : x),
      }))
    }
    return rec
  },

  // ─── CURRENCIES & EXCHANGE RATES ───────────────────────────────
  // rate = units of this currency per 1 unit of the base (company) currency
  currencies: [],

  addCurrency: (c) =>
    set((s) => {
      if (s.currencies.some((x) => x.code === c.code)) return s
      return { currencies: [...s.currencies, { ...c, id: uuid(), rate: Number(c.rate) || 1, updatedAt: new Date().toISOString() }] }
    }),

  updateCurrency: (id, patch) =>
    set((s) => ({ currencies: s.currencies.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)) })),

  deleteCurrency: (id) => {
    get().recycleRecord('currencies', id)
    return set((s) => ({ currencies: s.currencies.filter((c) => c.id !== id) }))
  },

  // ─── FX REVALUATION ────────────────────────────────────────────
  // Restates foreign-currency account balances to the period-end closing
  // rate and posts the unrealized gain/loss to acc-fxgl. `entries` is a list
  // of { accountId, currency, fcBalance, rate, currentBase, revaluedBase }.
  fxRevaluations: [],
  postFxRevaluation: ({ date, entries, note }) => {
    const rows = (entries || [])
      .map((e) => ({ ...e, delta: Math.round(((e.revaluedBase || 0) - (e.currentBase || 0)) * 100) / 100 }))
      .filter((e) => Math.abs(e.delta) >= 0.01)
    if (rows.length === 0) return null
    const accs = get().accounts
    const lines = []
    let net = 0 // debits minus credits from the account legs
    rows.forEach((e) => {
      const acc = accs.find((a) => a.id === e.accountId)
      const debitNatured = ['asset', 'expense'].includes(acc?.type)
      // increasing an account's base carrying value debits a debit-natured
      // account and credits a credit-natured one; negative delta flips it
      let dr = 0, cr = 0
      if (debitNatured) { if (e.delta >= 0) dr = e.delta; else cr = -e.delta }
      else { if (e.delta >= 0) cr = e.delta; else dr = -e.delta }
      lines.push({ accountId: e.accountId, debit: dr, credit: cr, description: `FX revaluation @ ${e.rate} ${e.currency}` })
      net += dr - cr
    })
    // balancing offset to the FX gain/loss account
    net = Math.round(net * 100) / 100
    if (net >= 0) lines.push({ accountId: 'acc-fxgl', debit: 0, credit: net, description: 'Unrealized FX gain' })
    else lines.push({ accountId: 'acc-fxgl', debit: -net, credit: 0, description: 'Unrealized FX loss' })
    const je = get().addJournalEntry({
      date, description: `FX Revaluation${note ? ' – ' + note : ''}`, reference: '', type: 'fx_reval', lines,
    })

    // Auto-reverse on the first day of the next period.
    //
    // A revaluation restates the *carrying value* of AR/AP for reporting at
    // the period-end rate; it does not change what the customer owes. When
    // the invoice later settles, recordInvoicePayment relieves AR at the
    // original document rate — so without this reversal the restatement is
    // stranded in AR forever and the same movement is counted twice, once
    // unrealized and again as a realized gain on settlement.
    //
    // Reversing is also what makes the split honest: acc-fxgl holds only
    // estimates that have since been undone, acc-fxreal holds only cash
    // differences that actually happened.
    // The reversal is always postable: the period lock rejects any date at or
    // before it, so a revaluation that posted at all has a next day that is
    // open too.
    const revDate = addDaysISO(date, 1)
    const revJe = get().addJournalEntry({
      date: revDate,
      description: `FX Revaluation reversal${note ? ' – ' + note : ''}`,
      reference: '', type: 'fx_reval', reverses: je.id,
      lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit, description: `Reversal – ${l.description}` })),
    })

    const rec = {
      id: uuid(), date, journalEntryId: je.id, reversalJEId: revJe.id, reversalDate: revDate,
      note: note || '', entries: rows, gainLoss: net, createdAt: new Date().toISOString(),
    }
    set((s) => ({ fxRevaluations: [...s.fxRevaluations, rec] }))
    return rec
  },

  // ─── BANK RECONCILIATION ───────────────────────────────────────
  // marks individual JE lines (by je id + account) as reconciled per statement
  reconciliations: [],

  toggleReconciled: (bankAccountId, journalEntryId) =>
    set((s) => {
      const key = `${bankAccountId}::${journalEntryId}`
      const has = s.reconciliations.includes(key)
      return { reconciliations: has ? s.reconciliations.filter((k) => k !== key) : [...s.reconciliations, key] }
    }),
})
