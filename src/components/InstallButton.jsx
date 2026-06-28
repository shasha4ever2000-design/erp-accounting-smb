import { useState, useEffect } from 'react'
import { useT } from '../i18n'
import { Download, X } from 'lucide-react'

export default function InstallButton() {
  const t = useT()
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const isNative = window.location.protocol === 'file:' || /electron/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
    if (standalone || isNative) setInstalled(true)

    const onPrompt = (e) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return null

  const handleClick = async () => {
    if (deferred) {
      deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') setInstalled(true)
      setDeferred(null)
    } else {
      setShowHelp(true)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg px-3 py-1.5 transition-colors"
        title="Install ERP as a desktop app"
      >
        <Download size={15} /> {t('Install app')}
      </button>

      {showHelp && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowHelp(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Download size={18} className="text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{t('Install the desktop app')}</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-300 mb-4">Install ERP Accounting so it opens in its own window with a desktop icon — and works offline.</p>
            <div className="space-y-3 text-sm text-gray-600 dark:text-slate-300">
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">Chrome / Edge (Windows, Mac, Linux)</p>
                <p>{t('Click the')}<strong>install icon</strong> (a monitor with a ↓) at the right of the address bar — or open the ⋮ menu → <strong>Install ERP Accounting…</strong></p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">Safari (Mac)</p>
                <p>{t('Open the')}<strong>Share</strong> menu → <strong>{t('Add to Dock')}</strong>.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">iPhone / iPad</p>
                <p>Tap <strong>Share</strong> → <strong>{t('Add to Home Screen')}</strong>.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
