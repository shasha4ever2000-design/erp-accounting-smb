import { describe, it, expect } from 'vitest'
import {
  targetDimensions, validateImageFile, dataUrlBytes, formatBytes,
  MAX_EDGE, THUMB_EDGE, MAX_SOURCE_BYTES, ACCEPTED_TYPES,
} from '../src/utils/itemImages.js'

describe('targetDimensions — what keeps storage survivable', () => {
  it('shrinks a phone photo to the maximum edge, keeping its shape', () => {
    // A typical 12 MP portrait shot.
    const { width, height } = targetDimensions(3024, 4032, MAX_EDGE)
    expect(height).toBe(MAX_EDGE)
    expect(width).toBe(768)                       // 3024/4032 × 1024
    expect(width / height).toBeCloseTo(3024 / 4032, 3)
  })

  it('caps by the longer edge whichever way round the picture is', () => {
    expect(targetDimensions(4032, 3024, MAX_EDGE)).toEqual({ width: 1024, height: 768 })
  })

  it('never scales a small image up — that adds bytes and no clarity', () => {
    expect(targetDimensions(90, 60, MAX_EDGE)).toEqual({ width: 90, height: 60 })
  })

  it('leaves an image exactly at the limit alone', () => {
    expect(targetDimensions(1024, 500, MAX_EDGE)).toEqual({ width: 1024, height: 500 })
  })

  it('makes a much smaller thumbnail from the same source', () => {
    const thumb = targetDimensions(3024, 4032, THUMB_EDGE)
    expect(thumb.height).toBe(THUMB_EDGE)
    expect(thumb.width).toBe(120)
  })

  it('never collapses a very wide image to zero pixels', () => {
    const { width, height } = targetDimensions(5000, 3, MAX_EDGE)
    expect(width).toBe(1024)
    expect(height).toBeGreaterThanOrEqual(1)
  })

  it('returns nothing usable for a degenerate size rather than dividing by zero', () => {
    expect(targetDimensions(0, 100)).toEqual({ width: 0, height: 0 })
    expect(targetDimensions(undefined, undefined)).toEqual({ width: 0, height: 0 })
  })

  it('shrinks by a lot — which is the entire point', () => {
    // 12 MP down to under 0.8 MP: roughly a fifteenth of the pixels, so a
    // 4 MB photo lands in the low tens of KB once JPEG-encoded.
    const before = 3024 * 4032
    const { width, height } = targetDimensions(3024, 4032, MAX_EDGE)
    expect((width * height) / before).toBeLessThan(0.08)
  })
})

describe('validateImageFile', () => {
  const file = (type, size) => ({ type, size, name: 'x' })

  it('accepts the ordinary photo formats', () => {
    ACCEPTED_TYPES.forEach((t) => expect(validateImageFile(file(t, 1000)).ok, t).toBe(true))
  })

  it('refuses something that is not an image', () => {
    const r = validateImageFile(file('application/pdf', 1000))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/not an image/)
  })

  it('refuses a file too large to be worth decoding', () => {
    expect(validateImageFile(file('image/jpeg', MAX_SOURCE_BYTES + 1)).ok).toBe(false)
  })

  it('accepts one right on the limit', () => {
    expect(validateImageFile(file('image/jpeg', MAX_SOURCE_BYTES)).ok).toBe(true)
  })

  it('is case-insensitive about the type', () => {
    expect(validateImageFile(file('IMAGE/JPEG', 100)).ok).toBe(true)
  })

  it('refuses nothing at all', () => {
    expect(validateImageFile(null).ok).toBe(false)
  })
})

describe('dataUrlBytes', () => {
  it('measures the decoded size, not the base64 length', () => {
    // "hello" is 5 bytes, 8 base64 characters.
    expect(dataUrlBytes('data:image/jpeg;base64,aGVsbG8=')).toBe(5)
  })

  it('accounts for padding', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,aGVsbG8h')).toBe(6)   // "hello!"
    expect(dataUrlBytes('data:image/jpeg;base64,YQ==')).toBe(1)       // "a"
  })

  it('is zero for anything that is not a data URL', () => {
    expect(dataUrlBytes('')).toBe(0)
    expect(dataUrlBytes(null)).toBe(0)
    expect(dataUrlBytes('https://example.com/a.jpg')).toBe(0)
  })
})

describe('formatBytes', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
  it('copes with nothing', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(null)).toBe('0 B')
  })
})
