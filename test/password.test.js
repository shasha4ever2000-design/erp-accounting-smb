import { describe, it, expect } from 'vitest'
import {
  MIN_LENGTH, GOOD_LENGTH, isCommonPassword, isRepeated, isSequential,
  classesIn, classCount, scorePassword, scoreLabel, validatePassword, passwordHint,
} from '../src/utils/password.js'

describe('isCommonPassword', () => {
  it('catches the passwords stuffing attacks try first', () => {
    expect(isCommonPassword('password')).toBe(true)
    expect(isCommonPassword('qwerty')).toBe(true)
    expect(isCommonPassword('letmein')).toBe(true)
    expect(isCommonPassword('admin')).toBe(true)
  })

  it('sees through the decoration people add to satisfy a rule', () => {
    // Password1! passes every classic composition rule and is worthless.
    expect(isCommonPassword('Password1!')).toBe(true)
    expect(isCommonPassword('password123')).toBe(true)
    expect(isCommonPassword('Welcome2024')).toBe(true)
    expect(isCommonPassword('admin!!!')).toBe(true)
  })

  it('sees through leet-speak', () => {
    expect(isCommonPassword('p4ssw0rd')).toBe(true)
    expect(isCommonPassword('P@ssw0rd')).toBe(true)
  })

  it('catches words specific to this app, which are the obvious guesses here', () => {
    expect(isCommonPassword('accounting')).toBe(true)
    expect(isCommonPassword('invoice2026')).toBe(true)
  })

  it('leaves a genuine passphrase alone', () => {
    expect(isCommonPassword('correct horse battery staple')).toBe(false)
    expect(isCommonPassword('rusty kettle marmalade')).toBe(false)
  })

  it('says nothing about an empty password', () => {
    expect(isCommonPassword('')).toBe(false)
    expect(isCommonPassword(null)).toBe(false)
  })
})

describe('isRepeated', () => {
  it('catches one character however long', () => {
    expect(isRepeated('aaaaaaaaaaaa')).toBe(true)
    expect(isRepeated('ababababab')).toBe(true)      // two characters is no better
  })
  it('leaves a varied password alone', () => {
    expect(isRepeated('rusty kettle marmalade')).toBe(false)
  })
  it('ignores something too short to judge', () => {
    expect(isRepeated('aa')).toBe(false)
  })
})

describe('isSequential', () => {
  it('catches a run off the keyboard', () => {
    expect(isSequential('qwertyuiop')).toBe(true)
    expect(isSequential('asdfghjkl')).toBe(true)
  })
  it('catches a run through the alphabet or the digits', () => {
    expect(isSequential('abcdefghij')).toBe(true)
    expect(isSequential('1234567890')).toBe(true)
  })
  it('catches it backwards too', () => {
    expect(isSequential('0987654321')).toBe(true)
  })
  it('catches a consistent step', () => {
    expect(isSequential('13579')).toBe(false)        // too short to judge
    expect(isSequential('1357911')).toBe(false)      // step breaks
    expect(isSequential('acegik')).toBe(true)        // every step is 2
  })
  it('leaves real text alone', () => {
    expect(isSequential('rusty kettle marmalade')).toBe(false)
    expect(isSequential('Tr0ub4dor&3')).toBe(false)
  })
})

describe('character classes are advisory', () => {
  it('reports what is present', () => {
    expect(classesIn('aB3!')).toEqual({ lower: true, upper: true, digit: true, symbol: true })
    expect(classCount('aB3!')).toBe(4)
    expect(classCount('abcdef')).toBe(1)
  })

  it('never blocks a save on its own', () => {
    // All lowercase, no digits, no symbols — and far better than Password1!.
    const r = validatePassword('rusty kettle marmalade jar')
    expect(r.ok).toBe(true)
    expect(classCount('rusty kettle marmalade jar')).toBe(2)   // letters + space
  })
})

describe('scorePassword', () => {
  it('floors anything that fails a hard rule', () => {
    expect(scorePassword('Password1!')).toBe(0)
    expect(scorePassword('short')).toBe(0)
    expect(scorePassword('aaaaaaaaaaaa')).toBe(0)
    expect(scorePassword('qwertyuiop')).toBe(0)
  })

  it('rewards length above all', () => {
    // A long passphrase of one character class beats a short varied jumble.
    expect(scorePassword('rusty kettle marmalade jar')).toBeGreaterThan(scorePassword('aB3!xY7@q'))
  })

  it('climbs with length', () => {
    const a = scorePassword('kettle two9')
    const b = scorePassword('kettle marmalade9')
    const c = scorePassword('rusty kettle marmalade jar9')
    expect(a).toBeLessThanOrEqual(b)
    expect(b).toBeLessThanOrEqual(c)
    expect(c).toBe(4)
  })

  it('gives nothing for nothing', () => {
    expect(scorePassword('')).toBe(0)
    expect(scorePassword(null)).toBe(0)
  })

  it('labels every score', () => {
    expect(scoreLabel(0)).toBe('Too weak')
    expect(scoreLabel(4)).toBe('Strong')
    expect(scoreLabel(99)).toBe('Strong')      // clamped, never undefined
    expect(scoreLabel(-1)).toBe('Too weak')
  })
})

describe('validatePassword — the gate', () => {
  it('accepts a decent passphrase', () => {
    const r = validatePassword('rusty kettle marmalade')
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
  })

  it('refuses anything under the minimum, and says by how much', () => {
    const r = validatePassword('pass1234')
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(MIN_LENGTH))
    expect(r.error).toContain('8')             // names the actual length
  })

  it('refuses the password my own test account used', () => {
    // It sailed through the old eight-character rule.
    expect(validatePassword('pass1234').ok).toBe(false)
  })

  it('refuses a common password even when it is long enough', () => {
    const r = validatePassword('Password1!23')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/first passwords an attacker tries/)
  })

  it('refuses a keyboard run', () => {
    expect(validatePassword('qwertyuiop').ok).toBe(false)
  })

  it('refuses a repeated character', () => {
    expect(validatePassword('aaaaaaaaaaaaaa').ok).toBe(false)
  })

  it('refuses a password containing the email address', () => {
    // Public information, so it is most of the way to a guess.
    const r = validatePassword('layla2026kettle', { email: 'layla@example.com' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/email address/)
  })

  it('refuses a password containing the person name', () => {
    const r = validatePassword('saraalamin99x', { name: 'Sara Al-Amin' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/your name/)
  })

  it('does not trip on a short email local part appearing by chance', () => {
    // "jo" is too short to be meaningful; refusing here would be noise.
    expect(validatePassword('rusty kettle jo marmalade', { email: 'jo@example.com' }).ok).toBe(true)
  })

  it('warns without blocking on a thin but legal password', () => {
    const r = validatePassword('kettle9jar')
    expect(r.ok).toBe(true)
    expect(r.warning).toBeTruthy()
  })

  it('asks for a password when given none', () => {
    expect(validatePassword('').error).toMatch(/choose a password/)
    expect(validatePassword(null).ok).toBe(false)
  })

  it('explains itself in a sentence a person can act on', () => {
    // Never a bare "does not meet requirements".
    const r = validatePassword('abc')
    expect(r.error.length).toBeGreaterThan(30)
    expect(r.error).not.toMatch(/requirements/i)
  })
})

describe('passwordHint', () => {
  it('counts down the characters still needed', () => {
    expect(passwordHint('abc')).toMatch(/7 more characters/)
    expect(passwordHint('abcdefghi')).toMatch(/1 more character\b/)   // singular
  })
  it('names the specific problem', () => {
    expect(passwordHint('Password1!')).toMatch(/Too common/)
    // qwertyuiop is on the common list too, and "Too common" wins there —
    // so use a run that is only ever caught by the sequential check.
    expect(passwordHint('abcdefghijk')).toMatch(/Too predictable/)
    expect(passwordHint('aaaaaaaaaaaa')).toMatch(/Too repetitive/)
  })
  it('encourages a long passphrase', () => {
    expect(passwordHint('rusty kettle marmalade jar')).toMatch(/Excellent/)
  })
  it('says nothing about an empty box', () => {
    expect(passwordHint('')).toBe('')
  })
})

describe('the thresholds themselves', () => {
  it('sets a floor well above the old eight characters', () => {
    expect(MIN_LENGTH).toBeGreaterThan(8)
  })
  it('aims higher than it demands', () => {
    expect(GOOD_LENGTH).toBeGreaterThan(MIN_LENGTH)
  })
})
