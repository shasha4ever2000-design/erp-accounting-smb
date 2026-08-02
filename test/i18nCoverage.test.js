// Does the Arabic build actually speak Arabic?
//
// Input, Select, Textarea, Btn and Modal all run their label through t()
// internally, so a screen is translated when the string exists in the
// dictionary — not when the call site literally writes t(...). That makes the
// gap invisible to code review: the JSX looks the same either way, and the only
// way to find an untranslated field is to switch the language and look.
//
// This does the looking. It fails when somebody adds a form field without an
// Arabic label, which is the moment it is cheapest to fix.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dict = readFileSync('src/i18n.js', 'utf8')
const KEYS = new Set([
  ...[...dict.matchAll(/^\s+'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1]),
  ...[...dict.matchAll(/^\s+"((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]),
])

// Sample values and document codes. Translating "INV-0001" or "Cairo" helps
// nobody, and an example placeholder is meant to look like what it is an
// example of.
const NOT_PROSE = new Set([
  'Al-Noor Trading Est.', 'Cairo', 'Nasr City', 'USD', 'Jul 2026',
  'INV-', 'INV-0001', 'INV-1042', 'PUR-0001', 'EAN / UPC / scan',
  'INVOICE', 'STATEMENT', 'Version, notes...',
])

const FIELD = /(label|placeholder|title)="([A-Z][^"{}]{2,})"/g

function scan() {
  const out = new Map()
  for (const dir of ['src/pages', 'src/components']) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(FIELD)) {
        const s = m[2]
        if (NOT_PROSE.has(s) || KEYS.has(s)) continue
        if (!out.has(s)) out.set(s, f)
      }
    }
  }
  return out
}

describe('Arabic coverage of form labels', () => {
  it('every field label, placeholder and tooltip has a translation', () => {
    const missing = scan()
    const report = [...missing].map(([s, f]) => `  ${f}: "${s}"`).join('\n')
    expect(missing.size, `\n${missing.size} untranslated string(s) — add them to src/i18n.js:\n${report}\n`).toBe(0)
  })

  it('is measuring something — the scanner finds real strings', () => {
    // A regex that silently stopped matching would make the check above pass
    // for ever while the app drifted back into English.
    let total = 0
    for (const dir of ['src/pages', 'src/components']) {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
        total += [...readFileSync(join(dir, f), 'utf8').matchAll(FIELD)].length
      }
    }
    expect(total).toBeGreaterThan(400)
    expect(KEYS.size).toBeGreaterThan(2000)
  })
})
