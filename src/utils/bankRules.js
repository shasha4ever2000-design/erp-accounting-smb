// Bank statement auto-categorisation.
//
// Two jobs:
//  1. matchRule()   — decide which rule (if any) applies to a statement line,
//                     honouring direction and optional amount bounds, with the
//                     most specific rule winning rather than merely the first.
//  2. suggestRules() — mine already-categorised bank history for repeated
//                     merchant → account pairings and propose rules, so the
//                     app learns from what the user has already done instead
//                     of making them hand-write every rule.
//
// Pure over plain data, so both are unit-testable.

const lower = (s) => String(s || '').toLowerCase()

/**
 * Direction of a line.
 *
 * Imported statement lines carry a signed amount, but records already stored by
 * addBankTransaction() keep the amount POSITIVE and put the direction in a
 * separate `type` field ('money_in' / 'money_out'). Reading the sign alone
 * would therefore classify every historical expense as money in, so prefer an
 * explicit type whenever one is present.
 */
const flowOf = (amountOrTx, type) => {
  if (type === 'money_in') return 'in'
  if (type === 'money_out') return 'out'
  return (Number(amountOrTx) || 0) >= 0 ? 'in' : 'out'
}

/** Does one rule apply to this line? */
export function ruleApplies(rule, { description, amount, type }) {
  if (!rule || !rule.contains) return false
  if (!lower(description).includes(lower(rule.contains))) return false

  // 'auto' matches either direction; 'in'/'out' must agree with the sign.
  const flow = rule.flow || 'auto'
  if (flow !== 'auto' && flow !== flowOf(amount, type)) return false

  const abs = Math.abs(Number(amount) || 0)
  if (rule.minAmount != null && rule.minAmount !== '' && abs < Number(rule.minAmount)) return false
  if (rule.maxAmount != null && rule.maxAmount !== '' && abs > Number(rule.maxAmount)) return false
  return true
}

/**
 * Best matching rule for a line. Specificity wins over order: a longer keyword
 * is a stronger signal than a short one, and a direction- or amount-constrained
 * rule beats a catch-all, so "amazon web services" wins over a bare "amazon".
 */
export function matchRule(rules, line) {
  const applicable = (rules || []).filter((r) => ruleApplies(r, line))
  if (!applicable.length) return null
  const score = (r) =>
    String(r.contains || '').length +
    ((r.flow && r.flow !== 'auto') ? 10 : 0) +
    ((r.minAmount != null && r.minAmount !== '') || (r.maxAmount != null && r.maxAmount !== '') ? 10 : 0)
  return applicable.reduce((best, r) => (score(r) > score(best) ? r : best), applicable[0])
}

/** Categorise a batch of lines in one pass. */
export function applyRules(rules, lines) {
  return (lines || []).map((line) => {
    const rule = matchRule(rules, line)
    return { ...line, matchedRule: rule || null, suggestedAccountId: rule ? rule.accountId : null }
  })
}

// ── Learning from history ───────────────────────────────────────────────

// Statement descriptions carry noise that differs every time — dates, card
// numbers, reference ids. Strip it so "POS 4521 STARBUCKS 12/03" and
// "POS 9987 STARBUCKS 04/07" collapse to the same merchant key.
const STOPWORDS = new Set(['pos', 'ref', 'txn', 'trf', 'transfer', 'payment', 'purchase', 'card', 'debit', 'credit', 'the', 'and', 'ltd', 'llc', 'inc', 'co'])

export function merchantKey(description) {
  const words = lower(description)
    .replace(/[^a-z؀-ۿ\s]/g, ' ')   // drop digits/punctuation, keep Arabic
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  return words.slice(0, 2).join(' ')
}

/**
 * Propose rules from categorised bank history.
 * @param transactions [{ description, accountId, amount }] already-booked lines
 * @param existingRules current rules (so we never suggest a duplicate)
 * @param opts { minOccurrences, minConfidence }
 * @returns [{ contains, accountId, flow, occurrences, confidence }]
 */
export function suggestRules(transactions, existingRules = [], opts = {}) {
  const { minOccurrences = 2, minConfidence = 0.6 } = opts
  const groups = new Map()

  ;(transactions || []).forEach((tx) => {
    if (!tx || !tx.accountId) return
    const key = merchantKey(tx.description)
    if (!key) return
    const g = groups.get(key) || { key, total: 0, byAccount: new Map(), flows: new Set() }
    g.total += 1
    g.byAccount.set(tx.accountId, (g.byAccount.get(tx.accountId) || 0) + 1)
    g.flows.add(flowOf(tx.amount, tx.type))
    groups.set(key, g)
  })

  const out = []
  groups.forEach((g) => {
    if (g.total < minOccurrences) return
    // Dominant account for this merchant.
    let bestAcc = null, bestCount = 0
    g.byAccount.forEach((count, accountId) => { if (count > bestCount) { bestCount = count; bestAcc = accountId } })
    const confidence = bestCount / g.total
    if (!bestAcc || confidence < minConfidence) return

    // Don't propose something the user already has covered.
    const covered = (existingRules || []).some((r) => lower(r.contains) && (lower(g.key).includes(lower(r.contains)) || lower(r.contains).includes(lower(g.key))))
    if (covered) return

    out.push({
      contains: g.key,
      accountId: bestAcc,
      // Only pin the direction when history is consistently one-way.
      flow: g.flows.size === 1 ? [...g.flows][0] : 'auto',
      occurrences: g.total,
      confidence: Math.round(confidence * 100) / 100,
    })
  })

  // Strongest evidence first.
  return out.sort((a, b) => (b.occurrences - a.occurrences) || (b.confidence - a.confidence))
}
