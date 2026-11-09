// Pure helpers for scripts/check-home-bins.mjs, kept apart so a test can import
// them without loading the script (which reads credentials and the database).

import { TargetError } from './env.mjs'

/**
 * `--target <name>` and `--target=<name>` mean `--env=<name>`. env.mjs takes the
 * equals form only, because a space-separated value can be mistaken for a
 * filename by scripts that take one; the home-bin check takes none, so both
 * spellings are safe here. A `--target` with no name is refused, never guessed.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function normaliseTargetArgs(argv) {
  const out = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) {
        throw new TargetError('--target needs a name, e.g. --target dev')
      }
      out.push(`--env=${value}`)
      i += 1
    } else if (arg.startsWith('--target=')) {
      out.push(`--env=${arg.slice('--target='.length)}`)
    } else {
      out.push(arg)
    }
  }
  return out
}

/**
 * One line for one problem.
 *
 * @param {{ code: string, name?: string }} warehouse
 * @param {{ sku: string, binCode: string }} row
 * @param {{ code: string, message: string }} problem
 * @returns {string}
 */
export function formatProblem(warehouse, row, problem) {
  return `${warehouse.code} | ${row.sku} | ${row.binCode} | ${problem.code} | ${problem.message}`
}

/**
 * 0 when every home is usable, 1 when any is not. (2 is reserved by the script
 * for "could not run the check": a gate must never read "could not look" as
 * "all clear".)
 *
 * @param {number} problemCount
 * @returns {0 | 1}
 */
export function exitCodeFor(problemCount) {
  return problemCount > 0 ? 1 : 0
}
