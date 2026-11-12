# `@types/react-reconciler` stub (NX-0035)

`@react-three/fiber` depends on `its-fine`, which depends on
`@types/react-reconciler`, whose peer `@types/react` npm then installs
automatically. This repo **must not** have `@types/react`: `strict` is off and
every React type is deliberately `any` (CLAUDE.md, "Types gotcha"); with the real
types present `npx tsc --noEmit` fails across the app.

`package.json` `overrides` points `@types/react-reconciler` here. Only
`its-fine`'s and fiber's own `.d.ts` files import it, and `skipLibCheck` skips
those, so the 3D view's R3F types resolve to `any` like every other React type.

Check after any dependency change: `npm ls @types/react` must print nothing.
