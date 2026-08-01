// Password strength.
//
// Supabase can check a password against HaveIBeenPwned's breach corpus, which
// is the single most effective rule there is — but only on a paid plan, and
// only for cloud accounts. This app's accounts are mostly local and never
// touch Supabase at all, so the check has to live here to protect anyone.
//
// The design follows NIST SP 800-63B rather than the older "one uppercase,
// one digit, one symbol" orthodoxy:
//
//   * **Length is the rule that matters.** Every extra character multiplies
//     the search space; a required symbol adds one predictable `!` to the end.
//   * **Screen against known-bad passwords.** We cannot ship the full breach
//     corpus — it is hundreds of megabytes — but the few hundred passwords
//     below cover what credential-stuffing attacks actually try first.
//   * **Reject patterns, not character classes.** `Password1!` satisfies every
//     classic composition rule and is worthless. `correct horse battery` fails
//     them all and is excellent.
//
// So composition is *advice*, never a gate. What blocks a save is: too short,
// a known-bad password, or a password that is essentially one repeated or
// sequential run.

/** Anything shorter than this cannot be saved. */
export const MIN_LENGTH = 10

/** Below this we still save, but say the password is weak. */
export const GOOD_LENGTH = 14

/**
 * The passwords credential-stuffing actually tries, plus the ones people
 * reach for when a form demands "a capital and a number".
 *
 * Compared case-insensitively and after stripping the trailing digits and
 * punctuation people add to satisfy a rule, so `Password1!` is caught by the
 * `password` entry rather than needing its own.
 */
const COMMON = new Set([
  'password', 'passwd', 'pass', 'p@ssword', 'p@ssw0rd', 'passw0rd',
  'welcome', 'letmein', 'admin', 'administrator', 'root', 'guest', 'user',
  'login', 'test', 'demo', 'sample', 'temp', 'changeme', 'secret',
  'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'batman', 'trustno', 'freedom', 'whatever',
  'starwars', 'master', 'shadow', 'ninja', 'access', 'jesus', 'michael',
  'jordan', 'harley', 'ranger', 'hunter', 'buster', 'soccer', 'hockey',
  'killer', 'george', 'andrew', 'charlie', 'thomas', 'robert', 'daniel',
  'summer', 'winter', 'spring', 'autumn', 'january', 'february', 'december',
  'company', 'business', 'accounting', 'accounts', 'finance', 'invoice',
  'erp', 'system', 'default', 'example', 'internet', 'computer', 'server',
  'abc', 'abcd', 'abcdef', 'abcdefg', 'aaa', 'ninja', 'pokemon', 'minecraft',
])

const num = (v) => Number(v) || 0

/** Leet-speak folded back, so `p4ssw0rd` reaches the `password` entry. */
function deleet(s) {
  return s.replace(/[04315$@!]/g, (c) => ({ 0: 'o', 4: 'a', 3: 'e', 1: 'i', 5: 's', $: 's', '@': 'a', '!': 'i' }[c] || c))
}

/**
 * Every reduction of a password that might land on a known-bad word.
 *
 * Order matters: leet-speak is folded *before* symbols are stripped, so the
 * `@` in `P@ssw0rd` becomes an `a` rather than being deleted — otherwise that
 * password reduces to `pssword` and slips past the `password` entry.
 */
function candidates(pw) {
  const lower = String(pw || '').toLowerCase()
  const out = new Set()
  const add = (s) => {
    const alnum = s.replace(/[^a-z0-9]/g, '')
    out.add(alnum)
    out.add(alnum.replace(/\d+$/, ''))    // password2024 → password
    out.add(alnum.replace(/\d+/g, ''))    // pass2024word → passward
  }
  add(lower)
  add(deleet(lower))
  return [...out].filter((s) => s.length >= 3)
}

export function isCommonPassword(pw) {
  return candidates(pw).some((c) => COMMON.has(c))
}

/** `aaaaaaaaaa` — one character, however long. */
export function isRepeated(pw) {
  const s = String(pw || '')
  if (s.length < 4) return false
  return new Set(s.toLowerCase()).size <= 2
}

/**
 * `1234567890`, `abcdefghij`, `qwertyuiop` — a straight run off the keyboard
 * or the alphabet. Long, and worthless.
 */
export function isSequential(pw) {
  const s = String(pw || '').toLowerCase()
  if (s.length < 6) return false

  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '01234567890']
  const inRun = (hay) => hay.includes(s) || [...hay].reverse().join('').includes(s)
  if (rows.some(inRun)) return true

  // Or a consistent step between every adjacent character: 13579, 97531.
  let step = null
  for (let i = 1; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (Math.abs(d) > 2) return false
    if (step === null) step = d
    else if (d !== step) return false
  }
  return step !== null && step !== 0
}

/** Which kinds of character appear. Advisory only — never a gate. */
export function classesIn(pw) {
  const s = String(pw || '')
  return {
    lower: /[a-z]/.test(s),
    upper: /[A-Z]/.test(s),
    digit: /\d/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s),
  }
}

export function classCount(pw) {
  return Object.values(classesIn(pw)).filter(Boolean).length
}

/**
 * Score a password out of 4, for the meter.
 *
 * Length dominates, because length is what actually costs an attacker time.
 * Variety nudges it, and any of the hard failures floors it at zero.
 */
export function scorePassword(pw) {
  const s = String(pw || '')
  if (!s) return 0
  if (s.length < MIN_LENGTH || isCommonPassword(s) || isRepeated(s) || isSequential(s)) return 0

  let score = 1
  if (s.length >= 12) score += 1
  if (s.length >= GOOD_LENGTH) score += 1
  if (s.length >= 20) score += 1              // a passphrase beats everything
  else if (classCount(s) >= 3) score += 1     // otherwise variety has to carry it

  return Math.min(4, score)
}

export const SCORE_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong']

export function scoreLabel(score) {
  return SCORE_LABELS[Math.max(0, Math.min(4, num(score)))]
}

/**
 * The gate.
 *
 * `ok` false means refuse the save, and `error` says why in a sentence a
 * person can act on — never a bare "password does not meet requirements",
 * which tells someone nothing about what to change.
 *
 * `warning` is advice on an otherwise-acceptable password. It never blocks.
 */
export function validatePassword(pw, { name = '', email = '' } = {}) {
  const s = String(pw || '')

  if (!s) return { ok: false, error: 'Please choose a password.' }

  if (s.length < MIN_LENGTH)
    return {
      ok: false,
      error: `Your password needs at least ${MIN_LENGTH} characters — this one has ${s.length}. A few ordinary words together is easier to remember than a short jumble, and much harder to guess.`,
    }

  if (isCommonPassword(s))
    return {
      ok: false,
      error: 'That is one of the first passwords an attacker tries. Please pick something else.',
    }

  if (isRepeated(s))
    return { ok: false, error: 'That password is the same character repeated. Please pick something else.' }

  if (isSequential(s))
    return {
      ok: false,
      error: 'That is a straight run across the keyboard, which is guessed almost immediately. Please pick something else.',
    }

  // Your own name or email address is public information.
  const bare = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  const who = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (local.length >= 4 && bare.includes(local))
    return { ok: false, error: 'Your password contains your email address. Anyone who knows it is most of the way in.' }
  if (who.length >= 4 && bare.includes(who))
    return { ok: false, error: 'Your password contains your name. Please pick something less guessable.' }

  const score = scorePassword(s)
  if (score <= 1)
    return {
      ok: true,
      score,
      warning: 'This password is on the weak side. Adding a couple more words would make it far harder to guess.',
    }

  return { ok: true, score }
}

/** Live feedback for the meter, without gating anything. */
export function passwordHint(pw) {
  const s = String(pw || '')
  if (!s) return ''
  if (s.length < MIN_LENGTH) return `${MIN_LENGTH - s.length} more character${MIN_LENGTH - s.length === 1 ? '' : 's'} needed`
  if (isCommonPassword(s)) return 'Too common — pick something else'
  if (isSequential(s)) return 'Too predictable — pick something else'
  if (isRepeated(s)) return 'Too repetitive — pick something else'
  if (s.length >= 20) return 'Excellent — length beats complexity'
  if (s.length < GOOD_LENGTH) return 'Another word or two would help'
  return 'Good password'
}
