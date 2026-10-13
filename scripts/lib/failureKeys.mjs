// Every failure in one test module, at every level, as comparable strings.
//
// The gate decides "pre-existing vs new" by comparing these keys between the
// tip and the base. It used to read vitest's JSON reporter, which turned out to
// be lossy in exactly the places that matter: it exposes failing TESTS and the
// FIRST module-level error, but nothing a hook throws inside a `describe` (that
// lands on the suite's own result). Three gate reviews in a row found a failure
// shape the JSON dropped. So the gate now runs its own reporter
// (scripts/gate-reporter.mjs), which hands each module here and walks the whole
// task tree: module errors, every suite's errors, every failed test.
//
// Pure: takes vitest 4's reported-task API shape, so it is tested with fakes.

import { stripRoot } from './flakeVerdict.mjs'

const firstLine = (error, root) => stripRoot(String(error?.message ?? error ?? '').split('\n')[0].trim(), root)

/**
 * @param {{ errors(): {message:string}[], children: { allSuites(): Iterable<any>, allTests(state: string): Iterable<any> } }} testModule
 * @param {string} root  the workdir, stripped from messages
 * @returns {string[]}
 */
export function failureKeys(testModule, root) {
  const keys = testModule.errors().map((e) => `[module] ${firstLine(e, root)}`)
  for (const suite of testModule.children.allSuites()) {
    for (const e of suite.errors()) keys.push(`${suite.fullName} [suite] ${firstLine(e, root)}`)
  }
  for (const test of testModule.children.allTests('failed')) keys.push(test.fullName)
  return keys
}
