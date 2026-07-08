// Convert a currency amount to English words (e.g. invoices commonly require this).
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion']

function threeDigits(n) {
  let s = ''
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) s += ONES[h] + ' hundred' + (r ? ' ' : '')
  if (r < 20) s += ONES[r]
  else { s += TENS[Math.floor(r / 10)]; if (r % 10) s += '-' + ONES[r % 10] }
  return s.trim()
}

export function numberToWords(amount) {
  amount = Number(amount) || 0
  const neg = amount < 0
  amount = Math.abs(amount)
  let int = Math.floor(amount)
  const cents = Math.round((amount - int) * 100)
  if (int === 0) {
    const base = 'zero' + (cents ? ` and ${cents}/100` : '')
    return (neg ? 'minus ' : '') + base
  }
  const groups = []
  while (int > 0) { groups.push(int % 1000); int = Math.floor(int / 1000) }
  let words = ''
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue
    words += threeDigits(groups[i]) + (SCALES[i] ? ' ' + SCALES[i] : '') + ' '
  }
  words = words.trim()
  if (cents) words += ` and ${cents}/100`
  const out = (neg ? 'minus ' : '') + words
  return out.charAt(0).toUpperCase() + out.slice(1)
}
