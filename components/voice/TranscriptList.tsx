import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '@/lib/voice/transcript'
import { isNearBottom } from './transcriptScroll'

// The conversation as bubbles: the user on the right on stone-100, the assistant
// on the left on white. A line still arriving is italic. It is its own scroller
// (the sheet body does not scroll) so it can follow the newest line, but only
// while the reader is at the bottom (transcriptScroll.ts).

export interface TranscriptListProps {
  entries: readonly TranscriptEntry[]
}

const BUBBLE_BASE = 'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words'
const BUBBLE_ROLE = {
  user: 'self-end bg-stone-100 text-stone-900 rounded-br-md',
  assistant: 'self-start bg-white text-stone-800 border border-stone-200 rounded-bl-md',
} as const

export function TranscriptList({ entries }: TranscriptListProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  // Measured on scroll, i.e. BEFORE the update that adds content: after it the
  // new line has already pushed the bottom away.
  const stick = useRef(true)
  const count = entries.length
  const lastText = count > 0 ? entries[count - 1].text : ''

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [count, lastText])

  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)
  }

  return (
    <div
      ref={scroller}
      role="log"
      aria-label="Conversation"
      onScroll={onScroll}
      className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 rounded-xl bg-stone-50 p-3"
    >
      {count === 0 ? (
        <p className="m-auto max-w-[16rem] text-center text-sm text-stone-600">
          Hi, I&apos;m Nex. Ask me about your sales, targets, customers or stock.
        </p>
      ) : (
        entries.map((entry) => (
          <p key={entry.id} className={`${BUBBLE_BASE} ${BUBBLE_ROLE[entry.role]}`}>
            <span className="sr-only">{entry.role === 'user' ? 'You: ' : 'Nex: '}</span>
            <span className={entry.final ? undefined : 'italic text-stone-600'}>{entry.text || '…'}</span>
          </p>
        ))
      )}
    </div>
  )
}
