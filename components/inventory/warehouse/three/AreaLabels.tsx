// Floating area names and floor signs (NX-0035), as screen labels.
//
// Rendered by ScreenLabels' DOM overlay — NOT drei `Html` (whose separate React
// root crashed the view on warehouse switch; see ScreenLabels.tsx) and NOT drei
// `Text` (troika: CDN font + workers the CSP refuses). App fonts, plain DOM.

import type { SceneLabel } from '@/lib/warehouse3d/buildScene'
import type { ScreenLabel } from './ScreenLabels'

export function areaLabelItems(labels: readonly SceneLabel[]): ScreenLabel[] {
  return labels.map((l) => ({
    key: `label:${l.key}`,
    position: l.position,
    content: (
      <span
        className={
          l.kind === 'area'
            ? 'whitespace-nowrap rounded-md bg-white/90 px-2 py-0.5 font-display text-xs font-bold text-stone-800 shadow-sm ring-1 ring-stone-200'
            : 'whitespace-nowrap rounded bg-stone-800/85 px-1.5 py-0.5 text-[11px] font-semibold text-white'
        }
      >
        {l.text}
      </span>
    ),
  }))
}
