// Weighted-average (moving average) cost, used by every path that receives
// stock: opening balances, a goods receipt against a purchase order, and a
// supplier bill received directly into stock.
//
// It lives here rather than being written out at each of those three sites
// because the interesting case is easy to get wrong in exactly the same way
// three times over — see the negative-quantity note below.

/**
 * The new unit cost after receiving stock.
 *
 * @param {object}  p
 * @param {number}  p.onHand         quantity before the receipt (may be negative)
 * @param {number}  p.unitCost       carried unit cost before the receipt
 * @param {number}  p.receivedQty    quantity received
 * @param {number}  p.receivedValue  total value of the receipt (not per unit)
 * @returns {number} the unit cost to carry going forward
 */
export function weightedAverageCost({ onHand, unitCost, receivedQty, receivedValue }) {
  const q0 = Number(onHand) || 0
  const c0 = Number(unitCost) || 0
  const qr = Number(receivedQty) || 0
  const vr = Number(receivedValue) || 0

  const receiptUnitCost = qr > 0 ? vr / qr : c0

  // A negative quantity on hand is stock that was sold without being owned —
  // the app allows it, and its own integrity check reports it. Blending that
  // balance into the average prices the units now on the shelf against
  // inventory value that never existed, and it always errs the same way:
  // the carried cost comes out above what was actually paid, so inventory is
  // overstated and cost of sales understated. Receiving 20 at 110 against a
  // balance of -10 at 100 would otherwise yield 120 a unit.
  //
  // Once the balance is at or below zero the only reliable information about
  // the units on the shelf is what this receipt cost, so use that.
  if (q0 <= 0) return receiptUnitCost

  const newQty = q0 + qr
  if (newQty <= 0) return c0

  return (q0 * c0 + vr) / newQty
}
