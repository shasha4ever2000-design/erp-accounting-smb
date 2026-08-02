// The first-run setup, and the one thing it must never do: ask twice.
//
// A wizard that reappears is worse than none, and a wizard shown to a company
// that has been trading for a year is an insult. Both are decided by a single
// piece of state, so both are pinned here.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../src/store.js'

const g = () => useStore.getState()
const pending = () => (g().settings.setup?.state || 'pending') === 'pending'

beforeEach(() => {
  useStore.setState({ settings: { ...g().settings, setup: { state: 'pending', at: '' } } })
})

describe('when the setup guide appears', () => {
  it('asks a brand-new company', () => {
    expect(pending()).toBe(true)
  })

  it('stops asking once it is completed', () => {
    g().markSetupDone('done')
    expect(pending()).toBe(false)
    expect(g().settings.setup.state).toBe('done')
    expect(g().settings.setup.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('stops asking when it is skipped, too', () => {
    // Skipping is an answer. Being asked again every reload would make the
    // skip button a lie.
    g().markSetupDone('skipped')
    expect(pending()).toBe(false)
    expect(g().settings.setup.state).toBe('skipped')
  })

  it('can be summoned again from Settings', () => {
    g().markSetupDone('skipped')
    g().reopenSetup()
    expect(pending()).toBe(true)
  })
})

describe('the migration for companies that predate the guide', () => {
  it('does not show it to books already in use', async () => {
    const migrate = useStore.persist.getOptions().migrate
    const out = migrate({ settings: { company: { name: 'Existing Co' } } }, 37)
    expect(out.settings.setup.state).toBe('done')
  })

  it('leaves an answer already given alone', async () => {
    const migrate = useStore.persist.getOptions().migrate
    const mine = { state: 'skipped', at: '2026-01-01T00:00:00.000Z' }
    expect(migrate({ settings: { setup: mine } }, 37).settings.setup).toBe(mine)
  })

  it('survives a persisted blob carrying no settings', () => {
    const migrate = useStore.persist.getOptions().migrate
    expect(() => migrate({}, 31)).not.toThrow()
    expect(migrate({}, 31).settings.setup.state).toBe('done')
  })
})

describe('what the guide sets', () => {
  it('turns tax on for a country that charges it', () => {
    // The whole reason the guide exists: tax ships off, and an invoice raised
    // before anyone notices carries none.
    useStore.setState({ settings: { ...g().settings, tax: { enabled: false, rate: 15, name: 'VAT', system: 'vat', country: '' } } })
    expect(g().settings.tax.enabled).toBe(false)

    g().updateTax({ enabled: true, name: 'VAT', rate: 15, system: 'vat', country: 'SA' })
    g().updateCompany({ currency: 'SAR', currencySymbol: 'SAR' })

    expect(g().settings.tax.enabled).toBe(true)
    expect(g().settings.tax.rate).toBe(15)
    expect(g().settings.company.currency).toBe('SAR')
  })
})
