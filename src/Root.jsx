import { useEffect } from 'react'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { useAuth } from './auth'
import { useI18n } from './i18n'
import App from './App'
import AuthScreen from './components/AuthScreen'
import CompanyScreen from './components/CompanyScreen'

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

  if (!currentUserId) return <AuthScreen />
  if (!currentCompanyId) return <CompanyScreen />

  return (
    <Router {...routerProps}>
      <App />
    </Router>
  )
}
