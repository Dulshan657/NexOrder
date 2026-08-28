// Define the `__MODULE_*__` build constants for the test run.
//
// `vite.config.ts` substitutes these textually via `define` at build time, and
// `lib/modules.ts` reads them at module scope. Vitest transforms test files
// through the SSR pipeline, where `define` does NOT apply — so without this the
// whole suite dies on import with "__MODULE_SALES_ORDERS__ is not defined" the
// moment anything reaches AppShell, AdminView or adminTabUrl.
//
// EVERY MODULE ON. These tests assert what the product does, and a suite that
// silently ran against a reduced feature set would be worse than no suite. The
// disabled behaviour cannot be covered by flipping a value here — a build
// constant is global to a config — so it is proven where it actually matters:
// `moduleForTab` is asserted directly (__tests__/modules.test.ts), and "the
// code is not in the bundle" is checked by building with a module removed and
// grepping the output, which no unit test can do.
//
// Derived from the registry rather than listed, so a new module cannot be added
// without the suite picking it up.
import { ALL_MODULES } from '../../config/environments.mjs'

for (const slug of ALL_MODULES as string[]) {
  ;(globalThis as Record<string, unknown>)[`__MODULE_${slug.toUpperCase()}__`] = true
}

// `__DEMO_HOST__` is the same kind of build constant and needs the same shim:
// vite.config.ts folds it from `kind` in the target registry, and
// components/auth/LoginPage.tsx reads it at module scope, so anything importing
// that file dies on "__DEMO_HOST__ is not defined" without this line.
//
// TRUE here, and that is a considered choice rather than a convenience. It is
// the branch with more in it -- the demo roster renders, so the accessibility
// suites scan the login page in its fullest form, and a labelling defect in the
// roster cannot hide behind a flag being off. That a tenant build omits the
// roster entirely is not a unit-testable claim in any case: it is a fold, and
// only the built artifact can answer it. scripts/check-demo-surface.mjs does.
;(globalThis as Record<string, unknown>).__DEMO_HOST__ = true
