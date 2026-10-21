import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { VOICE_ROLES } from '../../supabase/functions/_shared/voice/toolSchemas'

/**
 * The voice-session Edge Function is Deno code that nothing imports and `tsc`
 * excludes, so its contract is checked here by parsing it with the TypeScript
 * parser (as __tests__/moduleOwnership.test.ts does for the module gate).
 *
 * Two promises are pinned:
 *  - the role allow-list is a literal array equal to VOICE_ROLES, the list the
 *    shared tool contract offers tools to, and it is what requireAuth enforces;
 *  - the system prompt never travels back to the browser: no response body,
 *    and in particular not the success literal carrying `clientSecret`,
 *    mentions `instructions`.
 */

const PATH = resolve(__dirname, '../../supabase/functions/voice-session/index.ts')

function source(): ts.SourceFile {
  return ts.createSourceFile(PATH, readFileSync(PATH, 'utf8'), ts.ScriptTarget.Latest, true)
}

function collect<T extends ts.Node>(root: ts.Node, pick: (n: ts.Node) => n is T): T[] {
  const found: T[] = []
  const walk = (node: ts.Node): void => {
    if (pick(node)) found.push(node)
    ts.forEachChild(node, walk)
  }
  walk(root)
  return found
}

function allowedLiterals(sf: ts.SourceFile): string[] | null {
  const decl = collect(sf, ts.isVariableDeclaration).find(
    (d) => ts.isIdentifier(d.name) && d.name.text === 'ALLOWED',
  )
  const init = decl?.initializer
  if (!init || !ts.isArrayLiteralExpression(init)) return null
  return init.elements.map((e) => (ts.isStringLiteral(e) ? e.text : `<non-literal ${e.getText()}>`))
}

function propertyName(p: ts.ObjectLiteralElementLike): string | null {
  if (!p.name) return null
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
  return null
}

/** Does this subtree name `instructions` as an identifier, property or string? */
function mentionsInstructions(node: ts.Node): boolean {
  const hits = collect(
    node,
    (n): n is ts.Node =>
      (ts.isIdentifier(n) || ts.isStringLiteral(n)) && /instructions/i.test(n.text),
  )
  return hits.length > 0
}

function requireAuthRoleArgs(sf: ts.SourceFile): string[] {
  return collect(sf, ts.isCallExpression)
    .filter((c) => ts.isIdentifier(c.expression) && c.expression.text === 'requireAuth')
    .flatMap((c) => c.arguments.filter(ts.isObjectLiteralExpression))
    .flatMap((o) => o.properties.filter(ts.isPropertyAssignment))
    .filter((p) => propertyName(p) === 'allowedRoles')
    .map((p) => p.initializer.getText())
}

describe('voice-session contract', () => {
  it('allows exactly the four sales roles', () => {
    const sf = source()
    const roles = allowedLiterals(sf)
    expect(roles).not.toBeNull()
    expect([...(roles ?? [])].sort()).toEqual([...VOICE_ROLES].sort())
    expect(roles).toHaveLength(4)
    expect(requireAuthRoleArgs(sf)).toEqual(['ALLOWED'])
    const importsModules = sf.statements.some(
      (s) =>
        ts.isImportDeclaration(s) &&
        ts.isStringLiteral(s.moduleSpecifier) &&
        s.moduleSpecifier.text === '../_shared/modules.ts',
    )
    expect(importsModules).toBe(true)
  })

  it('never puts the instructions in a response', () => {
    const sf = source()
    const successLiterals = collect(sf, ts.isObjectLiteralExpression).filter((o) =>
      o.properties.some((p) => propertyName(p) === 'clientSecret'),
    )
    expect(successLiterals.length).toBeGreaterThan(0)
    for (const literal of successLiterals) {
      expect(literal.properties.map(propertyName)).not.toContain('instructions')
      expect(mentionsInstructions(literal)).toBe(false)
    }

    const responses = collect(sf, ts.isNewExpression).filter(
      (n) => ts.isIdentifier(n.expression) && n.expression.text === 'Response',
    )
    expect(responses.length).toBeGreaterThan(0)
    for (const response of responses) {
      expect(mentionsInstructions(response)).toBe(false)
    }
  })
})

function functionBody(sf: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const fn = collect(sf, ts.isFunctionDeclaration).find((f) => f.name?.text === name)
  if (!fn) throw new Error(`function ${name} not found in voice-session/index.ts`)
  return fn
}

/** Source offsets of every call to `callee` inside `node`, in order. */
function callOffsets(node: ts.Node, callee: string): number[] {
  return collect(node, ts.isCallExpression)
    .filter((c) => ts.isIdentifier(c.expression) && c.expression.text === callee)
    .map((c) => c.getStart())
}

describe('voice-session hardening', () => {
  it('builds the mint request before opening the ledger row', () => {
    const start = functionBody(source(), 'handleStart')
    const build = callOffsets(start, 'buildMintRequest')
    const open = callOffsets(start, 'openLedgerRow')
    expect(build).toHaveLength(1)
    expect(open).toHaveLength(1)
    expect(build[0]).toBeLessThan(open[0])
  })

  it('re-checks the budget after inserting and before minting', () => {
    const start = functionBody(source(), 'handleStart')
    const [open] = callOffsets(start, 'openLedgerRow')
    const [verify] = callOffsets(start, 'verifyBudgetAfterInsert')
    const [mint] = callOffsets(start, 'mintClientSecret')
    expect(open).toBeLessThan(verify)
    expect(verify).toBeLessThan(mint)
    expect(callOffsets(functionBody(source(), 'verifyBudgetAfterInsert'), 'rowsBefore')).toHaveLength(1)
  })

  it('bounds every reported usage field', () => {
    const sf = source()
    const decl = collect(sf, ts.isVariableDeclaration).find(
      (d) => ts.isIdentifier(d.name) && d.name.text === 'usageSchema',
    )
    const call = decl?.initializer
    expect(call && ts.isCallExpression(call)).toBe(true)
    const shape = (call as ts.CallExpression).arguments[0]
    expect(shape && ts.isObjectLiteralExpression(shape)).toBe(true)
    const props = (shape as ts.ObjectLiteralExpression).properties.filter(ts.isPropertyAssignment)
    expect(props).toHaveLength(7)
    for (const p of props) expect(p.initializer.getText()).toContain('.max(MAX_REPORTED_TOKENS)')
  })

  it('closes a session only for the caller', () => {
    const text = functionBody(source(), 'closeSession').getText()
    expect(text).toContain(".eq('user_id', userId)")
    expect(text).toContain(".is('ended_at', null)")
  })
})

/** The `try` in handleStart that guards everything after this request's own insert. */
function startGuard(): { start: ts.FunctionDeclaration; guard: ts.TryStatement | undefined } {
  const start = functionBody(source(), 'handleStart')
  const guard = collect(start, ts.isTryStatement).find(
    (t) => callOffsets(t.tryBlock, 'verifyBudgetAfterInsert').length > 0,
  )
  return { start, guard }
}

describe('voice-session open-row cleanup', () => {
  it('covers the budget re-read, the mint and the audit write with one catch', () => {
    const { start, guard } = startGuard()
    expect(guard).toBeDefined()
    const block = (guard as ts.TryStatement).tryBlock
    const [open] = callOffsets(start, 'openLedgerRow')
    // The insert itself is outside the guard (a failed insert leaves no row to delete)...
    expect(callOffsets(block, 'openLedgerRow')).toHaveLength(0)
    expect(block.getStart()).toBeGreaterThan(open)
    // ...and everything that can throw after it is inside.
    for (const callee of ['verifyBudgetAfterInsert', 'mintClientSecret', 'logAuditEvent']) {
      expect(callOffsets(block, callee), callee).toHaveLength(1)
    }
    expect((guard as ts.TryStatement).finallyBlock).toBeUndefined()
  })

  it('deletes this request own row, then rethrows the original error', () => {
    const { guard } = startGuard()
    const clause = guard?.catchClause
    expect(clause).toBeDefined()
    const variable = clause?.variableDeclaration?.name.getText()
    expect(variable).toBeTruthy()
    const body = (clause as ts.CatchClause).block
    const deletes = collect(body, ts.isCallExpression).filter(
      (c) => ts.isIdentifier(c.expression) && c.expression.text === 'deleteOpenRow',
    )
    expect(deletes).toHaveLength(1)
    expect(deletes[0].arguments.map((a) => a.getText())).toEqual(['service', 'sessionId'])
    expect(ts.isAwaitExpression(deletes[0].parent)).toBe(true)
    const throws = collect(body, ts.isThrowStatement)
    expect(throws).toHaveLength(1)
    expect(throws[0].expression.getText()).toBe(variable)
    expect(deletes[0].getStart()).toBeLessThan(throws[0].getStart())
    // And that catch is the ONLY place handleStart deletes a row: no other path
    // (a success, an early refusal) may remove the row it has just returned.
    const { start } = startGuard()
    expect(callOffsets(start, 'deleteOpenRow')).toHaveLength(1)
  })

  it('deletes by id only, and a failed delete cannot mask the original error', () => {
    const text = functionBody(source(), 'deleteOpenRow')
    expect(text.getText()).toContain(".eq('id', sessionId)")
    expect(text.getText()).not.toContain('user_id')
    // A cleanup that throws would replace the error being rethrown.
    expect(collect(text, ts.isTryStatement).filter((t) => t.catchClause)).toHaveLength(1)
    // ...and nothing in it throws, inside the catch or outside the try.
    expect(collect(text, ts.isThrowStatement)).toHaveLength(0)
  })

  it('has no second delete of its own row inside the re-read', () => {
    const verify = functionBody(source(), 'verifyBudgetAfterInsert')
    expect(callOffsets(verify, 'deleteOpenRow')).toHaveLength(0)
  })
})

describe('voice-session refusal copy', () => {
  it('words a rate-limit wait through describeRetryAfter, never as raw seconds', () => {
    const limiter = functionBody(source(), 'enforceRateLimit')
    expect(callOffsets(limiter, 'describeRetryAfter')).toHaveLength(1)
    expect(limiter.getText()).not.toMatch(/\}s`/)
  })
})
