import { describe, it, expect } from 'vitest'
import {
  splitDataUrl, buildOcrRequest, parseOcrResponse, applyToForm,
  currencyWarning, scanReceipt, RECEIPT_SCHEMA,
} from '../src/utils/receiptOcr.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const ok = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] })
const FULL = {
  total: 250.5, taxAmount: 32.67, currency: 'SAR', date: '2026-03-14',
  vendor: 'Al-Noor Cafe', receiptRef: 'R-889', category: 'Meals & Entertainment',
  description: 'Team lunch',
}

describe('splitDataUrl', () => {
  it('separates media type from payload', () => {
    expect(splitDataUrl(PNG)).toEqual({ mediaType: 'image/png', data: 'iVBORw0KGgo=' })
  })
  it('rejects anything that is not a base64 data URL', () => {
    expect(splitDataUrl('https://example.com/a.png')).toBeNull()
    expect(splitDataUrl('')).toBeNull()
    expect(splitDataUrl(null)).toBeNull()
  })
})

describe('buildOcrRequest', () => {
  it('sends the image as a base64 block before the instruction', () => {
    const b = buildOcrRequest(PNG, { todayISO: '2026-07-24' })
    const [img, text] = b.messages[0].content
    expect(img).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } })
    expect(text.type).toBe('text')
  })
  it('constrains the reply to the schema so there is no prose to parse', () => {
    const b = buildOcrRequest(PNG)
    expect(b.output_config.format.type).toBe('json_schema')
    expect(b.output_config.format.schema).toBe(RECEIPT_SCHEMA)
    expect(RECEIPT_SCHEMA.additionalProperties).toBe(false)
  })
  it("tells the model today's date, so a day/month-only receipt can be dated", () => {
    expect(buildOcrRequest(PNG, { todayISO: '2026-07-24' }).messages[0].content[1].text).toContain('2026-07-24')
  })
  it('mentions the base currency when one is configured', () => {
    expect(buildOcrRequest(PNG, { currency: 'SAR' }).messages[0].content[1].text).toContain('SAR')
    expect(buildOcrRequest(PNG).messages[0].content[1].text).not.toMatch(/books in/)
  })
  it('throws on a non-image rather than sending a malformed request', () => {
    expect(() => buildOcrRequest('not-an-image')).toThrow(/RECEIPT_NOT_AN_IMAGE/)
  })
})

describe('parseOcrResponse — happy path', () => {
  it('returns every sanitised field', () => {
    const r = parseOcrResponse(ok(FULL))
    expect(r.ok).toBe(true)
    expect(r.fields).toEqual({
      amount: 250.5, taxAmount: 32.67, currency: 'SAR', date: '2026-03-14',
      vendor: 'Al-Noor Cafe', receiptRef: 'R-889',
      category: 'Meals & Entertainment', description: 'Team lunch',
    })
  })
  it('keeps a partially-legible receipt rather than discarding it', () => {
    const r = parseOcrResponse(ok({ ...FULL, vendor: null, receiptRef: null, category: null }))
    expect(r.ok).toBe(true)
    expect(r.fields.amount).toBe(250.5)
    expect(r.fields.vendor).toBeNull()
  })
})

describe('parseOcrResponse — refuses to launder bad data into the books', () => {
  it('drops a negative or zero total', () => {
    expect(parseOcrResponse(ok({ ...FULL, total: -50 })).fields.amount).toBeNull()
    expect(parseOcrResponse(ok({ ...FULL, total: 0 })).fields.amount).toBeNull()
  })
  it('drops an absurd magnitude — a misread decimal point is not a claim', () => {
    expect(parseOcrResponse(ok({ ...FULL, total: 5e12 })).fields.amount).toBeNull()
  })
  it('rounds to two decimals', () => {
    expect(parseOcrResponse(ok({ ...FULL, total: 10.005 })).fields.amount).toBe(10.01)
  })
  it('drops tax that exceeds the total — that is a swapped reading', () => {
    const r = parseOcrResponse(ok({ ...FULL, total: 100, taxAmount: 400 }))
    expect(r.fields.amount).toBe(100)
    expect(r.fields.taxAmount).toBeNull()
  })
  it('rejects a malformed or impossible date', () => {
    expect(parseOcrResponse(ok({ ...FULL, date: '14/03/2026' })).fields.date).toBeNull()
    expect(parseOcrResponse(ok({ ...FULL, date: '2026-02-31' })).fields.date).toBeNull()
    expect(parseOcrResponse(ok({ ...FULL, date: '1970-01-01' })).fields.date).toBeNull()
  })
  it('rejects a category outside the allowed set', () => {
    expect(parseOcrResponse(ok({ ...FULL, category: 'Bribes' })).fields.category).toBeNull()
  })
  it('rejects a currency that is not a 3-letter code', () => {
    expect(parseOcrResponse(ok({ ...FULL, currency: 'riyals' })).fields.currency).toBeNull()
    expect(parseOcrResponse(ok({ ...FULL, currency: 'sar' })).fields.currency).toBe('SAR')
  })
  it('truncates an over-long description rather than bloating the record', () => {
    const r = parseOcrResponse(ok({ ...FULL, description: 'x'.repeat(500) }))
    expect(r.fields.description.length).toBe(60)
  })
  it('reports a receipt where nothing was legible', () => {
    const r = parseOcrResponse(ok({
      total: null, taxAmount: null, currency: null, date: null,
      vendor: null, receiptRef: null, category: null, description: null,
    }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/legible/i)
  })
})

describe('parseOcrResponse — API-level outcomes', () => {
  it('handles a safety refusal, which arrives as a normal 200 with no content', () => {
    const r = parseOcrResponse({ stop_reason: 'refusal', content: [] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/declined/i)
  })
  it('handles a truncated response instead of parsing half a JSON object', () => {
    const r = parseOcrResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"total": 25' }] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/cut short/i)
  })
  it('handles unparseable text without throwing', () => {
    expect(parseOcrResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sorry!' }] }).ok).toBe(false)
  })
  it('handles an empty or contentless body', () => {
    expect(parseOcrResponse(null).ok).toBe(false)
    expect(parseOcrResponse({ content: [] }).ok).toBe(false)
  })
})

describe('applyToForm — OCR fills blanks, it does not overwrite the user', () => {
  const blank = { amount: '', date: '', receiptRef: '', category: '', description: '' }
  const fields = { amount: 250.5, date: '2026-03-14', receiptRef: 'R-889', category: 'Office Supplies', vendor: 'Acme', description: 'Paper' }

  it('fills empty fields and reports which ones it touched', () => {
    const { form, filled } = applyToForm(blank, fields)
    expect(form.amount).toBe('250.5')
    expect(form.date).toBe('2026-03-14')
    expect(filled).toEqual(expect.arrayContaining(['amount', 'date', 'receiptRef', 'category', 'description']))
  })
  it('leaves a value the user already typed completely alone', () => {
    const typed = { ...blank, amount: '99', description: 'My own note' }
    const { form, filled } = applyToForm(typed, fields)
    expect(form.amount).toBe('99')
    expect(form.description).toBe('My own note')
    expect(filled).not.toContain('amount')
    expect(filled).not.toContain('description')
  })
  it('treats whitespace as blank', () => {
    expect(applyToForm({ ...blank, receiptRef: '   ' }, fields).form.receiptRef).toBe('R-889')
  })
  it('combines vendor and description into one readable line', () => {
    expect(applyToForm(blank, fields).form.description).toBe('Acme — Paper')
  })
  it('uses whichever half it has when only one is present', () => {
    expect(applyToForm(blank, { vendor: 'Acme' }).form.description).toBe('Acme')
    expect(applyToForm(blank, { description: 'Paper' }).form.description).toBe('Paper')
  })
  it('fills a field still holding its opening default — nobody typed that', () => {
    // The claim form opens with today's date and the first category already
    // set. A strict emptiness test would make the receipt's own date
    // unfillable, which is the field users most want read for them.
    const defaults = { date: '2026-07-25', category: 'Travel & Transport' }
    const opened = { ...blank, ...defaults }
    const { form, filled } = applyToForm(opened, fields, { defaults })
    expect(form.date).toBe('2026-03-14')
    expect(form.category).toBe('Office Supplies')
    expect(filled).toEqual(expect.arrayContaining(['date', 'category']))
  })
  it('still refuses a default the user has since changed', () => {
    const defaults = { date: '2026-07-25', category: 'Travel & Transport' }
    const edited = { ...blank, date: '2026-01-01', category: 'Accommodation' }
    const { form, filled } = applyToForm(edited, fields, { defaults })
    expect(form.date).toBe('2026-01-01')
    expect(form.category).toBe('Accommodation')
    expect(filled).not.toContain('date')
    expect(filled).not.toContain('category')
  })
  it('changes nothing when there is nothing to fill', () => {
    const { form, filled } = applyToForm(blank, {})
    expect(filled).toEqual([])
    expect(form).toEqual(blank)
  })
  it('does not mutate the form it was given', () => {
    const orig = { ...blank }
    applyToForm(orig, fields)
    expect(orig).toEqual(blank)
  })
})

describe('currencyWarning', () => {
  it('flags a receipt in a currency the books are not kept in', () => {
    expect(currencyWarning({ currency: 'USD' }, 'SAR')).toBe('USD')
  })
  it('stays quiet when they match, case-insensitively', () => {
    expect(currencyWarning({ currency: 'SAR' }, 'SAR')).toBeNull()
    expect(currencyWarning({ currency: 'SAR' }, 'sar')).toBeNull()
  })
  it('stays quiet when either side is unknown', () => {
    expect(currencyWarning({ currency: null }, 'SAR')).toBeNull()
    expect(currencyWarning({ currency: 'USD' }, null)).toBeNull()
    expect(currencyWarning(null, 'SAR')).toBeNull()
  })
})

describe('scanReceipt', () => {
  const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

  it('sends the documented browser headers', async () => {
    let seen
    await scanReceipt(PNG, { apiKey: 'sk-test', fetchImpl: async (url, init) => { seen = { url, init }; return jsonRes(ok(FULL)) } })
    expect(seen.url).toBe('https://api.anthropic.com/v1/messages')
    expect(seen.init.headers['x-api-key']).toBe('sk-test')
    expect(seen.init.headers['anthropic-version']).toBe('2023-06-01')
    expect(seen.init.headers['anthropic-dangerous-direct-browser-calls']).toBe('true')
  })

  it('returns parsed fields on success', async () => {
    const r = await scanReceipt(PNG, { apiKey: 'k', fetchImpl: async () => jsonRes(ok(FULL)) })
    expect(r.ok).toBe(true)
    expect(r.fields.amount).toBe(250.5)
  })

  it('never calls the API without a key', async () => {
    let called = false
    const r = await scanReceipt(PNG, { apiKey: '', fetchImpl: async () => { called = true; return jsonRes(ok(FULL)) } })
    expect(called).toBe(false)
    expect(r.reason).toMatch(/API key/i)
  })

  it('explains an auth failure in terms the user can act on', async () => {
    const r = await scanReceipt(PNG, { apiKey: 'bad', fetchImpl: async () => jsonRes({ error: { message: 'invalid x-api-key' } }, 401) })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/rejected/i)
  })

  it('explains a rate limit', async () => {
    const r = await scanReceipt(PNG, { apiKey: 'k', fetchImpl: async () => jsonRes({}, 429) })
    expect(r.reason).toMatch(/rate limit/i)
  })

  it('surfaces the API message for other errors', async () => {
    const r = await scanReceipt(PNG, { apiKey: 'k', fetchImpl: async () => jsonRes({ error: { message: 'image too large' } }, 400) })
    expect(r.reason).toBe('image too large')
  })

  it('reports a network failure rather than throwing', async () => {
    const r = await scanReceipt(PNG, { apiKey: 'k', fetchImpl: async () => { throw new Error('offline') } })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/connection/i)
  })

  it('rejects a non-image before spending a request on it', async () => {
    let called = false
    const r = await scanReceipt('nope', { apiKey: 'k', fetchImpl: async () => { called = true; return jsonRes(ok(FULL)) } })
    expect(called).toBe(false)
    expect(r.reason).toMatch(/not an image/i)
  })
})
