// A thin strip under the top bar: offline, a new version, or "ready to work offline".
import { useEffect, useState } from 'react'
import { WifiOff, Sparkles, CheckCircle2, X } from 'lucide-react'
import { usePwa, applyUpdate } from '../pwa'
import { useAuth } from '../auth'
import { useT } from '../i18n'

export default function ConnectionBanner() {
  const t = useT()
  const { online, updateReady, offlineReady } = usePwa()
  const cloud = useAuth((s) => !!s.companies.find((c) => c.id === s.currentCompanyId)?.cloudCompanyId)
  const [hideReady, setHideReady] = useState(false)
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => setHideReady(true), 8000)
    return () => clearTimeout(timer)
  }, [offlineReady])

  if (!online) {
    return (
      <div role="status" className="no-print flex items-center gap-2 px-4 lg:px-6 py-2 text-sm bg-slate-800 text-slate-100">
        <WifiOff size={15} className="flex-shrink-0" />
        <span>
          {t("You're offline. You can keep working — everything is saved on this device.")}
          {cloud && ' ' + t('Changes will sync when you are back online.')}
        </span>
      </div>
    )
  }
  if (updateReady) {
    return (
      <div role="status" className="no-print flex items-center gap-2 px-4 lg:px-6 py-2 text-sm bg-brand-700 text-white">
        <Sparkles size={15} className="flex-shrink-0" />
        <span className="flex-1">{t('A new version of the app is ready.')}</span>
        <button onClick={applyUpdate} className="font-semibold underline underline-offset-2 hover:no-underline">{t('Update now')}</button>
      </div>
    )
  }
  if (offlineReady && !hideReady) {
    return (
      <div role="status" className="no-print flex items-center gap-2 px-4 lg:px-6 py-2 text-sm bg-success-700 text-white">
        <CheckCircle2 size={15} className="flex-shrink-0" />
        <span className="flex-1">{t('The app is saved on this device and now works without internet.')}</span>
        <button onClick={() => setHideReady(true)} aria-label={t('Dismiss')}><X size={14} /></button>
      </div>
    )
  }
  return null
}
