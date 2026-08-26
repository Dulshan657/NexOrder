import React from 'react';
import { Menu } from 'lucide-react';

interface MobileTopBarProps {
    /** What this screen is called, already resolved to its display name. */
    title: string;
    onOpenMenu: () => void;
    /** The notification bell. Passed as a node so AppShell keeps ownership of
     *  NotificationCenter's props rather than this bar re-declaring six of them. */
    notifications?: React.ReactNode;
}

/**
 * The handheld's app bar: ☰, the screen's name, the notification bell.
 *
 * ── WHY THIS IS A FLEX SIBLING AND NOT `position: fixed` ────────────────────
 *
 * It renders in normal flow, immediately before `<main data-scroll-container>`
 * and inside the same column. `main` is `flex-1`, so it absorbs whatever is
 * left; nothing needs a `pt-[52px]`, and no page can ever be overlapped.
 *
 * That is the entire point. What this replaces was a `fixed top-4 left-4 z-30`
 * hamburger that floated over the page, and for which only four of the ten
 * warehouse screens reserved space (`pl-16`) — so on the other six it sat on top
 * of the page heading. Fixing that per-page is four edits to keep in sync
 * forever, and it was already out of sync. A bar in flow makes the collision
 * structurally impossible instead of individually avoided.
 *
 * It also keeps `sticky top-0` meaning what it says for everything INSIDE the
 * scroller. A fixed bar would push every sticky element in the app onto a
 * `top-[52px]` magic number — re-introducing the exact class of hand-maintained
 * clearance being deleted here.
 *
 * ── TWO SMALLER DECISIONS ───────────────────────────────────────────────────
 *
 * `relative z-20`: `main` is a LATER sibling, so without a stacking context of
 * its own this bar paints underneath the page's own shadows.
 *
 * No `backdrop-blur`. Two independent reasons: F35 measured that the cost is
 * having a backdrop-filter layer at all rather than its radius, and a filtered
 * element is a CONTAINING BLOCK — which is precisely the trap the sidebar sets
 * for the notification panel it hosts (F37). A bar that hosts the bell must not
 * repeat it.
 *
 * The title is a `<span>`, not a heading. Every page already renders its own
 * `<h1>` with the same words; a second one would mean two `h1`s per page and
 * would capture `getByRole('heading', { name })` in the existing specs.
 */
const MobileTopBar: React.FC<MobileTopBarProps> = ({ title, onOpenMenu, notifications }) => {
    return (
        <header
            data-mobile-topbar
            className="md:hidden shrink-0 relative z-20 flex h-13 items-center gap-2 border-b border-stone-200 bg-white px-2"
        >
            <button
                type="button"
                onClick={onOpenMenu}
                // `aria-label` is byte-identical to the button this replaces:
                // tests/e2e/mobile/helpers.ts navigates by it AND uses it as the
                // signal that the drawer has closed again.
                aria-label="Open menu"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 hover:text-stone-900 btn-press transition-colors cursor-pointer"
            >
                <Menu className="w-5 h-5" />
            </button>
            <span className="min-w-0 flex-1 truncate font-display text-base font-semibold tracking-tight text-stone-900">
                {title}
            </span>
            {notifications}
        </header>
    );
};

export default MobileTopBar;
