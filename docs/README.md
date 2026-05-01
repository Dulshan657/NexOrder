# Nex Order — Documentation

This folder holds the long-form product and production specification.

## Files

- **`PRODUCT_SPEC.html`** — single self-contained spec covering roles & capabilities, ~95 user stories, eight end-to-end use cases, what's shipped, every known production gap, and the recommended sequence to launch. Audience: internal dev-team handoff.

## Regenerate the PDF

`PRODUCT_SPEC.html` is the source of truth. To produce a PDF:

1. Open `docs/PRODUCT_SPEC.html` in Chrome.
2. `Ctrl+P` → Destination: **Save as PDF** → Paper size: **A4** → Margins: **Default** → Background graphics: **on**.
3. Save next to the HTML as `PRODUCT_SPEC.pdf`. The PDF is ignored by git (regenerate when the HTML changes).

## When to update

Re-edit `PRODUCT_SPEC.html` whenever:

- A new role or capability is introduced (update §2 matrix and the relevant epic in §3).
- An item moves from "Pending Work" to shipped (move it from §6.1 to §5).
- A new audit finding surfaces (add a row to §6.2).
- The prioritisation in §7 changes.

The `CLAUDE.md` file at the repo root remains the canonical engineer onboarding doc. This spec is the longer-form companion.
