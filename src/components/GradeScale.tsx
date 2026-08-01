/** The 13-button grade row. */

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
  const pad = size === 'small' ? 'px-2 py-1 text-xs' : 'px-2.5 py-2 text-sm'
  return (
    <div>
      {label ? (
        <div className="mb-1.5 text-xs uppercase tracking-wide text-[--color-muted]">{label}</div>
      ) : null}
      <div className="flex flex-wrap gap-1" role="group" aria-label={label ?? 'Grade'}>
        {GRADE_SCALE.map((g) => {
          const active = value === g
          return (
            <button
              key={g}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(g)}
              className={
                `min-w-10 flex-1 rounded border font-mono ${pad} transition-colors ` +
                (active
                  ? 'border-[--color-accent] bg-[--color-accent] font-semibold text-black'
                  : 'border-[--color-edge] bg-[--color-panel] hover:border-[--color-muted]')
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
