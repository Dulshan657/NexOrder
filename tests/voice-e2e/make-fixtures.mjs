// Records the spoken questions the Nex end-to-end spec plays into a fake
// microphone. Run once; the WAVs are committed so a normal run calls OpenAI only
// for the conversation itself.
//
//   node tests/voice-e2e/make-fixtures.mjs
//
// Reads OPENAI_API_KEY from .env.dev.local (never printed). Each file is PCM16
// mono 24 kHz WAV, which Chromium's --use-file-for-fake-audio-capture accepts,
// with silence before the question (so the session is listening when it starts)
// and after it (so server-side voice detection hears the end of the turn).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const OUT = join(HERE, 'fixtures')
const SAMPLE_RATE = 24_000
const LEAD_SECONDS = 3
const TAIL_SECONDS = 4

export const QUESTIONS = {
  processed: 'How many orders did we process this month?',
  'came-in': 'How many orders came in this month?',
}

function apiKey() {
  const env = readFileSync(join(ROOT, '.env.dev.local'), 'utf8')
  const line = env.split(/\r?\n/).find((l) => l.startsWith('OPENAI_API_KEY='))
  const key = line?.slice('OPENAI_API_KEY='.length).trim()
  if (!key) throw new Error('OPENAI_API_KEY is missing from .env.dev.local')
  return key
}

function wav(pcm) {
  const lead = Buffer.alloc(LEAD_SECONDS * SAMPLE_RATE * 2)
  const tail = Buffer.alloc(TAIL_SECONDS * SAMPLE_RATE * 2)
  const data = Buffer.concat([lead, pcm, tail])
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function speak(text, key) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
  })
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = apiKey()
  mkdirSync(OUT, { recursive: true })
  for (const [name, text] of Object.entries(QUESTIONS)) {
    const file = join(OUT, `${name}.wav`)
    writeFileSync(file, wav(await speak(text, key)))
    console.log(`wrote ${file}`)
  }
}
