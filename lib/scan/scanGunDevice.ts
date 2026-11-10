// Is this device a scan gun?
//
// The answer decides ONE thing: whether ScanField keeps Android's soft keyboard
// down and offers a keyboard button instead. On a gun the scan box holds focus
// permanently, so an always-up keyboard covers half the screen for nothing. On a
// phone or tablet the operator types into the box and needs the keyboard — so a
// wrong "yes" there is far worse than a wrong "no", and both checks below lean
// towards "no".
//
// Two ways to know, either is enough:
//
//   1. The device model. Chrome's reduced User-Agent no longer carries it, but
//      `navigator.userAgentData.getHighEntropyValues(['model'])` does on Android
//      (secure contexts only). Async, so it lands a moment after first render.
//   2. Having seen it. A machine-speed burst ending in a commit is a hardware
//      scanner by definition. Remembered in localStorage, so from the next load
//      on the keyboard is down from the very first frame.
//
// Browser storage can throw (private mode, blocked site data); every access is
// guarded and failure simply means "not known to be a gun".

import { useEffect, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'nex.scanGun'

/** CipherLab handhelds: the RS35 in use, and its RS3x siblings. */
const GUN_MODEL_PATTERN = /\bRS3\d\b|cipherlab/i

export function isScanGunModel(model: string): boolean {
  return GUN_MODEL_PATTERN.test(model)
}

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1')
  } catch {
    // Not remembered across reloads; this session still knows.
  }
}

let isGun = readStored()
let modelChecked = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => isGun
const getServerSnapshot = () => false

/** Record that this device is a scan gun. Idempotent. */
export function markScanGun(): void {
  if (isGun) return
  isGun = true
  writeStored()
  listeners.forEach((listener) => listener())
}

interface UserAgentDataLike {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>
}

async function checkModelOnce(): Promise<void> {
  if (modelChecked || isGun) return
  modelChecked = true
  const uaData = (globalThis.navigator as { userAgentData?: UserAgentDataLike } | undefined)
    ?.userAgentData
  if (!uaData?.getHighEntropyValues) return
  try {
    const { model = '' } = await uaData.getHighEntropyValues(['model'])
    if (isScanGunModel(model)) markScanGun()
  } catch {
    // Refused or unsupported: fall back to learning from a scan.
  }
}

export function useIsScanGun(): boolean {
  useEffect(() => {
    void checkModelOnce()
  }, [])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Test seam: forget everything, optionally keeping what storage holds. */
export function resetScanGunForTests({ keepStorage = false } = {}): void {
  if (!keepStorage) {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  isGun = readStored()
  modelChecked = false
}
