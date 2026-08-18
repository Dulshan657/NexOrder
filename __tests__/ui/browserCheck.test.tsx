// `public/browser-check.js` is the only code in the repo that runs OUTSIDE the
// module graph, so nothing else type-checks it, bundles it, or imports it. It is
// also the one file whose two failure modes are both severe:
//
//   - too eager: it hides a perfectly good app behind a notice telling the
//     operator their browser is broken. Worse than the defect it fixes.
//   - too shy: it never fires, and a below-floor device shows the white screen
//     that raising `build.target` created.
//
// So it is loaded from disk and executed here against a stubbed CSS API. The
// source is read rather than imported on purpose — importing it would prove the
// bundler can parse it, which is not the question.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), 'public/browser-check.js'),
  'utf8',
)

/** The notice markup as index.html carries it, trimmed to what the script touches. */
const MARKUP = `
  <div id="root"><span>the app</span></div>
  <div id="unsupported-browser" style="display:none">
    <p id="unsupported-browser-detected"></p>
  </div>
`

interface CssStub {
  supports?: (property: string, value: string) => boolean
  registerProperty?: () => void
}

function run(css: CssStub | undefined, userAgent?: string): void {
  document.body.innerHTML = MARKUP
  ;(window as any).CSS = css
  if (userAgent !== undefined) {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: userAgent,
      configurable: true,
    })
  }
  // eslint-disable-next-line no-eval
  ;(0, eval)(SOURCE)
}

const notice = () => document.getElementById('unsupported-browser')!
const root = () => document.getElementById('root')!
const detected = () => document.getElementById('unsupported-browser-detected')!

const MODERN: CssStub = {
  registerProperty: () => {},
  supports: (property, value) =>
    property === 'color' && value === 'color-mix(in srgb, red, blue)',
}

const originalCss = (window as any).CSS

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  ;(window as any).CSS = originalCss
})

describe('a browser at or above the floor', () => {
  it('is left completely alone', () => {
    run(MODERN)
    expect(notice().style.display).toBe('none')
    expect(root().style.display).not.toBe('none')
  })
})

describe('a browser below the floor', () => {
  it('is caught when color-mix() is missing — the Chrome 111 boundary', () => {
    // Chrome 107: @property has shipped (85), color-mix has not (111). Testing
    // only @property would wave this through.
    run({ registerProperty: () => {}, supports: () => false })
    expect(notice().style.display).toBe('block')
  })

  it('is caught when @property is missing — the Firefox 128 boundary', () => {
    // Firefox 113-127: color-mix has shipped (113), @property has not (128).
    // Testing only color-mix would wave this through, and the app would render
    // unstyled with no explanation.
    run({ supports: () => true })
    expect(notice().style.display).toBe('block')
  })

  it('hides the empty root so the notice sits at the top', () => {
    run({ supports: () => false })
    expect(root().style.display).toBe('none')
  })
})

describe('failing toward the notice', () => {
  it('shows it when CSS is absent entirely', () => {
    run(undefined)
    expect(notice().style.display).toBe('block')
  })

  it('shows it when CSS.supports is not callable', () => {
    run({ registerProperty: () => {} })
    expect(notice().style.display).toBe('block')
  })

  it('shows it when CSS.supports throws', () => {
    run({
      registerProperty: () => {},
      supports: () => {
        throw new Error('nope')
      },
    })
    expect(notice().style.display).toBe('block')
  })
})

describe('the detected-version line', () => {
  it('names Chrome, because that is what an operator can act on', () => {
    run(
      { supports: () => false },
      'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36',
    )
    expect(detected().textContent).toBe('This device reports Chrome 96.')
  })

  it('names Firefox', () => {
    run({ supports: () => true }, 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0')
    expect(detected().textContent).toBe('This device reports Firefox 120.')
  })

  it('names Safari without mistaking Chrome for it', () => {
    // Every Chromium UA also ends in "Safari/537.36". The Chrome branch is
    // tested first for exactly that reason; this pins the order.
    run(
      { supports: () => false },
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    )
    expect(detected().textContent).toBe('This device reports Safari 15.')
  })

  it('says nothing rather than guessing on an unrecognised agent', () => {
    run({ supports: () => false }, 'SomeManagedKiosk/1.0')
    expect(detected().textContent).toBe('')
    // The notice itself still shows — the version is decoration, never the test.
    expect(notice().style.display).toBe('block')
  })
})

describe('the source itself', () => {
  it('is ES5, because it runs on browsers that cannot parse the bundle', () => {
    // A syntax error here is a white screen with no explanation — precisely the
    // outcome this file exists to prevent, and it would never be caught by tsc,
    // by the bundler, or by any other test in this suite.
    const body = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(body).not.toMatch(/=>/)
    expect(body).not.toMatch(/\bconst\b/)
    expect(body).not.toMatch(/\blet\b/)
    expect(body).not.toMatch(/`/)
    expect(body).not.toMatch(/\?\./)
    expect(body).not.toMatch(/\?\?/)
  })
})
