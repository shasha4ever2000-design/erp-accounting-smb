import './boot' // MUST run before the store is imported (data isolation / migration)
import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root'
import ErrorBoundary from './components/ErrorBoundary'
import { DialogHost } from './components/Dialogs'
import { installDialogTranslation } from './i18n'
import './index.css'
import { registerPwa } from './pwa'

installDialogTranslation()

const isDesktop = !!(window.erpDesktop && window.erpDesktop.isDesktop) ||
  window.location.protocol === 'file:' || window.location.protocol === 'app:'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
      <DialogHost />
    </ErrorBoundary>
  </React.StrictMode>
)

// Offline / installable web edition (not in the native app). See src/pwa.js.
registerPwa({ url: `${import.meta.env.BASE_URL}sw.js`, isDesktop })
