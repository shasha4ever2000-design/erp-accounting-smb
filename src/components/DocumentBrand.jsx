import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'
import { resolveDocBrand } from '../utils/branding'
import { getBrandAsset, migrateLegacyLogo } from '../utils/brandAssets'

/**
 * Loads a brand asset, moving an older in-settings logo out of the store the
 * first time it is needed.
 *
 * The migration lives here rather than in the store's `migrate` because that
 * function is synchronous and IndexedDB is not. Doing it on first render means
 * it happens exactly once, on the first document anybody opens, and costs
 * nothing afterwards.
 */
export function useBrandAsset(kind) {
  const legacy = useStore((s) => s.settings.company?.logo)
  const clearLegacyLogo = useStore((s) => s.clearLegacyLogo)
  const [asset, setAsset] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      let row = await getBrandAsset(kind)
      if (!row && kind === 'logo' && legacy) {
        const moved = await migrateLegacyLogo(legacy)
        if (moved) {
          row = await getBrandAsset('logo')
          clearLegacyLogo?.()
        }
      }
      if (alive) setAsset(row)
    })()
    return () => { alive = false }
  }, [kind, legacy, clearLegacyLogo])

  return asset
}

/** The branding that applies to one document type. */
export function useDocBrand(docType) {
  const branding = useStore((s) => s.settings.branding)
  return resolveDocBrand(branding, docType)
}

/**
 * The top of a document: logo, company details, and the document's own title.
 *
 * `right` is whatever identifies the document — its number, dates, status.
 * The layouts differ in where the logo sits and whether the accent appears as
 * a rule or a solid band.
 */
export function DocumentHeader({ docType, title, right = null }) {
  const t = useT()
  const company = useStore((s) => s.settings.company)
  const zatca = useStore((s) => s.settings.zatca)
  const brand = useDocBrand(docType)
  const logo = useBrandAsset('logo')

  const Logo = () =>
    brand.showLogo && logo?.dataUrl ? (
      <img
        src={logo.dataUrl}
        alt={company.name}
        style={{ height: `${brand.logoHeight}px` }}
        className="w-auto object-contain"
      />
    ) : null

  const Details = ({ align = 'start' }) => (
    <div className={align === 'center' ? 'text-center' : ''}>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 tracking-tight">{company.name}</h1>
      {company.arabicName && <p className="text-lg font-bold text-gray-800 dark:text-slate-100" dir="rtl">{company.arabicName}</p>}
      {company.address && <p className="text-gray-500 dark:text-slate-400 text-sm mt-1 whitespace-pre-line">{company.address}</p>}
      {company.phone && <p className="text-gray-400 dark:text-slate-500 text-sm">{company.phone}</p>}
      {company.email && <p className="text-gray-400 dark:text-slate-500 text-sm">{company.email}</p>}
      {zatca?.enabled && zatca.vatNumber
        ? <p className="text-gray-400 dark:text-slate-500 text-sm">{t('VAT No.')} {zatca.vatNumber}</p>
        : company.taxId && <p className="text-gray-400 dark:text-slate-500 text-sm">{t('Tax ID')}: {company.taxId}</p>}
    </div>
  )

  const Title = () => (
    <p className="text-3xl font-black tracking-tight" style={{ color: brand.accentColor }}>
      {t(title)}
    </p>
  )

  if (brand.layout === 'banded') {
    return (
      <div className="mb-6 doc-brand">
        <div
          className="rounded-lg px-5 py-4 flex items-center justify-between gap-4 doc-band"
          style={{ background: brand.accentColor, color: brand.textOnAccent }}
        >
          <div className="flex items-center gap-4 min-w-0">
            <Logo />
            <div className="min-w-0">
              <p className="text-xl font-bold truncate">{company.name}</p>
              {company.arabicName && <p className="text-sm opacity-90 truncate" dir="rtl">{company.arabicName}</p>}
            </div>
          </div>
          <p className="text-2xl font-black tracking-tight flex-shrink-0">{t(title)}</p>
        </div>
        <div className="flex justify-between gap-6 mt-4 flex-wrap">
          <div className="text-sm text-gray-500 dark:text-slate-400">
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            {company.phone && <p>{company.phone}</p>}
            {company.email && <p>{company.email}</p>}
          </div>
          {right}
        </div>
        {brand.header && <p className="text-sm text-gray-600 dark:text-slate-300 mt-3">{brand.header}</p>}
      </div>
    )
  }

  if (brand.layout === 'centred') {
    return (
      <div className="mb-6 doc-brand text-center">
        <div className="flex flex-col items-center gap-3">
          <Logo />
          <Details align="center" />
        </div>
        <div className="h-1 rounded-full my-4" style={{ background: brand.accentColor }} />
        <div className="flex justify-between items-start gap-6 text-start flex-wrap">
          <Title />
          {right}
        </div>
        {brand.header && <p className="text-sm text-gray-600 dark:text-slate-300 mt-3 text-start">{brand.header}</p>}
      </div>
    )
  }

  // classic
  return (
    <div className="mb-6 doc-brand">
      <div className="flex justify-between items-start gap-6 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          <Logo />
          <Details />
        </div>
        <div className="text-end flex-shrink-0">
          <Title />
          {right}
        </div>
      </div>
      <div className="h-0.5 rounded-full mt-4" style={{ background: brand.accentColor }} />
      {brand.header && <p className="text-sm text-gray-600 dark:text-slate-300 mt-3">{brand.header}</p>}
    </div>
  )
}

/**
 * The foot of a document: bank details where money is expected, terms, a
 * signature block, and the shared footer line.
 */
export function DocumentFooter({ docType, bankDetails = '' }) {
  const t = useT()
  const brand = useDocBrand(docType)
  const signature = useBrandAsset('signature')

  const showBank = brand.showBank && String(bankDetails || '').trim()
  const nothing = !showBank && !brand.terms && !brand.footer && !brand.showSignature
  if (nothing) return null

  return (
    <div className="mt-8 doc-brand-footer">
      {(showBank || brand.terms) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-5 border-t border-gray-200 dark:border-surface-700">
          {showBank && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: brand.accentColor }}>
                {t('Payment details')}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-300 whitespace-pre-line">{bankDetails}</p>
            </div>
          )}
          {brand.terms && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: brand.accentColor }}>
                {t('Terms')}
              </p>
              <p className="text-sm text-gray-600 dark:text-slate-300 whitespace-pre-line">{brand.terms}</p>
            </div>
          )}
        </div>
      )}

      {brand.showSignature && (
        <div className="mt-8 flex justify-end">
          <div className="w-56 text-center">
            {signature?.dataUrl
              ? <img src={signature.dataUrl} alt="" className="h-16 w-auto mx-auto object-contain" />
              : <div className="h-16" />}
            <div className="border-t border-gray-400 dark:border-slate-500 pt-1.5">
              <p className="text-xs text-gray-500 dark:text-slate-400">{brand.signatureLabel}</p>
            </div>
          </div>
        </div>
      )}

      {brand.footer && (
        <p className="mt-6 pt-4 border-t border-gray-100 dark:border-surface-750 text-xs text-gray-400 dark:text-slate-500 text-center whitespace-pre-line">
          {brand.footer}
        </p>
      )}
    </div>
  )
}
