import { useEffect, useState } from 'react'

// True while the user asks for reduced motion, following changes live. Shared by
// Nex's orb and the Nex mark, which both stay still when it is set.

const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [reduced, setReduced] = useState(() => supported && window.matchMedia(QUERY).matches)
  useEffect(() => {
    if (!supported) return
    const mq = window.matchMedia(QUERY)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [supported])
  return reduced
}
