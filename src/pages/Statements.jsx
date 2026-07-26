import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney, fmtDate, today } from '../utils/formatters'
import { PageHeader, Card, Btn, Select, Input } from '../components/UI'
import ExportMenu from '../components/ExportMenu'
import { buildStatementMessage, mailtoLink, whatsappLink, resolveRegion } from '../utils/shareStatement'
import { buildStatement } from '../utils/statement'
import { DocumentHeader, DocumentFooter } from '../components/DocumentBrand'
import { format } from 'date-fns'
import { Printer, FileText, Mail, MessageCircle, Copy, Check, AlertTriangle } from 'lucide-react'

export default function Statements() {
  const t = useT()
  const { customers, suppliers, invoices, purchases, creditNotes, debitNotes, settings } = useStore()
  const sym = settings.company.currencySymbol
  const company = settings.company

  const thisYear = format(new Date(), 'yyyy')
  const [type, setType] = useState('customer')
  const [entityId, setEntityId] = useState('')
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`)
  const [endDate, setEndDate] = useState(today())
  const [mode, setMode] = useState('activity')

  const list = type === 'customer' ? customers : suppliers
  const entity = list.find((e) => e.id === entityId)

  // Both views are built by utils/statement.js, which is tested on its own —
  // this is real accounting logic and it used to live untested in this file.
  const stmt = useMemo(
    () => buildStatement(type, entityId, { invoices, purchases, creditNotes, debitNotes }, {
      start: startDate, end: endDate, mode,
    }),
    [type, entityId, invoices, purchases, creditNotes, debitNotes, startDate, endDate, mode]
  )
  const { opening, closing, items, aged } = stmt
  const rows = stmt.rows.map((r) => ({ ...r, type: r.label }))

  const label = type === 'customer' ? 'owed by customer' : 'owed to supplier'

  // ── Sharing ────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  const shareMessage = useMemo(() => (entity ? buildStatementMessage({
    entityName: entity.name,
    companyName: company.name,
    startDate, endDate, closing,
    isCustomer: type === 'customer',
    bankDetails: settings.invoice?.bankDetails,
    money: (v) => fmtMoney(v, sym),
    date: (d) => fmtDate(d),
    t,
  }) : ''), [entity, company.name, startDate, endDate, closing, type, settings.invoice, sym, t])

  const shareSubject = entity ? `${t('Statement of Account')} — ${company.name} (${fmtDate(startDate)} — ${fmtDate(endDate)})` : ''

  const openLink = (url) => window.open(url, '_blank', 'noopener')
  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(shareMessage); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    catch { window.prompt(t('Copy the statement message:'), shareMessage) }
  }

  // Statement lines for CSV/Excel/PDF export, bracketed by opening and closing
  // balance so the export stands on its own.
  const exportRows = entity ? [
    { date: fmtDate(startDate), type: t('Opening balance'), ref: '', debit: '', credit: '', balance: opening },
    ...rows.map((r) => ({ date: fmtDate(r.date), type: r.type, ref: r.ref || '', debit: r.debit || '', credit: r.credit || '', balance: r.balance })),
    { date: fmtDate(endDate), type: t('Closing balance'), ref: '', debit: '', credit: '', balance: closing },
  ] : []
  const exportColumns = [
    { key: 'date', label: t('Date') },
    { key: 'type', label: t('Type') },
    { key: 'ref', label: t('Reference') },
    { key: 'debit', label: t('Debit'), right: true, map: (v) => (v === '' ? '' : Number(v).toFixed(2)) },
    { key: 'credit', label: t('Credit'), right: true, map: (v) => (v === '' ? '' : Number(v).toFixed(2)) },
    { key: 'balance', label: t('Balance'), right: true, map: (v) => Number(v).toFixed(2) },
  ]

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Statements of Account"
          subtitle="Printable customer & supplier account statements"
          action={entity && (
            <div className="flex flex-wrap items-center gap-2">
              {entity.email && (
                <Btn variant="secondary" size="sm" onClick={() => openLink(mailtoLink({ email: entity.email, subject: shareSubject, body: shareMessage }))}>
                  <Mail size={14} /> {t('Email')}
                </Btn>
              )}
              {entity.phone && (
                <Btn variant="secondary" size="sm" onClick={() => openLink(whatsappLink({ phone: entity.phone, body: shareMessage, countryId: resolveRegion(settings.tax?.country, company.currency) }))}>
                  <MessageCircle size={14} /> {t('WhatsApp')}
                </Btn>
              )}
              <Btn variant="secondary" size="sm" onClick={copyMessage}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy message')}
              </Btn>
              <ExportMenu
                filename={`statement-${(entity.name || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}-${startDate}_to_${endDate}`}
                rows={exportRows} columns={exportColumns}
                title={`${t('Statement of Account')} — ${entity.name}`}
                subtitle={`${company.name} · ${fmtDate(startDate)} — ${fmtDate(endDate)}`}
                size="sm"
              />
              <Btn variant="secondary" size="sm" onClick={() => window.print()}><Printer size={14} /> {t('Print')}</Btn>
            </div>
          )}
        />
      </div>

      <Card className="p-5 mb-6 no-print">
        <div className="flex gap-2 mb-4 flex-wrap">
          {[['activity', 'Activity (balance forward)'], ['open', 'Open items only']].map(([v, lbl]) => (
            <button key={v} onClick={() => setMode(v)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${mode === v ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-btn-primary' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700'}`}>
              {t(lbl)}
            </button>
          ))}
          <span className="text-xs text-gray-400 dark:text-slate-500 self-center ms-1">
            {mode === 'open'
              ? t('Only what is still unpaid, with its age — the view for chasing money.')
              : t('Opening balance, every movement, closing balance — the view that reconciles.')}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <Select label="Type" value={type} onChange={(e) => { setType(e.target.value); setEntityId('') }} className="w-40">
            <option value="customer">{t('Customer')}</option>
            <option value="supplier">{t('Supplier')}</option>
          </Select>
          <Select label={type === 'customer' ? 'Customer' : 'Supplier'} value={entityId} onChange={(e) => setEntityId(e.target.value)} className="w-64">
            <option value="">— Select —</option>
            {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
          <Input label="From" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
          <Input label="To" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        </div>
      </Card>

      {!entity ? (
        <Card className="p-12 text-center text-gray-400 dark:text-slate-500">
          <FileText size={32} className="mx-auto mb-3 opacity-40" />
          Select a {type} to generate a statement of account.
        </Card>
      ) : (
        <Card className="p-8 max-w-4xl mx-auto print:shadow-none">
          <DocumentHeader
            docType="statement"
            title="STATEMENT"
            right={
              <div className="text-end">
                <p className="text-sm text-gray-500 dark:text-slate-400">{fmtDate(startDate)} → {fmtDate(endDate)}</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-slate-100 mt-1">{fmtMoney(Math.abs(closing), sym)}</p>
                <p className="text-xs text-gray-400 dark:text-slate-500">{closing >= 0 ? t(label) : t('in credit')}</p>
              </div>
            }
          />

          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase mb-1">{type === 'customer' ? 'Customer' : 'Supplier'}</p>
            <p className="font-semibold text-gray-800 dark:text-slate-100">{entity.name}</p>
            {entity.email && <p className="text-sm text-gray-500 dark:text-slate-400">{entity.email}</p>}
            {entity.taxId && <p className="text-sm text-gray-500 dark:text-slate-400">VAT/Tax: {entity.taxId}</p>}
          </div>

          {mode === 'open' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-xs text-gray-500 dark:text-slate-400 uppercase">
                  <th className="text-start py-2">{t('Date')}</th>
                  <th className="text-start py-2">{t('Reference')}</th>
                  <th className="text-start py-2">{t('Due')}</th>
                  <th className="text-end py-2">{t('Total')}</th>
                  <th className="text-end py-2">{t('Paid')}</th>
                  <th className="text-end py-2">{t('Outstanding')}</th>
                  <th className="text-end py-2">{t('Age')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.docId} className="border-b border-gray-100 dark:border-slate-700/50">
                    <td className="py-2 text-gray-500 dark:text-slate-400">{fmtDate(r.date)}</td>
                    <td className="py-2 font-mono text-xs text-gray-700 dark:text-slate-200">{r.ref}</td>
                    <td className="py-2 text-gray-500 dark:text-slate-400">{fmtDate(r.dueDate)}</td>
                    <td className="py-2 text-end tabular-nums text-gray-600 dark:text-slate-300">{fmtMoney(r.total, sym)}</td>
                    <td className="py-2 text-end tabular-nums text-gray-500 dark:text-slate-400">{r.paid ? fmtMoney(r.paid, sym) : '—'}</td>
                    <td className="py-2 text-end tabular-nums font-semibold text-gray-900 dark:text-slate-100">{fmtMoney(r.outstanding, sym)}</td>
                    <td className={`py-2 text-end tabular-nums ${r.daysOverdue > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
                      {r.daysOverdue > 0 ? t('{n} days').replace('{n}', r.daysOverdue) : t('not due')}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('Nothing outstanding — the account is clear.')}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-600 text-xs text-gray-500 dark:text-slate-400 uppercase">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">Transaction</th>
                <th className="text-left py-2">Ref</th>
                <th className="text-right py-2">Debit</th>
                <th className="text-right py-2">Credit</th>
                <th className="text-right py-2">{t('Balance')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 dark:border-slate-700/50 bg-gray-50 dark:bg-slate-800/60">
                <td className="py-2 text-gray-500 dark:text-slate-400" colSpan={5}>{t('Opening Balance')}</td>
                <td className="py-2 text-right font-semibold text-gray-800 dark:text-slate-100">{fmtMoney(opening, sym)}</td>
              </tr>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-slate-700/50">
                  <td className="py-2 text-gray-500 dark:text-slate-400">{fmtDate(r.date)}</td>
                  <td className="py-2 text-gray-700 dark:text-slate-200">{r.type}</td>
                  <td className="py-2 text-gray-400 dark:text-slate-500 font-mono text-xs">{r.ref}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-slate-200">{r.debit ? fmtMoney(r.debit, sym) : ''}</td>
                  <td className="py-2 text-right text-gray-700 dark:text-slate-200">{r.credit ? fmtMoney(r.credit, sym) : ''}</td>
                  <td className="py-2 text-right font-medium text-gray-800 dark:text-slate-100">{fmtMoney(r.balance, sym)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400 dark:text-slate-500">{t('No transactions in this period')}</td></tr>
              )}
            </tbody>
          </table>
          )}

          <div className="flex justify-end mt-6">
            <div className="w-64 bg-gray-50 dark:bg-slate-800/60 rounded-lg p-4">
              <div className="flex justify-between font-bold text-base">
                <span className="text-gray-800 dark:text-slate-100">{t('Closing Balance')}</span>
                <span className={closing >= 0 ? 'text-gray-900 dark:text-slate-100' : 'text-green-600'}>{fmtMoney(Math.abs(closing), sym)}</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 text-right">{closing >= 0 ? t(label) : t('in credit')}</p>
            </div>
          </div>

          {/* Aged summary — the part of a statement people actually read. */}
          {aged.total > 0 && (
            <div className="mt-8 pt-5 border-t border-gray-200 dark:border-surface-700">
              <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                {t('Aged summary')}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-xs text-gray-500 dark:text-slate-400 uppercase">
                      {aged.labels.map((l) => <th key={l} className="text-end py-1.5 font-medium">{t(l)}</th>)}
                      <th className="text-end py-1.5 font-medium">{t('Total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-100 dark:border-surface-750">
                      {aged.cells.map((v, i) => (
                        <td key={i} className={`text-end py-2 tabular-nums ${i > 1 && v > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-gray-700 dark:text-slate-200'}`}>
                          {v ? fmtMoney(v, sym) : '—'}
                        </td>
                      ))}
                      <td className="text-end py-2 tabular-nums font-bold text-gray-900 dark:text-slate-100">{fmtMoney(aged.total, sym)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* If the two views disagree, say so rather than printing one of
              them — a payment recorded against nothing means the figure
              being chased is wrong. */}
          {stmt.reconciliation && !stmt.reconciliation.ok && (
            <div className="mt-6 p-3.5 rounded-lg bg-warning-50/70 dark:bg-warning-500/[0.08] ring-1 ring-inset ring-warning-500/25 flex items-start gap-3 no-print">
              <AlertTriangle size={16} className="text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-warning-800 dark:text-warning-200">
                {t('The running balance ({a}) does not match the unpaid documents ({b}). A credit or payment is recorded against nothing — check before sending this.')
                  .replace('{a}', fmtMoney(stmt.reconciliation.closing, sym))
                  .replace('{b}', fmtMoney(stmt.reconciliation.open, sym))}
              </p>
            </div>
          )}

          <DocumentFooter docType="statement" bankDetails={settings.invoice?.bankDetails} />
        </Card>
      )}
    </div>
  )
}
