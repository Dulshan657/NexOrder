// Floating area names and floor signs (NX-0035).
//
// drei `Html` — DOM text in the app's own fonts — and deliberately NOT drei
// `Text`: that is troika, which fetches a font and builds workers in ways the
// `script-src 'self'` CSP refuses. lazyGate.test.ts holds the allow-list.

import { Html } from '@react-three/drei'
import type { SceneLabel } from '@/lib/warehouse3d/buildScene'

export interface AreaLabelsProps {
  labels: readonly SceneLabel[]
}

export function AreaLabels({ labels }: AreaLabelsProps) {
  return (
    <group>
      {labels.map((l) => (
        <Html key={l.key} position={l.position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <span
            className={
              l.kind === 'area'
                ? 'whitespace-nowrap rounded-md bg-white/90 px-2 py-0.5 font-display text-xs font-bold text-stone-800 shadow-sm ring-1 ring-stone-200'
                : 'whitespace-nowrap rounded bg-stone-800/85 px-1.5 py-0.5 text-[11px] font-semibold text-white'
            }
          >
            {l.text}
          </span>
        </Html>
      ))}
    </group>
  )
}
