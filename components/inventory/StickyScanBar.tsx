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
}

/** The two padding scales in use across the inventory pages, and nothing else.
 *  Add a third only after checking the host actually pads that way. */
const BLEED: Record<'lg' | 'xl', string> = {
    lg: '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
    xl: '-mx-4 px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8',
};

/**
 * Pins a scan field to the top of the page while the operator walks a list.
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
const StickyScanBar: React.FC<StickyScanBarProps> = ({ children, bleed = 'lg' }) => {
    return (
        <div className={`sticky top-0 z-10 border-b border-stone-200 bg-white py-2 ${BLEED[bleed]}`}>
            {children}
        </div>
    );
};

export default StickyScanBar;
