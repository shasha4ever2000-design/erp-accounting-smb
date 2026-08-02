// The words on a journal entry, in the reader's language.
//
// Every posting in this system writes its own narration — "Sales Invoice
// INV-0001 – Acme Trading", "Cost of Sales – INV-0001" — and every one of them
// was written in English inside store.js. An Arabic accountant got an Arabic
// interface, Arabic reports, and then a general ledger narrated in English:
// the one artifact they print, file, and hand to an auditor.
//
// The narration is *stored* in English on purpose. It is the audit record, it
// goes into exports, and it must not change meaning because somebody toggled a
// language switch. So the translation happens when it is read, not when it is
// written — which also means entries posted before any of this existed are
// translated too, with no migration.
//
// Each pattern is anchored and takes the document number and party as data, so
// only the words are translated and never the reference. Anything that does not
// match is shown exactly as it was posted: an unrecognised narration is far
// better than a mangled one.

/**
 * Ordered most specific first. `key` is the translatable sentence with {0},
 * {1} standing in for whatever the pattern captured.
 */
const PATTERNS = [
  // ── Document postings ──
  [/^Sales Invoice (\S+) – (.*)$/,        'Sales Invoice {0} – {1}'],
  [/^Sales Invoice (\S+)$/,               'Sales Invoice {0}'],
  [/^Purchase Invoice (\S+) – (.*)$/,     'Purchase Invoice {0} – {1}'],
  [/^Purchase Invoice (\S+)$/,            'Purchase Invoice {0}'],
  [/^Sales Return (\S+) – (.*)$/,         'Sales Return {0} – {1}'],
  [/^Purchase Return (\S+) – (.*)$/,      'Purchase Return {0} – {1}'],
  [/^Cost of Sales – (\S+)$/,             'Cost of Sales – {0}'],
  [/^Restock – Return (\S+)$/,            'Restock – Return {0}'],
  [/^Receipt (\S+) for (\S+)$/,           'Receipt {0} for {1}'],
  [/^Payment (\S+) for (\S+)$/,           'Payment {0} for {1}'],
  [/^Credit Note (\S+) for (\S+)$/,       'Credit Note {0} for {1}'],
  [/^Credit Note (\S+)$/,                 'Credit Note {0}'],
  [/^Debit Note (\S+)$/,                  'Debit Note {0}'],

  // ── Reversals and corrections ──
  [/^Reversal of (\S+) — (.*)$/,          'Reversal of {0} — {1}'],
  [/^Reversal of (\S+)$/,                 'Reversal of {0}'],
  [/^Reversal: (.*)$/,                    'Reversal: {0}'],

  // ── Inventory ──
  [/^Stock Adj (\S+) – (.*)$/,            'Stock Adj {0} – {1}'],
  [/^Stock count (\S+)$/,                 'Stock count {0}'],
  [/^Landed cost (\S+)$/,                 'Landed cost {0}'],

  // ── Manufacturing ──
  [/^Work Order (\S+) – Issue Materials$/, 'Work Order {0} – Issue Materials'],
  [/^Work Order (\S+) – Finished Goods$/,  'Work Order {0} – Finished Goods'],
  [/^WO (\S+) – Materials to WIP$/,        'WO {0} – Materials to WIP'],
  [/^WO (\S+) – Materials issued$/,        'WO {0} – Materials issued'],
  [/^Finished: (.*)$/,                     'Finished: {0}'],

  // ── Payroll and assets ──
  [/^Payroll Pmt (\S+)$/,                 'Payroll Pmt {0}'],
  [/^Payroll (\S+) – GOSI \(employer\)$/, 'Payroll {0} – GOSI (employer)'],
  [/^Dep: (.*)$/,                         'Dep: {0}'],
  [/^Dispose: (.*)$/,                     'Dispose: {0}'],

  // ── Money movement ──
  [/^Realized FX gain – (\S+)$/,          'Realized FX gain – {0}'],
  [/^Realized FX loss – (\S+)$/,          'Realized FX loss – {0}'],
  [/^Withholding tax – (\S+)$/,           'Withholding tax – {0}'],
  [/^Settlement discount — (.*)$/,        'Settlement discount — {0}'],
  [/^Transfer to (.*)$/,                  'Transfer to {0}'],
  [/^Transfer from (.*)$/,                'Transfer from {0}'],
  [/^Transfer fee \((.*)\)$/,             'Transfer fee ({0})'],
  [/^VAT settlement (\S+) → (\S+)$/,      'VAT settlement {0} → {1}'],
  [/^Opening balances as at (\S+)$/,      'Opening balances as at {0}'],

  // ── Line narrations ──
  [/^Revenue – (\S+)$/,                   'Revenue – {0}'],
  [/^Purchase – (\S+)$/,                  'Purchase – {0}'],
  [/^Invoice (\S+)$/,                     'Invoice {0}'],
  [/^Purchase (\S+)$/,                    'Purchase {0}'],
]

/**
 * Break a stored narration into its translatable sentence and its data.
 * @returns {{key: string, args: string[]}|null} null when nothing matches
 */
export function parseNarration(text) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return null
  for (const [re, key] of PATTERNS) {
    const m = s.match(re)
    if (m) return { key, args: m.slice(1) }
  }
  return null
}

/**
 * A narration in the reader's language.
 *
 * Falls back to exactly what was posted whenever the sentence is unrecognised
 * or untranslated — a manual entry somebody typed themselves is their words,
 * not ours, and must never be rewritten.
 *
 * @param {string} text  the stored (English) narration
 * @param {(s: string) => string} t
 */
export function narrate(text, t) {
  const parsed = parseNarration(text)
  if (!parsed) return text || ''
  const template = t(parsed.key)
  if (template === parsed.key) return text          // no translation for it yet
  return parsed.args.reduce((out, arg, i) => out.split(`{${i}}`).join(arg ?? ''), template)
}
