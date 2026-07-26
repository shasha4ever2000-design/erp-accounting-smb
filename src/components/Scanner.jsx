import { useState, useEffect, useRef, useCallback } from 'react'
import { useT } from '../i18n'
import { Btn } from './UI'
import { scannerSupport, scannerMessage, SCAN_FORMATS } from '../utils/scanning'
import { Camera, CameraOff, Keyboard, X } from 'lucide-react'

/**
 * Reads a code, by camera where the browser allows it and by keyboard
 * everywhere else.
 *
 * The manual box is not a fallback bolted on afterwards — it is the primary
 * path on most desktops, and it is also what a USB barcode gun uses, since
 * those present themselves as a keyboard and "type" the code followed by
 * Enter. So the input stays focused and clears itself after each read.
 */
export default function Scanner({ onScan, autoFocus = true, placeholder }) {
  const t = useT()
  const support = scannerSupport()
  const [manual, setManual] = useState('')
  const [camera, setCamera] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const lastRef = useRef({ code: '', at: 0 })

  const submit = useCallback((value, { fromCamera = false } = {}) => {
    const code = String(value || '').trim()
    if (!code) return
    // A camera sees the same label thirty times a second, so a repeat within a
    // moment is one label, not two items. Deliberate input is the opposite:
    // pressing Enter twice on the same code means two identical boxes, and
    // swallowing the second would silently undercount a shelf of them. So the
    // suppression applies to the camera only.
    if (fromCamera) {
      const now = Date.now()
      if (lastRef.current.code === code && now - lastRef.current.at < 1500) return
      lastRef.current = { code, at: now }
    }
    onScan?.(code)
  }, [onScan])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setCamera(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const startCamera = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setCamera(true)
      // The element only exists once `camera` is true, so wait a tick.
      setTimeout(async () => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        const detector = new window.BarcodeDetector({ formats: SCAN_FORMATS })
        const tick = async () => {
          if (!videoRef.current || !streamRef.current) return
          try {
            const found = await detector.detect(videoRef.current)
            if (found?.length) submit(found[0].rawValue, { fromCamera: true })
          } catch { /* a dropped frame is not worth reporting */ }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }, 50)
    } catch (e) {
      setError(String(e?.name) === 'NotAllowedError'
        ? t('Camera permission was refused. You can still type or scan with a barcode gun below.')
        : t('Could not open the camera. You can still type or scan with a barcode gun below.'))
      stopCamera()
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Keyboard size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={manual}
            placeholder={placeholder || t('Scan a label, or type a code and press Enter')}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              submit(manual)
              setManual('')
            }}
            className="w-full border rounded-lg ps-9 pe-3 py-2.5 text-sm bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 border-slate-300/90 dark:border-surface-600 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
          />
        </div>

        {support.camera ? (
          camera ? (
            <Btn variant="secondary" onClick={stopCamera}><CameraOff size={15} /> {t('Stop camera')}</Btn>
          ) : (
            <Btn variant="secondary" onClick={startCamera}><Camera size={15} /> {t('Use camera')}</Btn>
          )
        ) : (
          <span className="text-xs text-gray-400 dark:text-slate-500 max-w-[260px]">
            {scannerMessage(support.reason)}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-warning-700 dark:text-warning-400 mt-2">{error}</p>}

      {camera && (
        <div className="relative mt-3 rounded-xl overflow-hidden bg-black max-w-md">
          <video ref={videoRef} playsInline muted className="w-full block" />
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-3/5 aspect-square border-2 border-white/70 rounded-lg" />
          </div>
          <button onClick={stopCamera} className="absolute top-2 end-2 p-1.5 rounded-lg bg-black/50 text-white">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
