// Journal narration, translated when read.
//
// The narration is stored in English deliberately — it is the audit record and
// it goes into exports, so it must not change meaning because somebody flipped
// a language switch. Translating on the way out means entries posted long
// before any of this existed are translated too, with no migration.
//
// The rule that matters most is the last one: anything unrecognised is shown
// exactly as posted. A manual entry is the user's own words, and mangling them
// would be worse than leaving them in English.
import { describe, it, expect } from 'vitest'
import { narrate, parseNarration } from '../src/utils/jeNarration.js'

// A stand-in dictionary: only these sentences have Arabic.
const AR = {
  'Sales Invoice {0} – {1}': 'فاتورة مبيعات {0} – {1}',
  'Cost of Sales – {0}': 'تكلفة المبيعات – {0}',
  'Receipt {0} for {1}': 'سند قبض {0} عن {1}',
  'Reversal of {0} — {1}': 'عكس القيد {0} — {1}',
  'Work Order {0} – Issue Materials': 'أمر تشغيل {0} – صرف المواد',
}
const t = (s) => AR[s] || s
const en = (s) => s   // the English build translates nothing

describe('reading a narration back', () => {
  it('translates the words and leaves the document number alone', () => {
    expect(narrate('Sales Invoice INV-0001 – Acme Trading', t))
      .toBe('فاتورة مبيعات INV-0001 – Acme Trading')
  })

  it('keeps the customer name exactly as it was posted', () => {
    // A party's name is data. Translating it would be a lie about who they are.
    expect(narrate('Sales Invoice INV-9 – شركة النيل', t)).toBe('فاتورة مبيعات INV-9 – شركة النيل')
  })

  it('handles the single-argument forms', () => {
    expect(narrate('Cost of Sales – INV-0001', t)).toBe('تكلفة المبيعات – INV-0001')
  })

  it('handles two references in one sentence', () => {
    expect(narrate('Receipt REC-0003 for INV-0001', t)).toBe('سند قبض REC-0003 عن INV-0001')
  })

  it('carries a free-text reason through untouched', () => {
    expect(narrate('Reversal of JE-0004 — wrong month', t)).toBe('عكس القيد JE-0004 — wrong month')
  })

  it('matches a sentence with no arguments at the end', () => {
    expect(narrate('Work Order WO-1 – Issue Materials', t)).toBe('أمر تشغيل WO-1 – صرف المواد')
  })
})

describe('what it refuses to touch', () => {
  it('leaves a narration somebody typed themselves alone', () => {
    const own = 'Accrue December rent per lease review'
    expect(narrate(own, t)).toBe(own)
    expect(parseNarration(own)).toBeNull()
  })

  it('leaves a recognised sentence in English when it has no translation yet', () => {
    // Parsed, but the dictionary has nothing — better the original than a gap.
    expect(narrate('Landed cost LC-1', t)).toBe('Landed cost LC-1')
  })

  it('is a no-op in the English build', () => {
    const s = 'Sales Invoice INV-0001 – Acme Trading'
    expect(narrate(s, en)).toBe(s)
  })

  it('survives nothing at all', () => {
    expect(narrate('', t)).toBe('')
    expect(narrate(null, t)).toBe('')
    expect(narrate(undefined, t)).toBe('')
    expect(parseNarration('')).toBeNull()
  })
})

describe('the patterns are anchored', () => {
  it('does not match a sentence that merely contains a keyword', () => {
    // A customer called "Receipt Books Ltd" must not turn the narration into
    // a receipt posting.
    expect(parseNarration('Paid Receipt Books Ltd for stationery')).toBeNull()
  })

  it('picks the more specific pattern when two could match', () => {
    expect(parseNarration('Reversal of JE-1 — typo').key).toBe('Reversal of {0} — {1}')
    expect(parseNarration('Reversal of JE-1').key).toBe('Reversal of {0}')
  })
})

describe('every pattern has Arabic in the real dictionary', () => {
  it('leaves no narration recognised but untranslated', async () => {
    const { readFileSync } = await import('node:fs')
    const dict = readFileSync('src/i18n.js', 'utf8')
    const src = readFileSync('src/utils/jeNarration.js', 'utf8')
    const keys = [...src.matchAll(/],\s*'((?:[^'\\]|\\.)*)'\],/g)].map((m) => m[1])
      .concat([...src.matchAll(/,\s+'([^']*\{0\}[^']*)'\],/g)].map((m) => m[1]))
    const missing = [...new Set(keys)].filter((k) => !dict.includes(`'${k}':`))
    expect(missing, `no Arabic for: ${missing.join(' | ')}`).toEqual([])
  })
})
