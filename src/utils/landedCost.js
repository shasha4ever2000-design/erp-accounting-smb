// Landed cost allocation — pure, no store/UI dependency.
//
// When goods arrive, extra costs (freight, insurance, customs duty, handling)
// belong in the inventory value of the items received, not in a period expense.
// This spreads one total additional cost across the chosen item lines by a basis,
// so each item's weighted-average unit cost can be bumped accordingly.
//
// lines: [{ itemId, qty, unitCost }]   qty = quantity being costed (on hand),
//                                       unitCost = current weighted-avg cost.
// method: 'value'    → weight by extended value (qty × unitCost)
//         'quantity' → weight by quantity
//         'weight'   → weight by an explicit lines[].weight field (gross weight)
//
// Returns [{ itemId, allocated }] whose allocated values sum EXACTLY to `amount`
// (any rounding remainder is folded into the largest-weight line, so no cents leak).

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

export function allocateLandedCost(amount, lines, method = 'value') {
  const total = round2(amount)
  const valid = (lines || []).filter((l) => l && l.itemId && (Number(l.qty) || 0) > 0)
  if (valid.length === 0 || total === 0) return valid.map((l) => ({ itemId: l.itemId, allocated: 0 }))

  const weightOf = (l) => {
    if (method === 'quantity') return Number(l.qty) || 0
    if (method === 'weight') return (Number(l.weight) || 0) * (Number(l.qty) || 0)
    return (Number(l.qty) || 0) * (Number(l.unitCost) || 0) // 'value'
  }

  let weights = valid.map(weightOf)
  let sum = weights.reduce((s, w) => s + w, 0)
  // If the chosen basis has no signal (e.g. all zero-cost items under 'value'),
  // fall back to a quantity split so the cost still lands somewhere sensible.
  if (sum <= 0) { weights = valid.map((l) => Number(l.qty) || 0); sum = weights.reduce((s, w) => s + w, 0) }
  if (sum <= 0) { weights = valid.map(() => 1); sum = valid.length }

  const out = valid.map((l, i) => ({ itemId: l.itemId, allocated: round2((total * weights[i]) / sum) }))

  // Reconcile rounding: push the remainder onto the largest-weight line.
  const allocatedSum = round2(out.reduce((s, o) => s + o.allocated, 0))
  const remainder = round2(total - allocatedSum)
  if (remainder !== 0) {
    let maxI = 0
    for (let i = 1; i < weights.length; i++) if (weights[i] > weights[maxI]) maxI = i
    out[maxI].allocated = round2(out[maxI].allocated + remainder)
  }
  return out
}
