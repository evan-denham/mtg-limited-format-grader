/** The 13-button grade row.
 *
 *  The selected grade must be readable at a glance from across a table, so it
 *  gets a solid accent fill plus a ring rather than only a border change.
 */

import { GRADE_SCALE, type GradeLetter } from '../domain/grades'

export function GradeScale({
  value,
  onChange,
  size = 'normal',
  label,
}: {
  value: GradeLetter | null
  onChange: (g: GradeLetter) => void
  size?: 'normal' | 'small'
  label?: string
}) {
  const pad = size === 'small' ? 'px-2 py-1.5 text-xs' : 'px-2 py-2.5 text-base'

  return (
    <div>
      {label ? (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
          <span className="font-mono text-sm text-muted">{value ?? 'Not graded'}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label ?? 'Grade'}>
        {GRADE_SCALE.map((g) => {
          const active = value === g
          return (
            <button
              key={g}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(g)}
              className={
                `min-w-11 flex-1 rounded border font-mono transition-all duration-100 ${pad} ` +
                'active:translate-y-px ' +
                (active
                  ? 'z-10 border-accent bg-accent font-bold text-black ring-2 ring-accent/40'
                  : 'border-edge bg-raised text-text hover:border-edge-strong hover:bg-raised-hover')
              }
            >
              {g}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Read-only rendering of a grade, for results views. */
export function GradeBadge({
  grade,
  size = 'normal',
}: {
  grade: GradeLetter | null
  size?: 'normal' | 'large'
}) {
  if (!grade) {
    return (
      <span
        className={
          'inline-flex items-center justify-center rounded border border-dashed border-edge ' +
          'font-mono text-muted ' +
          (size === 'large' ? 'min-w-14 px-3 py-1 text-xl' : 'min-w-9 px-2 py-0.5 text-sm')
        }
      >
        &mdash;
      </span>
    )
  }
  return (
    <span
      className={
        'inline-flex items-center justify-center rounded bg-accent font-mono font-bold text-black ' +
        (size === 'large' ? 'min-w-14 px-3 py-1 text-xl' : 'min-w-9 px-2 py-0.5 text-sm')
      }
    >
      {grade}
    </span>
  )
}
