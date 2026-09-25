// Reading bank statement files and matching them to the books.
//
// Banks export statements in a handful of formats. CSV is the lowest common
// denominator but every bank lays it out differently; the structured formats
// below carry dates, signed amounts, a unique line id and the closing balance
// in a fixed place, so importing them needs no column guessing at all:
//
//   OFX / QFX   Money, Quicken, most US/UK/Gulf online banking ("Download for
//               Quicken"). Either SGML (tags left open) or XML.
//   CAMT.053    ISO 20022 end-of-day statement, the standard in Europe and
//               increasingly in the Gulf (SEPA, SARIE).
//   MT940       SWIFT end-of-day statement, what corporate banking portals
//               still hand out by default.
//
// Everything is plain string parsing so it runs the same in the browser, in
// Electron and in tests (no DOMParser). Every parser returns
//   { format, lines: [{ date, desc, amount, ref }], closingBalance, currency }
// with amount signed: positive money in, negative money out.
import { parseCSV, detectStatementColumns } from './csv'

const r2 = (n) => Math.round(n * 100) / 100

/** Which format a file is, from its content (the extension is only a hint). */
export function detectFormat(text, filename = '') {
  const head = String(text || '').slice(0, 4000)
  if (/<OFX>|OFXHEADER:|<\?OFX/i.test(head)) return 'ofx'
  if (/camt\.05[23]|<(\w+:)?BkToCstmrStmt>|<(\w+:)?BkToCstmrAcctRpt>/i.test(head)) return 'camt'
  if (/:20:|:60[FM]:|:61:/.test(head) && /:61:/.test(text)) return 'mt940'
  const ext = String(filename).toLowerCase().split('.').pop()
  if (ext === 'ofx' || ext === 'qfx') return 'ofx'
  if (ext === 'sta' || ext === 'mt940' || ext === '940') return 'mt940'
  if (ext === 'xml') return 'camt'
  return 'csv'
}

/** Parse any supported statement. Throws with a readable message on nonsense. */
export function parseStatement(text, filename = '') {
  const format = detectFormat(text, filename)
  const out = format === 'ofx' ? parseOFX(text)
    : format === 'camt' ? parseCAMT(text)
      : format === 'mt940' ? parseMT940(text)
        : parseCSVStatement(text)
  if (!out.lines.length) throw new Error('NO_LINES')
  return { format, ...out }
}

// ─── OFX ──────────────────────────────────────────────────────────────

// OFX dates are YYYYMMDD[HHMMSS[.XXX]][[-5:EST]]; only the day matters here.
const ofxDate = (v) => {
  const m = String(v || '').match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

// OFX amounts are normally 1234.56, but some European banks send 1234,56.
const ofxAmount = (v) => {
  let s = String(v || '').trim()
  if (/,\d{1,2}$/.test(s) && !s.includes('.')) s = s.replace(',', '.')
  return parseFloat(s.replace(/[^0-9.-]/g, '')) || 0
}

// Value of <TAG> inside a block. SGML OFX leaves leaf tags unclosed, so the
// value runs to the next '<' or line end, whichever comes first.
const ofxTag = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))
  return m ? decodeEntities(m[1].trim()) : ''
}

export function parseOFX(text) {
  const src = String(text || '')
  const lines = []
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi
  let m
  while ((m = re.exec(src))) {
    const b = m[1]
    const name = ofxTag(b, 'NAME')
    const memo = ofxTag(b, 'MEMO')
    lines.push({
      date: ofxDate(ofxTag(b, 'DTPOSTED') || ofxTag(b, 'DTUSER')),
      desc: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' — '),
      amount: r2(ofxAmount(ofxTag(b, 'TRNAMT'))),
      ref: ofxTag(b, 'FITID') || ofxTag(b, 'CHECKNUM') || ofxTag(b, 'REFNUM'),
    })
  }
  const bal = src.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)
  const closingBalance = bal ? r2(ofxAmount(ofxTag(bal[1], 'BALAMT'))) : null
  return { lines, closingBalance, currency: ofxTag(src, 'CURDEF') || '' }
}

// ─── CAMT.053 (ISO 20022) ─────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

// Namespace prefixes (<ns2:Ntry>) vary by bank; drop them so one set of
// patterns reads every file.
const stripNs = (xml) => String(xml || '').replace(/<(\/?)[A-Za-z0-9_-]+:/g, '<$1')

const xmlBlocks = (xml, tag) => {
  const out = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  let m
  while ((m = re.exec(xml))) out.push(m[1])
  return out
}
const xmlFirst = (xml, path) => {
  let cur = xml
  for (const tag of path.split('/')) {
    const b = xmlBlocks(cur, tag)
    if (!b.length) return ''
    cur = b[0]
  }
  return decodeEntities(cur.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

export function parseCAMT(text) {
  const xml = stripNs(text)
  const stmt = xmlBlocks(xml, 'Stmt')[0] || xmlBlocks(xml, 'Rpt')[0] || xml
  const lines = xmlBlocks(stmt, 'Ntry').map((e) => {
    const amt = parseFloat(xmlFirst(e, 'Amt')) || 0
    const sign = xmlFirst(e, 'CdtDbtInd') === 'DBIT' ? -1 : 1
    // Reversals (RvslInd=true) flip the direction of the original entry.
    const reversed = xmlFirst(e, 'RvslInd') === 'true' ? -1 : 1
    const date = (xmlFirst(e, 'BookgDt/Dt') || xmlFirst(e, 'BookgDt/DtTm') || xmlFirst(e, 'ValDt/Dt') || xmlFirst(e, 'ValDt/DtTm')).slice(0, 10)
    const party = sign > 0
      ? (xmlFirst(e, 'RltdPties/Dbtr/Nm') || xmlFirst(e, 'RltdPties/Dbtr/Pty/Nm'))
      : (xmlFirst(e, 'RltdPties/Cdtr/Nm') || xmlFirst(e, 'RltdPties/Cdtr/Pty/Nm'))
    const info = xmlFirst(e, 'RmtInf/Ustrd') || xmlFirst(e, 'AddtlTxInf') || xmlFirst(e, 'AddtlNtryInf')
    return {
      date,
      desc: [party, info].filter(Boolean).join(' — '),
      amount: r2(amt * sign * reversed),
      ref: xmlFirst(e, 'AcctSvcrRef') || xmlFirst(e, 'Refs/EndToEndId') || xmlFirst(e, 'NtryRef'),
    }
  })
  // The closing booked balance (CLBD); fall back to the last balance given.
  let closingBalance = null
  const bals = xmlBlocks(stmt, 'Bal')
  const clbd = bals.find((b) => /<Cd>CLBD<\/Cd>/.test(b)) || bals[bals.length - 1]
  if (clbd) {
    const v = parseFloat(xmlFirst(clbd, 'Amt'))
    if (!isNaN(v)) closingBalance = r2(v * (xmlFirst(clbd, 'CdtDbtInd') === 'DBIT' ? -1 : 1))
  }
  const cur = (stmt.match(/<Amt\s+Ccy="([A-Z]{3})"/) || [])[1] || xmlFirst(stmt, 'Acct/Ccy')
  return { lines, closingBalance, currency: cur || '' }
}

// ─── MT940 (SWIFT) ────────────────────────────────────────────────────

const mtAmount = (v) => parseFloat(String(v || '0').replace(',', '.')) || 0
const mtDate = (yymmdd) => {
  const m = String(yymmdd || '').match(/^(\d{2})(\d{2})(\d{2})/)
  if (!m) return ''
  const yy = Number(m[1])
  return `${yy >= 70 ? 1900 + yy : 2000 + yy}-${m[2]}-${m[3]}`
}

export function parseMT940(text) {
  // Join continuation lines onto their tag: a field runs until the next ":NN:".
  const fields = []
  String(text || '').replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.replace(/^\{\d:|\}$|^-\}?$/g, '')
    const tag = line.match(/^:(\d{2}[A-Z]?):(.*)$/)
    if (tag) fields.push({ tag: tag[1], value: tag[2] })
    else if (fields.length && line.trim()) fields[fields.length - 1].value += '\n' + line
  })
  const lines = []
  let closingBalance = null
  let currency = ''
  fields.forEach((f, i) => {
    if (f.tag === '61') {
      // YYMMDD [MMDD] [R]C|D [funds code] amount N... //bank ref
      const m = f.value.match(/^(\d{6})(\d{4})?(R?[CD])([A-Z])?(\d+,\d*)([A-Z]\w{3})?([^\n/]*)(?:\/\/([^\n]*))?([\s\S]*)$/)
      if (!m) return
      const dir = m[3]
      const sign = dir === 'C' || dir === 'RD' ? 1 : -1
      const next = fields[i + 1]
      const info = next && next.tag === '86' ? cleanMt86(next.value) : ''
      const extra = (m[9] || '').trim()
      lines.push({
        date: mtDate(m[1]),
        desc: info || extra || (m[7] || '').trim(),
        amount: r2(mtAmount(m[5]) * sign),
        ref: (m[7] || '').trim() !== 'NONREF' ? (m[7] || '').trim() || (m[8] || '').trim() : (m[8] || '').trim(),
      })
    } else if (f.tag === '62F' || f.tag === '62M') {
      const m = f.value.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/)
      if (m) {
        closingBalance = r2(mtAmount(m[4]) * (m[1] === 'D' ? -1 : 1))
        currency = m[3]
      }
    } else if ((f.tag === '60F' || f.tag === '60M') && !currency) {
      const m = f.value.match(/^[CD]\d{6}([A-Z]{3})/)
      if (m) currency = m[1]
    }
  })
  return { lines, closingBalance, currency }
}

// :86: is free text on most banks, or "?20...?21..." subfields on German
// (and many Gulf) banks. Either way, the readable part is what's wanted.
function cleanMt86(v) {
  const s = String(v || '').replace(/\n/g, '')
  if (/\?\d{2}/.test(s)) {
    const parts = {}
    s.split(/\?(\d{2})/).slice(1).forEach((p, i, arr) => { if (i % 2 === 0) parts[p] = (parts[p] || '') + (arr[i + 1] || '') })
    const text = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'].map((k) => parts[k]).filter(Boolean).join('')
    const name = [parts['32'], parts['33']].filter(Boolean).join('')
    return [name, text].filter(Boolean).join(' — ').trim()
  }
  return s.trim()
}

// ─── CSV ──────────────────────────────────────────────────────────────

const csvAmount = (s) => {
  let v = String(s || '').trim()
  const negative = /^\(.*\)$/.test(v) // (123.45) accounting style
  // 1.234,56 (European) → 1234.56
  if (/^\(?-?[\d.]+,\d{1,2}\)?$/.test(v)) v = v.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(v.replace(/[^0-9.-]/g, '')) || 0
  return negative ? -Math.abs(n) : n
}

export function normalizeDate(s) {
  const v = String(s || '').trim()
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/) // dd/mm/yyyy
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  return v
}

export function parseCSVStatement(text) {
  const { headers, rows } = parseCSV(text)
  const col = detectStatementColumns(headers)
  if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) throw new Error('CSV_COLUMNS')
  const lines = rows.map((r) => ({
    date: normalizeDate(r[col.date]),
    desc: (col.description >= 0 ? r[col.description] || '' : '').trim(),
    amount: r2(col.amount >= 0 ? csvAmount(r[col.amount]) : Math.abs(csvAmount(r[col.credit])) - Math.abs(csvAmount(r[col.debit]))),
    ref: '',
  })).filter((l) => l.amount !== 0 || l.desc)
  return { lines, closingBalance: null, currency: '' }
}

// ─── Matching ─────────────────────────────────────────────────────────

const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000)
const norm = (s) => String(s || '').toLowerCase()
// "INV-0012" also shows up as "INV 0012", "INV0012" or plain "0012" on bank narratives.
const refVariants = (ref) => {
  const r = norm(ref).trim()
  if (!r) return []
  const digits = r.replace(/\D/g, '').replace(/^0+/, '')
  return [r, r.replace(/[^a-z0-9]/g, ''), digits.length >= 3 ? digits : ''].filter(Boolean)
}
const mentions = (desc, ref) => {
  const d = norm(desc)
  const compact = d.replace(/[^a-z0-9]/g, '')
  return refVariants(ref).some((v) => d.includes(v) || compact.includes(v) || new RegExp(`(^|\\D)0*${v}(\\D|$)`).test(d))
}

/**
 * Match statement lines to ledger movements on the bank account.
 * Same amount (to the cent) is required; among those, the closest date wins,
 * and a movement whose reference appears in the bank narrative wins outright.
 * Each movement is used once. Movements already cleared are ignored.
 * @returns {{ matched: Array, unmatched: Array }}
 */
export function matchToLedger(stmtLines, movements, { windowDays = 7, isCleared = () => false } = {}) {
  const used = new Set()
  const matched = []
  const unmatched = []
  stmtLines.forEach((sl) => {
    let best = null
    let bestScore = -Infinity
    movements.forEach((m) => {
      if (used.has(m.id) || isCleared(m.id)) return
      if (Math.abs(m.amount - sl.amount) >= 0.01) return
      const days = sl.date && m.date ? dayDiff(m.date, sl.date) : 0
      if (days > windowDays) return
      const score = (mentions(sl.desc, m.ref) ? 100 : 0) - days
      if (score > bestScore) { best = m; bestScore = score }
    })
    if (best) { used.add(best.id); matched.push({ ...sl, jeId: best.id, jeRef: best.ref }) }
    else unmatched.push(sl)
  })
  return { matched, unmatched }
}

/**
 * For a statement line that isn't in the books yet, find the open invoice
 * (money in) or bill (money out) it most likely pays — so the user records
 * the payment against it instead of booking a loose bank line.
 *
 * Evidence, strongest first: the document number is in the narrative; the
 * party's name is in the narrative; the amount equals what is still due.
 * An amount-only match counts only when it is the single open document for
 * that amount, never a guess between several.
 *
 * @param {{date,desc,amount}} line
 * @param {{invoices,purchases,customers,suppliers,due:(doc,kind)=>number}} books
 * @returns {null | { kind:'invoice'|'purchase', doc, party, amount, reason }}
 */
export function suggestDocument(line, { invoices = [], purchases = [], customers = [], suppliers = [], due }) {
  const incoming = line.amount > 0
  const docs = incoming ? invoices : purchases
  const parties = incoming ? customers : suppliers
  const partyKey = incoming ? 'customerId' : 'supplierId'
  const kind = incoming ? 'invoice' : 'purchase'
  const want = Math.abs(line.amount)
  const open = docs
    .filter((d) => d && !['void', 'cancelled', 'draft', 'paid'].includes(d.status))
    .map((d) => ({ doc: d, left: due(d, kind), rate: Number(d.exchangeRate) || 1 }))
    .filter((x) => x.left > 0.005)
  if (!open.length) return null

  const partyOf = (d) => parties.find((p) => p.id === d[partyKey])
  const nameHit = (d) => {
    const n = norm(partyOf(d)?.name).trim()
    return n.length >= 3 && norm(line.desc).includes(n)
  }
  // Only base-currency amounts can be compared with a bank line directly.
  const amountFits = (x) => x.rate === 1 && want <= x.left + 0.005
  const exact = (x) => x.rate === 1 && Math.abs(x.left - want) < 0.01
  const pick = (x, reason) => ({ kind, doc: x.doc, party: partyOf(x.doc) || null, amount: Math.min(want, x.left), reason })

  const byNumber = open.filter((x) => mentions(line.desc, x.doc.number) && amountFits(x))
  if (byNumber.length) return pick(byNumber.sort((a, b) => Number(exact(b)) - Number(exact(a)))[0], 'number')

  const byName = open.filter((x) => nameHit(x.doc) && amountFits(x))
  const byNameExact = byName.filter(exact)
  if (byNameExact.length) return pick(oldest(byNameExact), 'name')
  if (byName.length === 1) return pick(byName[0], 'name')

  const byAmount = open.filter(exact)
  if (byAmount.length === 1) return pick(byAmount[0], 'amount')
  return null
}

const oldest = (xs) => xs.slice().sort((a, b) => String(a.doc.date || '').localeCompare(String(b.doc.date || '')))[0]
