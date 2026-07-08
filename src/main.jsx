import './boot' // MUST run before the store is imported (data isolation / migration)
import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root'
import ErrorBoundary from './components/ErrorBoundary'
import { installDialogTranslation } from './i18n'
import './index.css'

installDialogTranslation()

const isDesktop = !!(window.erpDesktop && window.erpDesktop.isDesktop) ||
  window.location.protocol === 'file:' || window.location.protocol === 'app:'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)

// Register service worker for the offline / installable web edition (not in the native app)
if (!isDesktop && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/erp-accounting-smb/sw.js').catch(() => {})
  })
}
