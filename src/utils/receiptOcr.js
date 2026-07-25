// Receipt OCR — read a photographed receipt into the expense-claim form.
//
// Uses the Claude vision API with structured outputs, so the model returns a
// JSON object matching a fixed schema rather than prose we would have to parse.
//
// Three things this file is careful about:
//
//   * It never overwrites what the user already typed. OCR fills blanks; a
//     field with a value in it is the user's, and a model is not entitled to
//     it.
//   * It downscales the image first. A modern phone photo is 4000px wide and
//     costs several thousand image tokens; a receipt is legible at 1200px.
//   * Every extracted value is range-checked before it reaches the form. A
//     hallucinated date in 1970 or a negative total is dropped rather than
//     quietly posted to the books.
//
// The request/parse halves are pure and unit-tested. Only `downscaleImage`
// touches the DOM.

const API_URL = 'https://api.anthropic.com/v1/messages'

/** Longest edge, in pixels, we send. Receipts stay legible well below this. */
export const MAX_EDGE = 1200

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: ['number', 'null'], description: 'Grand total actually paid, including tax. Null if not legible.' },
    taxAmount: { type: ['number', 'null'], description: 'Tax/VAT amount shown, if any.' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code, e.g. SAR, USD, EUR.' },
    date: { type: ['string', 'null'], description: 'Receipt date as YYYY-MM-DD.' },
    vendor: { type: ['string', 'null'], description: 'Merchant or supplier name.' },
    receiptRef: { type: ['string', 'null'], description: 'Receipt, invoice or bill number.' },
    category: {
      type: ['string', 'null'],
      enum: ['Travel & Transport', 'Meals & Entertainment', 'Office Supplies',
             'Accommodation', 'Communication', 'Training & Development', 'Other', null],
      description: 'Best-fit expense category.',
    },
    description: { type: ['string', 'null'], description: 'One short line describing what was bought.' },
  },
  required: ['total', 'taxAmount', 'currency', 'date', 'vendor', 'receiptRef', 'category', 'description'],
  additionalProperties: false,
}

const SYSTEM = `You read photographed receipts and return the fields exactly as printed.

Rules:
- Report only what is legible. Use null for anything you cannot read — never guess a number.
- "total" is the grand total actually paid, including tax, not a subtotal or a line item.
- Dates are YYYY-MM-DD. A receipt showing only day and month takes the year given as today's date, unless that would place it in the future, in which case use the previous year.
- Arabic/Hindi-Arabic numerals convert to Western digits.
- "description" is one short line, no more than 60 characters.`

/** Split a data URL into the media type and bare base64 the API expects. */
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''))
  if (!m) return null
  return { mediaType: m[1], data: m[2] }
}

/**
 * Build the request body. Kept separate from the fetch so the wire format is
 * testable without a network or an API key.
 */
export function buildOcrRequest(dataUrl, { model, todayISO, currency } = {}) {
  const img = splitDataUrl(dataUrl)
  if (!img) throw new Error('RECEIPT_NOT_AN_IMAGE')
  return {
    model: model || 'claude-haiku-4-5',
    // A receipt is a handful of short fields; a large cap would only buy us
    // a slower failure if the model ever ran away.
    max_tokens: 1024,
    system: SYSTEM,
    // Structured outputs guarantee parseable JSON, so there is no prose to
    // strip and no regex to maintain.
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        {
          type: 'text',
          text: `Extract this receipt. Today is ${todayISO || new Date().toISOString().slice(0, 10)}.`
            + (currency ? ` The company books in ${currency}.` : ''),
        },
      ],
    }],
  }
}

const clean = (v, max = 200) => {
  if (typeof v !== 'string') return ''
  const s = v.trim().replace(/\s+/g, ' ')
  return s.length > max ? s.slice(0, max) : s
}

const money = (v) => {
  const n = Number(v)
  // Reject NaN, negatives and absurd magnitudes — a misread decimal point
  // should not become a six-figure claim.
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return null
  return Math.round(n * 100) / 100
}

const isoDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null
  const year = d.getUTCFullYear()
  // A receipt outside this window is a misread, not a receipt.
  if (year < 2000 || year > 2100) return null
  return v
}

const CATEGORIES = new Set(['Travel & Transport', 'Meals & Entertainment', 'Office Supplies',
  'Accommodation', 'Communication', 'Training & Development', 'Other'])

/**
 * Turn an API response into a sanitised field set.
 * @returns { ok: true, fields } | { ok: false, reason }
 */
export function parseOcrResponse(body) {
  if (!body) return { ok: false, reason: 'Empty response' }
  // A safety decline arrives as a normal 200 with an empty content array, so
  // check the stop reason before reaching into content.
  if (body.stop_reason === 'refusal') return { ok: false, reason: 'The image was declined by the safety system.' }
  if (body.stop_reason === 'max_tokens') return { ok: false, reason: 'The response was cut short. Try a clearer photo.' }

  const text = (body.content || []).find((b) => b.type === 'text')?.text
  if (!text) return { ok: false, reason: 'No readable response' }

  let raw
  try { raw = JSON.parse(text) } catch { return { ok: false, reason: 'Could not read the extracted data' } }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'Could not read the extracted data' }

  const cat = clean(raw.category, 40)
  const total = money(raw.total)
  const tax = money(raw.taxAmount)

  const fields = {
    amount: total,
    // Tax above the total is a misread of which number is which — drop it
    // rather than carry a contradiction into the claim.
    taxAmount: tax != null && total != null && tax > total ? null : tax,
    // Validate the full string before truncating — testing a value already
    // clipped to 3 chars would let "riyals" through as "RIY".
    currency: /^[A-Za-z]{3}$/.test(clean(raw.currency, 80)) ? clean(raw.currency, 80).toUpperCase() : null,
    date: isoDate(raw.date),
    vendor: clean(raw.vendor, 80) || null,
    receiptRef: clean(raw.receiptRef, 40) || null,
    category: CATEGORIES.has(cat) ? cat : null,
    description: clean(raw.description, 60) || null,
  }

  // Nothing usable came back — say so rather than silently doing nothing.
  if (Object.values(fields).every((v) => v == null)) return { ok: false, reason: 'Nothing legible on this receipt' }
  return { ok: true, fields }
}

/**
 * Merge extracted fields into a form, filling blanks only.
 *
 * `defaults` matters more than it looks. The claim form opens with `date`
 * already set to today and `category` to the first option — so on a strict
 * emptiness test the receipt's own date could never be applied, which is
 * exactly the field the user most wants read for them. A value still equal to
 * its default was never typed by anyone, so it is fair game; a value the user
 * changed is not.
 *
 * @returns { form, filled } — `filled` lists the keys actually changed, so the
 *          UI can tell the user what it touched.
 */
export function applyToForm(form, fields, { defaults = {} } = {}) {
  const next = { ...form }
  const filled = []
  const unset = (k) => {
    const v = next[k]
    if (v === undefined || v === null || String(v).trim() === '') return true
    return k in defaults && String(v) === String(defaults[k])
  }
  const put = (key, value) => {
    if (value == null || value === '') return
    if (!unset(key)) return       // never overwrite the user
    next[key] = value
    filled.push(key)
  }

  put('amount', fields.amount != null ? String(fields.amount) : null)
  put('date', fields.date)
  put('receiptRef', fields.receiptRef)
  put('category', fields.category)
  // Description reads best as "vendor — what it was"; either half alone works.
  put('description', [fields.vendor, fields.description].filter(Boolean).join(' — ') || null)
  return { form: next, filled }
}

/**
 * A currency mismatch is worth surfacing: the claim posts in base currency, so
 * a foreign receipt needs converting by hand before it is submitted.
 */
export function currencyWarning(fields, baseCurrency) {
  if (!fields?.currency || !baseCurrency) return null
  if (fields.currency === String(baseCurrency).toUpperCase()) return null
  return fields.currency
}

/**
 * Downscale to MAX_EDGE and re-encode as JPEG. Browser-only.
 * A 4000px phone photo costs several thousand image tokens and reads no better
 * than a 1200px one.
 */
export function downscaleImage(dataUrl, maxEdge = MAX_EDGE) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
        if (scale === 1) return resolve(dataUrl)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      // On any decode failure fall back to the original — a larger request is
      // better than no request.
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}

/** Read a File into a data URL. Browser-only. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('RECEIPT_READ_FAILED'))
    r.readAsDataURL(file)
  })
}

/**
 * Full round trip: image in, sanitised fields out.
 * @returns { ok: true, fields } | { ok: false, reason }
 */
export async function scanReceipt(dataUrl, { apiKey, model, todayISO, currency, fetchImpl } = {}) {
  if (!apiKey) return { ok: false, reason: 'Add your Claude API key in Settings → AI Assistant first.' }
  const doFetch = fetchImpl || fetch
  let body
  try { body = buildOcrRequest(dataUrl, { model, todayISO, currency }) }
  catch { return { ok: false, reason: 'That file is not an image.' } }

  let res
  try {
    res = await doFetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, reason: 'Could not reach the API. Check your connection.' }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err?.error?.message || `API error ${res.status}`
    if (res.status === 401) return { ok: false, reason: 'That API key was rejected. Check it in Settings.' }
    if (res.status === 429) return { ok: false, reason: 'Rate limited. Wait a moment and try again.' }
    return { ok: false, reason: msg }
  }

  return parseOcrResponse(await res.json().catch(() => null))
}
