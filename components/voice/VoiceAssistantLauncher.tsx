import { useCallback, useMemo, useState } from 'react'
import { useVoiceSession } from '@/hooks/useVoiceSession'
import { useToastActions } from '@/hooks/useToasts'
import { reportError } from '@/lib/errorReporter'
import { runVoiceTool } from '@/lib/voice/runVoiceTool'
import type { VoiceToolContext, VoiceToolResult } from '@/lib/voice/runVoiceTool'
import type { AppSettings, HoReCa, Order, Product, SalesTarget, ScheduledVisit, User, Visit } from '@/types'
import { VoiceAssistantButton } from './VoiceAssistantButton'
import { VoiceAssistantSheet } from './VoiceAssistantSheet'
import { enabledModules } from './enabledModules'

// Nex Assistant's entry point, lazily loaded by AppShell only where the module is
// built in and the role may use it. It owns the session (useVoiceSession), the
// floating button and the sheet, and builds what every tool call reads: a
// snapshot of the data the app already holds, with `now` stamped per call.
//
// THE TAP STARTS THE SESSION IN THE SAME HANDLER THAT OPENS THE SHEET. iOS lets
// audio.play() (and the mic prompt) happen only inside a user gesture; deferring
// start() to an effect after the sheet renders would leave the gesture behind.

export interface VoiceAssistantLauncherProps {
  currentUser: User
  currentUserUuid: string
  allOrders: Order[]
  products: Product[]
  hoReCas: HoReCa[]
  salesTargets: SalesTarget[]
  visits: Visit[]
  routes: ScheduledVisit[]
  appSettings: AppSettings
}

type StableContext = Omit<VoiceToolContext, 'now'>

function useStableContext(props: VoiceAssistantLauncherProps): StableContext {
  const { currentUser, currentUserUuid, allOrders, products, hoReCas, salesTargets, visits, routes, appSettings } = props
  const lowStockThreshold = appSettings.lowStockThreshold
  const user = useMemo(
    () => ({ numericId: currentUser.id, uuid: currentUserUuid, role: currentUser.role, name: currentUser.name }),
    [currentUser.id, currentUserUuid, currentUser.role, currentUser.name],
  )
  const settings = useMemo(() => ({ lowStockThreshold }), [lowStockThreshold])
  return useMemo(
    () => ({ orders: allOrders, products, hoReCas, salesTargets, visits, routes, settings, user, modules: enabledModules() }),
    [allOrders, products, hoReCas, salesTargets, visits, routes, settings, user],
  )
}

function reportToolError(toolName: string, error: unknown): void {
  reportError({
    message: `Nex Assistant tool failed: ${toolName}`,
    stack: error instanceof Error ? error.stack : undefined,
    metadata: { toolName, error: error instanceof Error ? error.message : String(error) },
  })
}

export default function VoiceAssistantLauncher(props: VoiceAssistantLauncherProps) {
  const { addToast } = useToastActions()
  const [open, setOpen] = useState(false)
  const context = useStableContext(props)

  const runTool = useCallback(
    (name: string, args: unknown): VoiceToolResult => runVoiceTool(name, args, { ...context, now: new Date() }, { onError: reportToolError }),
    [context],
  )
  const onWarning = useCallback((message: string) => addToast(message, 'info'), [addToast])
  const session = useVoiceSession({ runTool, onWarning })

  const handleOpen = () => {
    setOpen(true)
    // Synchronous, inside the tap: see the header.
    session.start().catch((error: unknown) => {
      reportError({ message: 'Nex Assistant failed to start', stack: error instanceof Error ? error.stack : undefined })
    })
  }
  const handleClose = useCallback(() => setOpen(false), [])

  return (
    <>
      {!open && <VoiceAssistantButton onClick={handleOpen} />}
      <VoiceAssistantSheet open={open} session={session} onClose={handleClose} />
    </>
  )
}
