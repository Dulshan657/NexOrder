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
