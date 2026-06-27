// Runs FIRST (before the main store is created) so multi-company data is
// isolated correctly and legacy single-company data is never lost.

const AUTH_KEY = 'erp-auth'
const LEGACY_KEY = 'erp-v1'

export function currentCompanyKey() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}')
    const id = auth?.state?.currentCompanyId
    return `erp-co-${id || '__none__'}`
  } catch {
    return 'erp-co-__none__'
  }
}

;(function bootstrap() {
  try {
    if (localStorage.getItem(AUTH_KEY)) return // already initialised

    let companies = []
    let currentCompanyId = null

    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      // Migrate the existing single-company dataset into a "default" company.
      if (!localStorage.getItem('erp-co-default')) {
        localStorage.setItem('erp-co-default', legacy)
      }
      let name = 'My Company'
      try { name = JSON.parse(legacy)?.state?.settings?.company?.name || name } catch { /* ignore */ }
      companies = [{ id: 'default', name, createdAt: new Date().toISOString() }]
      currentCompanyId = 'default'
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
      state: { users: [], currentUserId: null, companies, currentCompanyId },
      version: 1,
    }))
  } catch (e) {
    console.warn('ERP bootstrap failed (continuing):', e)
  }
})()
