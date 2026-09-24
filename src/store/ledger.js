// The chart of accounts, journal entries and the rules every posting passes through.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { useAuth } from '../auth'
import { weightedAverageCost } from '../utils/inventoryCost'
import { receiveInto, layersFromBalance } from '../utils/fifo'
import { diffRecord, describeChanges, severityFor } from '../utils/auditDiff'
import { GENESIS, hashEntry, chainEntries, reseal, verifyChain, ledgerAnchor, shortHash, prevTag } from '../utils/ledgerChain'
import { needsApproval, canApprove, amountOf } from '../utils/approvals'
import { buildOpeningEntry, validateOpening } from '../utils/openingBalances'
import { RECYCLABLE, isRecyclable, makeEntry, canRestore } from '../utils/recycleBin'
import { DEFAULT_GROUPS, assignDefaultGroups, validateGroup, deleteGroupPlan, defaultGroupFor } from '../utils/accountTree'
import { CAPITAL_CONTROL, DEFAULT_SUBACCOUNTS, validateCapitalAccount, movementLines, allocateProfit, profitAllocationLines } from '../utils/capitalAccounts'
import { CONTROL_KINDS, resolveControl, validateControlAccount, controlAccountsFor, reclassLines, fieldFor, defaultFor } from '../utils/controlAccounts'
import { todayISO } from '../utils/localDate'
import { DEFAULT_ACCOUNTS, nextNum, BALANCE_TOLERANCE, keepEntries } from './shared'

export const createLedgerSlice = (set, get) => ({
  // ─── ACCOUNTS ──────────────────────────────────────────────────
  accounts: assignDefaultGroups(DEFAULT_ACCOUNTS),

  addAccount: (a) =>
    set((s) => ({
      accounts: [...s.accounts, { ...a, id: uuid(), groupId: a.groupId || defaultGroupFor(a) }],
    })),

  updateAccount: (id, patch) => {
    const before = get().accounts.find((a) => a.id === id)
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
    get().logChange('Updated account', before, get().accounts.find((a) => a.id === id), { entity: 'account' })
  },

  deleteAccount: (id) => {
    // Every posting anywhere in the app addresses a system account by
    // this fixed id (acc-ar, acc-vatout, acc-salpay, ...), so deleting one
    // does not just remove a row — it breaks referential integrity across
    // every document type at once. The chart of accounts page already
    // stops this in its own delete handler, but that leaves the guarantee
    // resting on every future delete button remembering to check, which
    // is exactly the kind of thing this file does not otherwise leave to
    // the caller (see JE_UNBALANCED, PERIOD_LOCKED, CAPITAL_LINE_UNATTRIBUTED).
    const target = get().accounts.find((a) => a.id === id)
    if (target?.isSystem) throw new Error(`ACCOUNT_IS_SYSTEM:${target.code} – ${target.name}`)
    get().recycleRecord('accounts', id)
    const gone = get().accounts.find((a) => a.id === id)
    set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id) }))
    if (gone) get().logActivity('Deleted account', `${gone.code} – ${gone.name}`, { entity: 'account', entityId: id, entityRef: gone.code })
  },

  // ─── ACCOUNT GROUPS ────────────────────────────────────────────
  // The chart is a tree; groups are the branches. They hold no balance of
  // their own — a group total is always the sum of what is under it, so
  // there is no way for a group and its contents to disagree.
  accountGroups: DEFAULT_GROUPS.map((g) => ({ ...g })),

  addAccountGroup: (g) => {
    const check = validateGroup(g, get().accountGroups)
    if (!check.ok) throw new Error(`GROUP_INVALID:${check.errors.join(' ')}`)
    const id = uuid()
    set((s) => ({
      accountGroups: [...s.accountGroups, {
        id,
        name: String(g.name).trim(),
        code: g.code || '',
        type: g.type,
        parentId: g.parentId || null,
        sort: g.sort ?? 500,
        role: g.role || '',
      }],
    }))
    get().logActivity('Created account group', String(g.name).trim(), { entity: 'accountGroup', entityId: id })
    return id
  },

  updateAccountGroup: (id, patch) => {
    const before = get().accountGroups.find((g) => g.id === id)
    if (!before) throw new Error('GROUP_NOT_FOUND')
    // Validate the merged result, not the patch — a rename alone must not
    // be judged against a half-filled object.
    const check = validateGroup({ ...before, ...patch }, get().accountGroups, { id })
    if (!check.ok) throw new Error(`GROUP_INVALID:${check.errors.join(' ')}`)
    set((s) => ({ accountGroups: s.accountGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
    get().logChange('Updated account group', before, get().accountGroups.find((g) => g.id === id), { entity: 'accountGroup' })
  },

  /**
   * Delete a group and lift everything inside it up one level.
   *
   * Nothing is orphaned: subgroups and accounts re-parent to the deleted
   * group's parent, or become ungrouped at the top of their type. A report
   * that quietly lost a branch because someone tidied a header would be
   * far worse than an untidy chart.
   */
  deleteAccountGroup: (id) => {
    const gone = get().accountGroups.find((g) => g.id === id)
    if (!gone) return
    const plan = deleteGroupPlan(get().accountGroups, get().accounts, id)
    const reparent = Object.fromEntries(plan.groupUpdates.map((u) => [u.id, u.parentId]))
    const regroup = Object.fromEntries(plan.accountUpdates.map((u) => [u.id, u.groupId]))
    set((s) => ({
      accountGroups: s.accountGroups
        .filter((g) => g.id !== id)
        .map((g) => (g.id in reparent ? { ...g, parentId: reparent[g.id] } : g)),
      accounts: s.accounts.map((a) => (a.id in regroup ? { ...a, groupId: regroup[a.id] } : a)),
    }))
    get().logActivity('Deleted account group', gone.name, {
      entity: 'accountGroup', entityId: id, entityRef: gone.code || gone.name,
    })
    return { movedAccounts: plan.accountUpdates.length, movedGroups: plan.groupUpdates.length }
  },

  /** Move an account into a group. Refuses a group of a different type. */
  moveAccountToGroup: (accountId, groupId) => {
    const acc = get().accounts.find((a) => a.id === accountId)
    if (!acc) throw new Error('ACCOUNT_NOT_FOUND')
    if (groupId) {
      const grp = get().accountGroups.find((g) => g.id === groupId)
      if (!grp) throw new Error('GROUP_NOT_FOUND')
      if (grp.type !== acc.type)
        throw new Error('GROUP_TYPE_MISMATCH')
    }
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, groupId: groupId || '' } : a)) }))
  },

  // ─── CONTROL ACCOUNTS ──────────────────────────────────────────
  // Receivables, payables and inventory can each be split across several
  // control accounts. Nothing posts to a record's stored pointer directly —
  // it goes through here, which falls back to the default whenever that
  // pointer no longer names a usable control account. See
  // utils/controlAccounts.js for why that matters.

  /** The account a customer / supplier / item actually posts through. */
  controlAccountFor: (kind, recordId) => {
    const st = get()
    const record = (st[CONTROL_KINDS[kind]?.slice] || []).find((r) => r.id === recordId)
    return resolveControl(record, kind, st.accounts)
  },

  /** Every account usable as a control account of this kind. */
  controlAccountOptions: (kind) => controlAccountsFor(get().accounts, kind),

  /** Nominate an account as a control account, or stand it down. */
  setAccountControlKind: (accountId, kind) => {
    const account = get().accounts.find((a) => a.id === accountId)
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')

    if (!kind) {
      // Standing an account down while records still point at it would
      // silently redirect their postings to the default — the balance
      // sheet would go on balancing while two accounts quietly went wrong.
      const slice = CONTROL_KINDS[account.controlFor]?.slice
      const inUse = slice
        ? (get()[slice] || []).filter((r) => r[fieldFor(account.controlFor)] === accountId).length
        : 0
      if (inUse) throw new Error(`CONTROL_IN_USE:${inUse}`)
      set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, controlFor: '' } : a)) }))
      return
    }

    const check = validateControlAccount(account, kind)
    if (!check.ok) throw new Error(`CONTROL_INVALID:${check.errors.join(' ')}`)
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, controlFor: kind } : a)) }))
    get().logActivity('Made a control account', `${account.code} – ${account.name}`, { entity: 'account', entityId: accountId })
  },

  /**
   * Point a customer, supplier or item at a different control account.
   *
   * An outstanding balance is moved with a reclassification entry rather
   * than by rewriting history. Leaving the old debt where it was while new
   * receipts credit the new account would make both accounts wrong, and
   * the customer's own statement would reconcile to neither.
   */
  setRecordControlAccount: (kind, recordId, accountId, { date } = {}) => {
    const cfg = CONTROL_KINDS[kind]
    if (!cfg) throw new Error('CONTROL_KIND_UNKNOWN')
    const st = get()
    const record = (st[cfg.slice] || []).find((r) => r.id === recordId)
    if (!record) throw new Error('RECORD_NOT_FOUND')

    const from = resolveControl(record, kind, st.accounts)
    const target = accountId || defaultFor(kind)
    if (target !== defaultFor(kind)) {
      const account = st.accounts.find((a) => a.id === target)
      const check = validateControlAccount(account, kind)
      if (!check.ok) throw new Error(`CONTROL_INVALID:${check.errors.join(' ')}`)
    }

    const field = fieldFor(kind)
    if (from === target) {
      set((s) => ({ [cfg.slice]: s[cfg.slice].map((r) => (r.id === recordId ? { ...r, [field]: accountId || '' } : r)) }))
      return { moved: 0, journalEntryId: null }
    }

    // What this record still owes, read from the documents rather than the
    // ledger: invoice and bill postings carry no customer or supplier id,
    // so the ledger cannot be filtered by party. The open document balance
    // is the right figure regardless — it is what the aging reports and
    // customer statements are built from.
    const openDocs = kind === 'customers' ? st.invoices : kind === 'suppliers' ? st.purchases : []
    const partyField = kind === 'customers' ? 'customerId' : 'supplierId'
    let balance = openDocs.reduce((sum, d) => {
      if (d[partyField] !== recordId) return sum
      if (['cancelled', 'void', 'draft'].includes(d.status)) return sum
      return sum + ((+d.total || 0) - (+d.amountPaid || 0))
    }, 0)
    balance = Math.round(balance * 100) / 100

    let entry = null
    if (balance !== 0) {
      // `balance` is what the party owes (or is owed), already expressed in
      // the control account's own natural direction — a receivable as a
      // debit, a payable as a credit. reclassLines works in those same
      // terms, so it is passed through unchanged; negating it here would
      // move payables the wrong way.
      entry = get().addJournalEntry({
        date: date || todayISO(),
        description: `Reclassified ${record.name || cfg.noun} to a different control account`,
        type: 'reclass',
        ...(kind === 'customers' ? { customerId: recordId } : {}),
        ...(kind === 'suppliers' ? { supplierId: recordId } : {}),
        lines: reclassLines(kind, {
          fromAccountId: from, toAccountId: target, amount: balance, name: record.name || "",
        }),
      })
    }

    set((s) => ({ [cfg.slice]: s[cfg.slice].map((r) => (r.id === recordId ? { ...r, [field]: accountId || '' } : r)) }))
    return { moved: balance, journalEntryId: entry?.id || null }
  },

  // ─── CAPITAL ACCOUNTS ──────────────────────────────────────────
  // A subledger over acc-capital-ctl, one row per owner or partner. See
  // utils/capitalAccounts.js for why the detail cannot live in the chart
  // of accounts itself.
  capitalAccounts: [],
  capitalSubaccounts: DEFAULT_SUBACCOUNTS.map((s) => ({ ...s })),

  addCapitalAccount: (a) => {
    const check = validateCapitalAccount(a, get().capitalAccounts)
    if (!check.ok) throw new Error(`CAPITAL_INVALID:${check.errors.join(' ')}`)
    const id = uuid()
    set((s) => ({
      capitalAccounts: [...s.capitalAccounts, {
        id,
        name: String(a.name).trim(),
        code: a.code || '',
        share: a.share === '' || a.share == null ? 0 : Number(a.share),
        notes: a.notes || '',
        active: a.active !== false,
        createdAt: new Date().toISOString(),
      }],
    }))
    get().logActivity('Created capital account', String(a.name).trim(), { entity: 'capitalAccount', entityId: id })
    return id
  },

  updateCapitalAccount: (id, patch) => {
    const before = get().capitalAccounts.find((a) => a.id === id)
    if (!before) throw new Error('CAPITAL_NOT_FOUND')
    const check = validateCapitalAccount({ ...before, ...patch }, get().capitalAccounts, { id })
    if (!check.ok) throw new Error(`CAPITAL_INVALID:${check.errors.join(' ')}`)
    set((s) => ({ capitalAccounts: s.capitalAccounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
    get().logChange('Updated capital account', before, get().capitalAccounts.find((a) => a.id === id), { entity: 'capitalAccount' })
  },

  /**
   * A capital account with history cannot be deleted — its ledger lines
   * would point at nothing and the report would show them as unallocated.
   * Deactivating keeps the history readable and takes it out of new
   * pickers and profit splits.
   */
  deleteCapitalAccount: (id) => {
    const used = get().journalEntries.some((je) =>
      (je.lines || []).some((l) => l.capitalAccountId === id))
    if (used) throw new Error('CAPITAL_HAS_ACTIVITY')
    get().recycleRecord('capitalAccounts', id)
    const gone = get().capitalAccounts.find((a) => a.id === id)
    set((s) => ({ capitalAccounts: s.capitalAccounts.filter((a) => a.id !== id) }))
    if (gone) get().logActivity('Deleted capital account', gone.name, { entity: 'capitalAccount', entityId: id })
  },

  addCapitalSubaccount: (name) => {
    const clean = String(name || '').trim()
    if (!clean) throw new Error('CAPITAL_SUB_NAME_REQUIRED')
    const dup = get().capitalSubaccounts.some((s) => s.name.toLowerCase() === clean.toLowerCase())
    if (dup) throw new Error('CAPITAL_SUB_DUPLICATE')
    const id = uuid()
    set((s) => ({
      capitalSubaccounts: [...s.capitalSubaccounts, { id, name: clean, sort: 100 + s.capitalSubaccounts.length, isSystem: false }],
    }))
    return id
  },

  deleteCapitalSubaccount: (id) => {
    const sub = get().capitalSubaccounts.find((s) => s.id === id)
    if (!sub) return
    if (sub.isSystem) throw new Error('CAPITAL_SUB_IS_SYSTEM')
    const used = get().journalEntries.some((je) => (je.lines || []).some((l) => l.subaccountId === id))
    if (used) throw new Error('CAPITAL_SUB_HAS_ACTIVITY')
    set((s) => ({ capitalSubaccounts: s.capitalSubaccounts.filter((x) => x.id !== id) }))
  },

  /**
   * Money in from an owner, or money out to one.
   * `kind` is 'contribution' or 'drawing'.
   */
  recordCapitalMovement: (kind, payload) => {
    const acc = get().capitalAccounts.find((a) => a.id === payload.capitalAccountId)
    if (!acc) throw new Error('CAPITAL_NOT_FOUND')
    const lines = movementLines(kind, { ...payload, name: acc.name })
    const je = get().addJournalEntry({
      date: payload.date,
      description: payload.description || `${kind === 'contribution' ? 'Funds contributed' : 'Drawings'} — ${acc.name}`,
      type: 'capital',
      lines,
    })
    return je
  },

  /**
   * Split a profit between the partners by their shares.
   *
   * Moves profit from retained earnings to each partner's share-of-profit
   * subaccount. Total equity does not change by a cent — the money simply
   * stops being "kept in the business" and becomes "owed to a named owner".
   */
  allocateProfitToPartners: ({ date, amount, description } = {}) => {
    const active = get().capitalAccounts.filter((a) => a.active !== false)
    if (!active.length) throw new Error('CAPITAL_NO_ACCOUNTS')
    const split = allocateProfit(amount, active)
    const lines = profitAllocationLines(split)
    if (!lines.length) throw new Error('CAPITAL_NOTHING_TO_ALLOCATE')
    return get().addJournalEntry({
      date,
      description: description || 'Allocation of profit to partners',
      type: 'capital',
      lines,
    })
  },

  /** Put the tree back to the shipped structure, keeping custom groups. */
  restoreDefaultGroups: () => {
    set((s) => {
      const have = new Set(s.accountGroups.map((g) => g.id))
      const missing = DEFAULT_GROUPS.filter((g) => !have.has(g.id)).map((g) => ({ ...g }))
      return {
        accountGroups: [...s.accountGroups, ...missing],
        accounts: assignDefaultGroups(s.accounts.map((a) => ({ ...a, groupId: '' }))),
      }
    })
    get().logActivity('Restored default account groups', '', { entity: 'accountGroup', severity: 'warning' })
  },

  // ─── APPROVAL WORKFLOW ─────────────────────────────────────────
  // A request parks the *draft payload* a posting action would have
  // received. Nothing reaches the ledger until someone else approves, at
  // which point the payload is replayed through the ordinary posting path
  // — so an approved bill posts through exactly the same code as any
  // other, VAT, freight, FX and inventory included.
  approvalRequests: [],

  currentUser: () => {
    try {
      const auth = useAuth.getState()
      return auth.users.find((x) => x.id === auth.currentUserId) || null
    } catch { return null }
  },

  allUsers: () => {
    try { return useAuth.getState().users || [] } catch { return [] }
  },

  /** Park a draft for approval. Returns the created request. */
  submitForApproval: (kind, payload, meta = {}) => {
    const u = get().currentUser()
    const req = {
      id: uuid(), kind, payload, status: 'pending',
      amount: amountOf(kind, payload),
      submittedBy: u?.id || null, submittedByName: u?.name || 'Unknown',
      submittedAt: new Date().toISOString(),
      note: meta.note || '',
      decidedBy: null, decidedByName: '', decidedAt: null, decisionReason: '',
      resultId: null, resultRef: '',
    }
    set((st) => ({ approvalRequests: [...(st.approvalRequests || []), req] }))
    get().logActivity('Submitted for approval', `${kind} · ${req.amount}`, {
      entity: 'approval', entityId: req.id, severity: 'notable',
    })
    return req
  },

  /**
   * Approve and post. Replays the payload through the real posting action,
   * bypassing the threshold gate so it cannot loop.
   */
  approveRequest: (id, reason) => {
    const st = get()
    const req = (st.approvalRequests || []).find((r) => r.id === id)
    const user = st.currentUser()
    const check = canApprove(req, user, st.settings?.approvals, get().allUsers())
    if (!check.ok) throw new Error(`APPROVAL_DENIED:${check.reason}`)

    let result = null
    if (req.kind === 'purchase') result = st.addPurchase(req.payload, { approved: true })
    else if (req.kind === 'journal') result = st.addJournalEntry(req.payload, { approved: true })
    else if (req.kind === 'payment') {
      st.recordPurchasePayment(req.payload.purchaseId, req.payload.payment, { approved: true })
      result = { number: req.payload.targetRef || '' }
    }
    else throw new Error(`APPROVAL_UNKNOWN_KIND:${req.kind}`)

    set((s) => ({
      approvalRequests: s.approvalRequests.map((r) =>
        r.id === id ? {
          ...r, status: 'approved',
          decidedBy: user?.id || null, decidedByName: user?.name || '',
          decidedAt: new Date().toISOString(), decisionReason: reason || '',
          resultId: result?.id || null, resultRef: result?.number || '',
        } : r
      ),
    }))
    get().logActivity('Approved ' + req.kind, `${result?.number || ''} · ${req.amount}`.trim(), {
      entity: 'approval', entityId: id, entityRef: result?.number || '', severity: 'notable',
    })
    return result
  },

  rejectRequest: (id, reason) => {
    const st = get()
    const req = (st.approvalRequests || []).find((r) => r.id === id)
    const user = st.currentUser()
    const check = canApprove(req, user, st.settings?.approvals, get().allUsers())
    if (!check.ok) throw new Error(`APPROVAL_DENIED:${check.reason}`)
    set((s) => ({
      approvalRequests: s.approvalRequests.map((r) =>
        r.id === id ? {
          ...r, status: 'rejected',
          decidedBy: user?.id || null, decidedByName: user?.name || '',
          decidedAt: new Date().toISOString(), decisionReason: reason || '',
        } : r
      ),
    }))
    get().logActivity('Rejected ' + req.kind, reason || '', {
      entity: 'approval', entityId: id, severity: 'notable',
    })
  },

  /** The submitter can pull their own request back while it is still pending. */
  withdrawRequest: (id) => {
    const st = get()
    const req = (st.approvalRequests || []).find((r) => r.id === id)
    const user = st.currentUser()
    if (!req || req.status !== 'pending') return
    if (req.submittedBy && user?.id && req.submittedBy !== user.id) return
    set((s) => ({ approvalRequests: s.approvalRequests.filter((r) => r.id !== id) }))
    get().logActivity('Withdrew approval request', req.kind, { entity: 'approval', entityId: id })
  },

  // ─── OPENING BALANCES (migration cutover) ──────────────────────
  // Establishes the position a business is carrying into this system on
  // day one. Receivables, payables and stock arrive as individual open
  // documents rather than lump sums, so aging, statements and stock counts
  // work from the first day instead of showing legacy invoices as new.

  updateOpening: (patch) =>
    set((s) => ({ settings: { ...s.settings, opening: { ...(s.settings.opening || {}), ...patch } } })),

  /**
   * Post the cutover. One balanced journal entry plus the subledger
   * documents it summarises.
   * @throws OPENING_ALREADY_POSTED | OPENING_INVALID:<reasons>
   */
  postOpeningBalances: (input) => {
    const st = get()
    if (st.settings.opening?.posted) throw new Error('OPENING_ALREADY_POSTED')

    const errors = validateOpening(input, { lockDate: st.settings?.accounting?.lockDate })
    if (errors.length) throw new Error(`OPENING_INVALID:${errors.join(' | ')}`)

    const nameOf = (id) => st.accounts.find((a) => a.id === id)?.name || id
    const entry = buildOpeningEntry(input, { accountName: nameOf })
    const { date, customers = [], suppliers = [], items = [] } = input

    const je = get().addJournalEntry({
      date,
      description: `Opening balances as at ${date}`,
      reference: 'OPENING', type: 'opening', lines: entry.lines,
    })

    // Opening documents carry their ORIGINAL numbers — a payment arriving
    // next week has to match what the customer has on their copy. They
    // hold no journal entry of their own; the single opening entry above
    // already put their total into the control account.
    const stamp = new Date().toISOString()
    const openingInvoices = customers.map((c) => ({
      id: uuid(), number: c.number, isOpening: true,
      customerId: c.customerId || '', customerName: c.customerName || '',
      date: c.date || date, dueDate: c.dueDate || c.date || date,
      items: [], subtotal: Number(c.amount) || 0, taxAmount: 0,
      total: Number(c.amount) || 0, amountPaid: 0, payments: [],
      status: 'sent', exchangeRate: 1, baseTotal: Number(c.amount) || 0,
      notes: 'Carried in from your previous system',
      journalEntryId: je.id, createdAt: stamp,
    }))
    const openingBills = suppliers.map((b) => ({
      id: uuid(), number: b.number, isOpening: true,
      supplierId: b.supplierId || '', supplierName: b.supplierName || '',
      date: b.date || date, dueDate: b.dueDate || b.date || date,
      items: [], subtotal: Number(b.amount) || 0, taxAmount: 0,
      total: Number(b.amount) || 0, amountPaid: 0, payments: [],
      status: 'received', exchangeRate: 1, baseTotal: Number(b.amount) || 0,
      notes: 'Carried in from your previous system',
      journalEntryId: je.id, createdAt: stamp,
    }))

    // Stock arrives at the cost you are carrying it in at, blended into
    // any existing quantity with the same weighted-average maths a
    // purchase uses — so a re-migration behaves predictably.
    const openingQty = {}
    items.forEach((it) => {
      const q = Number(it.quantity) || 0
      if (!it.itemId || q <= 0) return
      openingQty[it.itemId] = (openingQty[it.itemId] || 0) + q
    })

    set((s) => ({
      invoices: [...s.invoices, ...openingInvoices],
      purchases: [...s.purchases, ...openingBills],
      inventoryItems: s.inventoryItems.map((it) => {
        const row = items.find((r) => r.itemId === it.id)
        if (!row) return it
        const q = Number(row.quantity) || 0
        const cost = Number(row.unitCost) || 0
        if (q <= 0) return it
        const oldQty = it.quantity || 0
        const newCost = weightedAverageCost({
          onHand: oldQty, unitCost: it.costPrice, receivedQty: q, receivedValue: q * cost,
        })
        const seeded = { ...it, costLayers: it.costLayers || layersFromBalance(oldQty, it.costPrice) }
        return { ...it, quantity: oldQty + q, ...receiveInto(seeded, {
          qty: q, value: q * cost, date, ref: 'Opening balance',
          method: get().costingMethod(), wacCost: newCost,
        }) }
      }),
      settings: { ...s.settings, opening: {
        date, posted: true, journalEntryId: je.id, postedAt: stamp,
        counts: { accounts: entry.lines.length, customers: customers.length, suppliers: suppliers.length, items: items.length },
      } },
    }))

    items.forEach((it) => {
      const q = Number(it.quantity) || 0
      if (!it.itemId || q <= 0) return
      get().logStockMovement({
        itemId: it.itemId, itemName: it.itemName || '', date,
        type: 'opening', qtyChange: q, ref: 'OPENING', note: 'Opening stock',
      })
    })

    get().logActivity('Posted opening balances', `as at ${date}`, {
      entity: 'opening', entityId: je.id, entityRef: je.number, severity: 'critical',
    })
    return { entry, journalEntry: je }
  },

  /**
   * Undo the cutover so it can be re-entered. Refused once anything has
   * been settled against it — reversing then would strand the payment
   * against an invoice that no longer exists.
   * @throws OPENING_NOT_POSTED | OPENING_HAS_ACTIVITY:<n> | PERIOD_LOCKED
   */
  reverseOpeningBalances: () => {
    const st = get()
    const op = st.settings.opening
    if (!op?.posted) throw new Error('OPENING_NOT_POSTED')

    const settled = [
      ...st.invoices.filter((i) => i.isOpening && ((i.amountPaid || 0) > 0 || (i.payments || []).length)),
      ...st.purchases.filter((p) => p.isOpening && ((p.amountPaid || 0) > 0 || (p.payments || []).length)),
    ]
    if (settled.length) throw new Error(`OPENING_HAS_ACTIVITY:${settled.length}`)

    const lock = st.settings?.accounting?.lockDate
    if (lock && op.date && String(op.date) <= String(lock)) throw new Error(`PERIOD_LOCKED:${lock}`)

    // Back the opening quantity out of stock rather than zeroing it —
    // anything received since the cutover is real and must survive.
    const openingMoves = (st.stockMovements || []).filter((m) => m.type === 'opening' && m.ref === 'OPENING')

    set((s) => ({
      journalEntries: keepEntries(s.journalEntries, (j) => j.id !== op.journalEntryId),
      invoices: s.invoices.filter((i) => !i.isOpening),
      purchases: s.purchases.filter((p) => !p.isOpening),
      stockMovements: (s.stockMovements || []).filter((m) => !(m.type === 'opening' && m.ref === 'OPENING')),
      inventoryItems: s.inventoryItems.map((it) => {
        const back = openingMoves.filter((m) => m.itemId === it.id).reduce((t, m) => t + (m.qtyChange || 0), 0)
        if (!back) return it
        return { ...it, quantity: Math.max(0, (it.quantity || 0) - back) }
      }),
      settings: { ...s.settings, opening: { date: op.date, posted: false, journalEntryId: null, postedAt: '', counts: null } },
    }))

    get().logActivity('Reversed opening balances', `as at ${op.date}`, {
      entity: 'opening', entityId: op.journalEntryId || '', severity: 'critical',
    })
  },

  // ─── RECYCLE BIN ───────────────────────────────────────────────
  // Covers records whose deletion is pure data loss. Documents that post
  // to the ledger are voided with a reversing entry instead — restoring
  // one of those would post the transaction twice. See utils/recycleBin.
  recycleBin: [],

  /** Snapshot a record just before it is removed. Called by delete actions. */
  recycleRecord: (entity, id) => {
    if (!isRecyclable(entity)) return
    const slice = get()[RECYCLABLE[entity].slice] || []
    const record = slice.find((r) => r.id === id)
    if (!record) return
    const entry = makeEntry(entity, record, { user: get().currentUser() })
    // Cap the bin so a bulk delete cannot grow local storage without
    // bound; the oldest rows fall off first.
    set((s) => ({ recycleBin: [...(s.recycleBin || []).slice(-999), entry] }))
  },

  /**
   * Put a record back where it came from.
   * @throws RESTORE_DENIED:<reason>
   */
  restoreFromBin: (entryId) => {
    const st = get()
    const entry = (st.recycleBin || []).find((e) => e.id === entryId)
    const slice = entry ? (st[RECYCLABLE[entry.entity]?.slice] || []) : []
    const check = canRestore(entry, slice)
    if (!check.ok) throw new Error(`RESTORE_DENIED:${check.reason}`)

    const key = RECYCLABLE[entry.entity].slice
    set((s) => ({
      [key]: [...(s[key] || []), entry.record],
      recycleBin: s.recycleBin.filter((e) => e.id !== entryId),
    }))
    get().logActivity('Restored from recycle bin', `${entry.entity} · ${entry.recordId}`, {
      entity: entry.entity, entityId: entry.recordId, severity: 'notable',
    })
    return entry.record
  },

  /** Remove one entry for good. */
  purgeFromBin: (entryId) => {
    const entry = (get().recycleBin || []).find((e) => e.id === entryId)
    set((s) => ({ recycleBin: s.recycleBin.filter((e) => e.id !== entryId) }))
    if (entry) get().logActivity('Purged from recycle bin', `${entry.entity} · ${entry.recordId}`, {
      entity: entry.entity, entityId: entry.recordId, severity: 'critical',
    })
  },

  /** Empty the bin. @param ids optional subset */
  emptyRecycleBin: (ids) => {
    const n = ids ? ids.length : (get().recycleBin || []).length
    set((s) => ({ recycleBin: ids ? s.recycleBin.filter((e) => !ids.includes(e.id)) : [] }))
    get().logActivity('Emptied recycle bin', `${n} item(s)`, { entity: 'recycleBin', severity: 'critical' })
  },

  // ─── AUDIT / ACTIVITY LOG ──────────────────────────────────────
  auditLog: [],

  logActivity: (action, detail, meta = {}) => {
    let user = 'System', userId = ''
    try {
      const auth = useAuth.getState()
      const u = auth.users.find((x) => x.id === auth.currentUserId)
      user = u?.name || 'System'; userId = u?.id || ''
    } catch { /* ignore */ }
    const entry = {
      id: uuid(), ts: new Date().toISOString(), user, userId,
      action, detail: detail || '',
      // Structured fields make the trail filterable and answer "what
      // exactly changed", which a free-text detail string cannot.
      entity: meta.entity || '', entityId: meta.entityId || '', entityRef: meta.entityRef || '',
      changes: meta.changes || [],
      severity: meta.severity || severityFor(action),
    }
    // Append-only audit trail (retain up to 20k events; never wiped — immutability)
    set((st) => ({ auditLog: [...(st.auditLog || []).slice(-19999), entry] }))
  },

  /**
   * Log an edit with a field-level diff. Silently records nothing when the
   * save changed no audited field, so the trail stays signal, not noise.
   */
  logChange: (action, before, after, meta = {}) => {
    const changes = diffRecord(before, after, { ignore: meta.ignore })
    if (changes.length === 0) return
    get().logActivity(action, describeChanges(changes), {
      ...meta,
      changes,
      entityRef: meta.entityRef || after?.number || after?.name || before?.number || before?.name || '',
      entityId: meta.entityId || after?.id || before?.id || '',
    })
  },

  // Audit trail is immutable — this remains only for API compatibility and no
  // longer erases history (previously wiped the log).
  clearAuditLog: () => { get().logActivity('Audit-log clear requested (ignored — trail is immutable)', ''); },

  // ─── JOURNAL ENTRIES ───────────────────────────────────────────
  journalEntries: [],

  addJournalEntry: (entry, opts = {}) => {
    const s = get()
    // Integrity guards: every entry must be dated and balanced. This stops any
    // caller bug from silently corrupting the ledger / trial balance.
    if (!entry?.date) throw new Error('JE_NO_DATE')
    // Threshold approval applies to *manual* entries only. System-generated
    // entries (an invoice's own posting, a payment, a depreciation run) are
    // consequences of a document that was itself gated, and blocking them
    // here would tear a half-posted document apart.
    if (!opts.approved && (entry.type || 'manual') === 'manual'
        && needsApproval(s.settings?.approvals, 'journal', amountOf('journal', entry))) {
      return { pendingApproval: true, request: get().submitForApproval('journal', entry) }
    }
    const _dr = (entry.lines || []).reduce((t, l) => t + (+l.debit || 0), 0)
    const _cr = (entry.lines || []).reduce((t, l) => t + (+l.credit || 0), 0)
    if (Math.abs(_dr - _cr) > BALANCE_TOLERANCE) throw new Error(`JE_UNBALANCED:${(_dr - _cr).toFixed(2)}`)
    // The capital control account is a subledger: its balance must always
    // be the sum of the partner accounts underneath it. A line that hits it
    // without naming a partner would break that quietly — the balance sheet
    // would still balance while the capital accounts report disagreed with
    // it, and nothing on screen would say why. Refuse it at the door.
    const _stray = (entry.lines || []).find(
      (l) => l?.accountId === CAPITAL_CONTROL && !l?.capitalAccountId
    )
    if (_stray) throw new Error('CAPITAL_LINE_UNATTRIBUTED')
    const lock = s.settings?.accounting?.lockDate
    if (lock && String(entry.date) <= String(lock))
      throw new Error(`PERIOD_LOCKED:${lock}`)
    const { prefix, next } = s.settings.journal
    const number = nextNum(prefix, next)
    const newJE = { ...entry, id: uuid(), number, type: entry.type || 'manual', createdAt: new Date().toISOString() }
    // Seal the entry into the hash chain. Done inside the setter, reading
    // the tail from the state being written to, so two postings in the same
    // tick cannot both chain off the same predecessor. See utils/ledgerChain.js.
    let sealed = newJE
    set((st) => {
      const prev = st.journalEntries[st.journalEntries.length - 1]?.hash || GENESIS
      // The link is computed from the full predecessor hash; only the
      // stored back-reference is a short tag. See PREV_TAG_LENGTH.
      sealed = { ...newJE, prevHash: prevTag(prev), hash: hashEntry(newJE, prev) }
      return {
        journalEntries: [...st.journalEntries, sealed],
        settings: { ...st.settings, journal: { ...st.settings.journal, next: st.settings.journal.next + 1 } },
      }
    })
    get().logActivity('Posted ' + String(newJE.type || 'entry').replace(/_/g, ' '), `${number} · ${entry.description || ''}`.trim())
    return sealed
  },

  /**
   * Why this entry cannot be edited, or null when it can.
   *
   * Only entries somebody typed by hand are editable. An entry the system
   * posted belongs to a document — correcting it here would leave the
   * invoice, bill or receipt saying one thing and the ledger another, so
   * those are corrected at their source. Reversals and already-reversed
   * entries are history and stay exactly as posted.
   */
  journalEditBlock: (id) => {
    const s = get()
    const je = s.journalEntries.find((j) => j.id === id)
    if (!je) return 'missing'
    // Reversals carry type 'reversal', so these are checked before the
    // manual test — otherwise a reversal is explained as an entry to correct
    // at its source document, which is not what it is.
    if (je.reversedBy) return 'voided'
    if (je.reverses) return 'reversal'
    if (je.type !== 'manual') return 'auto'
    const lock = s.settings?.accounting?.lockDate
    if (lock && je.date && String(je.date) <= String(lock)) return 'locked'
    return null
  },

  updateJournalEntry: (id, patch) => {
    const before = get().journalEntries.find((j) => j.id === id)
    const beforeHash = before?.hash
    set((s) => {
      const lock = s.settings?.accounting?.lockDate
      const je = s.journalEntries.find((j) => j.id === id)
      // block editing an entry in a closed period, or moving one into it
      if (lock && ((je?.date && String(je.date) <= String(lock)) || (patch?.date && String(patch.date) <= String(lock))))
        throw new Error(`PERIOD_LOCKED:${lock}`)
      // A reversal, and the entry it reversed, are settled history.
      if (je && (je.reversedBy || je.reverses)) throw new Error('JE_IMMUTABLE')
      // A system-posted entry mirrors a document; hand-editing it would put
      // the two out of step, so it is corrected from the document instead.
      if (je && je.type !== 'manual') throw new Error('JE_NOT_MANUAL')
      const merged = je ? { ...je, ...patch } : null
      // a patch must not unbalance the entry or strip its date
      if (merged) {
        if (!merged.date) throw new Error('JE_NO_DATE')
        const dr = (merged.lines || []).reduce((t, l) => t + (+l.debit || 0), 0)
        const cr = (merged.lines || []).reduce((t, l) => t + (+l.credit || 0), 0)
        if (Math.abs(dr - cr) > BALANCE_TOLERANCE) throw new Error(`JE_UNBALANCED:${(dr - cr).toFixed(2)}`)
      }
      // Editing a manual entry is legal, so the chain is repaired — but only
      // from this entry forward. Re-hashing the whole ledger would also
      // silently repair any *earlier* tampering, destroying the evidence
      // this chain exists to preserve. See utils/ledgerChain.js `reseal`.
      const at = s.journalEntries.findIndex((j) => j.id === id)
      const next = s.journalEntries.map((j) => (j.id === id ? merged : j))
      return { journalEntries: at < 0 ? next : reseal(next, at) }
    })
    if (before) {
      const after = get().journalEntries.find((j) => j.id === id)
      // The old and new hashes go in the trail: an edit is allowed, but it
      // must never be invisible, and these two values are what let anyone
      // check later that the ledger they hold is the edited one.
      get().logActivity(
        'Edited journal entry',
        `${before.number} · ${patch?.description || before.description || ''}`.trim(),
        { entity: 'journal', entityId: id, entityRef: before.number || '',
          changes: [{ field: 'ledgerHash', from: shortHash(beforeHash), to: shortHash(after?.hash) }] },
      )
    }
    return get().journalEntries.find((j) => j.id === id)
  },

  deleteJournalEntry: (id) => {
    const before = get().journalEntries.find((j) => j.id === id)
    set((s) => {
      const lock = s.settings?.accounting?.lockDate
      const je = s.journalEntries.find((j) => j.id === id)
      if (lock && je?.date && String(je.date) <= String(lock))
        throw new Error(`PERIOD_LOCKED:${lock}`)
      // Removing an entry shifts every link after it, so the chain is
      // resealed from the gap — again, forward only.
      const at = s.journalEntries.findIndex((j) => j.id === id)
      const next = s.journalEntries.filter((j) => j.id !== id)
      return { journalEntries: at < 0 ? next : reseal(next, at) }
    })
    if (before) {
      get().logActivity('Deleted journal entry', `${before.number || ''} · ${before.description || ''}`.trim(),
        { entity: 'journal', entityId: id, entityRef: before.number || '', severity: 'high',
          changes: [{ field: 'ledgerHash', from: shortHash(before.hash), to: '' }] })
    }
  },

  // ─── LEDGER TAMPER-EVIDENCE ────────────────────────────────────
  // See utils/ledgerChain.js for what the chain does and does not prove.

  /** Recompute every link and report anything that does not match. */
  verifyLedger: () => verifyChain(get().journalEntries),

  /**
   * The single value that fixes the ledger as it stands right now.
   *
   * Worth writing down somewhere outside this browser. Anyone can later
   * recompute the chain from the data and compare — if the head still
   * matches, nothing in those entries has been touched since.
   */
  ledgerAnchor: () => ledgerAnchor(get().journalEntries),

  /**
   * Seal entries that carry no hash yet.
   *
   * Needed for books restored from a backup taken before the chain
   * existed. It is honest about what it achieves: sealing fixes the ledger
   * from this moment on and says nothing whatsoever about what happened to
   * it beforehand, so it is recorded in the trail as exactly that.
   */
  sealLedger: () => {
    const before = verifyChain(get().journalEntries)
    if (before.unsealed === 0) return { sealed: 0, alreadySealed: before.sealed }
    set((s) => ({ journalEntries: chainEntries(s.journalEntries) }))
    const after = ledgerAnchor(get().journalEntries)
    get().logActivity('Sealed the ledger', `${before.unsealed} entries sealed · anchor ${shortHash(after.head)}`,
      { entity: 'journal', severity: 'high' })
    return { sealed: before.unsealed, anchor: after }
  },

  // Throws PERIOD_LOCKED if deleting a document would remove any journal entry
  // dated in a closed period. Called by every document delete that cascades JEs.
  assertJEsUnlocked: (...ids) => {
    const lock = get().settings?.accounting?.lockDate
    if (!lock) return
    const wanted = new Set(ids.filter(Boolean))
    if (get().journalEntries.some((j) => wanted.has(j.id) && j.date && String(j.date) <= String(lock)))
      throw new Error(`PERIOD_LOCKED:${lock}`)
  },

  // Void a posted entry by posting a mirror-image reversal instead of deleting
  // it — the original and its reversal both stay in the ledger permanently
  // (immutable audit trail, no numbering gaps). Reversing on an open date is the
  // correct way to undo a closed-period entry, so this works even when the
  // original is locked, as long as the reversal `date` is in an open period.
  voidJournalEntry: (id, { date, reason } = {}) => {
    const je = get().journalEntries.find((j) => j.id === id)
    if (!je) return null
    if (je.reversedBy) throw new Error('ALREADY_VOID')
    if (je.reverses) throw new Error('CANNOT_VOID_REVERSAL')
    const voidDate = date || je.date
    const rev = get().addJournalEntry({
      date: voidDate,
      description: `Reversal of ${je.number}${reason ? ' — ' + reason : ''}`,
      reference: je.number, type: 'reversal', reverses: je.id,
      departmentId: je.departmentId || null,
      lines: (je.lines || []).map((l) => ({
        accountId: l.accountId, debit: l.credit || 0, credit: l.debit || 0,
        description: `Reversal: ${l.description || ''}`,
      })),
    })
    set((s) => ({
      journalEntries: s.journalEntries.map((j) =>
        j.id === id ? { ...j, reversedBy: rev.id, voidReason: reason || '', voidedAt: new Date().toISOString() } : j),
    }))
    get().logActivity('Voided journal entry', `${je.number} reversed by ${rev.number}${reason ? ' · ' + reason : ''}`)
    return rev
  },

  // ─── RECURRING JOURNAL ENTRIES ─────────────────────────────────
  // Templated journal entries (e.g. monthly rent accrual, amortization)
  // that post automatically on a schedule.
  recurringJournals: [],
  addRecurringJournal: (r) =>
    set((s) => ({ recurringJournals: [...s.recurringJournals, {
      id: uuid(), name: r.name || 'Recurring entry', frequency: r.frequency || 'monthly',
      nextDate: r.nextDate, lines: r.lines || [], status: 'active', lastPosted: null,
      postedCount: 0, createdAt: new Date().toISOString(),
    }] })),
  updateRecurringJournal: (id, patch) =>
    set((s) => ({ recurringJournals: s.recurringJournals.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  deleteRecurringJournal: (id) => {
    get().recycleRecord('recurringJournals', id)
    return set((s) => ({ recurringJournals: s.recurringJournals.filter((x) => x.id !== id) }))
  },

  postRecurringJournal: (id, { onDate } = {}) => {
    const r = get().recurringJournals.find((x) => x.id === id)
    if (!r) return null
    const date = onDate || r.nextDate
    const je = get().addJournalEntry({ date, description: r.name, reference: 'REC', type: 'recurring', lines: r.lines })
    const nextDate = get().advanceDate(date, r.frequency)
    set((s) => ({ recurringJournals: s.recurringJournals.map((x) =>
      (x.id === id ? { ...x, nextDate, lastPosted: date, postedCount: (x.postedCount || 0) + 1 } : x)) }))
    return je
  },
  // Post every active recurring journal whose nextDate has arrived (catches up
  // multiple missed periods, bounded, and stops on a locked period).
  generateDueRecurringJournals: () => {
    const today = todayISO()
    let count = 0
    get().recurringJournals.filter((r) => r.status === 'active' && r.nextDate <= today).forEach((r) => {
      let guard = 0
      while (guard++ < 60) {
        const cur = get().recurringJournals.find((x) => x.id === r.id)
        if (!cur || cur.status !== 'active' || cur.nextDate > today) break
        try { get().postRecurringJournal(r.id, { onDate: cur.nextDate }); count += 1 }
        catch { break }
      }
    })
    return count
  },

  // ─── COMPUTED ──────────────────────────────────────────────────
  getAccountBalance: (accountId, startDate, endDate) => {
    const s = get()
    const account = s.accounts.find((a) => a.id === accountId)
    if (!account) return 0
    let dr = 0, cr = 0
    s.journalEntries.forEach((je) => {
      if (startDate && je.date < startDate) return
      if (endDate   && je.date > endDate)   return
      je.lines.forEach((line) => {
        if (line.accountId === accountId) { dr += line.debit || 0; cr += line.credit || 0 }
      })
    })
    return ['asset', 'expense'].includes(account.type) ? dr - cr : cr - dr
  },

  getAllBalances: (startDate, endDate) => {
    const s = get()
    const balances = {}
    s.accounts.forEach((a) => { balances[a.id] = { dr: 0, cr: 0 } })
    s.journalEntries.forEach((je) => {
      if (startDate && je.date < startDate) return
      if (endDate   && je.date > endDate)   return
      je.lines.forEach((line) => {
        if (!balances[line.accountId]) balances[line.accountId] = { dr: 0, cr: 0 }
        balances[line.accountId].dr += line.debit  || 0
        balances[line.accountId].cr += line.credit || 0
      })
    })
    return balances
  },
})
