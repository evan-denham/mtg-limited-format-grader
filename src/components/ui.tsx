/** Shared primitives. Minimal surface, neutral copy, no decoration.
 *
 *  Every interactive element must be visibly distinct in four states: rest,
 *  hover, pressed, and disabled. Buttons sit on --color-raised so they read as
 *  raised against the panel behind them rather than dissolving into it.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Button({
  variant = 'default',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  loading?: boolean
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded border px-3 py-2 text-sm ' +
    'transition-all duration-100 select-none ' +
    'active:translate-y-px ' +
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 ' +
    'disabled:hover:bg-raised disabled:hover:border-edge'

  const variants = {
    default:
      'bg-raised border-edge text-text hover:bg-raised-hover hover:border-edge-strong ' +
      'active:bg-panel',
    primary:
      'bg-accent border-accent text-black font-semibold hover:bg-accent-hover ' +
      'hover:border-accent-hover active:brightness-90',
    ghost:
      'bg-transparent border-transparent text-muted hover:bg-raised hover:text-text ' +
      'active:bg-panel',
    danger:
      'bg-raised border-edge text-danger hover:bg-raised-hover hover:border-danger ' +
      'active:bg-panel',
  }

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      ) : null}
      {children}
    </button>
  )
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        'w-full rounded border border-edge bg-ink px-3 py-2 text-sm text-text ' +
        'transition-colors hover:border-edge-strong focus:border-accent ' +
        `placeholder:text-muted ${className}`
      }
      {...props}
    />
  )
}

export function Select({
  className = '',
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={
        'rounded border border-edge bg-raised px-3 py-2 text-sm text-text ' +
        `transition-colors hover:border-edge-strong hover:bg-raised-hover ${className}`
      }
      {...props}
    >
      {children}
    </select>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-edge bg-panel p-4 ${className}`}>{children}</div>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error'
  children: ReactNode
}) {
  const tones = {
    info: 'border-edge bg-raised text-muted',
    warn: 'border-warn/50 bg-warn/10 text-warn',
    error: 'border-danger/50 bg-danger/10 text-danger',
  }
  return <div className={`rounded border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-edge border-t-accent" />
      {label}
    </div>
  )
}

/** Full-panel loading state, for when a whole view is waiting. */
export function LoadingPanel({ label }: { label: string }) {
  return (
    <Panel className="flex items-center justify-center py-12">
      <Spinner label={label} />
    </Panel>
  )
}

/** Toggle group used for view switches. Selected option is unmistakable. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label?: string
}) {
  return (
    <div>
      {label ? (
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      ) : null}
      <div
        className="inline-flex overflow-hidden rounded border border-edge"
        role="group"
        aria-label={label}
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={
                'px-3 py-2 text-sm transition-colors ' +
                (active
                  ? 'bg-accent font-semibold text-black'
                  : 'bg-raised text-muted hover:bg-raised-hover hover:text-text')
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
