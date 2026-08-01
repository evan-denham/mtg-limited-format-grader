import { describe, expect, it } from 'vitest'
import {
  applyModifier,
  combine,
  GRADE_SCALE,
  gradeToNumber,
  isContentious,
  numberToGrade,
  stepGrade,
} from './grades'

describe('grade scale', () => {
  it('runs F to A+ across 13 steps', () => {
    expect(GRADE_SCALE).toHaveLength(13)
    expect(GRADE_SCALE[0]).toBe('F')
    expect(GRADE_SCALE[12]).toBe('A+')
  })

  it('round-trips every grade through its number', () => {
    for (const g of GRADE_SCALE) {
      expect(numberToGrade(gradeToNumber(g))).toBe(g)
    }
  })

  it('clamps out-of-range numbers to the ends instead of returning undefined', () => {
    expect(numberToGrade(-5)).toBe('F')
    expect(numberToGrade(99)).toBe('A+')
  })
})

describe('combine', () => {
  it('returns nulls when nobody has graded', () => {
    expect(combine([])).toEqual({ letter: null, mean: null, spread: 0, count: 0 })
    expect(combine([null, undefined])).toEqual({ letter: null, mean: null, spread: 0, count: 0 })
  })

  it('ignores ungraded entries rather than counting them as F', () => {
    // The bug this guards: treating a missing grade as 0 drags the mean down.
    expect(combine(['A', null, undefined])).toMatchObject({ letter: 'A', count: 1, spread: 0 })
  })

  it('averages and rounds to the nearest letter', () => {
    // B+ = 9, A- = 10 -> mean 9.5 -> half-up to index 10 = A-
    expect(combine(['B+', 'A-'])).toMatchObject({ letter: 'A-', mean: 9.5 })
    // C- = 4, C+ = 6 -> mean 5 -> C, exactly between with no rounding needed
    expect(combine(['C-', 'C+'])).toMatchObject({ letter: 'C', mean: 5 })
  })

  it('rounds exact halves upward, consistently', () => {
    // C = 5, A- = 10 -> mean 7.5 -> index 8 = B, not B- (index 7).
    expect(combine(['C', 'A-'])).toMatchObject({ letter: 'B', mean: 7.5 })
  })

  it('reports the spread in scale steps', () => {
    expect(combine(['F', 'A+']).spread).toBe(12)
    expect(combine(['B', 'B']).spread).toBe(0)
  })

  it('flags real disagreement but not near-agreement', () => {
    expect(isContentious(combine(['C', 'A-']))).toBe(true)
    expect(isContentious(combine(['B', 'B+']))).toBe(false)
  })

  it('never flags a single grader as contentious', () => {
    expect(isContentious(combine(['A+']))).toBe(false)
  })
})

describe('applyModifier', () => {
  it('builds modified grades', () => {
    expect(applyModifier('B', '+')).toBe('B+')
    expect(applyModifier('C', '-')).toBe('C-')
    expect(applyModifier('A', '')).toBe('A')
  })

  it('falls back to the base grade when the modifier is not on the scale', () => {
    // F- and F+ do not exist.
    expect(applyModifier('F', '-')).toBe('F')
    expect(applyModifier('F', '+')).toBe('F')
  })
})

describe('stepGrade', () => {
  it('moves along the scale and stops at the ends', () => {
    expect(stepGrade('B', 1)).toBe('B+')
    expect(stepGrade('B', -1)).toBe('B-')
    expect(stepGrade('A+', 1)).toBe('A+')
    expect(stepGrade('F', -1)).toBe('F')
  })
})
