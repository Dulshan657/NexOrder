// scripts/lib/nexGoldenArgs.mjs — arguments for scripts/nex-golden.mjs.
//
// DEV ONLY, and not as a default: the runner signs in with the seeded demo
// password and spends the demo users' voice minutes. A tenant has neither demo
// logins nor (yet) Nex, so any other target is refused by name. Equals-form only,
// like every script here (`--env dev` with a space is refused, see CLAUDE.md).

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ env: 'dev', only: string[] | null }}
 */
export function parseNexGoldenArgs(argv) {
  let env = null
  /** @type {string[] | null} */
  let only = null
  for (const arg of argv) {
    if (arg.startsWith('--env=')) env = arg.slice('--env='.length)
    else if (arg.startsWith('--only=')) only = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
    else throw new Error(`nex-golden: unknown argument ${arg}. Usage: --env=dev [--only=case-id,case-id]`)
  }
  if (env === null) throw new Error('nex-golden: name the target with --env=dev')
  if (env !== 'dev') throw new Error(`nex-golden: "${env}" refused; the golden run is dev only`)
  return { env: 'dev', only }
}
