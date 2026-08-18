/*
 * Tell an operator on a too-old browser that the browser is the problem.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Tailwind v4 needs Chrome 111 / Safari 16.4 / Firefox 128. Below that the CSS
 * simply does not apply and the app renders as unstyled markup — a wall of
 * left-aligned black text on white. The reported symptom is "the app looks
 * completely broken", on a managed handheld, and the first thing suspected is
 * the scanner, which is innocent. Diagnosing it took an afternoon.
 *
 * `vite.config.ts` now pins `build.target` to that same floor, which is correct
 * but makes this file MANDATORY rather than nice to have: with the target
 * raised, an older browser can no longer parse the bundle at all, so the failure
 * mode changes from unstyled-but-present to a white screen. A white screen says
 * even less than a broken layout. This is what replaces it.
 *
 * ── WHY IT IS A SEPARATE FILE AND NOT INLINE ────────────────────────────────
 *
 * `vercel.ts` sets `script-src 'self'` with no `'unsafe-inline'`, so an inline
 * <script> in index.html is blocked in production — silently, and only in
 * production, which is the worst possible place to discover it. `'self'` permits
 * this file. The NOTICE MARKUP is inline in index.html and styled with a `style`
 * attribute, which is fine: `style-src` does carry `'unsafe-inline'`.
 *
 * ── CONSTRAINTS ─────────────────────────────────────────────────────────────
 *
 * ES5 ONLY. No const/let, no arrow functions, no template literals. This file
 * runs on precisely the browsers that cannot parse the modern bundle; a syntax
 * error here would be a white screen with no explanation, which is the exact
 * outcome it exists to prevent.
 *
 * It is a CLASSIC script, not a module. Module scripts are deferred, so this
 * runs first wherever it sits in the document, and an old browser would ignore
 * `type="module"` entirely.
 *
 * It must FAIL TOWARD SHOWING THE NOTICE. A browser too old to have `CSS` or
 * `CSS.supports` at all is far below the floor.
 */
(function () {
  'use strict';

  /*
   * Feature test, never a UA sniff. A managed handheld can carry any WebView
   * string, and a version number parsed out of one is a guess about a capability
   * we can simply ask about.
   *
   * TWO features, because no single one draws the line on every engine:
   *
   *   color-mix()  — Chrome 111, Safari 16.2, Firefox 113. This is the Chrome
   *                  boundary, and Chrome is what is on the floor.
   *   @property    — Chrome 85, Safari 16.4, Firefox 128. This is the Firefox
   *                  and Safari boundary. Probed through `CSS.registerProperty`,
   *                  its JS half, which ships with it.
   *
   * Together they land on Tailwind v4's stated floor on all three engines.
   * Testing only color-mix would pass a Firefox 113-127 that cannot render the
   * app.
   */
  function isSupported() {
    if (!window.CSS || typeof window.CSS.supports !== 'function') return false;
    if (typeof window.CSS.registerProperty !== 'function') return false;
    try {
      return window.CSS.supports('color', 'color-mix(in srgb, red, blue)');
    } catch (e) {
      return false;
    }
  }

  /*
   * Best-effort version, for the notice only — never for the decision above.
   * Shown because "Chrome 96" is something an operator can act on and read out
   * over the phone, where "your browser is old" is not.
   */
  function engineLabel() {
    var ua = navigator.userAgent || '';
    var m = ua.match(/(?:Chrome|Chromium|CriOS)\/(\d+)/);
    if (m) return 'Chrome ' + m[1];
    /* iOS puts `Mobile/15E148` between the version and the Safari token, and
       desktop does not. Matching only the desktop shape reported nothing at all
       on an iPhone, which is the likelier device to be below the floor. */
    m = ua.match(/Version\/(\d+)[\d.]*(?:\s+Mobile\/\S+)?\s+Safari/);
    if (m) return 'Safari ' + m[1];
    m = ua.match(/Firefox\/(\d+)/);
    if (m) return 'Firefox ' + m[1];
    return null;
  }

  if (isSupported()) return;

  function reveal() {
    var notice = document.getElementById('unsupported-browser');
    var root = document.getElementById('root');
    if (!notice) return;

    var found = engineLabel();
    if (found) {
      var slot = document.getElementById('unsupported-browser-detected');
      if (slot) {
        slot.textContent = 'This device reports ' + found + '.';
      }
    }

    notice.style.display = 'block';
    /* The app cannot have rendered — the bundle did not parse — but an empty
       #root still reserves layout. Removing it keeps the notice at the top. */
    if (root) root.style.display = 'none';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reveal);
  } else {
    reveal();
  }
})();
