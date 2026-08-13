import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * scripts/claude/guard-workspace.mjs is the PreToolUse hook that refuses
 * tenant-targeting shell commands in the development workspace.
 *
 * It is tested here rather than left to manual checking because its two failure
 * modes are both silent and both expensive. Too loose and a migration reaches a
 * paying client's database; too tight and it blocks ordinary work — the first
 * version rejected `git commit -m "...--env=amadiya..."`, a commit message
 * describing the guard itself, which is why the "content, not invocation" block
 * below exists at all.
 *
 * The guard is spawned as a child process because that is exactly how the hook
 * runs it: JSON on stdin, a permission decision on stdout.
 *
 * These assertions hold in CI for free — the guard treats a checkout as a
 * tenant workspace only when a `kind: 'tenant'` env file is present, and CI has
 * no env files at all.
 */

const ROOT = resolve(__dirname, '..')
const GUARD = resolve(ROOT, 'scripts/claude/guard-workspace.mjs')

// Assembled rather than written out, so this file is not itself a string that
// a future, blunter version of the guard would trip over.
const TENANT = 'ama' + 'diya'
const TENANT_REF = 'lsgkznyi' + 'abqitqfpveey'

function decide(command: string): 'DENY' | 'ALLOW' {
  const result = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  })
  expect(result.status, `guard crashed: ${result.stderr}`).toBe(0)
  if (!result.stdout.trim()) return 'ALLOW'
  const parsed = JSON.parse(result.stdout)
  expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
  expect(parsed.hookSpecificOutput.permissionDecisionReason).toBeTruthy()
  return parsed.hookSpecificOutput.permissionDecision === 'deny' ? 'DENY' : 'ALLOW'
}

describe('workspace guard', () => {
  describe('refuses tenant-targeting invocations', () => {
    it.each([
      [`npm run migrate:${TENANT}`, 'npm alias'],
      [`node supabase/migrate.mjs --env=${TENANT} --dry-run`, 'the flag mid-command'],
      [`cd foo && npm run deploy:${TENANT}`, 'a runner in the second segment'],
      [`node supabase/apply-sql.mjs --env=prod --query "select 1"`, 'the deprecated alias'],
      [`node scripts/x.mjs --project-ref ${TENANT_REF}`, 'the bare project ref'],
    ])('%s (%s)', (command) => {
      expect(decide(command)).toBe('DENY')
    })

    // --dry-run does not make it safe: resolveTarget still loads the tenant's
    // credentials, and several scripts read before they decide what to write.
    it('blocks even a dry run', () => {
      expect(decide(`node supabase/migrate.mjs --env=${TENANT} --dry-run`)).toBe('DENY')
    })
  })

  describe('refuses bare CLI calls that no --env flag can steer', () => {
    it.each([['npx supabase projects list'], ['vercel env pull'], ['supabase db push']])(
      '%s',
      (command) => {
        expect(decide(command)).toBe('DENY')
      },
    )

    it('allows the raw CLI when the target is stated explicitly', () => {
      expect(decide('npx supabase functions deploy health --project-ref uqvekvavkjjurpqtovbq')).toBe(
        'ALLOW',
      )
    })
  })

  describe('allows the tenant name as CONTENT rather than as a target', () => {
    it.each([
      [`git commit -m "guard blocks --env=${TENANT} from here"`],
      [`git log --grep=${TENANT}`],
      [`echo "npm run migrate:${TENANT} is blocked"`],
      [`rg -n "env=${TENANT}" docs/`],
    ])('%s', (command) => {
      expect(decide(command)).toBe('ALLOW')
    })

    // The case that actually broke: a commit message quoting a blocked command.
    // The `&&` inside the message splits it, and the fragment leads with `npm`,
    // so nothing about leading tokens saves this — the quotes have to be seen.
    it('allows a commit message that quotes a blocked command verbatim', () => {
      const message = `so \`cd x && npm run migrate:${TENANT}\` is refused`
      expect(decide(`git commit -q -m "${message}"`)).toBe('ALLOW')
    })
  })

  // Masking quoted spans is what buys the block above, and it cuts both ways.
  // Documented as a decision, not discovered later as a hole: the credential
  // file is the boundary, this hook is the signpost.
  it('KNOWN GAP: a quoted target value is masked and therefore missed', () => {
    expect(decide(`node x.mjs --env="${TENANT}"`)).toBe('ALLOW')
    expect(decide(`node x.mjs --env=${TENANT}`)).toBe('DENY')
  })

  describe('leaves ordinary development work alone', () => {
    it.each([
      ['npm run migrate:dev'],
      ['node supabase/migrate.mjs --env=dev'],
      ['npm run deploy:dev'],
      ['npm test'],
      ['npx tsc --noEmit'],
      ['git diff --stat'],
    ])('%s', (command) => {
      expect(decide(command)).toBe('ALLOW')
    })
  })

  it('ignores a payload with no command', () => {
    const result = spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }),
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // A guard that throws must not block every command in the session. It fails
  // open on its own bugs and closed on the patterns it understands, because the
  // real boundary is the absent credential file, not this hook.
  it('fails open on malformed input', () => {
    const result = spawnSync(process.execPath, [GUARD], { input: 'not json', encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})
