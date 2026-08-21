// The audit binder.
//
// This is the document a business hands to somebody who does not trust it
// yet — an auditor, a bank, a buyer. Two things therefore have to hold that
// would be merely nice elsewhere.
//
// It must not flatter. A binder that reports "clean" over books that do not
// balance is worse than no binder, because it converts a problem the business
// could still fix into a representation made to a third party. So the verdict
// is tested against broken books at least as hard as against good ones.
//
// And it must be safe to open. The document is built from text the user typed
// and is then opened in someone else's browser, so every interpolation is
// escaped — a detail that is invisible until it is an incident.
import { describe, it, expect } from 'vitest'
import {
  trialBalance, positionSummary, auditTrailSummary, buildBinder, verifyBinder,
  canonicalBinder, naturalOf,
} from '../src/utils/auditBinder.js'
import { renderBinderHtml } from '../src/utils/binderHtml.js'

const ACCOUNTS = [
  { id: 'bank', code: '1001', name: 'Bank', type: 'asset' },
  { id: 'ar', code: '1100', name: 'Receivables', type: 'asset' },
  { id: 'ap', code: '2001', name: 'Payables', type: 'liability' },
  { id: 'cap', code: '3001', name: 'Capital', type: 'equity' },
  { id: 'sales', code: '4001', name: 'Sales', type: 'revenue' },
  { id: 'rent', code: '5003', name: 'Rent', type: 'expense' },
  { id: 'idle', code: '5099', name: 'Never used', type: 'expense' },
]

// Capital 50,000 in; sales 30,000 on credit; rent 12,000 paid.
const BALANCES = {
  bank: { dr: 50000, cr: 12000 },
  ar: { dr: 30000, cr: 0 },
  ap: { dr: 0, cr: 0 },
  cap: { dr: 0, cr: 50000 },
  sales: { dr: 0, cr: 30000 },
  rent: { dr: 12000, cr: 0 },
}

const base = (over = {}) => buildBinder({
  company: { name: 'Test Co.' },
  period: { start: '2026-01-01', end: '2026-12-31' },
  accounts: ACCOUNTS,
  balances: BALANCES,
  periodBalances: BALANCES,
  generatedAt: '2026-12-31T00:00:00.000Z',
  ...over,
})

describe('the trial balance', () => {
  it('lists every account that moved', () => {
    const tb = trialBalance(ACCOUNTS, BALANCES)
    expect(tb.rows.map((r) => r.code)).toEqual(['1001', '1100', '3001', '4001', '5003'])
  })

  it('leaves out accounts that never moved', () => {
    // A chart of accounts is not evidence.
    expect(trialBalance(ACCOUNTS, BALANCES).rows.find((r) => r.code === '5099')).toBeUndefined()
  })

  it('keeps an account that moved and came back to zero', () => {
    // That movement is exactly what somebody checking the books wants to see.
    const tb = trialBalance(ACCOUNTS, { ...BALANCES, ap: { dr: 5000, cr: 5000 } })
    const ap = tb.rows.find((r) => r.code === '2001')
    expect(ap).toMatchObject({ debit: 5000, credit: 5000, natural: 0 })
  })

  it('totals debits and credits, and says whether they agree', () => {
    const tb = trialBalance(ACCOUNTS, BALANCES)
    expect(tb.totalDebit).toBe(92000)
    expect(tb.totalCredit).toBe(92000)
    expect(tb.balances).toBe(true)
  })

  it('reports a trial balance that does not balance', () => {
    // The oldest check in bookkeeping, and the one that must never be quietly
    // rounded away.
    const tb = trialBalance(ACCOUNTS, { ...BALANCES, bank: { dr: 50000, cr: 11000 } })
    expect(tb.balances).toBe(false)
    expect(tb.difference).toBe(1000)
  })

  it('puts each balance in the column a printed trial balance would use', () => {
    const tb = trialBalance(ACCOUNTS, BALANCES)
    const bank = tb.rows.find((r) => r.code === '1001')
    const sales = tb.rows.find((r) => r.code === '4001')
    expect(bank.balanceDebit).toBe(38000)
    expect(bank.balanceCredit).toBe(0)
    expect(sales.balanceCredit).toBe(30000)
    expect(sales.balanceDebit).toBe(0)
  })

  it('puts a contra balance on the other side', () => {
    // Accumulated depreciation is an asset carrying a credit; showing it as a
    // negative debit would be arithmetically right and unreadable.
    const tb = trialBalance(
      [{ id: 'dep', code: '1610', name: 'Accumulated depreciation', type: 'asset' }],
      { dep: { dr: 0, cr: 8000 } })
    expect(tb.rows[0]).toMatchObject({ natural: -8000, balanceCredit: 8000, balanceDebit: 0 })
  })

  it('foots the balance columns, which must also agree', () => {
    // A second, independent reading of the same property: a ledger can foot
    // on movements while a balance sits in the wrong column, and only this
    // catches that.
    const tb = trialBalance(ACCOUNTS, BALANCES)
    expect(tb.balanceDebitTotal).toBe(80000)     // bank 38,000 + AR 30,000 + rent 12,000
    expect(tb.balanceCreditTotal).toBe(80000)    // capital 50,000 + sales 30,000
    expect(tb.balanceDebitTotal).toBe(tb.balanceCreditTotal)
  })

  it('sorts by account code', () => {
    const codes = trialBalance(ACCOUNTS, BALANCES).rows.map((r) => r.code)
    expect(codes).toEqual([...codes].sort())
  })

  it('signs each type the natural way round', () => {
    expect(naturalOf('asset', { dr: 100, cr: 40 })).toBe(60)
    expect(naturalOf('expense', { dr: 100, cr: 0 })).toBe(100)
    expect(naturalOf('liability', { dr: 0, cr: 90 })).toBe(90)
    expect(naturalOf('revenue', { dr: 0, cr: 90 })).toBe(90)
    expect(naturalOf('equity', { dr: 10, cr: 90 })).toBe(80)
  })
})

describe('the position summary', () => {
  it('totals by type and confirms the equation holds', () => {
    const p = positionSummary(ACCOUNTS, BALANCES)
    expect(p).toMatchObject({ assets: 68000, liabilities: 0, equity: 50000, revenue: 30000, expenses: 12000, profit: 18000 })
    expect(p.balances).toBe(true)
    expect(p.difference).toBe(0)
  })

  it('reports a broken equation rather than absorbing it', () => {
    const p = positionSummary(ACCOUNTS, { ...BALANCES, cap: { dr: 0, cr: 40000 } })
    expect(p.balances).toBe(false)
    expect(p.difference).toBe(10000)
  })
})

describe('the audit trail summary', () => {
  const LOG = [
    { ts: '2025-12-01T10:00:00Z', user: 'Old', action: 'Posted invoice', severity: 'low' },
    { ts: '2026-03-01T10:00:00Z', user: 'Sara', action: 'Posted invoice', severity: 'low' },
    { ts: '2026-03-02T10:00:00Z', user: 'Sara', action: 'Posted invoice', severity: 'low' },
    { ts: '2026-04-01T10:00:00Z', user: 'Ali', action: 'Deleted journal entry', severity: 'high', detail: 'JE-0004' },
    { ts: '2026-05-01T10:00:00Z', user: 'Ali', action: 'Edited journal entry', detail: 'JE-0002',
      changes: [{ field: 'ledgerHash', from: 'aaaaaaaaaaaa', to: 'bbbbbbbbbbbb' }] },
  ]
  const s = () => auditTrailSummary(LOG, { start: '2026-01-01', end: '2026-12-31' })

  it('counts only what happened in the period', () => {
    expect(s().total).toBe(4)
  })

  it('groups by action, commonest first', () => {
    expect(s().actions[0]).toEqual({ action: 'Posted invoice', count: 2 })
  })

  it('singles out edits that changed the ledger hash', () => {
    // The seal cannot reveal these: the chain was legitimately re-sealed, so
    // it verifies clean. This is the only record the entry ever read
    // differently.
    const edit = s().notable.find((e) => e.action === 'Edited journal entry')
    expect(edit.touchedLedger).toBe(true)
    expect(edit.changes[0]).toMatchObject({ from: 'aaaaaaaaaaaa', to: 'bbbbbbbbbbbb' })
  })

  it('singles out high-severity events', () => {
    expect(s().notable.some((e) => e.action === 'Deleted journal entry')).toBe(true)
  })

  it('leaves ordinary postings out of the notable list', () => {
    expect(s().notable.some((e) => e.action === 'Posted invoice')).toBe(false)
  })

  it('names who was active', () => {
    expect(s().users.sort()).toEqual(['Ali', 'Sara'])
  })

  it('flags an empty trail, which is itself a finding', () => {
    expect(auditTrailSummary([], { start: '2026-01-01', end: '2026-12-31' }).empty).toBe(true)
  })
})

describe('the verdict', () => {
  it('is clean when everything holds', () => {
    const b = base({
      integrity: { passed: 13, failed: 0, checks: [] },
      notes: { reconciles: true, failing: [], notes: [] },
      ledger: { anchor: { head: 'a'.repeat(64), count: 4 }, verify: { ok: true, sealed: 4, unsealed: 0, broken: [] } },
    })
    expect(b.verdict).toBe('clean')
    expect(b.findings).toEqual([])
  })

  it('is qualified when the trial balance does not balance', () => {
    // The binder must not flatter. This is the whole point of it.
    const b = base({ balances: { ...BALANCES, bank: { dr: 50000, cr: 11000 } } })
    expect(b.verdict).toBe('qualified')
    expect(b.findings.some((f) => f.code === 'TRIAL_BALANCE_OUT')).toBe(true)
  })

  it('is qualified when an integrity check fails, and names it', () => {
    const b = base({
      integrity: { passed: 12, failed: 1, checks: [{ ok: false, label: 'Trial balance nets to zero', detail: 'Out by 5' }] },
    })
    expect(b.verdict).toBe('qualified')
    expect(b.findings.find((f) => f.code === 'INTEGRITY_FAILED').detail).toBe('Trial balance nets to zero')
  })

  it('is qualified when the ledger does not match its seal', () => {
    const b = base({
      ledger: { anchor: { head: 'a'.repeat(64), count: 4 }, verify: { ok: false, sealed: 4, unsealed: 0, broken: [{ index: 1 }] } },
    })
    expect(b.verdict).toBe('qualified')
    expect(b.findings.some((f) => f.code === 'LEDGER_ALTERED')).toBe(true)
  })

  it('is qualified when a note disagrees with the statements', () => {
    const b = base({ notes: { reconciles: false, failing: ['Inventories'], notes: [] } })
    expect(b.findings.find((f) => f.code === 'NOTES_DISAGREE').detail).toBe('Inventories')
  })

  it('does not treat entries predating the seal as a problem', () => {
    // They came from a backup taken before sealing existed. Calling that
    // tampering would make every restored backup look like a fraud.
    const b = base({
      ledger: { anchor: { head: 'a'.repeat(64), count: 6 }, verify: { ok: true, sealed: 4, unsealed: 2, broken: [] } },
    })
    expect(b.verdict).toBe('clean')
    expect(b.unsealed).toBe(2)
  })

  it('collects every problem rather than stopping at the first', () => {
    const b = base({
      balances: { ...BALANCES, bank: { dr: 50000, cr: 11000 } },
      integrity: { passed: 12, failed: 1, checks: [{ ok: false, label: 'Something', detail: '' }] },
      notes: { reconciles: false, failing: ['Inventories'], notes: [] },
    })
    expect(b.findings.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the binder’s own fingerprint', () => {
  it('verifies against itself', () => {
    expect(verifyBinder(base())).toEqual({ ok: true })
  })

  it('catches the document being edited after it was produced', () => {
    const b = base()
    b.position.assets = 999999
    expect(verifyBinder(b)).toMatchObject({ ok: false, reason: 'ALTERED' })
  })

  it('catches the ledger seal being swapped', () => {
    const b = base({ ledger: { anchor: { head: 'a'.repeat(64), count: 4 }, verify: { ok: true, sealed: 4, broken: [] } } })
    b.ledger.anchor.head = 'b'.repeat(64)
    expect(verifyBinder(b).ok).toBe(false)
  })

  it('says so when there is no fingerprint at all', () => {
    expect(verifyBinder({})).toMatchObject({ ok: false, reason: 'NO_HASH' })
  })

  it('covers the figures a reader would act on', () => {
    const c = canonicalBinder(base())
    expect(c).toMatch(/assets=68000/)
    expect(c).toMatch(/trialDebit=92000/)
    expect(c).toMatch(/ledgerAnchor=/)
  })
})

describe('rendering', () => {
  const full = () => base({
    integrity: { passed: 2, failed: 0, checks: [
      { ok: true, label: 'Every journal entry balances', detail: '4 entries checked' },
      { ok: true, label: 'Trial balance nets to zero', detail: 'Dr = Cr = 92000' },
    ] },
    notes: { reconciles: true, failing: [], notes: [
      { id: 'policies', title: 'Significant accounting policies', reference: 'IAS 1.117',
        policies: [{ label: 'Inventories', text: 'Weighted average.' }] },
      { id: 'revenue', title: 'Revenue', reference: 'IFRS 15.114',
        rows: [{ id: 'sales', label: 'Sales', amount: 30000 }], total: 30000 },
    ] },
    ledger: { anchor: { head: 'a'.repeat(64), count: 4 }, verify: { ok: true, sealed: 4, unsealed: 0, broken: [] } },
    auditLog: [{ ts: '2026-05-01T10:00:00Z', user: 'Ali', action: 'Edited journal entry', detail: 'JE-0002',
      changes: [{ field: 'ledgerHash', from: 'aaaaaaaaaaaa', to: 'bbbbbbbbbbbb' }] }],
  })

  it('produces one self-contained document', () => {
    const html = renderBinderHtml(full(), { sym: '$' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    // Nothing fetched from anywhere: it has to open on a laptop with no
    // network, years from now.
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/src\s*=/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('carries the figures a reader came for', () => {
    const html = renderBinderHtml(full(), { sym: '$' })
    expect(html).toMatch(/Test Co\./)
    expect(html).toMatch(/Trial balance/)
    expect(html).toMatch(/92,000\.00/)
    expect(html).toMatch(/a{64}/)              // the ledger seal
    expect(html).toMatch(/Every journal entry balances/)
    expect(html).toMatch(/Significant accounting policies/)
  })

  it('shows the qualified verdict prominently when there is one', () => {
    const html = renderBinderHtml(base({ balances: { ...BALANCES, bank: { dr: 50000, cr: 11000 } } }), { sym: '$' })
    expect(html).toMatch(/class="verdict qualified"/)
    expect(html).toMatch(/TRIAL_BALANCE_OUT/)
  })

  it('reports the ledger edit the seal cannot reveal', () => {
    const html = renderBinderHtml(full(), { sym: '$' })
    expect(html).toMatch(/aaaaaaaaaaaa/)
    expect(html).toMatch(/bbbbbbbbbbbb/)
  })

  it('renders right-to-left when asked', () => {
    const html = renderBinderHtml(full(), { sym: 'SAR', dir: 'rtl', lang: 'ar' })
    expect(html).toMatch(/dir="rtl"/)
    expect(html).toMatch(/lang="ar"/)
  })

  it('translates through the supplied function', () => {
    const html = renderBinderHtml(full(), { sym: '$', t: (s) => (s === 'Trial balance' ? 'ميزان المراجعة' : s) })
    expect(html).toMatch(/ميزان المراجعة/)
  })
})

describe('safety of the rendered document', () => {
  // It is built from text the user typed and then opened in somebody else's
  // browser. An account named `<script>` would otherwise run there, turning a
  // document meant to establish trust into an attack on the person reading it.
  const hostile = '<script>alert(1)</script>'

  it('escapes a hostile company name', () => {
    const html = renderBinderHtml(base({ company: { name: hostile } }), { sym: '$' })
    expect(html).not.toMatch(/<script>alert/)
    expect(html).toMatch(/&lt;script&gt;/)
  })

  it('escapes a hostile account name', () => {
    const accounts = [{ id: 'x', code: '1', name: hostile, type: 'asset' }]
    const html = renderBinderHtml(
      base({ accounts, balances: { x: { dr: 1, cr: 0 } } }), { sym: '$' })
    expect(html).not.toMatch(/<script>alert/)
  })

  it('escapes a hostile audit-trail entry', () => {
    const html = renderBinderHtml(base({
      auditLog: [{ ts: '2026-05-01T10:00:00Z', user: hostile, action: hostile, detail: hostile, severity: 'high' }],
    }), { sym: '$' })
    expect(html).not.toMatch(/<script>alert/)
  })

  it('escapes a hostile revenue category inside a note', () => {
    const html = renderBinderHtml(base({
      notes: { reconciles: true, failing: [], notes: [
        { id: 'revenue', title: 'Revenue', reference: '', rows: [{ id: 'r', label: hostile, amount: 1 }], total: 1 },
      ] },
    }), { sym: '$' })
    expect(html).not.toMatch(/<script>alert/)
  })

  it('escapes an attribute-breaking value', () => {
    const html = renderBinderHtml(base({ company: { name: '" onload="alert(1)' } }), { sym: '$' })
    expect(html).not.toMatch(/onload="alert/)
  })
})

describe('robustness', () => {
  it('builds from nothing at all', () => {
    const b = buildBinder({})
    expect(b.verdict).toBe('clean')
    expect(b.trialBalance.rows).toEqual([])
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('renders a binder with no notes, no integrity run and no ledger', () => {
    const html = renderBinderHtml(buildBinder({ company: { name: 'Bare' } }), { sym: '$' })
    expect(html).toMatch(/Bare/)
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('renders without a currency symbol', () => {
    expect(() => renderBinderHtml(base(), {})).not.toThrow()
  })
})
