import { describe, it, expect } from 'vitest'
import {
  thresholdFor, needsApproval, isApprover, canApprove, amountOf,
  describeRequest, actionableFor, defaultApprovalSettings,
} from '../src/utils/approvals.js'

const on = (over = {}) => ({ ...defaultApprovalSettings(), enabled: true, thresholds: { purchase: 5000, journal: 10000, payment: 0 }, ...over })

describe('thresholdFor', () => {
  it('reads a configured threshold', () => {
    expect(thresholdFor(on(), 'purchase')).toBe(5000)
  })
  it('treats zero, blank and garbage as "no threshold"', () => {
    expect(thresholdFor(on(), 'payment')).toBe(0)
    expect(thresholdFor({ thresholds: { purchase: '' } }, 'purchase')).toBe(0)
    expect(thresholdFor({ thresholds: { purchase: 'abc' } }, 'purchase')).toBe(0)
    expect(thresholdFor({}, 'purchase')).toBe(0)
    expect(thresholdFor(undefined, 'purchase')).toBe(0)
  })
  it('ignores a negative threshold rather than gating everything', () => {
    expect(thresholdFor({ thresholds: { purchase: -1 } }, 'purchase')).toBe(0)
  })
})

describe('needsApproval', () => {
  it('gates at or above the threshold', () => {
    expect(needsApproval(on(), 'purchase', 5000)).toBe(true)
    expect(needsApproval(on(), 'purchase', 5000.01)).toBe(true)
    expect(needsApproval(on(), 'purchase', 4999.99)).toBe(false)
  })
  it('is off entirely when the feature is disabled', () => {
    expect(needsApproval({ ...on(), enabled: false }, 'purchase', 999999)).toBe(false)
  })
  it('is off for a kind with no threshold set', () => {
    expect(needsApproval(on(), 'payment', 999999)).toBe(false)
  })
  it('compares on magnitude, so a large credit is caught too', () => {
    expect(needsApproval(on(), 'journal', -20000)).toBe(true)
  })
  it('survives missing settings', () => {
    expect(needsApproval(undefined, 'purchase', 999999)).toBe(false)
  })
})

describe('canApprove — segregation of duties', () => {
  const req = { id: 'r1', status: 'pending', submittedBy: 'u1' }
  const admin = { id: 'u2', role: 'admin' }

  it('lets a different owner/admin approve', () => {
    expect(canApprove(req, admin, on()).ok).toBe(true)
    expect(canApprove(req, { id: 'u3', role: 'owner' }, on()).ok).toBe(true)
  })
  const twoManagers = [{ id: 'u1', role: 'owner' }, { id: 'u2', role: 'admin' }]

  it('refuses the submitter their own request — the whole point of the control', () => {
    const r = canApprove(req, { id: 'u1', role: 'owner' }, on(), twoManagers)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/your own/i)
  })
  it('lets a SOLE manager approve their own request rather than deadlocking', () => {
    // A one-person company would otherwise be permanently unable to post
    // anything above its own threshold.
    const solo = [{ id: 'u1', role: 'owner' }, { id: 'u5', role: 'viewer' }]
    expect(canApprove(req, { id: 'u1', role: 'owner' }, on(), solo).ok).toBe(true)
  })
  it('still refuses self-approval once a second manager exists', () => {
    expect(canApprove(req, { id: 'u1', role: 'owner' }, on(), twoManagers).ok).toBe(false)
  })
  it('allows self-approval only when that check is explicitly turned off', () => {
    expect(canApprove(req, { id: 'u1', role: 'owner' }, on({ requireDifferentUser: false })).ok).toBe(true)
  })
  it('refuses a non-manager', () => {
    expect(canApprove(req, { id: 'u9', role: 'viewer' }, on()).ok).toBe(false)
    expect(canApprove(req, { id: 'u9', role: 'accountant' }, on()).ok).toBe(false)
  })
  it('refuses an already-decided request', () => {
    expect(canApprove({ ...req, status: 'approved' }, admin, on()).ok).toBe(false)
    expect(canApprove({ ...req, status: 'rejected' }, admin, on()).ok).toBe(false)
  })
  it('refuses a missing request rather than throwing', () => {
    expect(canApprove(null, admin, on()).ok).toBe(false)
    expect(canApprove(req, null, on()).ok).toBe(false)
  })
})

describe('isApprover', () => {
  it('is owners and admins only', () => {
    expect(isApprover({ role: 'owner' })).toBe(true)
    expect(isApprover({ role: 'admin' })).toBe(true)
    expect(isApprover({ role: 'accountant' })).toBe(false)
    expect(isApprover(null)).toBe(false)
  })
})

describe('amountOf', () => {
  it('reads a document total', () => {
    expect(amountOf('purchase', { total: 7500 })).toBe(7500)
  })
  it('falls back to amount for payments', () => {
    expect(amountOf('payment', { amount: 300 })).toBe(300)
  })
  it('uses the debit side for a journal entry, which carries no total', () => {
    expect(amountOf('journal', { lines: [{ debit: 400 }, { debit: 600 }, { credit: 1000 }] })).toBe(1000)
  })
  it('handles empty payloads', () => {
    expect(amountOf('purchase', null)).toBe(0)
    expect(amountOf('journal', {})).toBe(0)
  })
})

describe('describeRequest', () => {
  it('names the counterparty for a bill', () => {
    expect(describeRequest({ kind: 'purchase', payload: { supplierName: 'Acme' } })).toBe('Acme')
  })
  it('uses the description for a journal entry', () => {
    expect(describeRequest({ kind: 'journal', payload: { description: 'Depreciation' } })).toBe('Depreciation')
  })
  it('never returns undefined', () => {
    expect(describeRequest(null)).toBe('')
    expect(describeRequest({ kind: 'journal', payload: {} })).toBeTruthy()
  })
})

describe('actionableFor', () => {
  it('counts only what this user may actually decide', () => {
    const reqs = [
      { id: 'a', status: 'pending', submittedBy: 'u1' },
      { id: 'b', status: 'pending', submittedBy: 'u2' },   // own request
      { id: 'c', status: 'approved', submittedBy: 'u1' },
    ]
    const mine = actionableFor(reqs, { id: 'u2', role: 'admin' }, on(), [{ id: 'u1', role: 'owner' }, { id: 'u2', role: 'admin' }])
    expect(mine.map((r) => r.id)).toEqual(['a'])
  })
  it('is empty for a viewer', () => {
    expect(actionableFor([{ id: 'a', status: 'pending' }], { id: 'u9', role: 'viewer' }, on())).toEqual([])
  })
  it('handles no requests', () => {
    expect(actionableFor(undefined, { role: 'owner' }, on())).toEqual([])
  })
})
