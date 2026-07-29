import { describe, it, expect } from 'vitest'
import { weightedAverageCost } from '../src/utils/inventoryCost.js'

const wac = (onHand, unitCost, receivedQty, receivedValue) =>
  weightedAverageCost({ onHand, unitCost, receivedQty, receivedValue })

describe('the ordinary blend', () => {
  it('averages the existing balance with the receipt', () => {
    // 10 at 100 plus 10 at 120 = 20 at 110.
    expect(wac(10, 100, 10, 1200)).toBeCloseTo(110, 10)
  })

  it('takes the receipt cost when there was nothing on hand', () => {
    expect(wac(0, 0, 5, 500)).toBeCloseTo(100, 10)
  })

  it('ignores a stale carried cost when the balance is empty', () => {
    // Nothing on the shelf means the old cost describes nothing.
    expect(wac(0, 999, 4, 400)).toBeCloseTo(100, 10)
  })

  it('weights a large existing balance properly', () => {
    // 90 at 10 plus 10 at 20 = 100 at 11.
    expect(wac(90, 10, 10, 200)).toBeCloseTo(11, 10)
  })
})

describe('a negative balance does not drag the average up', () => {
  it('prices the shelf at what the receipt cost', () => {
    // The bug: (-10 * 100 + 20 * 110) / 10 = 120, against 110 actually paid.
    expect(wac(-10, 100, 20, 2200)).toBeCloseTo(110, 10)
  })

  it('never returns more than the receipt cost when oversold', () => {
    // Whatever the carried cost was, it describes stock that was not owned.
    for (const carried of [0, 50, 100, 500, 10000]) {
      expect(wac(-25, carried, 40, 40 * 80)).toBeCloseTo(80, 10)
    }
  })

  it('holds the carried cost when the receipt does not clear the shortfall', () => {
    // Still negative afterwards: there is no positive balance to price yet,
    // and the receipt cost is the best information available.
    expect(wac(-30, 100, 10, 900)).toBeCloseTo(90, 10)
  })

  it('is unaffected by how the shortfall arose', () => {
    expect(wac(-1, 100, 2, 220)).toBeCloseTo(110, 10)
  })
})

describe('degenerate inputs never produce NaN or Infinity', () => {
  const finite = (n) => Number.isFinite(n)

  it('handles a zero-quantity receipt', () => {
    const r = wac(10, 100, 0, 0)
    expect(finite(r)).toBe(true)
    expect(r).toBeCloseTo(100, 10) // nothing received, nothing changes
  })

  it('handles undefined and null throughout', () => {
    expect(finite(weightedAverageCost({}))).toBe(true)
    expect(finite(wac(undefined, undefined, undefined, undefined))).toBe(true)
    expect(finite(wac(null, null, null, null))).toBe(true)
  })

  it('handles a free receipt without zeroing a real balance', () => {
    // 10 at 100 plus 10 free = 20 at 50. Unusual but arithmetically right.
    expect(wac(10, 100, 10, 0)).toBeCloseTo(50, 10)
  })

  it('handles strings, as form inputs arrive', () => {
    expect(wac('10', '100', '10', '1200')).toBeCloseTo(110, 10)
  })
})
