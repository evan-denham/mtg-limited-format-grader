/** Shared primitives. Minimal surface, neutral copy, no decoration. */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm ' +
    'transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const variants = {
    default: 'bg-[--color-panel] border border-[--color-edge] hover:border-[--color-muted]',
    primary: 'bg-[--color-accent] text-black font-medium hover:brightness-110',
    ghost: 'hover:bg-[--color-panel]',
    danger: 'bg-[--color-panel] border border-[#5a2b2b] text-[#e0a0a0] hover:border-[#7a3b3b]',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        'w-full rounded border border-[--color-edge] bg-[--color-ink] px-3 py-2 text-sm ' +
        `placeholder:text-[--color-muted] ${className}`
      }
      {...props}
    />
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
      <span className="mb-1 block text-xs uppercase tracking-wide text-[--color-muted]">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[--color-muted]">{hint}</span> : null}
    </label>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded border border-[--color-edge] bg-[--color-panel] p-4 ${className}`}
    >
      {children}
    </div>
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
    info: 'border-[--color-edge] text-[--color-muted]',
    warn: 'border-[#5a4a2b] text-[#d8bd82]',
    error: 'border-[#5a2b2b] text-[#e0a0a0]',
  }
  return (
    <div className={`rounded border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-[--color-muted]">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[--color-edge] border-t-[--color-accent]" />
      {label}
    </div>
  )
}
