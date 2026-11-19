import { useMemo } from 'react'
import { roleCanOpenTab, type AdminTab } from '../lib/adminTabUrl'

/** Given a tab, a click handler — or `undefined` when the link must not render as one. */
export type DashNav = (tab: AdminTab) => (() => void) | undefined

/**
 * The one gate for every link on a dashboard (NX-0041).
 *
 * AdminView renders a BLANK page for a tab the role cannot open or whose module
 * is off in this build, so a dashboard tile that navigates blindly is a dead end
 * dressed as a link. `roleCanOpenTab` already folds both checks; this turns it
 * into "a handler, or nothing", and the kit renders nothing as a non-button.
 */
export function dashNavFor(role: string | undefined, navigate: ((tab: AdminTab) => void) | undefined): DashNav {
  return (tab) => {
    if (!navigate || !role || !roleCanOpenTab(role, tab)) return undefined
    return () => navigate(tab)
  }
}

export function useDashNav(role: string | undefined, navigate: ((tab: AdminTab) => void) | undefined): DashNav {
  return useMemo(() => dashNavFor(role, navigate), [role, navigate])
}
