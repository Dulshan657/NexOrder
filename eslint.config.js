// ESLint exists in this repo for exactly one reason: jsx-a11y. Nothing else is
// enabled, and that restraint is the point — an accessibility gate that also
// lands 400 `react-hooks/exhaustive-deps` findings is a refactor wearing a
// gate's clothes, and it gets turned off.
//
// PINNED TO ESLINT 9. eslint-plugin-jsx-a11y@6.10.2 peers `^3 || … || ^9` and
// ESLint 10 is already out, so `npm i -D eslint` resolves to 10 and fails to
// install. Do not "fix" that by upgrading eslint; the plugin is the constraint.
// 9.39.5 is comfortably past 9.24, which is what `--suppress-all` needs.
//
// NO `parserOptions.project`, deliberately and load-bearingly. This repo has no
// `@types/react` and `strict` is off (see CLAUDE.md, "Types gotcha"), so every
// React type resolves to `any`; a type-aware rule set would be either silent or
// wrong, and mostly wrong. jsx-a11y needs none of it — every one of its rules
// walks the JSX AST and reads attribute literals. Adding `project` would buy
// nothing and cost a full type-check on every lint.
//
// eslint-suppressions.json is the same shrinking-baseline idiom as
// components/overlay-baseline.json: what is listed there is frozen, anything
// new is an error. After a fixing PR, run `npx eslint --prune-suppressions`.
// Never add an entry by hand.
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
    {
        // The tree carries 19 pre-existing
        // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments,
        // written defensively for a linter that did not exist. With the plugin
        // registered below they resolve to real rules that are simply off, so
        // they are inert now and immediately do their job the day react-hooks is
        // enabled. That makes every one of them "unused", which is why this is
        // off: the alternative is 19 warnings for correctly-written intent.
        linterOptions: { reportUnusedDisableDirectives: 'off' },
    },
    {
        ignores: [
            'node_modules/',
            'dist/',
            'coverage/',
            'test-results/',
            'playwright-report/',
            // Deno, not Node: a different global set, URL imports, and a
            // resolver this config has no opinion about. `deno check` is what
            // type-checks these (CLAUDE.md, "Code 128 labels").
            'supabase/functions/',
            // Generated, vendored, or one-off artefacts — not application source.
            'demo-export/',
            'presentation/',
            'tridon-demo/',
            'wie-demo/',
            'warehouse-main/',
            '**/*.html',
        ],
    },
    js.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
            },
            globals: { ...globals.browser, ...globals.node },
        },
        // react-hooks is registered but ENTIRELY DISABLED. It is here to define
        // rule names, not to lint: see linterOptions above. Turning it on is a
        // separate piece of work — `exhaustive-deps` alone reports across most
        // of the component tree and would bury the accessibility findings this gate
        // exists to surface.
        plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
        rules: {
            ...Object.fromEntries(Object.keys(reactHooks.rules).map((r) => ['react-hooks/' + r, 'off'])),
            ...jsxA11y.flatConfigs.recommended.rules,

            // ── DELIBERATE DEVIATIONS FROM jsx-a11y RECOMMENDED ─────────────
            //
            // OFF: this rule cannot see through this codebase's wrappers.
            // components/ui/Field.tsx renders its label and takes the control as
            // an opaque `children: ReactNode`, so every <Field> call site reads
            // as an unlabelled control to a rule looking at one element in
            // isolation. `control-has-associated-label` below answers the same
            // question from the control's side and answers it better; two rules
            // reporting two different numbers for one defect is worse than one.
            'jsx-a11y/label-has-associated-control': 'off',

            // OFF: deprecated by the plugin, and wrong for React, where onChange
            // already has onBlur's semantics.
            'jsx-a11y/no-onchange': 'off',

            // OFF, and this one is a judgement rather than a technicality.
            // All 30 findings are deliberate. The top five files are
            // ScanField, PickTaskRow, PutawayStopCard, ReplenStopCard and
            // CountLocationFinder -- every one a scan surface, where autofocus
            // is load-bearing: under the RS35 handheld default Input Method
            // mode a scan field that does not hold focus means a scan that
            // silently does not happen (CLAUDE.md, "Gotchas"). autoFocus is an
            // explicit opt-in prop on ScanField, plumbed through on purpose.
            // The remainder are dialogs placing focus on their first field,
            // which is standard and which WCAG does not prohibit at any level.
            // Freezing 30 deliberate decisions into the suppression baseline
            // would make that file describe debt it does not have.
            'jsx-a11y/no-autofocus': 'off',

            // PROMOTED above recommended: these three are this codebase's actual
            // findings — controls with no accessible name, <th>/<tr> carrying
            // click handlers, and link text that says only "here".
            //
            // `control-has-associated-label` is the load-bearing one and was very
            // nearly turned off as noise. Measured on first run: 245 findings, of
            // which 205 <input> + 9 <textarea> + 2 <button> are real and 29
            // (<td>/<th>/<tr>/<option>/<canvas>, mostly empty layout cells) are
            // not. 88% signal — and the 214 real ones independently corroborate a
            // separate regex-based audit that counted 208. It is kept at `error`
            // with the current state frozen in eslint-suppressions.json, which is
            // why this repo needs no bespoke label-checking script: a real parser
            // does the job without the blind spots a regex has around
            // `{...spread}` and computed `id={expr}`.
            'jsx-a11y/control-has-associated-label': 'error',
            'jsx-a11y/no-noninteractive-element-to-interactive-role': 'error',
            'jsx-a11y/anchor-ambiguous-text': 'error',
        },
    },
    {
        // `js.configs.recommended` does not know TypeScript. `no-undef` duplicates
        // what tsc already does and mis-fires on type-only names; `no-unused-vars`
        // fires on type parameters and interface members. tsc --noEmit owns both.
        files: ['**/*.{ts,tsx}'],
        rules: {
            'no-undef': 'off',
            'no-unused-vars': 'off',
        },
    },
    {
        // Shipped to the browser as a classic script, so it is neither a module
        // nor Node. It is the one file that must run on a browser too old for
        // everything else in here (see index.html).
        files: ['public/browser-check.js'],
        languageOptions: {
            ecmaVersion: 2015,
            sourceType: 'script',
            globals: { ...globals.browser },
        },
        rules: {
            // ESLint 9 defaults `caughtErrors` to 'all', which flags the unused
            // binding in this file's feature-detect `catch (e) { return false }`.
            // The obvious tidy -- optional catch binding, `catch {}` -- is ES2019,
            // and this is the one file that must parse on a browser too old for
            // everything else here. Narrowing the rule beats editing the file.
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
        },
    },
    {
        // Build and ops scripts: Node globals, no JSX, no accessibility surface.
        files: ['**/*.mjs', 'scripts/**/*.js', '*.config.{js,ts}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: { 'no-unused-vars': 'off' },
    },
]
