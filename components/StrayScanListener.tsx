// "You scanned, and this screen wasn't listening."
//
// Mounted once, app-wide. It renders nothing and exists purely to break a
// silence: on any surface that does not opt into `useWedgeScanner` — which is
// most of them — a scan fired with nothing focused produced characters that went
// to the body and vanished. No beep from the app, no message, no trace. The gun
// beeped, because the gun always beeps; it means "I read a barcode" and nothing
// about whether anything received it.
//
// That is the failure `lib/scan/scanFeedback.ts` wrote `playScanStray` for, with
// its own deliberately-third voice — two soft blips, neither the accept blip nor
// the reject buzz, because this is not a refusal. It is "say that again
// somewhere useful". It had never been called.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// It does not reopen either of the two stray-scan defects that are closed by
// design, and it must not be extended in either direction:
//
//   - A scan aimed at some OTHER input still lands in that input. Catching that
//     means preventDefault on characters not yet classified as a scan, which
//     risks eating real typing. The stand-down rule in `useWedgeScanner` is the
//     entire reason a wedge gun cannot corrupt a quantity box, and it is worth
//     more than this feature.
//   - Under Android's "Input Method" scanner mode, nothing focused means no
//     characters anywhere, so there is nothing here to hear. That is a property
//     of Android text input. The RS35 is configured for Key Event mode.
//
// What changed is only that the dropped scan is now audible. Both defects keep
// their reasoning.

import { useSyncExternalStore } from 'react'
import { useWedgeScanner } from '../lib/scan/useWedgeScanner'
import {
  hasActiveWedgeConsumer,
  subscribeWedgeConsumers,
} from '../lib/scan/wedgeRegistry'
import { playScanStray } from '../lib/scan/scanFeedback'
import { useToasts } from '../hooks/useToasts'

/**
 * Whether a real scanning surface currently holds wedge capture.
 *
 * `getServerSnapshot` is supplied because the unit suite renders under jsdom
 * through the same path; it can only ever be false there, which is correct — no
 * surface has mounted.
 */
function useHasWedgeConsumer(): boolean {
  return useSyncExternalStore(
    subscribeWedgeConsumers,
    hasActiveWedgeConsumer,
    () => false,
  )
}

export function StrayScanListener(): null {
  const claimed = useHasWedgeConsumer()
  const { addToast } = useToasts()

  useWedgeScanner({
    // Stand aside entirely whenever a real surface is listening. Receive Stock
    // handling a scan usefully must not also be told the scan went nowhere.
    active: !claimed,
    // Never claim capture — see `UseWedgeScannerOptions.claim`. This is the one
    // caller in the app that passes false.
    claim: false,
    onScan: (code) => {
      // Re-checked synchronously, after the subscription has already decided.
      // The subscription is a render-time value and can be one frame stale;
      // that one frame is exactly the mount window in which a surface has
      // claimed capture but this listener has not yet torn itself down.
      if (hasActiveWedgeConsumer()) return

      playScanStray()
      addToast(`Scanned ${code} — this screen isn't listening for scans.`, 'info')
    },
  })

  return null
}

export default StrayScanListener
