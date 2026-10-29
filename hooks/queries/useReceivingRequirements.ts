import { useQuery } from '@tanstack/react-query'
import {
  listReceivingRequirements,
  type ReceivingRequirement,
} from '@/services/supabase/wmsAttributesService'

export const receivingRequirementKeys = {
  all: ['receiving-requirements'] as const,
}

/**
 * Which products must arrive with a lot code or an expiry (mig 00134, NX-0005).
 *
 * One request for the whole catalogue rather than one per staged line: the map
 * is sparse (only flagged products), and a scan must be able to show the
 * required field the instant the line appears. Invalidated by the Product WMS
 * attributes save, which is the only place the flags change.
 */
export function useReceivingRequirements() {
  return useQuery<Map<number, ReceivingRequirement>>({
    queryKey: receivingRequirementKeys.all,
    queryFn: listReceivingRequirements,
  })
}
