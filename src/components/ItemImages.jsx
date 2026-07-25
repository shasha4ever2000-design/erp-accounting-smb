import { useState, useEffect, useRef, useCallback } from 'react'
import { useT } from '../i18n'
import { Btn } from './UI'
import {
  addItemImage, listItemImages, deleteItemImage, setPrimaryImage,
  formatBytes, MAX_EDGE,
} from '../utils/itemImages'
import { ImagePlus, Star, Trash2, AlertTriangle, Loader2 } from 'lucide-react'

/**
 * Photographs for one inventory item.
 *
 * Every upload is scaled down before it is stored — see utils/itemImages.js
 * for why. The size shown under each picture is the stored size, not the size
 * of the file that was chosen, so it is obvious that the shrinking happened.
 */
export default function ItemImages({ itemId }) {
  const t = useT()
  const fileRef = useRef(null)
  const [images, setImages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  const refresh = useCallback(async () => {
    if (!itemId) return setImages([])
    try { setImages(await listItemImages(itemId)) } catch { setImages([]) }
  }, [itemId])

  useEffect(() => { refresh() }, [refresh])

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(true); setError('')
    for (const f of files) {
      try {
        await addItemImage(itemId, f)
      } catch (err) {
        const m = String(err.message || err)
        setError(m.includes('IMAGE_INVALID') ? m.replace('IMAGE_INVALID:', '').trim()
          : m.includes('IMAGE_UNREADABLE') ? t('That file could not be read as an image.')
          : t('Could not save that picture. Storage may be full.'))
      }
    }
    await refresh()
    setBusy(false)
  }

  const remove = async (img) => {
    if (!confirm(t('Remove this picture?'))) return
    await deleteItemImage(img.id)
    await refresh()
  }

  const makePrimary = async (img) => {
    await setPrimaryImage(img.id)
    await refresh()
  }

  if (!itemId) {
    return (
      <p className="text-xs text-gray-400 dark:text-slate-500">
        {t('Save the item first, then you can add pictures to it.')}
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <Btn size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {busy ? t('Adding…') : t('Add pictures')}
        </Btn>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {t('Resized to {n}px and compressed, so a phone photo costs kilobytes rather than megabytes.').replace('{n}', MAX_EDGE)}
        </span>
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2 mt-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
          {images.map((img) => (
            <div key={img.id} className="group relative rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-surface-700 bg-gray-50 dark:bg-surface-800">
              <button type="button" onClick={() => setPreview(img)} className="block w-full aspect-square">
                <img src={img.thumbUrl} alt={img.name} className="w-full h-full object-cover" />
              </button>
              {img.primary && (
                <span className="absolute top-1 start-1 text-[9px] uppercase tracking-wider bg-brand-600 text-white px-1.5 py-0.5 rounded">
                  {t('main')}
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-1 bg-black/55 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <span className="text-[10px] text-white/80 tabular-nums">{formatBytes(img.bytes)}</span>
                <span className="flex items-center gap-1">
                  {!img.primary && (
                    <button type="button" onClick={() => makePrimary(img)} title={t('Use as the main picture')}
                      className="p-0.5 text-white/80 hover:text-amber-300"><Star size={13} /></button>
                  )}
                  <button type="button" onClick={() => remove(img)} title={t('Remove')}
                    className="p-0.5 text-white/80 hover:text-rose-300"><Trash2 size={13} /></button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70" onClick={() => setPreview(null)}>
          <img src={preview.dataUrl} alt={preview.name}
            className="max-h-full max-w-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
