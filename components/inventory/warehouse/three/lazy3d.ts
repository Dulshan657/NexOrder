// THE ONE place the 3D view is declared (NX-0035).
//
// Gated on the folded module constant, so where `warehouse_3d` is off this is
// `false ? … : null`, Rollup deletes the `import()`, and three.js is NOT SHIPPED —
// not merely hidden. Never import './Warehouse3DView' (or three, or
// @react-three/*) from anywhere else: that would put it in an eager chunk.
// __tests__/warehouse3d/lazyGate.test.ts pins this line.

import { MODULE_WAREHOUSE_3D } from '@/lib/modules'
import { lazyWithRetry } from '@/lib/lazyWithRetry'

export const Warehouse3DView = MODULE_WAREHOUSE_3D ? lazyWithRetry(() => import('./Warehouse3DView')) : null
