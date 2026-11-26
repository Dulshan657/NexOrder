// Whether the order on screen is saved as a draft yet.

import React from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import type { SaveStatus } from './useNewOrderState'

export default function SaveStatusBadge({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === 'idle') return null
  if (status === 'error') {
    return (
      <span role="status" className="flex items-center gap-1 text-xs font-medium text-red-700" title={error ?? undefined}>
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Draft not saved
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-stone-600">
        <Check className="w-3.5 h-3.5" aria-hidden="true" /> Draft saved
      </span>
    )
  }
  return (
    <span role="status" className="flex items-center gap-1 text-xs text-stone-600">
      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Saving…
    </span>
  )
}
