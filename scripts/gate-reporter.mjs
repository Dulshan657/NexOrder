// vitest reporter used only by scripts/gate.mjs.
//
// Writes, to $GATE_REPORT_OUT, every failure of every module as comparable keys
// (scripts/lib/failureKeys.mjs) plus the run's unhandled errors — the two
// things vitest's JSON reporter loses (suite-level hook errors; unhandled
// errors, which it has no field for). Loaded by ABSOLUTE path from the gate's
// own checkout, so it works when gating an older commit that predates it.
//
//   GATE_REPORT_OUT=<file> npx vitest run --reporter=default --reporter=<abs>/scripts/gate-reporter.mjs

import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { failureKeys } from './lib/failureKeys.mjs'
import { stripRoot } from './lib/flakeVerdict.mjs'

export default class GateReporter {
  onTestRunEnd(testModules, unhandledErrors = []) {
    const out = process.env.GATE_REPORT_OUT
    if (!out) throw new Error('gate-reporter: GATE_REPORT_OUT is not set')
    const root = process.cwd()
    const modules = {}
    for (const m of testModules) {
      modules[relative(root, m.moduleId).replaceAll('\\', '/')] = { state: m.state(), keys: failureKeys(m, root) }
    }
    const unhandled = unhandledErrors.map((e) => stripRoot(String(e?.message ?? e).split('\n')[0], root))
    writeFileSync(out, JSON.stringify({ modules, unhandled }, null, 2))
  }
}
