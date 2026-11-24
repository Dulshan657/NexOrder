// Who is offered the 3D live map (NX-0035). NOT lazy: this decides whether the
// lazy chunk is ever requested, so it must not live inside it.
//
// Desktop Admin/Manager only. The RS35 handheld (360px, coarse pointer) and the
// Warehouse role keep the 2D map, and a browser that cannot make a WebGL context
// is never offered a view that would render blank.

import { useEffect, useMemo, useState } from 'react'
import { UserRole } from '@/types'
import { MODULE_WAREHOUSE_3D } from '@/lib/modules'

/** Wide enough and precise enough to orbit a camera with a mouse. */
export const DESKTOP_QUERY = '(min-width: 1024px) and (pointer: fine)'

export interface Can3dInputs {
  moduleOn: boolean
  role: UserRole | string | null | undefined
  wideFinePointer: boolean
  webgl: boolean
}

export function can3d({ moduleOn, role, wideFinePointer, webgl }: Can3dInputs): boolean {
  if (!moduleOn || !wideFinePointer || !webgl) return false
  return role === UserRole.ADMIN || role === UserRole.MANAGER
}

/** Probes once per mount. A throwaway canvas: creating a context is cheap, and
 *  `getContext` returns null (never throws) where WebGL is blocked or absent. */
export function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl: any = canvas.getContext('webgl2') || canvas.getContext('webgl')
    // Release the probe's context now rather than at GC: Chrome caps live
    // contexts at ~16, and the 3D view itself will want one.
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}

function matchesDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP_QUERY).matches
}

export function useCan3d(role: UserRole | string | null | undefined): boolean {
  // The offer follows the window. It used to be read once per role, so dragging
  // the window below 1024px left the toggle, and the 3D view, in place (NX-0046).
  const [wideFinePointer, setWideFinePointer] = useState(matchesDesktop)
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(DESKTOP_QUERY) : undefined
    if (!mq?.addEventListener) return
    const onChange = () => setWideFinePointer(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return useMemo(
    () => {
      const base = { moduleOn: MODULE_WAREHOUSE_3D, role, wideFinePointer }
      // Probe WebGL last, and only for someone who would otherwise be offered 3D.
      if (!can3d({ ...base, webgl: true })) return false
      return can3d({ ...base, webgl: hasWebGL() })
    },
    [role, wideFinePointer],
  )
}
