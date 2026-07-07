import { useMutation } from '@tanstack/react-query'
import { runSimulation } from '@/services/supabase/simulationService'
import type { SimulationResult } from '@/types'

/** Run a what-if simulation for a layout. Not cached — each run is on-demand. */
export function useRunSimulation() {
  return useMutation<SimulationResult, Error, { layoutId: number; days?: number }>({
    mutationFn: ({ layoutId, days }) => runSimulation(layoutId, days),
  })
}
