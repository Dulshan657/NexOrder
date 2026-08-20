import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { ALL_MODULES } from '../config/environments.mjs'
import { FUNCTION_MODULES, disabledFunctionsFor } from '../config/moduleOwnership.mjs'
import { TARGETS } from '../config/environments.mjs'

/**
 * The module gate on the server is spread across 58 Edge Functions, and
 * `supabase/functions` is excluded from `npx tsc --noEmit` (tsconfig.json),
 * nothing imports those files, and `supabase functions deploy` without Docker
 * only uploads. Their call sites are therefore type-checked by NOTHING — the
 * trap CLAUDE.md already records for the `_shared/poInbox` helpers.
 *
 * So this file does the checking a compiler would: parse each function with the
 * TypeScript parser, and assert the gate is present, correctly spelled, and in
 * a position where its throw can actually be caught.
 *
 * It also pins the two-representations problem. `config/moduleOwnership.mjs` is
 * the Node-readable map (deploy-functions.mjs cannot import Deno TypeScript);
 * the `requireModule` call is the Deno-readable one (_shared cannot import from
 * outside supabase/functions). Neither side can own it alone, so the pair is
 * asserted equal here.
 */

const ROOT = resolve(__dirname, '..')
const FUNCTIONS_DIR = resolve(ROOT, 'supabase/functions')

function functionNames(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort()
}

function sourceFor(fn: string): ts.SourceFile {
  const path = resolve(FUNCTIONS_DIR, fn, 'index.ts')
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

/** Every `requireModule('x')` / `isModuleEnabled('x')` argument in the file. */
function gateSlugs(sf: ts.SourceFile): string[] {
  const found: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'requireModule' || node.expression.text === 'isModuleEnabled')
    ) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteral(arg)) found.push(arg.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return found
}

function importsModulesHelper(sf: ts.SourceFile): boolean {
  return sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === '../_shared/modules.ts',
  )
}

/** Is every `requireModule` call lexically inside a try block? */
function requireModuleCallsAreGuarded(sf: ts.SourceFile): boolean {
  let ok = true
  const walk = (node: ts.Node, inTry: boolean): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'requireModule' &&
      !inTry
    ) {
      ok = false
    }
    ts.forEachChild(node, (child) =>
      walk(child, inTry || (ts.isTryStatement(node) && child === node.tryBlock)),
    )
  }
  walk(sf, false)
  return ok
}

describe('module ownership map', () => {
  it('assigns every function to a known module', () => {
    for (const slug of Object.values(FUNCTION_MODULES)) {
      expect(ALL_MODULES).toContain(slug)
    }
  })

  it('names only functions that exist on disk', () => {
    for (const fn of Object.keys(FUNCTION_MODULES)) {
      expect(existsSync(resolve(FUNCTIONS_DIR, fn, 'index.ts')), `${fn} has no index.ts`).toBe(true)
    }
  })

  it('covers every module — an empty module would gate nothing server-side', () => {
    const owned = new Set(Object.values(FUNCTION_MODULES))
    // field_ops is deliberately thin (its surfaces are RLS-scoped table access)
    // but it must still own something, or a rename here would silently orphan it.
    for (const slug of ALL_MODULES) expect(owned, `no function owned by ${slug}`).toContain(slug)
  })
})

describe('every owned Edge Function actually gates', () => {
  const owned = Object.entries(FUNCTION_MODULES)

  it.each(owned)('%s gates on %s', (fn, slug) => {
    const sf = sourceFor(fn)
    expect(importsModulesHelper(sf), `${fn} does not import _shared/modules.ts`).toBe(true)
    expect(gateSlugs(sf), `${fn} gate slug`).toContain(slug)
  })

  it.each(owned)('%s parses without syntax errors', (fn) => {
    const sf = sourceFor(fn)
    // `parseDiagnostics` is internal but is the only way to see syntax errors
    // from a standalone SourceFile, and a syntax error here reaches production.
    const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics
    expect(diagnostics ?? [], `${fn} has syntax errors`).toHaveLength(0)
  })

  it.each(owned)('%s throws its gate somewhere catchable', (fn) => {
    // requireModule throws an EdgeFunctionError. Outside a try block that
    // becomes an unhandled 500 instead of a 403 — which is exactly why
    // poll-inbox uses isModuleEnabled and returns a no-op response instead.
    expect(requireModuleCallsAreGuarded(sourceFor(fn)), `${fn} calls requireModule outside try`).toBe(
      true,
    )
  })
})

describe('ungated functions are ungated on purpose', () => {
  it('has no gate in a function the map does not own', () => {
    for (const fn of functionNames()) {
      if (fn in FUNCTION_MODULES) continue
      const slugs = gateSlugs(sourceFor(fn))
      expect(slugs, `${fn} gates but is not in FUNCTION_MODULES`).toHaveLength(0)
    }
  })

  it('leaves the core surfaces alone', () => {
    // Named explicitly: these are the ones someone would "tidy" into a module.
    for (const fn of [
      'health',
      'invite-user',
      'log-client-error',
      'mutate-app-settings',
      'mutate-horeca',
      'mutate-product',
      'mutate-supplier',
      'mutate-profile',
      'send-email',
      'create-order-document-url',
      'gmail-oauth-callback',
      'outlook-oauth-callback',
    ]) {
      expect(FUNCTION_MODULES, `${fn} must stay core`).not.toHaveProperty(fn)
    }
  })
})

describe('disabledFunctionsFor', () => {
  it('returns nothing for the demo, which has every module', () => {
    expect(disabledFunctionsFor(TARGETS.dev)).toEqual([])
  })

  it('disables exactly the five non-warehouse modules for Amadiya', () => {
    // The first target to carry a real subset. This asserts the CONSEQUENCE of
    // the registry rather than restating it: every function withheld belongs to
    // a module Amadiya does not have, and every function they DO need to run a
    // warehouse against keyed-in orders survives.
    const disabled = disabledFunctionsFor(TARGETS.amadiya)
    const enabled = new Set(TARGETS.amadiya.modules)

    expect(disabled.every((fn) => !enabled.has(FUNCTION_MODULES[fn]))).toBe(true)

    for (const fn of ['place-order', 'update-order-status', 'cancel-order']) {
      expect(disabled, `${fn} is how an order exists at all`).not.toContain(fn)
    }
    for (const fn of ['record-pick', 'receive-stock', 'count-bin', 'generate-pick-slip']) {
      expect(disabled, `${fn} is the warehouse they bought`).not.toContain(fn)
    }
    for (const fn of ['approve-po', 'mutate-promotion', 'mutate-invoice-status', 'mutate-pantry-item']) {
      expect(disabled, `${fn} belongs to a module they did not buy`).toContain(fn)
    }
    // Core is never withheld, whatever the module set.
    for (const fn of ['health', 'invite-user', 'mutate-product', 'mutate-supplier']) {
      expect(disabled, `${fn} is core`).not.toContain(fn)
    }
  })

  it('returns exactly that module’s functions when one is off', () => {
    const remaining = ALL_MODULES.filter((m: string) => m !== 'inventory_dispatch')
    const disabled = disabledFunctionsFor({ modules: remaining })
    expect(disabled).toContain('receive-stock')
    expect(disabled).toContain('record-pick')
    expect(disabled).not.toContain('place-order')
    expect(disabled).not.toContain('health')
    expect(disabled.every((fn) => FUNCTION_MODULES[fn] === 'inventory_dispatch')).toBe(true)
  })
})
