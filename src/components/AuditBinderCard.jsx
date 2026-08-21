import { useState } from 'react'
import { useStore } from '../store'
import { useT, useI18n } from '../i18n'
import { Card, Btn, Input } from './UI'
import { FileCheck2, Download, CheckCircle2, AlertTriangle } from 'lucide-react'

// Produce the audit binder.
//
// Deliberately a deliberate act: a period is chosen, a button is pressed, a
// file comes out. Nothing here runs on boot or in the background, because the
// binder is a representation made to somebody outside the business and the
// moment it was made is part of what it says.
//
// The verdict is shown *before* the download rather than only inside the file,
// so a business finds out its books are qualified while it can still do
// something about it — not after the document is with the bank.

export default function AuditBinderCard() {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const auditBinder = useStore((s) => s.auditBinder)
  const company = useStore((s) => s.settings.company)

  const thisYear = new Date().getFullYear()
  const [start, setStart] = useState(`${thisYear}-01-01`)
  const [end, setEnd] = useState(`${thisYear}-12-31`)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const produce = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const binder = await auditBinder(start, end)
      const { renderBinderHtml } = await import('../utils/binderHtml')
      const html = renderBinderHtml(binder, {
        t, sym: company.currencySymbol || '',
        dir: lang === 'ar' ? 'rtl' : 'ltr', lang: lang || 'en',
      })
      setResult({ binder, html })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!result) return
    const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const slug = (company.name || 'company').replace(/[^\w-]+/g, '-').slice(0, 40)
    a.download = `audit-binder-${slug}-${end}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clean = result?.binder?.verdict === 'clean'

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center">
          <FileCheck2 size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Audit Binder')}</h2>
      </div>

      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4 max-w-2xl">
        {t('One self-contained file for whoever has to be given the books — an auditor, a bank, a buyer. It carries the trial balance, the integrity checks, the notes and the ledger seal, so the recipient can verify the books behind it rather than taking them on trust.')}
      </p>

      <div className="grid gap-3 sm:grid-cols-3 items-end">
        <Input label={t('From')} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input label={t('To')} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Btn onClick={produce} disabled={busy}>
          <FileCheck2 size={14} /> {busy ? t('Producing…') : t('Produce binder')}
        </Btn>
      </div>

      {error && <p className="mt-3 text-sm text-danger-600 dark:text-danger-400">{t('Could not produce the binder')}: {error}</p>}

      {result && (
        <div className="mt-4">
          {/* Shown here, not only inside the file — a business should learn its
              books are qualified while it can still fix them. */}
          <div className={`rounded-xl border p-4 ${clean
            ? 'bg-success-50 dark:bg-success-500/10 border-success-200 dark:border-success-900'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900'}`}>
            <div className="flex items-start gap-3">
              {clean
                ? <CheckCircle2 size={18} className="text-success-600 dark:text-success-400 mt-0.5 shrink-0" />
                : <AlertTriangle size={18} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${clean ? 'text-success-700 dark:text-success-300' : 'text-red-700 dark:text-red-300'}`}>
                  {clean ? t('Clean') : t('Qualified')}
                </p>
                <p className={`text-xs mt-0.5 ${clean ? 'text-success-600 dark:text-success-400' : 'text-red-600 dark:text-red-400'}`}>
                  {clean
                    ? t('These books balance, pass every integrity check, and match the seal recorded against them.')
                    : t('This binder is qualified. The items below need resolving before it can be relied on.')}
                </p>
                {result.binder.findings.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-red-700/90 dark:text-red-300/90">
                    {result.binder.findings.map((f, i) => (
                      <li key={i}>• {t(f.code)} — {f.detail}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Btn variant="success" onClick={download}><Download size={15} /> {t('Download binder')}</Btn>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {t('Entries covered')}: {result.binder.ledger?.anchor?.count ?? 0}
            </span>
          </div>

          <p className="mt-3 text-xs text-gray-400 dark:text-slate-500">{t('Document fingerprint')}</p>
          <p className="font-mono text-[11px] break-all text-gray-500 dark:text-slate-400">{result.binder.hash}</p>
        </div>
      )}
    </Card>
  )
}
