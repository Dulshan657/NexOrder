// What is this invocation asking for, and is it well formed?
//
// Split out of supabase/ops/set-user-password.mjs so the DECISION is pure and
// testable and only the HTTP calls live in the script — the same split as
// scripts/lib/releaseTag.mjs, and for the same reason: this runs by hand,
// against a paying client's database, at the moment you least want a surprise.
//
// ── WHY THE PASSWORD IS NOT AN ARGUMENT ─────────────────────────────────────
//
// It arrives in `NEW_PASSWORD`, never in argv. An argv password is written to
// the shell's history file and is visible in `ps` to every other process on the
// box for as long as the script runs; an environment variable is neither, and
// can be cleared afterwards. This is the one design decision here that the
// caller cannot work around, so it is enforced rather than documented.

/**
 * Matches `password_min_length` in supabase/apply-auth-config.mjs (8) and the
 * client-side check in ResetPasswordView. This is the THIRD copy of that
 * number — change one, change the others. Checking it here is not redundant
 * with the server: GoTrue's refusal arrives as an opaque 422 after the guards
 * have already run and the operator has typed the project ref.
 */
export const PASSWORD_MIN_LENGTH = 8

/**
 * @typedef {object} PasswordPlan
 * @property {true}   ok
 * @property {'list'|'set'} mode
 * @property {string|null}  email     the account to act on; null in list mode
 * @property {string|null}  password  the new password; null in list mode
 * @property {boolean} dryRun
 */

/**
 * @param {object} input
 * @param {string[]} input.argv
 * @param {Record<string,string|undefined>} input.env
 * @returns {PasswordPlan | { ok: false, problem: string, fix: string }}
 */
export function planPasswordChange({ argv = [], env = {} } = {}) {
  const dryRun = argv.includes('--dry-run')

  // Report-only, and deliberately the cheapest thing to ask for: it is how you
  // find out what accounts a project actually has before deciding to act.
  if (argv.includes('--list')) {
    return { ok: true, mode: 'list', email: null, password: null, dryRun }
  }

  // Equals-form only, mirroring readTargetName() in env.mjs — and for the same
  // reason it matters there: a space-form value becomes a stray positional that
  // some other reader picks up, so it must fail loudly rather than be guessed.
  if (argv.includes('--email')) {
    return {
      ok: false,
      problem: '--email was passed in space form.',
      fix: 'Write it as --email=someone@example.com (equals form only).',
    }
  }

  const email = argv.find((a) => a.startsWith('--email='))?.slice('--email='.length).trim()
  if (!email) {
    return {
      ok: false,
      problem: 'no account was named.',
      fix: 'Pass --email=<address>, or --list to see which accounts exist.',
    }
  }
  // Deliberately shallow: the account is looked up by exact address against the
  // project's own user list, so a clever pattern here would only reject
  // addresses the server would have accepted. This catches the typo class only.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      problem: `"${email}" is not an email address.`,
      fix: 'Pass the account\'s full address, e.g. --email=someone@example.com.',
    }
  }

  const password = env.NEW_PASSWORD
  if (!password) {
    return {
      ok: false,
      problem: 'NEW_PASSWORD is not set.',
      fix:
        'The new password is read from the environment, never from the command line,\n' +
        '  so it stays out of shell history and out of `ps`:\n' +
        "    $env:NEW_PASSWORD='…'   (PowerShell)   or   NEW_PASSWORD='…' node …   (bash)\n" +
        '  Clear it afterwards with `Remove-Item Env:\\NEW_PASSWORD`.',
    }
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      problem: `the new password is ${password.length} characters; the minimum is ${PASSWORD_MIN_LENGTH}.`,
      fix: 'GoTrue enforces the same minimum server-side. Choose a longer password.',
    }
  }
  // A password that is not what it looks like is worse than a rejected one: it
  // would be set successfully and then fail to open the app, with nothing on
  // screen to explain why. Almost always a paste that swept up a newline.
  if (password !== password.trim()) {
    return {
      ok: false,
      problem: 'the new password has leading or trailing whitespace.',
      fix:
        'That is legal but invisible, and it would be set and then appear not to work.\n' +
        '  Re-set NEW_PASSWORD without the stray space or newline.',
    }
  }

  return { ok: true, mode: 'set', email: email.toLowerCase(), password, dryRun }
}
