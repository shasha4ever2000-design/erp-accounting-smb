import { useState, useMemo, useEffect } from 'react'
import QRCode from 'qrcode'
import { useT } from '../i18n'
import { useStore } from '../store'
import { fmtMoney } from '../utils/formatters'
import { PageHeader, Card, Btn, Select, Input, EmptyState } from '../components/UI'
import { LABEL_PRESETS, KINDS, buildSheet, perPage } from '../utils/labels'
import { Printer, Tag, Search, CheckSquare, Square, QrCode } from 'lucide-react'

export default function Labels() {
  const t = useT()
  const { fixedAssets = [], inventoryItems = [], settings } = useStore()
  const sym = settings.company.currencySymbol
  const company = settings.company.name

  const [kind, setKind] = useState('fixedAssets')
  const [presetId, setPresetId] = useState('medium')
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState({})   // id -> true
  const [copies, setCopies] = useState({})       // id -> n
  const [qr, setQr] = useState({})               // payload -> data URL

  const source = kind === 'fixedAssets' ? fixedAssets : inventoryItems

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return source
    return source.filter((r) =>
      [r.name, r.code, r.number, r.barcode, r.location, r.serialNumber]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [source, search, kind])

  const chosen = useMemo(() => source.filter((r) => selected[r.id]), [source, selected])

  const sheet = useMemo(
    () => buildSheet(kind, chosen, {
      copies, presetId, offset, company,
      fmtMoney: (n) => fmtMoney(n, sym),
    }),
    [kind, chosen, copies, presetId, offset, company, sym]
  )

  // QR codes are generated per payload and cached; regenerating one on every
  // render would repaint the whole sheet on each keystroke.
  useEffect(() => {
    let alive = true
    const wanted = [...new Set(sheet.pages.flat().filter((l) => !l.blank).map((l) => l.payload))]
    const missing = wanted.filter((w) => !qr[w])
    if (!missing.length) return
    Promise.all(missing.map(async (payload) => {
      const url = await QRCode.toDataURL(payload, { margin: 0, width: 240, errorCorrectionLevel: 'M' })
      return [payload, url]
    }))
      .then((pairs) => { if (alive) setQr((prev) => ({ ...prev, ...Object.fromEntries(pairs) })) })
      .catch(() => {})
    return () => { alive = false }
  }, [sheet, qr])

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }))
  const allShown = rows.length > 0 && rows.every((r) => selected[r.id])
  const toggleAll = () => {
    const next = { ...selected }
    rows.forEach((r) => { next[r.id] = !allShown })
    setSelected(next)
  }
  const switchKind = (k) => { setKind(k); setSelected({}); setCopies({}); setSearch('') }

  const preset = LABEL_PRESETS[presetId]

  return (
    <div>
      <PageHeader
        title="Asset & Item Labels"
        subtitle="Printable tags with a scannable code, so a stock count or asset check is a walk with a phone"
        action={
          <Btn onClick={() => window.print()} disabled={sheet.total === 0}>
            <Printer size={15} /> {t('Print')} {sheet.total > 0 ? `(${sheet.total})` : ''}
          </Btn>
        }
      />

      {/* ── Controls ── */}
      <Card className="p-5 mb-6 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select label={t('What are you labelling?')} value={kind} onChange={(e) => switchKind(e.target.value)}>
            {Object.values(KINDS).map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
          </Select>
          <Select label={t('Label size')} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {Object.values(LABEL_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {t(p.label)} — {p.width}×{p.height}mm ({p.cols * p.rows}/{t('sheet')})
              </option>
            ))}
          </Select>
          <Input label={t('Skip used labels')} type="number" min="0" max={perPage(presetId) - 1}
            value={offset} onChange={(e) => setOffset(e.target.value)} />
          <div>
            <label className="block text-[13px] font-medium text-slate-600 dark:text-slate-300 mb-1.5">{t('Find')}</label>
            <div className="relative">
              <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Name, code, location…')}
                className="w-full border rounded-lg ps-9 pe-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
          {t('Skipping labels lets you reuse a part-used sheet instead of wasting the rest of it.')}
        </p>
      </Card>

      {/* ── Pick what to print ── */}
      <Card className="overflow-hidden mb-6 print:hidden">
        <div className="p-4 border-b border-gray-100 dark:border-surface-750 flex items-center gap-3">
          <button onClick={toggleAll} className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400">
            {allShown ? <CheckSquare size={16} /> : <Square size={16} />}
            {allShown ? t('Clear all') : t('Select all')}
          </button>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {t('{n} selected · {p} label(s) to print').replace('{n}', chosen.length).replace('{p}', sheet.total)}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Tag size={26} className="text-slate-400 dark:text-slate-500" />}
            title={kind === 'fixedAssets' ? 'No fixed assets yet' : 'No inventory items yet'}
            desc="Add some first, then come back here to print tags for them."
          />
        ) : (
          <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-50 dark:divide-surface-800">
            {rows.map((r) => {
              const code = kind === 'fixedAssets' ? (r.number || r.code || '') : (r.code || r.barcode || '')
              return (
                <label key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/70 dark:hover:bg-surface-800/50 cursor-pointer">
                  <input type="checkbox" checked={!!selected[r.id]} onChange={() => toggle(r.id)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 flex-shrink-0" />
                  <span className="font-mono text-xs text-gray-500 dark:text-slate-400 w-24 flex-shrink-0 truncate">{code}</span>
                  <span className="flex-1 min-w-0 text-sm text-gray-800 dark:text-slate-100 truncate">{r.name}</span>
                  {kind === 'fixedAssets' && r.location && (
                    <span className="hidden sm:inline text-xs text-gray-400 dark:text-slate-500 truncate max-w-[140px]">{r.location}</span>
                  )}
                  {selected[r.id] && (
                    <input type="number" min="0" value={copies[r.id] ?? 1}
                      onClick={(e) => e.preventDefault()}
                      onChange={(e) => setCopies((c) => ({ ...c, [r.id]: e.target.value }))}
                      title={t('Copies')}
                      className="w-16 border rounded px-2 py-1 text-xs text-end tabular-nums bg-white dark:bg-surface-800 border-slate-300/90 dark:border-surface-600" />
                  )}
                </label>
              )
            })}
          </div>
        )}
      </Card>

      {/* ── The sheet ── */}
      {sheet.total === 0 ? (
        <Card className="print:hidden">
          <EmptyState
            icon={<QrCode size={26} className="text-slate-400 dark:text-slate-500" />}
            title="Nothing selected yet"
            desc="Tick the assets or items you want tags for. Each label carries a QR code holding that record's permanent id, so scanning it still finds the right thing after names and numbers have been changed."
          />
        </Card>
      ) : (
        <div className="label-sheets">
          {sheet.pages.map((page, pi) => (
            <div key={pi} className="label-page">
              <div
                className="label-grid"
                style={{ gridTemplateColumns: `repeat(${preset.cols}, ${preset.width}mm)` }}
              >
                {page.map((l) => (
                  l.blank ? (
                    <div key={l.key} className="label-cell label-blank"
                      style={{ width: `${preset.width}mm`, height: `${preset.height}mm` }} />
                  ) : (
                    <div key={l.key} className="label-cell"
                      style={{ width: `${preset.width}mm`, height: `${preset.height}mm` }}>
                      {qr[l.payload] && <img src={qr[l.payload]} alt="" className="label-qr" />}
                      <div className="label-text">
                        <div className="label-code">{l.code}</div>
                        <div className="label-title">{l.title}</div>
                        {l.detail.length > 0 && <div className="label-detail">{l.detail.join(' · ')}</div>}
                        {l.company && <div className="label-company">{l.company}</div>}
                      </div>
                    </div>
                  )
                ))}
              </div>
              <p className="label-pagefoot print:hidden">
                {t('Page {a} of {b}').replace('{a}', pi + 1).replace('{b}', sheet.pages.length)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
