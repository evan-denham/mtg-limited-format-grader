/** The grade scale and the arithmetic for combining grades across graders. */

export const GRADE_SCALE = [
  'F',
  'D-',
  'D',
  'D+',
  'C-',
  'C',
  'C+',
  'B-',
  'B',
  'B+',
  'A-',
  'A',
  'A+',
] as const

export type GradeLetter = (typeof GRADE_SCALE)[number]

/** F=0 .. A+=12. The index IS the numeric value; keep them in sync. */
export function gradeToNumber(g: GradeLetter): number {
  return GRADE_SCALE.indexOf(g)
}

export function numberToGrade(n: number): GradeLetter {
  const i = Math.round(n)
  return GRADE_SCALE[Math.min(GRADE_SCALE.length - 1, Math.max(0, i))]
}

export function isGradeLetter(v: unknown): v is GradeLetter {
  return typeof v === 'string' && (GRADE_SCALE as readonly string[]).includes(v)
}

/** Base letter plus modifier, for keyboard entry: 'B' + '+' -> 'B+'. */
export function applyModifier(base: 'F' | 'D' | 'C' | 'B' | 'A', mod: '-' | '' | '+'): GradeLetter {
  // F has no modifiers; A+ exists but A- and A do too. F- and F+ are not on the scale.
  if (base === 'F') return 'F'
  const candidate = `${base}${mod}` as string
  return isGradeLetter(candidate) ? candidate : (base as GradeLetter)
}

export function stepGrade(g: GradeLetter, delta: number): GradeLetter {
  return numberToGrade(gradeToNumber(g) + delta)
}

export interface Combined {
  /** Rounded consensus letter, or null when nobody has graded it. */
  letter: GradeLetter | null
  /** Raw mean on the 0-12 scale, or null when ungraded. */
  mean: number | null
  /** max - min in scale steps. 0 when one or zero graders. */
  spread: number
  /** How many graders supplied a grade. */
  count: number
}

const EMPTY: Combined = { letter: null, mean: null, spread: 0, count: 0 }

/** Mean of the supplied grades, ignoring nulls. Returns EMPTY when none. */
export function combine(grades: readonly (GradeLetter | null | undefined)[]): Combined {
  const nums = grades.filter(isGradeLetter).map(gradeToNumber)
  if (nums.length === 0) return EMPTY
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  return {
    letter: numberToGrade(mean),
    mean,
    spread: Math.max(...nums) - Math.min(...nums),
    count: nums.length,
  }
}

/** Graders disagreeing by this many steps or more is worth surfacing. */
export const DISAGREEMENT_THRESHOLD = 3

export function isContentious(c: Combined): boolean {
  return c.count > 1 && c.spread >= DISAGREEMENT_THRESHOLD
}
