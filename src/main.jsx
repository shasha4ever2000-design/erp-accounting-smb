import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// In the desktop (Electron) build the app is served from a local custom scheme,
// so use hash routing with no base path. On the web (GitHub Pages) use clean
// URLs under the project base path.
const isDesktop = !!(window.erpDesktop && window.erpDesktop.isDesktop) ||
  window.location.protocol === 'file:' || window.location.protocol === 'app:'
const Router = isDesktop ? HashRouter : BrowserRouter
const routerProps = isDesktop ? {} : { basename: '/erp-accounting-smb' }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router {...routerProps}>
      <App />
    </Router>
  </React.StrictMode>
)

// Register service worker for the offline / installable web edition (not in the native app)
if (!isDesktop && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/erp-accounting-smb/sw.js').catch(() => {})
  })
}
