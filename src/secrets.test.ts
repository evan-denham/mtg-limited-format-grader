/** Guards against committing a real credential.
 *
 *  The repository is public. During development the admin password was once
 *  saved into the migration file that carries its placeholder, one `git add`
 *  away from being published. These tests fail the build in that situation,
 *  and `npm test` runs in the deploy workflow before anything ships.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

function read(relative: string): string {
  return readFileSync(new URL(relative, root), 'utf8')
}

describe('migration secrets', () => {
  it('the admin password migration still carries only a placeholder', () => {
    const sql = read('supabase/migrations/0004_admin_and_session_password.sql')
    const match = sql.match(/values\s*\(\s*'admin_password'\s*,\s*'([^']*)'\s*\)/i)

    expect(match, 'the admin_password insert should still be present').toBeTruthy()
    const value = match?.[1] ?? ''

    // A real password would not look like this.
    expect(
      value.startsWith('CHANGE-ME'),
      `admin_password in 0004 is "${value}". Set the real password in the Supabase ` +
        'SQL Editor, never in this tracked file.',
    ).toBe(true)
  })

  it('no migration contains an obvious hard-coded secret', () => {
    const dir = new URL('supabase/migrations/', root)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(new URL(file, dir), 'utf8')
      // service_role keys and Supabase JWTs both start with this.
      expect(sql.includes('eyJhbGciOi'), `${file} looks like it contains a JWT`).toBe(false)
      expect(/service_role\s*key/i.test(sql), `${file} mentions a service_role key`).toBe(false)
    }
  })
})

describe('environment files', () => {
  it('.env.example never holds real values', () => {
    const example = read('.env.example')
    for (const line of example.split(/\r?\n/)) {
      if (!line.startsWith('VITE_')) continue
      const value = line.slice(line.indexOf('=') + 1).trim()
      expect(value, `${line.split('=')[0]} should be blank in .env.example`).toBe('')
    }
  })

  it('.env.local is ignored by git', () => {
    const gitignore = read('.gitignore')
    expect(gitignore).toMatch(/^\.env\.local$/m)
  })
})
