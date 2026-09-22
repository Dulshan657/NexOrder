import React from 'react';

interface StickyScanBarProps {
    children: React.ReactNode;
    /**
     * Which padding scale the HOST page uses, so the bleed cancels exactly it.
     *
     * Not cosmetic: `ReceiveStockView` pads `p-4 sm:p-6 xl:p-8` while the three
     * putaway/stocktake hosts use `lg:p-8`. Bleeding 32px against 24px of
     * padding overhangs by 8px a side and puts a horizontal scrollbar on the
     * page between 1024px and 1279px — which is precisely what
     * `expectNoHorizontalOverflow` exists to catch, and what F25 was.
     */
    bleed?: 'lg' | 'xl';
    /**
     * Which edge of the scrollport to pin to. `'top'` is the default so every
     * existing caller keeps its behaviour; `'bottom'` is for the handheld
     * surfaces, where the field belongs under the thumb rather than up in the
     * glare.
     *
     * ── TWO THINGS THE CALLER MUST DO, NOT ONE ──────────────────────────────
     *
     * 1. RENDER THIS AS THE LAST CHILD OF THE PAGE ROOT. Sticky shifts in BOTH
     *    directions: left as a first child, `bottom-0` still pins the bar to the
     *    foot of the screen, but its ~60px of flow space stays reserved as a
     *    blank white band at the top of the page. It looks almost right, which
     *    is what makes it the likely way to get this wrong.
     *
     * 2. NOTHING MAY RENDER BELOW IT. Sticky is bounded by its containing
     *    block, so the bar un-pins the moment that block's bottom scrolls past —
     *    see the same trap written up at `warehouse/RackedWorkspace.tsx`, where a
     *    `sticky bottom-0` panel carried the operator away from the Apply button.
     *
     * The Android soft keyboard is already handled, and not by this file:
     * `index.html` sets `interactive-widget=resizes-content` (NOT the browser
     * default) precisely so a bottom-anchored bar is pushed up by the keyboard
     * instead of hidden behind it. That meta tag exists for the stocktake Post
     * bar (register F14); this is the same case.
     */
    position?: 'top' | 'bottom';
}

/** The two padding scales in use across the inventory pages, and nothing else.
 *  Add a third only after checking the host actually pads that way. */
const BLEED: Record<'lg' | 'xl', string> = {
    lg: '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
    xl: '-mx-4 px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8',
};

/**
 * The same cancellation, downwards, and only for a bottom dock.
 *
 * `sticky` stops pinning at the edge of its CONTAINING BLOCK, and the page root
 * carries bottom padding on the same scale as its sides. So at the very end of
 * the scroll the dock lifts by exactly that padding — 16px at 360px — and the
 * border that was sitting on the screen edge floats up off it. Measured, not
 * theorised: `tests/e2e/mobile/scan-dock.spec.ts` asserts the foot at both ends
 * of the scroll, and this is the difference between 648 and 664.
 *
 * Keyed off `bleed` rather than a fresh prop because the host has already
 * declared its padding scale there, and one declaration that can be wrong beats
 * two that can disagree.
 */
const BLEED_BOTTOM: Record<'lg' | 'xl', string> = {
    lg: '-mb-4 sm:-mb-6 lg:-mb-8',
    xl: '-mb-4 sm:-mb-6 xl:-mb-8',
};

/** The border faces the content the bar overlaps, so it reads as an edge rather
 *  than a stray hairline: a top bar is underlined, a bottom bar is overlined. */
const EDGE: Record<'top' | 'bottom', string> = {
    top: 'top-0 border-b',
    bottom: 'bottom-0 border-t',
};

/**
 * Pins a scan field to one edge of the page while the operator walks a list.
 *
 * ── WHY THIS IS NOT COSMETIC ────────────────────────────────────────────────
 *
 * On the RS35 the scanner runs in CipherLab's `Input Method` mode, and an
 * Android IME types into the FOCUSED EDITABLE and nowhere else. With nothing
 * focused there are simply no characters to hear — which is why
 * `lib/scan/useWedgeScanner.ts` documents its global stray-scan net as a
 * desktop safety valve that "cannot work" here (register O2, won't-fix, not
 * fixable in code).
 *
 * So on the handheld the scan field must be focused AND on screen, and
 * `PutawayScanFinder` arms the wedge with a comment claiming it "is on screen
 * for the whole walk". That premise is false at 360x664: two or three stop
 * cards push it out of view, and once it is gone the fallback that would have
 * covered for it does not exist on this device. The operator scans, nothing
 * happens, and nothing explains why.
 *
 * ── THE MECHANICS, EACH OF WHICH HAS A REASON ───────────────────────────────
 *
 * `sticky`, never `fixed`. `scripts/check-overlays.mjs` fails CI on a hand-rolled
 * full-screen backdrop outside `components/ui`, and more to the point a fixed bar
 * would have to be positioned against the viewport while it belongs to a
 * column that is offset by the 208px sidebar above `md`.
 *
 * `top-0` with NO offset, and that is load-bearing. `main[data-scroll-container]`
 * is the scroll container and the mobile top bar is a flow-positioned sibling
 * OUTSIDE it, so the top of the scrollport already sits below the bar. Had the
 * top bar been `position: fixed`, every one of these would need `top-[52px]` —
 * the same hand-maintained magic number the bar exists to delete.
 *
 * `bottom-0` needs no offset either, and for the mirror reason: `main` is the
 * LAST child of its column, so the bottom of the scrollport is the bottom of
 * what the operator can see. Nothing renders under it for this role.
 *
 * Opaque `bg-white`, no `backdrop-blur`. F35 measured that the cost is having a
 * backdrop-filter layer at all, and this one would repaint on every scroll frame
 * of a list the operator is actively scrolling.
 *
 * The negative margins cancel the host page's padding so the bar reaches both
 * edges. Without them the page's content shows through a 16px gutter on each
 * side as cards slide underneath, which reads as a rendering fault. The host's
 * scale is declared by the `bleed` prop, because it is NOT uniform — see there.
 *
 * `z-10` sits above the cards and below the top bar's `z-20`; they cannot
 * collide anyway, since this pins to the scrollport's top edge, which already
 * starts below the bar.
 */
const StickyScanBar: React.FC<StickyScanBarProps> = ({ children, bleed = 'lg', position = 'top' }) => {
    return (
        <div
            /* A test hook, and it earns its keep: "pinned" is a property of this
               BOX, not of the field inside it, and the two differ by the `py-2`.
               Measuring the input instead reports the dock as 8px short of the
               screen edge, which is indistinguishable from a dock that has come
               unstuck by 8px. There is no other stable selector here — the class
               list is the thing under test. */
            data-scan-dock={position}
            className={`sticky z-10 ${EDGE[position]} border-stone-200 bg-white py-2 ${BLEED[bleed]} ${
                position === 'bottom' ? BLEED_BOTTOM[bleed] : ''
            }`}
            /* Matches the one existing precedent in this codebase (`PantryList`):
               an inline `max()` rather than an arbitrary Tailwind value, so it
               degrades to the `py-2` this would otherwise be. Inert today — no
               `viewport-fit=cover` in index.html, so the inset resolves to 0 —
               and deliberately so: adding that meta changes the layout viewport
               for every screen in the app. This is forward-insurance only. */
            style={position === 'bottom' ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}
        >
            {children}
        </div>
    );
};

export default StickyScanBar;
