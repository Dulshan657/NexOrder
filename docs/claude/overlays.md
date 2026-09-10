# Overlays

> Extracted verbatim from `CLAUDE.md` on 2026-09-10, when that file passed Claude
> Code's 150k-char session limit. The load-bearing summary stays in `CLAUDE.md`;
> this is the full detail behind it. **Edit here, not there.**

**Overlays.** Never hand-roll a `fixed inset-0` backdrop — `scripts/check-overlays.mjs` fails CI on one outside `components/ui/` (it runs before `tsc` in the `verify` job). Use `<Modal>` (centered), `<Sheet>` (right slide-in, bottom sheet on mobile), or `<ConfirmDialog>`.

- The overlay is **never** the scroll container. The panel caps at `max-h-[90vh] flex flex-col`, header/footer are `shrink-0`, and only the body scrolls (`flex-1 min-h-0 overflow-y-auto`). `min-h-0` is load-bearing: without it flexbox's `min-height:auto` refuses to shrink the body, the panel outgrows the viewport, and a centered panel's header lands at a negative offset where it can never be scrolled to. That was the Add Warehouse bug.
- Pass `dirty` and every dismiss path (Esc, backdrop, X, footer `requestClose`) raises a discard confirm first. Wire footer Cancel to the `({ requestClose })` render-prop, not `onClose`, or it bypasses the guard.
- Overlays portal to `document.body` and take their z-index from `overlayStack.ts` (`BASE_Z = 1000`). Escape only ever closes the topmost. Don't reach for `z-[60]`.
- `useScrollLock` locks **`<main data-scroll-container>`**, not `document.body` — the AppShell root is `h-screen overflow-hidden` so the body never scrolls and a body lock is a silent no-op. Ref-counted, so a nested confirm can't unfreeze the page behind its parent.
- **The migration is finished and the guard is now absolute.** `components/overlay-baseline.json` is `"files": []` — every overlay in `components/`, `views/` and `context/` goes through `components/ui`. Keep the file (its `_comment` documents the ban); **never add an entry to it**. A new `fixed inset-0` fails CI outright, with the single permanent exemption of `components/AppShell.tsx` (mobile sidebar + order summary — app chrome, not dialogs).
- Two constraints the migration surfaced, both easy to trip over:
  - **`key` can never be passed to a typed local component.** With no `@types/react` there is no global JSX namespace, so `key` is checked against the component's own props and `<Modal key={x}>` errors. Wrap in `<React.Fragment key={x}>` instead.
  - **`max-h-[90vh]` is not a *definite* height.** A percentage-height child (`h-full` iframe/canvas) inside the `flex-1` body collapses to 0px. Give the body an explicit height via `bodyClassName` — see `context/DocumentViewerContext.tsx`.
- `components/admin/settings/primitives.tsx` re-exports `Field`/`Input`/`Select`/`Toggle` from `components/ui` for back-compat. New code should import from `components/ui` directly.
