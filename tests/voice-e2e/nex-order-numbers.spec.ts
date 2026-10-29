// NX-0008 — Nex, end to end, by VOICE.
//
// Chromium gets a fake microphone that plays a recorded question
// (fixtures/*.wav, made by make-fixtures.mjs), so the whole real path runs:
// login, the voice-session Edge Function, the OpenAI Realtime session over
// WebRTC, speech recognition, Nex choosing get_sales_summary, the tool running in
// the browser on the app's own data, and Nex speaking the answer. The test reads
// Nex's transcript and checks the number against SQL on the same database.
//
// An INSTRUMENT, not a regression test: it costs OpenAI minutes and depends on a
// language model, so it is excluded from `npm run test:e2e` and CI, like `soak`.
//   E2E_BASE_URL=https://nexorder.vercel.app npx playwright test --project=voice
//
// "Processed this month" must be answered with SHIPPED (by ship date), "came in"
// with PLACED (by order date): the two words the owner and Nex once disagreed on.

import { chromium, expect, test, type Page } from '@playwright/test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { loginAsAdmin } from '../e2e/fixtures/auth'
import { hasDbCreds, withRollbackTx } from '../../__tests__/support/pgTestClient'
import { sqlTruth, type SqlTruth } from '../../__tests__/support/orderNumbersSql'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ANSWER_TIMEOUT_MS = 90_000

interface Line {
  who: 'You' | 'Nex'
  text: string
  final: boolean
}

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** A number as Nex might say it: "22", "twenty-two" or "twenty two". */
export function spokenForms(n: number): RegExp {
  const forms = [String(n)]
  if (n < 20) forms.push(WORDS[n])
  else if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]
    const unit = n % 10
    forms.push(unit === 0 ? tens : `${tens}[- ]${WORDS[unit]}`)
  }
  return new RegExp(`\\b(${forms.join('|')})\\b`, 'i')
}

async function readTruth(): Promise<SqlTruth> {
  let truth: SqlTruth | null = null
  await withRollbackTx(async (client: pg.Client) => {
    truth = await sqlTruth(client)
  })
  if (!truth) throw new Error('SQL truth was not computed')
  return truth
}

async function transcript(page: Page): Promise<Line[]> {
  return page.getByRole('log', { name: 'Conversation' }).locator('p').evaluateAll((nodes) =>
    nodes
      .filter((p) => p.querySelector('.sr-only'))
      .map((p) => {
        const spans = p.querySelectorAll('span')
        const who = (spans[0]?.textContent ?? '').startsWith('You') ? 'You' : 'Nex'
        const body = spans[1]
        return { who, text: body?.textContent ?? '', final: !(body?.className ?? '').includes('italic') }
      }),
  ) as Promise<Line[]>
}

/** Ask Nex one recorded question in a fresh browser and return the conversation once Nex has answered with a number. */
async function ask(question: string): Promise<Line[]> {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${join(FIXTURES, `${question}.wav`)}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  try {
    const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, permissions: ['microphone'] })
    const page = await context.newPage()
    await loginAsAdmin(page)
    await page.getByRole('button', { name: 'Talk to Nex' }).click()

    let lines: Line[] = []
    try {
      await expect
        .poll(
          async () => {
            lines = await transcript(page)
            const heard = lines.some((l) => l.who === 'You' && l.final)
            // Nex often says "let me check" first; wait for a FINAL reply carrying a number.
            const answered = lines.some((l) => l.who === 'Nex' && l.final && /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|teen|twenty|thirty|forty)/i.test(l.text))
            return heard && answered
          },
          { timeout: ANSWER_TIMEOUT_MS, intervals: [1000] },
        )
        .toBe(true)
    } catch (error) {
      // The spec owns this browser, so Playwright's own failure screenshot cannot see it.
      await page.screenshot({ path: test.info().outputPath(`${question}-failed.png`) })
      console.info(`[nex:${question}] no answer; transcript so far`, JSON.stringify(lines))
      throw error
    }
    console.info(`[nex:${question}]`, JSON.stringify(lines))
    return lines
  } finally {
    await browser.close()
  }
}

function nexSaid(lines: Line[]): string {
  return lines.filter((l) => l.who === 'Nex' && l.final).map((l) => l.text).join(' ')
}

test.describe('Nex answers order questions with the same numbers as the database', () => {
  test.skip(!hasDbCreds(), 'needs dev database credentials in .env.dev.local')
  test.setTimeout(180_000)

  test('"how many orders did we process this month" is answered with orders shipped', async () => {
    const truth = await readTruth()
    const lines = await ask('processed')
    expect(lines.find((l) => l.who === 'You')?.text ?? '').toMatch(/process/i)
    const said = nexSaid(lines)
    expect(said).toMatch(spokenForms(truth.shipped))
    expect(said).toMatch(/ship|went out|sent|out the door|dispatch|deliver/i)
    // It must not answer the placed count AS the processed count.
    if (truth.placed !== truth.shipped) expect(said).not.toMatch(new RegExp(`processed ${truth.placed}\\b`, 'i'))
  })

  test('"how many orders came in this month" is answered with orders placed', async () => {
    const truth = await readTruth()
    const lines = await ask('came-in')
    const said = nexSaid(lines)
    expect(said).toMatch(spokenForms(truth.placed))
  })
})
