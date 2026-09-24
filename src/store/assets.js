// Fixed assets, prepaid expenses and leases.
// One slice of the store — see src/store.js for how the slices combine.
import { v4 as uuid } from 'uuid'
import { initialMeasurement, recognitionLines, periodLines } from '../utils/ifrs16'
import { todayISO } from '../utils/localDate'
import { nextNum, keepEntries } from './shared'

export const createAssetsSlice = (set, get) => ({
  // ─── FIXED ASSETS ──────────────────────────────────────────────
  fixedAssets: [],
  assetDepreciations: [],

  addFixedAsset: (asset) => {
    const s = get()
    const { prefix, next } = s.settings.fixedAsset
    const number = nextNum(prefix, next)
    // Bought on credit, the liability belongs on whichever payables
    // control account that supplier uses — the default when none is named.
    const creditAccId = asset.paymentType === 'credit'
      ? get().controlAccountFor('suppliers', asset.supplierId)
      : (asset.bankAccountId || 'acc-bank1')
    const je = get().addJournalEntry({
      date: asset.purchaseDate,
      description: `Asset Purchase: ${asset.name} (${number})`,
      reference: number, type: 'fixed_asset',
      lines: [
        { accountId: 'acc-fixed', debit: asset.purchaseCost, credit: 0,                  description: asset.name },
        { accountId: creditAccId, debit: 0,                  credit: asset.purchaseCost, description: asset.name },
      ],
    })
    const newAsset = {
      ...asset, id: uuid(), number, status: 'active',
      accumulatedDepreciation: 0, currentBookValue: asset.purchaseCost,
      journalEntryId: je.id, createdAt: new Date().toISOString(),
    }
    set((st) => ({
      fixedAssets: [...st.fixedAssets, newAsset],
      settings: { ...st.settings, fixedAsset: { ...st.settings.fixedAsset, next: next + 1 } },
    }))
    return newAsset
  },

  recordDepreciation: (assetId, { date, amount, period }) => {
    const asset = get().fixedAssets.find((a) => a.id === assetId)
    if (!asset || asset.status !== 'active') return
    const je = get().addJournalEntry({
      date,
      description: `Depreciation – ${asset.name} (${period})`,
      reference: asset.number, type: 'depreciation',
      lines: [
        { accountId: 'acc-depexp', debit: amount, credit: 0,      description: `Dep: ${asset.name}` },
        { accountId: 'acc-depr',   debit: 0,      credit: amount, description: `Dep: ${asset.name}` },
      ],
    })
    const newAccDep   = asset.accumulatedDepreciation + amount
    const newBookVal  = asset.purchaseCost - newAccDep
    set((st) => ({
      fixedAssets: st.fixedAssets.map((a) =>
        a.id === assetId ? { ...a, accumulatedDepreciation: newAccDep, currentBookValue: newBookVal } : a
      ),
      assetDepreciations: [...st.assetDepreciations, {
        id: uuid(), assetId, assetName: asset.name, assetNumber: asset.number,
        date, period, amount, journalEntryId: je.id,
      }],
    }))
  },

  // Batch straight-line depreciation for every active asset in one period.
  // Skips assets already depreciated for that period or fully depreciated,
  // and caps the charge at the remaining depreciable base.
  /**
   * Which active assets are owed a straight-line charge for a period, and
   * how much each is owed. Posts nothing.
   *
   * This is the single definition of "what depreciation is due". The
   * preview a user approves and the run that posts are otherwise two
   * copies of the same fifteen lines, and the moment they disagree the
   * app shows one number and books another — at exactly the point where
   * someone is deciding whether to commit.
   *
   * Skips assets already charged for the period, so running twice is
   * safe, and caps the charge at what is left of the depreciable base so
   * an asset can never depreciate past its salvage value.
   */
  depreciationDue: (period, date) => {
    const { fixedAssets, assetDepreciations } = get()
    return fixedAssets.reduce((due, a) => {
      if (a.status !== 'active') return due
      if ((a.depreciationMethod || 'straight_line') !== 'straight_line') return due
      if (a.purchaseDate && date && a.purchaseDate > date) return due // not yet acquired
      if (assetDepreciations.some((d) => d.assetId === a.id && d.period === period)) return due
      const cost = a.purchaseCost || 0, salvage = a.salvageValue || 0
      const months = (a.usefulLifeYears || 0) * 12
      if (months <= 0) return due
      const remaining = (cost - salvage) - (a.accumulatedDepreciation || 0)
      const amount = Math.round(Math.min((cost - salvage) / months, remaining) * 100) / 100
      if (amount <= 0.005) return due
      due.push({ assetId: a.id, name: a.name || '', amount })
      return due
    }, [])
  },

  /** Totals for a set of due charges, rounded the way they will be posted. */
  _depreciationTotals: (due) =>
    ({ count: due.length, total: Math.round(due.reduce((s, d) => s + d.amount, 0) * 100) / 100 }),

  runDepreciation: ({ period, date }) => {
    const due = get().depreciationDue(period, date)
    due.forEach((d) => get().recordDepreciation(d.assetId, { date, amount: d.amount, period }))
    return get()._depreciationTotals(due)
  },

  // preview only (no posting): how many assets are due for a period + total
  previewDepreciation: (period, date) => get()._depreciationTotals(get().depreciationDue(period, date)),

  /**
   * Straight-line depreciation still owed on an asset up to `date`: what
   * it should carry by then — one month for every calendar month from its
   * purchase month to `date`'s month, the same months the monthly run
   * charges — less what has been charged, never past the depreciable base.
   */
  depreciationCatchUp: (assetId, date) => {
    const a = get().fixedAssets.find((x) => x.id === assetId)
    if (!a || a.status !== 'active' || !date || !a.purchaseDate) return 0
    if ((a.depreciationMethod || 'straight_line') !== 'straight_line') return 0
    const months = (a.usefulLifeYears || 0) * 12
    if (months <= 0 || date < a.purchaseDate) return 0
    const [y1, m1] = a.purchaseDate.split('-').map(Number)
    const [y2, m2] = date.split('-').map(Number)
    const elapsed = (y2 - y1) * 12 + (m2 - m1) + 1
    const base = (a.purchaseCost || 0) - (a.salvageValue || 0)
    const shouldHave = Math.min(base, (base / months) * elapsed)
    return Math.max(0, Math.round((shouldHave - (a.accumulatedDepreciation || 0)) * 100) / 100)
  },

  disposeAsset: (assetId, { date, proceeds, bankAccountId, catchUp = true }) => {
    let asset = get().fixedAssets.find((a) => a.id === assetId)
    if (!asset || asset.status !== 'active') return
    // Charge the depreciation for the months up to disposal first.
    // Skipping it overstated the book value on the day it left, and so
    // understated the gain (or overstated the loss) on disposal.
    const owed = catchUp ? get().depreciationCatchUp(assetId, date) : 0
    if (owed > 0.005) {
      get().recordDepreciation(assetId, { date, amount: owed, period: `To disposal ${date}` })
      asset = get().fixedAssets.find((a) => a.id === assetId)
    }
    proceeds = Number(proceeds) || 0
    const accDep   = asset.accumulatedDepreciation
    const gainLoss = proceeds - asset.currentBookValue
    const lines = [
      { accountId: 'acc-fixed', debit: 0,      credit: asset.purchaseCost, description: `Dispose: ${asset.name}` },
      { accountId: 'acc-depr',  debit: accDep, credit: 0,                  description: `Dispose: ${asset.name}` },
    ]
    if (proceeds > 0)
      lines.push({ accountId: bankAccountId || 'acc-bank1', debit: proceeds, credit: 0, description: `Proceeds: ${asset.name}` })
    if (gainLoss > 0)
      lines.push({ accountId: 'acc-gainloss', debit: 0,                credit: gainLoss,         description: 'Gain on disposal' })
    else if (gainLoss < 0)
      lines.push({ accountId: 'acc-lossdis',  debit: Math.abs(gainLoss), credit: 0,              description: 'Loss on disposal' })
    const je = get().addJournalEntry({
      date,
      description: `Asset Disposal: ${asset.name} (${asset.number})`,
      reference: asset.number, type: 'asset_disposal', lines,
    })
    set((st) => ({
      fixedAssets: st.fixedAssets.map((a) =>
        a.id === assetId ? { ...a, status: 'disposed', disposalDate: date, disposalProceeds: proceeds, disposalJEId: je.id } : a
      ),
    }))
  },

  deleteFixedAsset: (id) =>
    set((s) => {
      const asset = s.fixedAssets.find((a) => a.id === id)
      // all JEs this asset produced: purchase, every depreciation charge, disposal
      const depJEs = s.assetDepreciations.filter((d) => d.assetId === id).map((d) => d.journalEntryId)
      const jeIds = new Set([asset?.journalEntryId, asset?.disposalJEId, ...depJEs].filter(Boolean))
      get().assertJEsUnlocked(...jeIds)
      return {
        fixedAssets: s.fixedAssets.filter((a) => a.id !== id),
        assetDepreciations: s.assetDepreciations.filter((d) => d.assetId !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => !jeIds.has(j.id)),
      }
    }),

  // ─── PREPAID EXPENSES ──────────────────────────────────────────
  prepaidExpenses: [],

  addPrepaidExpense: (pre) => {
    const s = get()
    const { prefix, next } = s.settings.prepaid
    const number = nextNum(prefix, next)
    const bankAccId = pre.bankAccountId || 'acc-bank1'
    const je = get().addJournalEntry({
      date: pre.startDate,
      description: `Prepaid: ${pre.name} (${number})`,
      reference: number, type: 'prepaid',
      lines: [
        { accountId: 'acc-prepaid', debit: pre.amount,  credit: 0,          description: pre.name },
        { accountId: bankAccId,     debit: 0,           credit: pre.amount, description: pre.name },
      ],
    })
    const newPre = {
      ...pre, id: uuid(), number, amortized: 0, remaining: pre.amount,
      journalEntryId: je.id, createdAt: new Date().toISOString(),
    }
    set((st) => ({
      prepaidExpenses: [...st.prepaidExpenses, newPre],
      settings: { ...st.settings, prepaid: { ...st.settings.prepaid, next: next + 1 } },
    }))
    return newPre
  },

  amortizePrepaid: (id, { date, amount, period }) => {
    const pre = get().prepaidExpenses.find((p) => p.id === id)
    if (!pre) return
    const expAccId = pre.expenseAccountId || 'acc-admin'
    const je = get().addJournalEntry({
      date,
      description: `Amortize Prepaid: ${pre.name} (${period})`,
      reference: pre.number, type: 'prepaid_amort',
      lines: [
        { accountId: expAccId,      debit: amount, credit: 0,      description: `${pre.name} – ${period}` },
        { accountId: 'acc-prepaid', debit: 0,      credit: amount, description: `${pre.name} – ${period}` },
      ],
    })
    const newAmortized = pre.amortized + amount
    const newRemaining = pre.amount - newAmortized
    set((st) => ({
      prepaidExpenses: st.prepaidExpenses.map((p) =>
        p.id === id ? { ...p, amortized: newAmortized, remaining: Math.max(0, newRemaining) } : p
      ),
    }))
    return je
  },

  deletePrepaidExpense: (id) =>
    set((s) => {
      const pre = s.prepaidExpenses.find((p) => p.id === id)
      get().assertJEsUnlocked(pre?.journalEntryId)
      return {
        prepaidExpenses: s.prepaidExpenses.filter((p) => p.id !== id),
        journalEntries: keepEntries(s.journalEntries, (j) => j.id !== pre?.journalEntryId),
      }
    }),

  // ─── LEASES ────────────────────────────────────────────────────
  leases: [],

  addLease: (lease) => {
    const s = get()
    const { prefix, next } = s.settings.lease
    const number = nextNum(prefix, next)
    const newLease = { ...lease, id: uuid(), number, status: 'active', payments: [], createdAt: new Date().toISOString() }
    set((st) => ({
      leases: [...st.leases, newLease],
      settings: { ...st.settings, lease: { ...st.settings.lease, next: next + 1 } },
    }))
    return newLease
  },

  // ── IFRS 16 ──
  // Capitalising a lease is opt-in per lease: it changes the shape of the
  // balance sheet, so it happens when somebody asks for it rather than
  // because a lease happens to look long enough to qualify.

  /** The measurement inputs a lease carries, in the shape ifrs16.js wants. */
  leaseTerms: (lease) => ({
    payment: Number(lease?.monthlyRent) || 0,
    termMonths: Number(lease?.termMonths) || 0,
    annualRate: Number(lease?.discountRate) || 0,
    timing: lease?.paymentTiming || 'advance',
    initialCosts: Number(lease?.initialCosts) || 0,
    prepaid: Number(lease?.prepaid) || 0,
    incentives: Number(lease?.incentives) || 0,
    usefulLifeMonths: Number(lease?.usefulLifeMonths) || 0,
    purchaseOption: !!lease?.purchaseOption,
    assetValue: Number(lease?.assetValue) || 0,
  }),

  /**
   * Recognise a lease under IFRS 16 — right-of-use asset and lease
   * liability at commencement.
   *
   * Refuses to run twice. A second recognition would double both the asset
   * and the liability, and the books would still balance, so the error
   * would sit there looking plausible for months.
   */
  recogniseLease: (leaseId, opts = {}) => {
    const lease = get().leases.find((l) => l.id === leaseId)
    if (!lease) throw new Error('LEASE_NOT_FOUND')
    if (lease.treatment === 'ifrs16') throw new Error('LEASE_ALREADY_RECOGNISED')
    const terms = get().leaseTerms(lease)
    if (!terms.termMonths || terms.termMonths < 1) throw new Error('LEASE_TERM_REQUIRED')
    if (!terms.payment) throw new Error('LEASE_PAYMENT_REQUIRED')

    const lines = recognitionLines(terms, { bankAccountId: lease.bankAccountId || 'acc-bank1' })
    if (!lines.length) throw new Error('LEASE_NOTHING_TO_RECOGNISE')
    const measured = initialMeasurement(terms)

    const je = get().addJournalEntry({
      date: opts.date || lease.startDate || todayISO(),
      description: `Lease recognition – ${lease.name}`,
      reference: lease.number, type: 'lease_recognition', lines,
    })
    set((st) => ({
      leases: st.leases.map((l) => (l.id === leaseId ? {
        ...l, treatment: 'ifrs16',
        recognitionJournalEntryId: je.id,
        initialLiability: measured.liability,
        initialRouAsset: measured.rouAsset,
        postedPeriods: [],
        recognisedAt: new Date().toISOString(),
      } : l)),
    }))
    return je
  },

  /**
   * Post one period of a capitalised lease: interest accretion, the
   * payment, and right-of-use depreciation.
   *
   * Posting a period twice is refused for the same reason as double
   * recognition — the entry balances either way, so nothing would flag it.
   */
  postLeasePeriod: (leaseId, period, opts = {}) => {
    const lease = get().leases.find((l) => l.id === leaseId)
    if (!lease) throw new Error('LEASE_NOT_FOUND')
    if (lease.treatment !== 'ifrs16') throw new Error('LEASE_NOT_RECOGNISED')
    if ((lease.postedPeriods || []).some((p) => p.period === period)) throw new Error('LEASE_PERIOD_ALREADY_POSTED')

    const built = periodLines(get().leaseTerms(lease), period, {
      bankAccountId: opts.bankAccountId || lease.bankAccountId || 'acc-bank1',
    })
    if (!built) throw new Error('LEASE_PERIOD_OUT_OF_TERM')

    const date = opts.date || todayISO()
    const je = get().addJournalEntry({
      date, description: `Lease period ${period} – ${lease.name}`,
      reference: lease.number, type: 'lease_period', lines: built.lines,
    })
    set((st) => ({
      leases: st.leases.map((l) => (l.id === leaseId ? {
        ...l,
        postedPeriods: [...(l.postedPeriods || []), {
          period, date, journalEntryId: je.id,
          interest: built.row.interest,
          depreciation: built.row.depreciation,
          payment: built.row.payment,
        }],
      } : l)),
    }))
    return je
  },

  recordLeasePayment: (leaseId, payment) => {
    const lease = get().leases.find((l) => l.id === leaseId)
    if (!lease) return
    // A capitalised lease posts through postLeasePeriod, which splits the
    // payment between interest and principal. Booking it as rent as well
    // would expense the same cash twice.
    if (lease.treatment === 'ifrs16') throw new Error('LEASE_IS_CAPITALISED')
    const bankAccId = payment.bankAccountId || lease.bankAccountId || 'acc-bank1'
    const expAccId  = payment.expenseAccountId || lease.expenseAccountId || 'acc-rent'
    const je = get().addJournalEntry({
      date: payment.date,
      description: `Lease Payment – ${lease.name} (${payment.period || payment.date})`,
      reference: lease.number, type: 'lease_payment',
      lines: [
        { accountId: expAccId,  debit: payment.amount,  credit: 0,              description: `${lease.name}` },
        { accountId: bankAccId, debit: 0,               credit: payment.amount, description: `${lease.name}` },
      ],
    })
    set((st) => ({
      leases: st.leases.map((l) =>
        l.id === leaseId
          ? { ...l, payments: [...(l.payments || []), { ...payment, id: uuid(), journalEntryId: je.id }] }
          : l
      ),
    }))
    return je
  },

  terminateLease: (id, terminationDate) =>
    set((s) => ({
      leases: s.leases.map((l) => l.id === id ? { ...l, status: 'terminated', terminationDate } : l),
    })),

  deleteLease: (id) =>
    set((s) => ({ leases: s.leases.filter((l) => l.id !== id) })),
})
