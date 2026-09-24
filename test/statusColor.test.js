import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusColor, tone } from '../src/utils/formatters.js'

describe('status colours mean one thing everywhere', () => {
  it('groups statuses by meaning', () => {
    for (const s of ['sent', 'open', 'received', 'approved']) expect(statusColor(s)).toBe(tone.brand)
    for (const s of ['partial', 'pending', 'paused', 'on_hold', 'expiring']) expect(statusColor(s)).toBe(tone.warning)
    for (const s of ['paid', 'accepted', 'active', 'completed']) expect(statusColor(s)).toBe(tone.success)
    for (const s of ['overdue', 'rejected', 'bounced', 'expired']) expect(statusColor(s)).toBe(tone.danger)
    for (const s of ['invoiced', 'posted', 'cancelled', 'disposed', 'inactive']) expect(statusColor(s)).toBe(tone.muted)
    expect(statusColor('draft')).toBe(tone.neutral)
  })

  it('strikes through a void document', () => {
    expect(statusColor('void')).toContain('line-through')
  })

  it('unknown statuses fall back to neutral rather than nothing', () => {
    expect(statusColor('something-new')).toBe(tone.neutral)
  })

  it('no screen keeps its own status colour map', () => {
    const offenders = readdirSync('src/pages')
      .filter((f) => /\bconst (STATUS_COLORS|STATUS_CLR)\b|statusBadge = \(status\)/.test(readFileSync(join('src/pages', f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
