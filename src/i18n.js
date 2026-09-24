import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Arabic translations are in src/locales/ar.js and load on demand — see
// loadArabic below. Until they arrive t() returns English, and Root holds the
// first paint for Arabic users so they never see that.
let AR = null
let loading = null

/** Load the Arabic dictionary once. Resolves when it is ready. */
export function loadArabic() {
  if (AR) return Promise.resolve(AR)
  if (!loading) {
    loading = import('./locales/ar.js').then((m) => {
      AR = m.default
      useI18n.setState((s) => ({ dictVersion: s.dictVersion + 1 }))
      return AR
    })
  }
  return loading
}

/** Whether the dictionary for the current language is in memory. */
export const dictionaryReady = () => useI18n.getState().lang !== 'ar' || !!AR

export const useI18n = create(
  persist(
    (set) => ({
      lang: 'en',
      numerals: 'latin', // 'latin' (0-9) or 'arabic' (٠-٩)
      dictVersion: 0,    // bumps when a dictionary finishes loading
      setLang: (lang) => { if (lang === 'ar') loadArabic(); set({ lang }) },
      toggle: () => set((s) => {
        const lang = s.lang === 'ar' ? 'en' : 'ar'
        if (lang === 'ar') loadArabic()
        return { lang }
      }),
      setNumerals: (numerals) => set({ numerals }),
    }),
    { name: 'erp-lang', version: 1, partialize: (s) => ({ lang: s.lang, numerals: s.numerals }) }
  )
)

// Arabic was the last choice: start fetching the dictionary straight away.
if (useI18n.getState().lang === 'ar') loadArabic()

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

// Convert digits in a string to the active numeral system (display only —
// never used for CSV/data export, which stay Latin for spreadsheet compatibility).
export function localizeDigits(str) {
  if (str == null) return str
  const s = String(str)
  const system = useI18n.getState().numerals
  if (system === 'arabic') return s.replace(/[0-9]/g, (d) => ARABIC_DIGITS[+d])
  // Default / latin: normalize any Arabic-Indic digits back to Latin.
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
}

export function useT() {
  const lang = useI18n((s) => s.lang)
  // Subscribe to numerals too so changing the numeral system re-renders
  // components (which call fmtMoney/fmtDate during render).
  useI18n((s) => s.numerals)
  // ...and to the dictionary arriving.
  useI18n((s) => s.dictVersion)
  return (s) => (lang === 'ar' && AR && AR[s]) ? AR[s] : s
}

// Non-hook translator — usable outside React (e.g. wrapped alert/confirm).
export function tr(s) {
  if (typeof s !== 'string') return s
  const lang = useI18n.getState().lang
  return (lang === 'ar' && AR && AR[s]) ? AR[s] : s
}

// Globally translate native alert/confirm messages through the dictionary so
// validation/confirmation prompts respect the chosen language without touching
// every call site. Exact-match only — interpolated strings pass through as-is.
export function installDialogTranslation() {
  if (typeof window === 'undefined' || window.__erpDialogI18n) return
  window.__erpDialogI18n = true
  const _alert = window.alert.bind(window)
  const _confirm = window.confirm.bind(window)
  window.alert = (msg) => _alert(tr(msg))
  window.confirm = (msg) => _confirm(tr(msg))
}
