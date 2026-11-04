// scripts/nex-golden.mjs — ask Nex the golden questions on dev and score the answers.
//
//   npm run nex:golden:dev                     # every case
//   npm run nex:golden:dev -- --only=a,b       # just these case ids
//
// An INSTRUMENT, like the NX-0009 voice spec: it drives the real Nex on
// nexorder.vercel.app (login, voice-session, the OpenAI Realtime session, the
// tools running in the browser) and so spends voice minutes. Never in CI.
//
// Questions are TYPED into the sheet, one session per role, asked in file order
// (later questions may lean on earlier ones, "place that order"). Every tool call
// Nex makes and the output it is given are read off the Realtime data channel, so
// the report separates a tool that returned the wrong thing from an answer that
// said the wrong thing. lib/voice/golden/score.ts scores each case.
//
// Each session is ENDED before the browser closes: an abandoned one is billed at
// the full 15-minute cap (docs/claude/voice-assistant.md).
//
// The functions handed to Playwright (addInitScript, evaluate, waitForFunction)
// run in the page, so they name browser globals.
/* global window, document, RTCPeerConnection */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { TARGETS } from '../config/environments.mjs'
import { USERS } from '../supabase/seedData/users.ts'
import { parseGoldenCases, scoreGoldenCase } from '../lib/voice/golden/score.ts'
import { ROOT, parseEnvFile } from './lib/env.mjs'
import { parseNexGoldenArgs } from './lib/nexGoldenArgs.mjs'

const ANSWER_TIMEOUT_MS = 60_000
const SETTLE_MS = 5_000
const OUT_DIR = join(ROOT, 'test-results', 'nex-golden')

const args = parseNexGoldenArgs(process.argv.slice(2))
const target = TARGETS[args.env]
const password = parseEnvFile(join(ROOT, '.env.dev.local')).SEED_USER_PASSWORD
if (!password) throw new Error('nex-golden: SEED_USER_PASSWORD is missing from .env.dev.local')

const all = parseGoldenCases(JSON.parse(readFileSync(join(ROOT, '__tests__', 'voice', 'golden', 'questions.json'), 'utf8')))
const cases = args.only ? all.filter((c) => args.only.includes(c.id)) : all
if (cases.length === 0) throw new Error('nex-golden: no case matches --only')

/** Runs in the page before the app: records the Realtime events the score needs. */
function captureRealtime() {
  window.__nexEvents = []
  const keep = new Set(['response.function_call_arguments.done', 'conversation.item.create', 'error'])
  const record = (raw) => {
    try {
      const event = JSON.parse(raw)
      if (keep.has(event.type)) window.__nexEvents.push(event)
    } catch {
      // not JSON: not an event we score
    }
  }
  const create = RTCPeerConnection.prototype.createDataChannel
  RTCPeerConnection.prototype.createDataChannel = function (...rest) {
    const channel = create.apply(this, rest)
    const send = channel.send.bind(channel)
    channel.send = (data) => {
      record(data)
      return send(data)
    }
    channel.addEventListener('message', (message) => record(message.data))
    return channel
  }
}

async function transcript(page) {
  return page.getByRole('log', { name: 'Conversation' }).locator('p').evaluateAll((nodes) =>
    nodes
      .filter((p) => p.querySelector('.sr-only'))
      .map((p) => {
        const spans = p.querySelectorAll('span')
        return {
          who: (spans[0]?.textContent ?? '').startsWith('You') ? 'You' : 'Nex',
          text: spans[1]?.textContent ?? '',
          final: !(spans[1]?.className ?? '').includes('italic'),
        }
      }),
  )
}

/** Tool calls paired with the outputs Nex was given, from the recorded events. */
function callsFrom(events) {
  const names = new Map()
  for (const e of events) if (e.type === 'response.function_call_arguments.done') names.set(e.call_id, { name: e.name, args: e.arguments })
  return events
    .filter((e) => e.type === 'conversation.item.create' && e.item?.type === 'function_call_output')
    .map((e) => {
      let output = e.item.output
      try {
        output = JSON.parse(output)
      } catch {
        // keep the raw text
      }
      const call = names.get(e.item.call_id)
      return { name: call?.name ?? 'unknown', args: call?.args, output }
    })
}

/** Type one question and wait until Nex's reply has settled; returns the reply and the calls. */
async function ask(page, question) {
  const before = (await transcript(page)).length
  const eventsBefore = await page.evaluate(() => window.__nexEvents.length)
  const input = page.getByLabel('Type a message')
  await input.fill(question)
  await input.press('Enter')
  const started = Date.now()
  let lines = []
  let last = ''
  let stableSince = Date.now()
  while (Date.now() - started < ANSWER_TIMEOUT_MS) {
    await page.waitForTimeout(1000)
    lines = (await transcript(page)).slice(before)
    const signature = JSON.stringify(lines)
    if (signature !== last) {
      last = signature
      stableSince = Date.now()
    }
    const answered = lines.some((l) => l.who === 'Nex' && l.final) && lines.every((l) => l.final)
    if (answered && Date.now() - stableSince > SETTLE_MS) break
  }
  const events = (await page.evaluate(() => window.__nexEvents)).slice(eventsBefore)
  const finals = lines.filter((l) => l.who === 'Nex' && l.final).map((l) => l.text)
  return { said: finals, answer: finals.join(' '), calls: callsFrom(events), ms: Date.now() - started }
}

async function endSession(page) {
  const end = page.getByRole('button', { name: 'End', exact: true })
  if (!(await end.isVisible().catch(() => false))) return
  const recorded = page
    .waitForResponse((r) => r.url().includes('/functions/v1/voice-session') && r.request().method() === 'POST', { timeout: 15_000 })
    .catch(() => console.warn('[nex-golden] End was pressed but voice-session did not answer in 15 s'))
  await end.click()
  await recorded
}

async function runRole(browser, role, roleCases) {
  const user = USERS.find((u) => u.role === role)
  if (!user) throw new Error(`nex-golden: no demo user has the role ${role}`)
  const context = await browser.newContext({ baseURL: target.appOrigin, permissions: ['microphone'], viewport: { width: 1400, height: 900 } })
  await context.addInitScript(captureRealtime)
  const page = await context.newPage()
  const results = []
  try {
    await page.goto('/')
    await page.getByLabel('Email address').fill(user.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.getByRole('navigation').first().waitFor({ state: 'visible', timeout: 20_000 })
    // The tools read the app's own caches: give the queries time to load.
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.getByRole('button', { name: 'Talk to Nex' }).click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="Type a message"]')?.disabled === false, null, { timeout: 30_000 })
    const mute = page.getByRole('button', { name: 'Mute', exact: true })
    if (await mute.isVisible().catch(() => false)) await mute.click()

    const earlierCalls = []
    for (const c of roleCases) {
      const run = await ask(page, c.question)
      const score = scoreGoldenCase(c, { ...run, earlierCalls: [...earlierCalls] })
      earlierCalls.push(...run.calls)
      results.push({ ...c, ...run, ...score })
      const detail = [...score.problems, ...(score.unchecked ?? []).map((f) => `unchecked (empty list): ${f}`)]
      console.log(`${score.pass ? 'PASS' : 'FAIL'}  ${c.id}${detail.length ? `\n      ${detail.join('\n      ')}` : ''}\n      Nex: ${run.answer}`)
    }
  } finally {
    await endSession(page).catch((error) => console.warn(`[nex-golden] could not end the ${role} session: ${error.message}`))
    await context.close()
  }
  return results
}

/** Two minutes of 24 kHz mono silence: Chromium's default fake microphone is a beep Nex would try to answer. */
function writeSilence(path) {
  const samples = 24_000 * 120
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + samples * 2, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24_000, 24)
  wav.writeUInt32LE(48_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  writeFileSync(path, wav)
}

mkdirSync(OUT_DIR, { recursive: true })
const silence = join(OUT_DIR, 'silence.wav')
writeSilence(silence)
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${silence}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const results = []
try {
  for (const role of [...new Set(cases.map((c) => c.role))]) {
    console.log(`\n== ${role}`)
    results.push(...(await runRole(browser, role, cases.filter((c) => c.role === role))))
  }
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.pass).length
mkdirSync(OUT_DIR, { recursive: true })
const file = join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
const version = await fetch(`${target.appOrigin}/version.json`).then((r) => r.json()).catch(() => null)
writeFileSync(file, JSON.stringify({ target: args.env, version, passed, total: results.length, results }, null, 2))
console.log(`\n${passed}/${results.length} passed on ${target.appOrigin} (${version?.sha?.slice(0, 7) ?? 'unknown sha'})\nreport: ${file}`)
process.exitCode = passed === results.length ? 0 : 1
