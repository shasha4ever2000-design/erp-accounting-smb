import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { useAuth } from './auth'
import { useStore } from './store'
import { useI18n, dictionaryReady } from './i18n'
import App from './App'
import AuthScreen from './components/AuthScreen'
import CompanyScreen from './components/CompanyScreen'
import { portalTokenFromLocation } from './utils/portal'

// A customer opening their portal link: no sign-in, no company data on this
// device, just their own account fetched from the server.
const Portal = lazy(() => import('./pages/Portal'))
const portalToken = typeof window !== 'undefined' ? portalTokenFromLocation() : ''

const isDesktop = !!(typeof window !== 'undefined' && window.erpDesktop && window.erpDesktop.isDesktop) ||
  (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.protocol === 'app:'))
const Router = isDesktop ? HashRouter : BrowserRouter
const routerProps = isDesktop ? {} : { basename: '/erp-accounting-smb' }

export default function Root() {
  const currentUserId = useAuth((s) => s.currentUserId)
  const currentCompanyId = useAuth((s) => s.currentCompanyId)
  const lang = useI18n((s) => s.lang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  }, [lang])

  // An Arabic user waits the moment it takes the dictionary to arrive rather
  // than seeing the app flash up in English first.
  useI18n((s) => s.dictVersion)
  if (!dictionaryReady()) return null

  if (portalToken) return <Suspense fallback={null}><Portal token={portalToken} /></Suspense>
  if (!currentUserId) return <AuthScreen />
  if (!currentCompanyId) return <CompanyScreen />

  // The main data store now persists to IndexedDB (async), so wait for it to
  // finish hydrating before mounting the app — otherwise the first paint would
  // flash empty data, and an early write could clobber the real snapshot.
  return <HydratedApp />
}

function HydratedApp() {
  const [hydrated, setHydrated] = useState(() => useStore.persist.hasHydrated())

  useEffect(() => {
    if (hydrated) return
    const unsub = useStore.persist.onFinishHydration(() => setHydrated(true))
    if (useStore.persist.hasHydrated()) setHydrated(true)
    return unsub
  }, [hydrated])

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="h-9 w-9 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-brand-500 animate-spin" />
      </div>
    )
  }

  return (
    <Router {...routerProps}>
      <App />
    </Router>
  )
}
