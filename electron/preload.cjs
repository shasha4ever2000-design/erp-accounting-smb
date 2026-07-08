// Preload runs in an isolated context before the page loads.
// The ERP app is fully self-contained (localStorage), so no bridge APIs are
// required here — this file exists to keep contextIsolation enabled safely.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('erpDesktop', {
  isDesktop: true,
  platform: process.platform,
})
