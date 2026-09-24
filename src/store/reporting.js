// IFRS 9, IAS 12, disclosure notes, VAT settlement, projects and budgets.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { buildNotes } from '../utils/disclosures'
import { buildDeferredTax, movementLines as deferredTaxLines, deferredCharge, effectiveRateReconciliation, DECLINING_BALANCE } from '../utils/deferredTax'
import { ageReceivables, computeEcl, eclMovement, provisionLines } from '../utils/ecl'
import { todayISO } from '../utils/localDate'
import { nextNum } from './shared'

export const createReportingSlice = (set, get) => ({
  // ─── IFRS 9 EXPECTED CREDIT LOSSES ─────────────────────────────

  updateEclSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ecl: { ...(s.settings.ecl || {}), ...patch } } })),

  /** The current aged book and the allowance it implies, as a working. */
  eclAssessment: (asOf) => {
    const s = get()
    const at = asOf || todayISO()
    const aged = ageReceivables(s.invoices, { asOf: at, customers: s.customers })
    const ecl = computeEcl(aged, s.settings.ecl?.matrix)
    // The allowance is a contra-asset, so its ledger balance is a credit.
    const bal = s.getAllBalances(undefined, at)['acc-ecl'] || { dr: 0, cr: 0 }
    const existing = Math.round((bal.cr - bal.dr) * 100) / 100
    return { asOf: at, aged, ecl, ...eclMovement(ecl.total, existing) }
  },

  /**
   * Adjust the allowance to the level the aged book requires.
   *
   * Posts the movement, never the requirement: charging the full expected
   * loss at every assessment would compound the allowance until
   * receivables were carried at nothing, and every entry would balance the
   * whole way down.
   */
  postEclProvision: (opts = {}) => {
    const assessment = get().eclAssessment(opts.asOf)
    const lines = provisionLines(assessment.movement)
    if (!lines.length) return null
    const je = get().addJournalEntry({
      date: assessment.asOf,
      description: `Expected credit loss assessment at ${assessment.asOf}`,
      reference: '', type: 'ecl', lines,
    })
    set((st) => ({
      settings: { ...st.settings, ecl: { ...(st.settings.ecl || {}), lastAssessedAt: assessment.asOf } },
    }))
    return je
  },

  // ─── IAS 12 — DEFERRED TAX ─────────────────────────────────────
  // See utils/deferredTax.js for the sign convention, which is the part
  // that decides whether any of this is right.

  updateDeferredTaxSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, deferredTax: { ...(s.settings.deferredTax || {}), ...patch } } })),

  /**
   * The temporary differences at a date and the deferred tax they carry.
   *
   * Carrying amounts are read from the ledger rather than rebuilt from the
   * subledgers, because the ledger is what the financial statements report
   * — deferred tax measured against anything else would be deferred tax on
   * a balance sheet nobody is publishing.
   */
  deferredTaxAssessment: (asOf) => {
    const s = get()
    const at = asOf || todayISO()
    const cfg = s.settings.deferredTax || {}
    const balances = s.getAllBalances(undefined, at)
    const byId = Object.fromEntries(s.accounts.map((a) => [a.id, a]))
    // Debits less credits for assets and expenses, the other way round for
    // everything else — so contra accounts come back negative, which is
    // what ledgerDifferences expects.
    const natural = (id) => {
      const b = balances[id] || { dr: 0, cr: 0 }
      const type = byId[id]?.type
      const v = ['asset', 'expense'].includes(type) ? b.dr - b.cr : b.cr - b.dr
      return Math.round(v * 100) / 100
    }

    const schedule = buildDeferredTax(
      { fixedAssets: s.fixedAssets, natural },
      {
        ratePct: cfg.ratePct || 0,
        allowanceRatePct: cfg.allowanceRatePct || 0,
        assetTaxMethod: cfg.assetTaxMethod || DECLINING_BALANCE,
        lossesCarriedForward: cfg.lossesCarriedForward || 0,
        recognitionPct: cfg.recognitionPct == null ? 100 : cfg.recognitionPct,
        offset: cfg.offset !== false,
        manual: cfg.manual || [],
        asOf: at,
      },
    )
    const existing = { asset: Math.max(0, natural('acc-dta')), liability: Math.max(0, natural('acc-dtl')) }
    return { ...schedule, existing, charge: deferredCharge(schedule, existing) }
  },

  /**
   * Move deferred tax to the level the schedule requires.
   *
   * Posts the movement, never the balance — the same property the ECL
   * provision needs and for the same reason: every entry balances either
   * way, so a position that doubled at each assessment would not trip a
   * single other check in the system.
   */
  postDeferredTax: (opts = {}) => {
    const assessment = get().deferredTaxAssessment(opts.asOf)
    const lines = deferredTaxLines(assessment, assessment.existing)
    if (!lines.length) return null
    const je = get().addJournalEntry({
      date: assessment.asOf,
      description: `Deferred tax at ${assessment.asOf}`,
      reference: '', type: 'deferred_tax', lines,
    })
    set((st) => ({
      settings: { ...st.settings, deferredTax: { ...(st.settings.deferredTax || {}), lastAssessedAt: assessment.asOf } },
    }))
    return je
  },

  /**
   * Why the tax charge is not simply profit times the rate (IAS 12.81(c)).
   *
   * A required disclosure and the first thing an auditor turns to. Profit
   * is taken before tax, so the tax accounts are excluded from it —
   * including tax in the profit it is charged on would make the
   * reconciliation circular.
   */
  taxRateReconciliation: (start, end) => {
    const s = get()
    const cfg = s.settings.deferredTax || {}
    const balances = s.getAllBalances(start, end)
    const TAX_ACCOUNTS = new Set(['acc-taxexp'])
    let revenue = 0, expenses = 0, taxCharge = 0
    s.accounts.forEach((a) => {
      const b = balances[a.id] || { dr: 0, cr: 0 }
      if (a.type === 'revenue') revenue += b.cr - b.dr
      else if (a.type === 'expense') {
        if (TAX_ACCOUNTS.has(a.id)) taxCharge += b.dr - b.cr
        else expenses += b.dr - b.cr
      }
    })
    const opening = get().deferredTaxAssessment(start)
    const closing = get().deferredTaxAssessment(end)
    return effectiveRateReconciliation({
      accountingProfit: Math.round((revenue - expenses) * 100) / 100,
      ratePct: cfg.ratePct || 0,
      // Everything posted to tax expense in the period, split between the
      // deferred movement and the rest, which is current tax by deduction.
      deferredTax: Math.round((closing.net - opening.net) * 100) / 100,
      currentTax: Math.round((taxCharge - (closing.net - opening.net)) * 100) / 100,
      unrecognisedAssetMovement: Math.round((closing.unrecognisedAsset - opening.unrecognisedAsset) * 100) / 100,
    })
  },

  // ─── NOTES TO THE FINANCIAL STATEMENTS ─────────────────────────

  /**
   * Every disclosure note for a period.
   *
   * Four primary statements without notes are not a set of IFRS financial
   * statements. See utils/disclosures.js — the rule every note obeys is
   * that it has to tie back to the face of the statements, and the pack
   * reports which notes do not rather than presenting a clean total.
   */
  disclosureNotes: (start, end) => {
    const s = get()
    const at = end || todayISO()
    const from = start || `${at.slice(0, 4)}-01-01`

    // The aged analysis is only meaningful once a loss allowance policy
    // exists; without one the note shows the balance and says no more.
    let ageing = null
    try { if (s.settings?.ecl?.enabled) ageing = s.eclAssessment(at).aged } catch { /* not configured */ }

    // Likewise the tax note: there is nothing to disclose about deferred
    // tax in a business that has not recognised any.
    let taxNote = null
    if (s.settings?.deferredTax?.enabled && s.settings?.deferredTax?.ratePct) {
      const schedule = s.deferredTaxAssessment(at)
      taxNote = { schedule, reconciliation: s.taxRateReconciliation(from, at) }
    }

    return buildNotes(s, { start: from, end: at, getAllBalances: s.getAllBalances, ageing, taxNote })
  },

  // ─── PROJECTS & JOB COSTING ────────────────────────────────────
  projects: [],

  addProject: (proj) => {
    const s = get()
    const { prefix, next } = s.settings.project
    const number = nextNum(prefix, next)
    const newProj = { ...proj, id: uuid(), number, status: proj.status || 'active', createdAt: new Date().toISOString() }
    set((st) => ({
      projects: [...st.projects, newProj],
      settings: { ...st.settings, project: { ...st.settings.project, next: next + 1 } },
    }))
    return newProj
  },

  updateProject: (id, patch) =>
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

  deleteProject: (id) => {
    get().recycleRecord('projects', id)
    return set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      timeEntries: s.timeEntries.filter((t) => t.projectId !== id),
    }))
  },

  // Record project income or cost — posts to the ledger AND tags the project
  recordProjectTransaction: (projectId, tx) => {
    get().addBankTransaction({ ...tx, projectId })
  },

  // ─── TIME TRACKING (billable) ──────────────────────────────────
  timeEntries: [],

  addTimeEntry: (entry) =>
    set((s) => ({ timeEntries: [...s.timeEntries, { ...entry, id: uuid(), createdAt: new Date().toISOString() }] })),

  updateTimeEntry: (id, patch) =>
    set((s) => ({ timeEntries: s.timeEntries.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  deleteTimeEntry: (id) => {
    get().recycleRecord('timeEntries', id)
    return set((s) => ({ timeEntries: s.timeEntries.filter((t) => t.id !== id) }))
  },

  // ─── BUDGETS (annual, per account) ─────────────────────────────
  budgets: [],

  setBudget: (accountId, year, amount) =>
    set((s) => {
      const existing = s.budgets.find((b) => b.accountId === accountId && b.year === year)
      if (existing)
        return { budgets: s.budgets.map((b) => (b.id === existing.id ? { ...b, amount } : b)) }
      return { budgets: [...s.budgets, { id: uuid(), accountId, year, amount }] }
    }),

  deleteBudget: (id) => {
    get().recycleRecord('budgets', id)
    return set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) }))
  },

  // ─── VAT SETTLEMENT ────────────────────────────────────────────
  // Close a filing period: clear Output VAT (liability) against Input VAT
  // (asset) and pay/receive the net through a bank account.
  //   net > 0 → payment to ZATCA (Cr bank), net < 0 → refund (Dr bank).
  settleVat: ({ date, from, to, bankAccountId, outputVat, inputVat }) => {
    const out = Math.round((Number(outputVat) || 0) * 100) / 100
    const inp = Math.round((Number(inputVat) || 0) * 100) / 100
    const net = Math.round((out - inp) * 100) / 100
    if (out === 0 && inp === 0) throw new Error('VAT_NOTHING_TO_SETTLE')
    const lines = []
    if (out > 0) lines.push({ accountId: 'acc-vatout', debit: out, credit: 0, description: 'Output VAT settled' })
    if (inp > 0) lines.push({ accountId: 'acc-vatin', debit: 0, credit: inp, description: 'Input VAT recovered' })
    if (net > 0) lines.push({ accountId: bankAccountId, debit: 0, credit: net, description: 'VAT paid to ZATCA' })
    else if (net < 0) lines.push({ accountId: bankAccountId, debit: -net, credit: 0, description: 'VAT refund from ZATCA' })
    return get().addJournalEntry({
      date,
      description: `VAT settlement ${from} → ${to}`,
      reference: `VAT ${from}..${to}`,
      type: 'vat_settlement',
      lines,
    })
  },
})
