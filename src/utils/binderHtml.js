// Rendering the audit binder as one self-contained file.
//
// The output has to open on somebody else's computer, years from now,
// possibly with no network — an auditor's laptop, a bank's file share, a
// data room. So everything is inline: no stylesheet, no script, no font, no
// image fetched from anywhere. A single .html file that a browser opens and
// a printer prints.
//
// ── Escaping is not a formality here ──────────────────────────────────
//
// This document is built from data the user typed — company name, account
// names, audit-trail descriptions — and is then handed to somebody outside
// the business who opens it in a browser. An account named
// `<script>…</script>` would otherwise execute in the recipient's browser,
// which turns a document meant to establish trust into an attack on the
// person reading it. Every interpolated value goes through `esc`, without
// exception, and the two places that must not be escaped (the assembled
// markup itself) are the only raw insertions in the file.

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const money = (n, sym = '') => {
  const v = Number(n) || 0
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${v < 0 ? '-' : ''}${esc(sym)}${s}`
}

const CSS = `
:root{--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--bg:#fff;--ok:#047857;--bad:#b91c1c;--warn:#b45309}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:17px;margin:32px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--line)}
h3{font-size:14px;margin:18px 0 6px}
.sub{color:var(--muted);margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
td.num,th.num{text-align:end;white-space:nowrap}
tr.total td{font-weight:700;border-top:2px solid var(--ink);border-bottom:none}
.verdict{padding:14px 16px;border-radius:8px;margin:16px 0}
.verdict.clean{background:#ecfdf5;color:var(--ok);border:1px solid #a7f3d0}
.verdict.qualified{background:#fef2f2;color:var(--bad);border:1px solid #fecaca}
.seal{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;
  background:#f9fafb;border:1px solid var(--line);border-radius:6px;padding:10px}
.ok{color:var(--ok)} .bad{color:var(--bad)} .warn{color:var(--warn)}
.small{font-size:12px;color:var(--muted)}
.note{margin:14px 0 22px}
ul{margin:6px 0;padding-inline-start:20px}
@media print{body{padding:0}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}
`

const row = (cells, cls = '') =>
  `<tr${cls ? ` class="${cls}"` : ''}>${cells.map((c) => (
    typeof c === 'object' ? `<td class="num">${c.num}</td>` : `<td>${c}</td>`
  )).join('')}</tr>`

/**
 * Render the binder.
 *
 * @param {object} binder      from buildBinder
 * @param {object} o
 * @param {(s: string) => string} o.t   translator
 * @param {string} o.sym       currency symbol
 * @param {string} o.dir       'ltr' | 'rtl'
 * @param {string} o.lang
 */
export function renderBinderHtml(binder, { t = (s) => s, sym = '', dir = 'ltr', lang = 'en' } = {}) {
  const T = (s) => esc(t(s))
  const b = binder || {}
  const co = b.company || {}
  const period = b.period || {}

  const verdictText = b.verdict === 'clean'
    ? t('These books balance, pass every integrity check, and match the seal recorded against them.')
    : t('This binder is qualified. The items below need resolving before it can be relied on.')

  const findings = (b.findings || []).length
    ? `<ul>${b.findings.map((f) => `<li>${T(f.code)} — ${esc(f.detail)}</li>`).join('')}</ul>`
    : ''

  // ── Ledger seal ──
  const anchor = b.ledger?.anchor || {}
  const verify = b.ledger?.verify || {}
  const sealSection = `
<h2>${T('The ledger seal')}</h2>
<p class="sub">${T('Every posted entry is hashed together with the entry before it. This value fixes the whole ledger as it stood when this binder was made.')}</p>
<div class="seal">${esc(anchor.head || '')}</div>
<table>
  ${row([T('Entries covered'), { num: esc(anchor.count ?? 0) }])}
  ${row([T('Entries sealed'), { num: esc(verify.sealed ?? 0) }])}
  ${b.unsealed ? row([T('Entries predating the seal'), { num: esc(b.unsealed) }]) : ''}
  ${row([T('Verifies against the seal'),
    { num: verify.ok === false
      ? `<span class="bad">${T('No')}</span>`
      : `<span class="ok">${T('Yes')}</span>` }])}
</table>
<p class="small">${T('To check this independently: recompute the chain from the ledger data and compare the result with the value above. If it matches, nothing in these entries has changed since this binder was produced.')}</p>
${b.unsealed ? `<p class="small">${T('Entries predating the seal came from a backup taken before sealing existed. They are not evidence of alteration.')}</p>` : ''}`

  // ── Integrity ──
  const integrity = b.integrity
  const integritySection = integrity ? `
<h2>${T('Integrity checks')}</h2>
<p class="sub">${esc(integrity.passed)} ${T('of')} ${esc(integrity.checks.length)} ${T('passed')}</p>
<table>
  <tr><th>${T('Check')}</th><th>${T('Result')}</th><th>${T('Detail')}</th></tr>
  ${integrity.checks.map((c) => row([
    T(c.label),
    c.ok ? `<span class="ok">${T('Pass')}</span>` : `<span class="bad">${T('Fail')}</span>`,
    esc(c.detail),
  ])).join('')}
</table>` : ''

  // ── Trial balance ──
  const tb = b.trialBalance || { rows: [] }
  const trialSection = `
<h2>${T('Trial balance')}</h2>
<table>
  <tr><th>${T('Code')}</th><th>${T('Account')}</th>
    <th class="num">${T('Debits')}</th><th class="num">${T('Credits')}</th>
    <th class="num">${T('Balance Dr')}</th><th class="num">${T('Balance Cr')}</th></tr>
  ${tb.rows.map((r) => row([
    esc(r.code), esc(r.name),
    { num: money(r.debit, sym) }, { num: money(r.credit, sym) },
    // Two columns, not one signed figure. A trial balance is read by people
    // who expect debits on the left and credits on the right; rendering a
    // capital account as "-50,000" is arithmetically true and reads as an
    // error to the one audience this document exists for.
    { num: r.balanceDebit ? money(r.balanceDebit, sym) : '' },
    { num: r.balanceCredit ? money(r.balanceCredit, sym) : '' },
  ])).join('')}
  ${row([
    '', `<strong>${T('Total')}</strong>`,
    { num: money(tb.totalDebit, sym) }, { num: money(tb.totalCredit, sym) },
    { num: money(tb.balanceDebitTotal, sym) },
    { num: tb.balances
      ? money(tb.balanceCreditTotal, sym)
      : `<span class="bad">${money(tb.difference, sym)}</span>` },
  ], 'total')}
</table>
${tb.balances
    ? `<p class="small ok">${T('Balanced')} — ${T('total debits equal total credits')}</p>`
    : `<p class="small bad">${T('Does not balance')}: ${money(tb.difference, sym)}</p>`}`

  // ── Position and performance ──
  const p = b.position || {}
  const perf = b.performance || {}
  const positionSection = `
<h2>${T('Financial position')}</h2>
<table>
  ${row([T('Assets'), { num: money(p.assets, sym) }])}
  ${row([T('Liabilities'), { num: money(p.liabilities, sym) }])}
  ${row([T('Equity'), { num: money(p.equity, sym) }])}
  ${row([T('Profit for the period'), { num: money(perf.profit, sym) }])}
  ${row([T('Assets less liabilities, equity and profit'),
    { num: p.balances ? `<span class="ok">${money(0, sym)}</span>` : `<span class="bad">${money(p.difference, sym)}</span>` }], 'total')}
</table>
<h3>${T('Performance for the period')}</h3>
<table>
  ${row([T('Revenue'), { num: money(perf.revenue, sym) }])}
  ${row([T('Expenses'), { num: money(perf.expenses, sym) }])}
  ${row([T('Profit for the period'), { num: money(perf.profit, sym) }], 'total')}
</table>
<p class="small">${T('Totals by account type. The grouped income statement and balance sheet are presentations of these same figures, produced in the app.')}</p>`

  // ── Notes ──
  const notes = b.notes
  const notesSection = notes ? `
<h2>${T('Notes to the financial statements')}</h2>
<p class="sub">${notes.reconciles
    ? `<span class="ok">${T('Every note agrees with the face of the financial statements.')}</span>`
    : `<span class="bad">${T('These notes do not agree with the statements')}: ${esc((notes.failing || []).join(', '))}</span>`}</p>
${(notes.notes || []).map((n, i) => renderNote(n, i, { T, esc, sym })).join('')}` : ''

  // ── Audit trail ──
  const trail = b.auditTrail || { actions: [], notable: [] }
  const trailSection = `
<h2>${T('Audit trail')}</h2>
<p class="sub">${esc(trail.total)} ${T('events recorded in the period')}${trail.users?.length ? ` · ${esc(trail.users.join(', '))}` : ''}</p>
<table>
  <tr><th>${T('Action')}</th><th class="num">${T('Count')}</th></tr>
  ${trail.actions.slice(0, 20).map((a) => row([esc(a.action), { num: esc(a.count) }])).join('')}
</table>
${trail.notable.length ? `
<h3>${T('Events a reviewer should see individually')}</h3>
<p class="small">${T('Edits to posted entries and anything flagged high-severity. An edit re-seals the ledger, so the seal alone cannot reveal it — this is the only record that the entry once read differently.')}</p>
<table>
  <tr><th>${T('When')}</th><th>${T('Who')}</th><th>${T('What')}</th><th>${T('Detail')}</th></tr>
  ${trail.notable.slice(0, 100).map((e) => row([
    esc(String(e.ts).slice(0, 19).replace('T', ' ')), esc(e.user), esc(e.action),
    esc(e.detail) + (e.touchedLedger
      ? ` <span class="warn">(${T('ledger hash changed')}${e.changes.filter((c) => c.field === 'ledgerHash')
        .map((c) => `: ${esc(c.from)} → ${esc(c.to || '—')}`).join('')})</span>`
      : ''),
  ])).join('')}
</table>` : `<p class="small">${T('No edits to posted entries and no high-severity events in this period.')}</p>`}`

  return `<!doctype html>
<html lang="${esc(lang)}" dir="${esc(dir)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${T('Audit Binder')} — ${esc(co.name || '')}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${esc(co.name || '')}</h1>
<p class="sub">${T('Audit Binder')} · ${esc(period.start || '')} – ${esc(period.end || '')}</p>
<p class="sub small">${T('Produced')} ${esc(String(b.generatedAt || '').slice(0, 19).replace('T', ' '))}${b.preparedBy ? ` · ${esc(b.preparedBy)}` : ''}</p>

<div class="verdict ${b.verdict === 'clean' ? 'clean' : 'qualified'}">
  <strong>${b.verdict === 'clean' ? T('Clean') : T('Qualified')}</strong> — ${esc(verdictText)}
  ${findings}
</div>

${sealSection}
${integritySection}
${positionSection}
${trialSection}
${notesSection}
${trailSection}

<h2>${T('About this document')}</h2>
<p class="small">${T('This binder was produced by the accounting system from its own books. It is self-contained: it needs no network, no software and no account to read. Its own fingerprint is below — recompute it to confirm the document itself has not been edited since it was produced.')}</p>
<div class="seal">${esc(b.hash || '')}</div>
</body>
</html>`
}

/** One disclosure note. Only the shapes the notes module actually produces. */
function renderNote(n, i, { T, esc: e, sym }) {
  const head = `<h3>${i + 1}. ${T(n.title)} <span class="small">${e(n.reference || '')}</span></h3>`

  const schedule = (title, s) => s ? `
<p class="small"><strong>${T(title)}</strong></p>
<table>
  ${row([T('At the start of the period'), { num: money(s.opening, sym) }])}
  ${(s.movements || []).map((m) => row([T(m.label), { num: money(m.amount, sym) }])).join('')}
  ${row([T('At the end of the period'), { num: money(s.closing, sym) }], 'total')}
  ${s.reconciles === false
    ? row([`<span class="bad">${T('Does not agree with the ledger')}</span>`, { num: `<span class="bad">${money(s.difference, sym)}</span>` }])
    : ''}
</table>` : ''

  if (n.id === 'policies') {
    return `<div class="note">${head}${(n.policies || []).map((p) => (
      `<p class="small"><strong>${T(p.label)}</strong><br>${T(p.text)}</p>`
    )).join('')}</div>`
  }
  if (n.id === 'ppe') {
    return `<div class="note">${head}${schedule('Cost', n.cost)}${schedule('Accumulated depreciation', n.depreciation)}
      <p class="small"><strong>${T('Carrying amount')}: ${money(n.carrying, sym)}</strong></p></div>`
  }
  if (n.id === 'leases') {
    return `<div class="note">${head}
      ${schedule('Right-of-use assets — cost', n.rightOfUse?.cost)}
      ${schedule('Right-of-use assets — accumulated depreciation', n.rightOfUse?.depreciation)}
      ${schedule('Lease liabilities', n.liability)}
      <table>${(n.maturity?.buckets || []).map((k) => row([T(k.label), { num: money(k.amount, sym) }])).join('')}
      ${row([T('Total'), { num: money(n.maturity?.total, sym) }], 'total')}</table>
      <p class="small">${T('These are undiscounted contractual payments, so they do not equal the lease liability above.')}</p></div>`
  }
  if (n.id === 'receivables') {
    return `<div class="note">${head}<table>
      ${row([T('Gross amount owed'), { num: money(n.gross, sym) }])}
      ${row([T('Loss allowance'), { num: money(-n.allowance, sym) }])}
      ${row([T('Carrying amount'), { num: money(n.net, sym) }], 'total')}</table>
      <p class="small">${T(n.note)}</p></div>`
  }
  if (n.id === 'inventories') {
    return `<div class="note">${head}<table>
      ${row([T('Carrying amount'), { num: money(n.carrying, sym) }])}
      ${row([T('Stock records'), { num: money(n.subledger, sym) }])}</table>
      <p class="small">${T('Cost formula')}: ${T(n.costFormula)}${n.reconciles === false
        ? ` <span class="bad">${T('Does not agree with the ledger')}: ${money(n.difference, sym)}</span>` : ''}</p></div>`
  }
  if (n.id === 'provisions') {
    return `<div class="note">${head}${schedule('End-of-service benefits', n.eosb)}
      <p class="small">${T(n.note)}</p></div>`
  }
  if (n.id === 'revenue') {
    return `<div class="note">${head}<table>
      ${(n.rows || []).map((r) => row([e(r.label), { num: money(r.amount, sym) }])).join('')}
      ${row([T('Total'), { num: money(n.total, sym) }], 'total')}</table></div>`
  }
  if (n.id === 'liquidity') {
    return `<div class="note">${head}<table>
      <tr><th></th><th class="num">${T('Within one year')}</th><th class="num">${T('One to five years')}</th><th class="num">${T('After five years')}</th></tr>
      ${(n.rows || []).map((r) => row([
        T(r.label), { num: money(r.y1, sym) }, { num: money(r.y2to5, sym) }, { num: money(r.over5, sym) },
      ])).join('')}
      ${row([T('Total'), { num: money(n.totals?.y1, sym) }, { num: money(n.totals?.y2to5, sym) }, { num: money(n.totals?.over5, sym) }], 'total')}
    </table></div>`
  }
  if (n.id === 'tax') {
    return `<div class="note">${head}<table>
      ${row([T('Gross deferred tax liability'), { num: money(n.schedule?.grossLiability, sym) }])}
      ${row([T('Gross deferred tax asset'), { num: money(n.schedule?.grossAsset, sym) }])}
      ${n.schedule?.unrecognisedAsset > 0
        ? row([T('Deferred tax asset not recognised'), { num: money(n.schedule.unrecognisedAsset, sym) }]) : ''}
      ${row([n.schedule?.net >= 0 ? T('Net deferred tax liability') : T('Net deferred tax asset'),
        { num: money(Math.abs(n.schedule?.net || 0), sym) }], 'total')}</table>
      <p class="small"><strong>${T('Reconciliation of the tax charge')}</strong></p>
      <table>${(n.reconciliation?.lines || []).map((l) => row([T(l.label), { num: money(l.amount, sym) }])).join('')}
      ${row([T('Total tax charge'), { num: money(n.reconciliation?.totalTax, sym) }], 'total')}</table></div>`
  }
  return `<div class="note">${head}</div>`
}
