import { useState, useRef, useEffect } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Btn, Input, Select } from './UI'
import { LAYOUTS, DOC_TYPES, DOC_TYPE_LIST, resolveDocBrand, contrastOn } from '../utils/branding'
import { saveBrandAsset, getBrandAsset, deleteBrandAsset } from '../utils/brandAssets'
import { formatBytes, dataUrlBytes } from '../utils/itemImages'
import { ImagePlus, Trash2, AlertTriangle, Loader2, PenLine } from 'lucide-react'

function AssetSlot({ kind, label, hint, height = 'h-20' }) {
  const t = useT()
  const ref = useRef(null)
  const [asset, setAsset] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => { try { setAsset(await getBrandAsset(kind)) } catch { setAsset(null) } }
  useEffect(() => { refresh() }, [kind])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      await saveBrandAsset(kind, file)
      await refresh()
    } catch (err) {
      const m = String(err.message || err)
      setError(m.includes('ASSET_INVALID') ? m.replace('ASSET_INVALID:', '').trim()
        : m.includes('IMAGE_UNREADABLE') ? t('That file could not be read as an image.')
        : t('Could not save that file.'))
    }
    setBusy(false)
  }

  const remove = async () => {
    if (!confirm(t('Remove this image?'))) return
    await deleteBrandAsset(kind)
    await refresh()
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t(label)}</label>
      <div className="flex items-center gap-4">
        <div className={`w-32 ${height} rounded-lg border border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-slate-700/50 p-2`}>
          {asset?.dataUrl
            ? <img src={asset.dataUrl} alt="" className="max-w-full max-h-full object-contain" />
            : <span className="text-xs text-gray-400 dark:text-slate-500">{t('None')}</span>}
        </div>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" onClick={() => ref.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
              {busy ? t('Saving…') : t('Upload')}
            </Btn>
            {asset && <Btn size="sm" variant="ghost" onClick={remove}><Trash2 size={13} className="text-red-400" /></Btn>}
          </div>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onFile} className="hidden" />
          <p className="text-xs text-gray-400 dark:text-slate-500 max-w-xs">{t(hint)}</p>
          {asset?.dataUrl && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {asset.width ? `${asset.width}×${asset.height} · ` : ''}{formatBytes(dataUrlBytes(asset.dataUrl))}
              {asset.mime === 'image/png' ? ` · ${t('transparency kept')}` : ''}
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400 flex items-start gap-1.5 max-w-xs">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BrandingPanel() {
  const t = useT()
  const branding = useStore((s) => s.settings.branding)
  const { updateBranding, updateDocBranding } = useStore()
  const [docType, setDocType] = useState('invoice')
  const [error, setError] = useState('')

  const b = { ...branding }
  const per = (b.perDoc || {})[docType] || {}
  const resolved = resolveDocBrand(b, docType)

  const set = (patch) => {
    try { updateBranding(patch); setError('') }
    catch (e) { setError(String(e.message || e).replace('BRANDING_INVALID:', '').trim()) }
  }

  return (
    <div className="space-y-6">
      <AssetSlot
        kind="logo"
        label="Company Logo"
        hint="PNG, JPEG, WebP or SVG. It is scaled down for you, and transparency is kept so the mark does not sit in a white box."
      />

      {/* Colour + layout */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Brand colour')}</label>
          <div className="flex items-center gap-2">
            <input type="color" value={resolved.accentColor}
              onChange={(e) => set({ accentColor: e.target.value })}
              className="h-9 w-12 rounded border border-gray-300 dark:border-slate-600 bg-transparent cursor-pointer" />
            <input value={b.accentColor || ''} onChange={(e) => set({ accentColor: e.target.value })}
              className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
          </div>
          <p className="text-xs mt-1.5 px-2 py-1 rounded inline-block"
            style={{ background: resolved.accentColor, color: resolved.textOnAccent }}>
            {t('Text stays readable on this')}
          </p>
        </div>

        <Select label={t('Header layout')} value={b.layout || 'classic'} onChange={(e) => set({ layout: e.target.value })}>
          {Object.values(LAYOUTS).map((l) => <option key={l.id} value={l.id}>{t(l.label)} — {t(l.note)}</option>)}
        </Select>

        <Input label={t('Logo height (px)')} type="number" min="24" max="160"
          value={b.logoHeight ?? 64} onChange={(e) => set({ logoHeight: Number(e.target.value) })} />
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {/* Shared text */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Default terms')}</label>
          <textarea rows={3} value={b.terms || ''} onChange={(e) => set({ terms: e.target.value })}
            placeholder={t('e.g. Payment due within 30 days of invoice date.')}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Footer line')}</label>
          <textarea rows={3} value={b.footer || ''} onChange={(e) => set({ footer: e.target.value })}
            placeholder={t('e.g. Registered in Riyadh · CR 1010xxxxxx')}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-slate-500 -mt-3">
        {t('These appear on every document. Override just the ones that differ below.')}
      </p>

      {/* Signature */}
      <div className="pt-4 border-t border-gray-100 dark:border-surface-750 space-y-4">
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="h-4 w-4 mt-0.5 rounded border-gray-300 dark:border-slate-600"
            checked={!!b.showSignature} onChange={(e) => set({ showSignature: e.target.checked })} />
          <span className="text-gray-700 dark:text-slate-200">
            {t('Show a signature block')}
            <span className="block text-xs text-gray-400 dark:text-slate-500">
              {t('A ruled line at the foot of the document, with your signature image above it if you upload one.')}
            </span>
          </span>
        </label>
        {b.showSignature && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AssetSlot kind="signature" label="Signature image" hint="Optional. A transparent PNG works best." height="h-16" />
            <Input label={t('Signature caption')} value={b.signatureLabel || ''}
              onChange={(e) => set({ signatureLabel: e.target.value })} placeholder={t('Authorised signature')} />
          </div>
        )}
      </div>

      {/* Per-document overrides */}
      <div className="pt-4 border-t border-gray-100 dark:border-surface-750">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <PenLine size={15} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('Wording for one document type')}</span>
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-56">
            {DOC_TYPE_LIST.map((k) => <option key={k} value={k}>{t(DOC_TYPES[k].label)}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('Note under the header')}</label>
            <textarea rows={2} value={per.header || ''} onChange={(e) => updateDocBranding(docType, { header: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
          </div>
          {DOC_TYPES[docType]?.terms !== false && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                {t('Terms')} <span className="text-xs text-gray-400">{t('(blank uses the default)')}</span>
              </label>
              <textarea rows={2} value={per.terms || ''} onChange={(e) => updateDocBranding(docType, { terms: e.target.value })}
                placeholder={b.terms || ''}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600" />
            </div>
          )}
        </div>

        {DOC_TYPES[docType]?.bank && (
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 dark:border-slate-600"
              checked={per.showBank !== false} onChange={(e) => updateDocBranding(docType, { showBank: e.target.checked })} />
            <span className="text-gray-700 dark:text-slate-200">{t('Show payment details on this document')}</span>
          </label>
        )}
        {!DOC_TYPES[docType]?.bank && (
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
            {t('Payment details are not shown on this document — nobody pays from it.')}
          </p>
        )}
      </div>
    </div>
  )
}
