// Sharing a statement of account by email or WhatsApp.
//
// Pure string/URL building so it is unit-testable — the caller does the actual
// window.open(). Chasing receivables is the daily SMB task, so the goal is one
// click from "I'm looking at this balance" to "the customer has it in writing".

// Dial codes for the tax regions the app ships presets for (utils/taxRegions.js),
// so a local number like 0501234567 can be turned into a WhatsApp-usable
// international number without asking the user to re-enter anything.
const DIAL_CODES = {
  SA: '966', AE: '971', BH: '973', EG: '20', JO: '962', GB: '44', IE: '353',
  DE: '49', FR: '33', ES: '34', IN: '91', AU: '61', SG: '65', ZA: '27',
  CA: '1', US: '1',
}

// Currency → region, used only as a fallback when no tax region has been
// configured yet. A company billing in SAR is overwhelmingly likely to be
// dialling Saudi numbers, and guessing here beats emitting a WhatsApp link
// that silently fails on a local-format number.
const CURRENCY_REGION = {
  SAR: 'SA', AED: 'AE', BHD: 'BH', EGP: 'EG', JOD: 'JO',
  GBP: 'GB', INR: 'IN', AUD: 'AU', CAD: 'CA', USD: 'US',
}

export const dialCodeFor = (countryId) => DIAL_CODES[countryId] || ''

/** Best-effort region: the configured tax country, else inferred from currency. */
export const resolveRegion = (taxCountry, currency) =>
  (taxCountry && DIAL_CODES[taxCountry] ? taxCountry : CURRENCY_REGION[currency]) || ''

/**
 * Normalise a phone number for a wa.me link (digits only, international form).
 * Returns '' when there is nothing usable, so callers can hide the button.
 */
export function normalisePhone(raw, countryId) {
  if (!raw) return ''
  let s = String(raw).trim()
  const hadPlus = s.startsWith('+') || s.startsWith('00')
  s = s.replace(/\D/g, '')
  if (!s) return ''
  if (hadPlus) return s.replace(/^00/, '')       // already international
  const dial = dialCodeFor(countryId)
  if (!dial) return s                            // unknown region — use as typed
  if (s.startsWith(dial)) return s               // already carries the dial code
  return dial + s.replace(/^0+/, '')             // local form: drop trunk zero
}

/**
 * Build the plain-text message body accompanying a statement.
 * @param opts { entityName, companyName, startDate, endDate, closing, currencySymbol,
 *               isCustomer, bankDetails, fmtMoney, fmtDate, t }
 */
export function buildStatementMessage(opts) {
  const {
    entityName, companyName, startDate, endDate, closing,
    isCustomer = true, bankDetails, money = (v) => String(v), date = (d) => String(d),
    t = (s) => s,
  } = opts
  const lines = []
  lines.push(`${t('Dear')} ${entityName},`)
  lines.push('')
  lines.push(
    isCustomer
      ? `${t('Please find your statement of account from')} ${companyName} ${t('for the period')} ${date(startDate)} — ${date(endDate)}.`
      : `${t('Please find our statement of account with')} ${companyName} ${t('for the period')} ${date(startDate)} — ${date(endDate)}.`
  )
  lines.push('')

  // Only frame it as "due" when money is actually owed; a zero or credit
  // balance should never read like a demand for payment.
  if (closing > 0.009) {
    lines.push(`${isCustomer ? t('Balance due') : t('Balance payable')}: ${money(closing)}`)
  } else if (closing < -0.009) {
    lines.push(`${t('Credit balance')}: ${money(Math.abs(closing))}`)
  } else {
    lines.push(t('Your account is fully settled — thank you.'))
  }
  lines.push('')

  if (isCustomer && closing > 0.009 && bankDetails) {
    lines.push(`${t('Payment details')}:`)
    lines.push(bankDetails)
    lines.push('')
  }
  lines.push(`${t('Regards')},`)
  lines.push(companyName)
  return lines.join('\n')
}

/** mailto: link for the statement. */
export function mailtoLink({ email, subject, body }) {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return `mailto:${encodeURIComponent(email || '')}?${q}`
}

/** wa.me link. Without a usable phone it still opens WhatsApp with the text. */
export function whatsappLink({ phone, body, countryId }) {
  const num = normalisePhone(phone, countryId)
  return `https://wa.me/${num}?text=${encodeURIComponent(body)}`
}
