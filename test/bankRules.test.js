import { describe, it, expect } from 'vitest'
import { ruleApplies, matchRule, applyRules, merchantKey, suggestRules } from '../src/utils/bankRules.js'

const R = (o) => ({ id: o.contains, flow: 'auto', ...o })

describe('ruleApplies', () => {
  it('matches on a case-insensitive keyword', () => {
    expect(ruleApplies(R({ contains: 'starbucks', accountId: 'meals' }), { description: 'POS 123 STARBUCKS DXB', amount: -25 })).toBe(true)
  })
  it('does not match an unrelated description', () => {
    expect(ruleApplies(R({ contains: 'starbucks', accountId: 'meals' }), { description: 'SALARY', amount: 5000 })).toBe(false)
  })
  it('honours direction — the stored flow was previously ignored', () => {
    const inOnly = R({ contains: 'transfer', accountId: 'x', flow: 'in' })
    expect(ruleApplies(inOnly, { description: 'TRANSFER', amount: 100 })).toBe(true)
    expect(ruleApplies(inOnly, { description: 'TRANSFER', amount: -100 })).toBe(false)
    const outOnly = R({ contains: 'transfer', accountId: 'x', flow: 'out' })
    expect(ruleApplies(outOnly, { description: 'TRANSFER', amount: -100 })).toBe(true)
    expect(ruleApplies(outOnly, { description: 'TRANSFER', amount: 100 })).toBe(false)
  })
  it('respects amount bounds on the absolute value', () => {
    const r = R({ contains: 'fee', accountId: 'bankfee', minAmount: 10, maxAmount: 50 })
    expect(ruleApplies(r, { description: 'FEE', amount: -25 })).toBe(true)
    expect(ruleApplies(r, { description: 'FEE', amount: -5 })).toBe(false)
    expect(ruleApplies(r, { description: 'FEE', amount: -500 })).toBe(false)
  })
  it('ignores blank bounds rather than treating them as zero', () => {
    const r = R({ contains: 'fee', accountId: 'x', minAmount: '', maxAmount: '' })
    expect(ruleApplies(r, { description: 'FEE', amount: -25 })).toBe(true)
  })
  it('rejects a rule with no keyword', () => {
    expect(ruleApplies(R({ contains: '', accountId: 'x' }), { description: 'anything', amount: 1 })).toBe(false)
  })
})

describe('matchRule — specificity beats ordering', () => {
  it('prefers the longer, more specific keyword regardless of rule order', () => {
    const rules = [R({ contains: 'amazon', accountId: 'general' }), R({ contains: 'amazon web services', accountId: 'hosting' })]
    expect(matchRule(rules, { description: 'AMAZON WEB SERVICES EMEA', amount: -300 }).accountId).toBe('hosting')
    // and the same holds when declared the other way round
    expect(matchRule([...rules].reverse(), { description: 'AMAZON WEB SERVICES EMEA', amount: -300 }).accountId).toBe('hosting')
  })
  it('prefers a direction-constrained rule over a catch-all', () => {
    const rules = [R({ contains: 'transfer', accountId: 'general' }), R({ contains: 'transfer', accountId: 'income', flow: 'in' })]
    expect(matchRule(rules, { description: 'TRANSFER IN', amount: 500 }).accountId).toBe('income')
  })
  it('falls back to the generic rule when the specific one does not apply', () => {
    const rules = [R({ contains: 'transfer', accountId: 'general' }), R({ contains: 'transfer', accountId: 'income', flow: 'in' })]
    expect(matchRule(rules, { description: 'TRANSFER OUT', amount: -500 }).accountId).toBe('general')
  })
  it('returns null when nothing matches', () => {
    expect(matchRule([R({ contains: 'x', accountId: 'a' })], { description: 'zzz', amount: 1 })).toBeNull()
    expect(matchRule([], { description: 'zzz', amount: 1 })).toBeNull()
  })
})

describe('applyRules', () => {
  it('annotates a batch, leaving unmatched lines null', () => {
    const rules = [R({ contains: 'rent', accountId: 'acc-rent' })]
    const out = applyRules(rules, [
      { description: 'MONTHLY RENT', amount: -2600 },
      { description: 'MYSTERY', amount: -10 },
    ])
    expect(out[0].suggestedAccountId).toBe('acc-rent')
    expect(out[1].suggestedAccountId).toBeNull()
    expect(out).toHaveLength(2)
  })
})

describe('merchantKey — strips the noise that differs every statement', () => {
  it('collapses varying reference numbers and dates to the same key', () => {
    expect(merchantKey('POS 4521 STARBUCKS 12/03')).toBe(merchantKey('POS 9987 STARBUCKS 04/07'))
  })
  it('drops stopwords and short tokens', () => {
    expect(merchantKey('PAYMENT TO ACME LTD')).toBe('acme')
  })
  it('returns empty for a description with nothing meaningful', () => {
    expect(merchantKey('123 456')).toBe('')
    expect(merchantKey('')).toBe('')
  })
})

describe('suggestRules — learning from history', () => {
  const hist = (n, description, accountId, amount = -50) => Array.from({ length: n }, () => ({ description, accountId, amount }))

  it('proposes a rule for a repeated merchant with a consistent account', () => {
    const s = suggestRules([...hist(3, 'STARBUCKS DXB', 'meals')])
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ accountId: 'meals', occurrences: 3, confidence: 1 })
    expect(s[0].contains).toContain('starbucks')
  })

  it('ignores a merchant seen only once', () => {
    expect(suggestRules(hist(1, 'ONE OFF SHOP', 'misc'))).toEqual([])
  })

  it('ignores a merchant with no dominant account', () => {
    // 50/50 split → below the confidence floor.
    const mixed = [...hist(2, 'AMBIGUOUS STORE', 'a'), ...hist(2, 'AMBIGUOUS STORE', 'b')]
    expect(suggestRules(mixed)).toEqual([])
  })

  it('still proposes when one account clearly dominates', () => {
    const mostly = [...hist(4, 'MOSTLY SHOP', 'a'), ...hist(1, 'MOSTLY SHOP', 'b')]
    const s = suggestRules(mostly)
    expect(s).toHaveLength(1)
    expect(s[0].accountId).toBe('a')
    expect(s[0].confidence).toBe(0.8)
  })

  it('reads direction from a stored transaction type, not the sign', () => {
    // Regression: addBankTransaction() stores amount POSITIVE with the
    // direction in `type`. Inferring from the sign alone labelled every
    // historical expense as "money in".
    const paidRent = Array.from({ length: 3 }, () => ({ description: 'MONTHLY OFFICE RENT', accountId: 'rent', amount: 2600, type: 'money_out' }))
    expect(suggestRules(paidRent)[0].flow).toBe('out')

    const received = Array.from({ length: 3 }, () => ({ description: 'CLIENT WIRE ACME', accountId: 'sales', amount: 900, type: 'money_in' }))
    expect(suggestRules(received)[0].flow).toBe('in')
  })

  it('ruleApplies also honours an explicit transaction type', () => {
    const outRule = { contains: 'rent', accountId: 'rent', flow: 'out' }
    // Positive amount but explicitly money_out — must still match.
    expect(ruleApplies(outRule, { description: 'OFFICE RENT', amount: 2600, type: 'money_out' })).toBe(true)
    expect(ruleApplies(outRule, { description: 'OFFICE RENT', amount: 2600, type: 'money_in' })).toBe(false)
  })

  it('pins direction only when history is one-way', () => {
    const oneWay = suggestRules(hist(3, 'RENT PAYMENT CO', 'rent', -100))
    expect(oneWay[0].flow).toBe('out')
    const bothWays = suggestRules([
      ...hist(2, 'WIRE PARTNER', 'x', 100),
      ...hist(2, 'WIRE PARTNER', 'x', -100),
    ])
    expect(bothWays[0].flow).toBe('auto')
  })

  it('does not re-suggest something an existing rule already covers', () => {
    const existing = [{ contains: 'starbucks', accountId: 'meals' }]
    expect(suggestRules(hist(5, 'STARBUCKS DXB', 'meals'), existing)).toEqual([])
  })

  it('skips uncategorised history', () => {
    expect(suggestRules(hist(3, 'NO ACCOUNT', null))).toEqual([])
  })

  it('ranks the strongest evidence first', () => {
    const s = suggestRules([...hist(2, 'SMALL VENDOR', 'a'), ...hist(6, 'BIG VENDOR', 'b')])
    expect(s[0].occurrences).toBe(6)
    expect(s[1].occurrences).toBe(2)
  })

  it('handles empty input without throwing', () => {
    expect(suggestRules([])).toEqual([])
    expect(suggestRules(null)).toEqual([])
  })
})
