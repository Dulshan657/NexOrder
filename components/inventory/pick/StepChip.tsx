// One of the confirmations of a scan-step pick, shown as a chip: done, current, or
// still to come. Shared by the directed row (PickTaskRow) and the unlisted-bin row.

import React from 'react'
import { Check } from 'lucide-react'

export const StepChip: React.FC<{
  label: string
  done: boolean
  active: boolean
  value: string
}> = ({ label, done, active, value }) => {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
        done
          ? 'bg-emerald-100 text-emerald-700'
          : active
            ? 'bg-nexgen-blue text-white'
            : 'bg-stone-100 text-stone-600'
      }`}
    >
      {done && <Check className="w-3 h-3" aria-hidden="true" />}
      {label}
      {done && value && <span className="font-mono opacity-70 max-w-[90px] truncate">{value}</span>}
    </span>
  )
}
