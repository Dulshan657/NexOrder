import { describe, expect, it } from 'vitest'

import { A4_HEIGHT, A4_WIDTH, MM } from '../supabase/functions/_shared/labelSheet'
import {
  POSTER_FORMATS,
  POSTER_HEADLINE,
  POSTER_SUBLINE,
  QR_QUIET_MODULES,
  isPosterFormat,
  layoutPoster,
  posterFileName,
  posterSpec,
  type Box,
  type PosterFormat,
  type PosterInput,
  type PosterLayout,
} from '../supabase/functions/_shared/qrPoster/layout'
import {
  fitLines,
  sanitizeForWinAnsi,
  wrapWords,
  type Measure,
} from '../supabase/functions/_shared/qrPoster/text'

// A deterministic stand-in for Helvetica: every glyph is a fixed fraction of the
// font size, a little wider for bold. Real widths differ glyph by glyph, but the
// geometry only needs "wider text is wider", and a fake lets the suite run
// without a PDF.
const measure: Measure = (text, size, font) => text.length * size * (font === 'bold' ? 0.58 : 0.52)

const QR_MODULES = 37 // a typical version-5 symbol for this URL length
const EPS = 0.01

function input(over: Partial<PosterInput> = {}): PosterInput {
  return {
    format: 'a4',
    venueName: 'The Grand Hotel',
    companyName: 'Amadiya Agro Products',
    phone: '02 9000 1234',
    logo: { width: 600, height: 200 },
    qrModules: QR_MODULES,
    ...over,
  }
}

function boxes(l: PosterLayout): Array<[string, Box]> {
  const out: Array<[string, Box | null]> = [
    ['logo', l.logo],
    ['company', l.company?.box ?? null],
    ['venue', l.venue.box],
    ['qr', l.qr.box],
    ['headline', l.headline.box],
    ['subline', l.subline?.box ?? null],
    ['phone', l.phone?.box ?? null],
  ]
  return out.filter((e): e is [string, Box] => e[1] !== null)
}

/** Everything a poster must satisfy whatever the venue is called. */
function expectSound(l: PosterLayout): void {
  const parts = boxes(l)

  // Inside the page margins.
  for (const [name, b] of parts) {
    expect(b.x, `${name} left`).toBeGreaterThanOrEqual(l.margin - EPS)
    expect(b.x + b.width, `${name} right`).toBeLessThanOrEqual(l.width - l.margin + EPS)
    expect(b.y, `${name} bottom`).toBeGreaterThanOrEqual(l.margin - EPS)
    expect(b.y + b.height, `${name} top`).toBeLessThanOrEqual(l.height - l.margin + EPS)
  }

  // Stacked top to bottom with no overlap.
  const byTop = [...parts].sort((a, b) => b[1].y + b[1].height - (a[1].y + a[1].height))
  for (let i = 0; i < byTop.length - 1; i += 1) {
    const [upperName, upper] = byTop[i]
    const [lowerName, lower] = byTop[i + 1]
    expect(upper.y, `${upperName} must sit above ${lowerName}`).toBeGreaterThanOrEqual(lower.y + lower.height - EPS)
  }

  // The code is a square, centred, with its quiet zone inside the box.
  const { qr } = l
  expect(qr.box.width).toBeCloseTo(qr.box.height, 6)
  expect(qr.box.x + qr.box.width / 2).toBeCloseTo(l.width / 2, 6)
  expect(qr.gridSize + 2 * QR_QUIET_MODULES * qr.moduleSize).toBeCloseTo(qr.box.width, 6)
  expect(qr.gridX - qr.box.x).toBeCloseTo(QR_QUIET_MODULES * qr.moduleSize, 6)
  expect(qr.gridY - qr.box.y).toBeCloseTo(QR_QUIET_MODULES * qr.moduleSize, 6)
  expect(qr.quietModules).toBeGreaterThanOrEqual(4)

  // Text is centred and fits its line.
  for (const block of [l.company, l.venue, l.headline, l.subline, l.phone]) {
    if (!block) continue
    expect(block.baselines).toHaveLength(block.lines.length)
    for (const line of block.lines) {
      expect(measure(line, block.size, block.font), line).toBeLessThanOrEqual(block.box.width + EPS)
    }
    expect(block.centerX).toBeCloseTo(l.width / 2, 6)
    // Baselines descend.
    for (let i = 1; i < block.baselines.length; i += 1) {
      expect(block.baselines[i]).toBeLessThan(block.baselines[i - 1])
    }
  }
}

describe('page sizes', () => {
  it('uses A4 and a 60 x 80 mm sticker', () => {
    const a4 = layoutPoster(input({ format: 'a4' }), measure)
    expect(a4.width).toBeCloseTo(A4_WIDTH, 6)
    expect(a4.height).toBeCloseTo(A4_HEIGHT, 6)

    const sticker = layoutPoster(input({ format: 'sticker' }), measure)
    expect(sticker.width).toBeCloseTo(60 * MM, 6)
    expect(sticker.height).toBeCloseTo(80 * MM, 6)
  })

  it('knows its two formats', () => {
    expect(POSTER_FORMATS).toEqual(['a4', 'sticker'])
    expect(isPosterFormat('a4')).toBe(true)
    expect(isPosterFormat('sticker')).toBe(true)
    expect(isPosterFormat('A4')).toBe(false)
    expect(isPosterFormat('a3')).toBe(false)
    expect(isPosterFormat(undefined)).toBe(false)
  })
})

describe('A4 poster', () => {
  const l = layoutPoster(input(), measure)

  it('is sound', () => expectSound(l))

  it('puts the code at about 120 mm, in the middle of the page', () => {
    expect(l.qr.box.width / MM).toBeCloseTo(120, 3)
    expect(l.qr.box.x + l.qr.box.width / 2).toBeCloseTo(A4_WIDTH / 2, 6)
  })

  it('stacks logo, venue, code, headline, subline, phone from the top', () => {
    expect(l.logo).not.toBeNull()
    expect(l.company).toBeNull() // the logo stands in for the company name
    const top = (b: Box): number => b.y + b.height
    expect(top(l.logo as Box)).toBeGreaterThan(top(l.venue.box))
    expect(top(l.venue.box)).toBeGreaterThan(top(l.qr.box))
    expect(top(l.qr.box)).toBeGreaterThan(top(l.headline.box))
    expect(top(l.headline.box)).toBeGreaterThan(top((l.subline as { box: Box }).box))
    expect(top((l.subline as { box: Box }).box)).toBeGreaterThan(top((l.phone as { box: Box }).box))
  })

  it('says what the poster is for', () => {
    expect(l.headline.lines).toEqual([POSTER_HEADLINE])
    expect(l.subline?.lines).toEqual([POSTER_SUBLINE])
    expect(POSTER_HEADLINE).toBe('Scan to reorder')
    expect(POSTER_SUBLINE).toBe('Enter your staff PIN')
  })

  it('pins the phone number to the bottom margin', () => {
    expect(l.phone?.lines).toEqual(['Call 02 9000 1234'])
    expect((l.phone as { box: Box }).box.y).toBeCloseTo(l.margin, 6)
  })

  it('scales the logo into its box without distorting it', () => {
    const logo = l.logo as Box
    expect(logo.width / logo.height).toBeCloseTo(600 / 200, 6)
    expect(logo.width).toBeLessThanOrEqual(posterSpec('a4').logoMax.width + EPS)
    expect(logo.height).toBeLessThanOrEqual(posterSpec('a4').logoMax.height + EPS)

    const tall = layoutPoster(input({ logo: { width: 100, height: 400 } }), measure).logo as Box
    expect(tall.width / tall.height).toBeCloseTo(100 / 400, 6)
    expect(tall.height).toBeLessThanOrEqual(posterSpec('a4').logoMax.height + EPS)
  })
})

describe('sticker', () => {
  const l = layoutPoster(input({ format: 'sticker' }), measure)

  it('is sound', () => expectSound(l))

  it('keeps the code near 45 mm', () => {
    expect(l.qr.box.width / MM).toBeGreaterThanOrEqual(40)
    expect(l.qr.box.width / MM).toBeLessThanOrEqual(45)
  })

  it('shrinks everything but the code relative to the poster', () => {
    const poster = layoutPoster(input(), measure)
    expect(l.venue.size).toBeLessThan(poster.venue.size)
    expect(l.headline.size).toBeLessThan(poster.headline.size)
    expect((l.logo as Box).height).toBeLessThan((poster.logo as Box).height)
  })
})

describe('missing pieces', () => {
  it('falls back to the company name when there is no logo', () => {
    for (const format of POSTER_FORMATS) {
      const l = layoutPoster(input({ format, logo: null }), measure)
      expect(l.logo).toBeNull()
      expect(l.company?.lines).toEqual(['Amadiya Agro Products'])
      expectSound(l)
    }
  })

  it('draws neither when there is no logo and no company name', () => {
    for (const format of POSTER_FORMATS) {
      const l = layoutPoster(input({ format, logo: null, companyName: '   ' }), measure)
      expect(l.logo).toBeNull()
      expect(l.company).toBeNull()
      expectSound(l)
    }
  })

  it('omits the phone line when the operator has not set a number', () => {
    for (const format of POSTER_FORMATS) {
      const l = layoutPoster(input({ format, phone: '' }), measure)
      expect(l.phone).toBeNull()
      expectSound(l)
    }
  })

  it('ignores a logo with no usable dimensions', () => {
    const l = layoutPoster(input({ logo: { width: 0, height: 0 } }), measure)
    expect(l.logo).toBeNull()
    expect(l.company).not.toBeNull()
  })

  it('never draws an empty heading', () => {
    const l = layoutPoster(input({ venueName: '   ' }), measure)
    expect(l.venue.lines.join(' ')).toBe('Your venue')
  })
})

describe('venue names', () => {
  const NAMES = [
    'Bar',
    'The Grand Hotel',
    'The Grand Hotel & Conference Centre Sydney CBD',
    'Supercalifragilisticexpialidocious-Hospitality-Group-Pty-Ltd-Trading-As-Everything',
    'A '.repeat(120),
    'W'.repeat(300),
    'Nhà hàng Phở 24 \u{1F35C}',
    '餐厅',
    'Café Münchën',
  ]

  it.each(POSTER_FORMATS)('every name stays on the page in the %s format', (format) => {
    for (const venueName of NAMES) {
      for (const phone of ['', '02 9000 1234']) {
        for (const logo of [null, { width: 600, height: 200 }]) {
          const l = layoutPoster(input({ format, venueName, phone, logo }), measure)
          expectSound(l)
          expect(l.venue.lines.length).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('shrinks a long name before it cuts it', () => {
    const short = layoutPoster(input({ venueName: 'Bar' }), measure)
    const long = layoutPoster(input({ venueName: 'The Grand Hotel & Conference Centre Sydney CBD' }), measure)
    expect(long.venue.size).toBeLessThan(short.venue.size)
    expect(long.venue.truncated).toBe(false)
    expect(long.venue.lines.join(' ')).toBe('The Grand Hotel & Conference Centre Sydney CBD')
  })

  it('marks a name that cannot fit even at the floor', () => {
    const l = layoutPoster(input({ venueName: 'W'.repeat(300) }), measure)
    expect(l.venue.truncated).toBe(true)
    expect(l.venue.size).toBe(posterSpec('a4').venue.min)
    expect(l.venue.lines.at(-1)).toMatch(/…$/)
  })

  it('keeps the code at least at its floor even for the worst sticker', () => {
    const l = layoutPoster(input({ format: 'sticker', venueName: 'W'.repeat(300) }), measure)
    expect(l.qr.box.width).toBeGreaterThanOrEqual(posterSpec('sticker').qrMin - EPS)
  })

  it('draws only characters a standard PDF font can encode', () => {
    const l = layoutPoster(input({ venueName: 'Phở \u{1F35C} 餐厅' }), measure)
    const drawn = l.venue.lines.join(' ')
    // eslint-disable-next-line no-control-regex
    expect(drawn).toMatch(/^[ -~ -ÿ…]*$/)
  })
})

describe('the code', () => {
  it('scales its modules with the symbol size', () => {
    const small = layoutPoster(input({ qrModules: 25 }), measure).qr
    const big = layoutPoster(input({ qrModules: 57 }), measure).qr
    expect(small.moduleSize).toBeGreaterThan(big.moduleSize)
    expect(small.box.width).toBeCloseTo(big.box.width, 6) // same printed size
  })

  it('keeps every module larger than a printer can resolve', () => {
    for (const format of POSTER_FORMATS) {
      // 177 modules is a version-40 symbol -- far beyond a URL this short, but the
      // bound is the point.
      const q = layoutPoster(input({ format, qrModules: 177 }), measure).qr
      expect(q.moduleSize).toBeGreaterThan(0.2 * MM)
    }
  })
})

describe('posterFileName', () => {
  it('builds a safe lowercase name', () => {
    expect(posterFileName('The Grand Hotel', 'a4')).toBe('qr-the-grand-hotel-a4.pdf')
    expect(posterFileName('Café Münchën', 'sticker')).toBe('qr-cafe-munchen-sticker.pdf')
  })

  it('never lets a name smuggle in a path or a header break', () => {
    const name = posterFileName('../../etc/passwd"\r\nX-Evil: 1', 'a4')
    expect(name).toMatch(/^qr-[a-z0-9-]+-a4\.pdf$/)
    expect(name).not.toMatch(/[\\/"\r\n]/)
  })

  it('falls back when nothing usable is left, and bounds the length', () => {
    expect(posterFileName('餐厅', 'a4')).toBe('qr-venue-a4.pdf')
    expect(posterFileName('x'.repeat(500), 'a4').length).toBeLessThanOrEqual(3 + 40 + 1 + 2 + 4)
  })
})

describe('sanitizeForWinAnsi', () => {
  it('leaves plain text and Latin-1 alone', () => {
    expect(sanitizeForWinAnsi('The Grand Hotel')).toBe('The Grand Hotel')
    expect(sanitizeForWinAnsi('Café Münchën')).toBe('Café Münchën')
  })

  it('keeps the Windows-1252 extras the standard font can draw', () => {
    expect(sanitizeForWinAnsi('Fish – Chips • “best” €5')).toBe(
      'Fish – Chips • “best” €5',
    )
  })

  it('reduces other Latin letters to their base letter', () => {
    expect(sanitizeForWinAnsi('Ōtāhuhu')).toBe('Otahuhu')
    expect(sanitizeForWinAnsi('Nhà hàng Phở')).toBe('Nhà hàng Pho')
  })

  it('replaces what has no base letter, and collapses whitespace and controls', () => {
    expect(sanitizeForWinAnsi('餐厅')).toBe('??')
    expect(sanitizeForWinAnsi('Pho \u{1F35C}')).toBe('Pho')
    expect(sanitizeForWinAnsi('A\u{1F35C}B')).toBe('A B')
    expect(sanitizeForWinAnsi('Caf\u00e9\u200b \ufe0f')).toBe('Caf\u00e9')
    expect(sanitizeForWinAnsi('  a\n\t b \u0000c ')).toBe('a b c')
    expect(sanitizeForWinAnsi('')).toBe('')
  })
})

describe('wrapWords / fitLines', () => {
  const at = (text: string, width: number, size = 10): string[] => wrapWords(text, width, size, 'regular', measure)

  it('wraps on word boundaries', () => {
    // 10pt regular = 5.2pt per character; 60pt holds 11 characters.
    expect(at('alpha beta gamma', 60)).toEqual(['alpha beta', 'gamma'])
  })

  it('hard-breaks a word that is wider than the line', () => {
    const lines = at('abcdefghijklmnopqrstuvwxyz', 52)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('abcdefghijklmnopqrstuvwxyz')
    for (const line of lines) expect(measure(line, 10, 'regular')).toBeLessThanOrEqual(52)
  })

  it('returns nothing for empty text', () => {
    expect(at('', 100)).toEqual([])
    expect(fitLines('   ', { maxWidth: 100, preferredSize: 10, minSize: 5, maxLines: 2, font: 'bold' }, measure).lines).toEqual([])
  })

  it('uses the preferred size when the text fits on one line', () => {
    const r = fitLines('Bar', { maxWidth: 400, preferredSize: 30, minSize: 10, maxLines: 1, font: 'bold' }, measure)
    expect(r).toEqual({ lines: ['Bar'], size: 30, truncated: false })
  })

  it('shrinks toward the floor to avoid a second line', () => {
    const r = fitLines('Seven char', { maxWidth: 100, preferredSize: 30, minSize: 10, maxLines: 1, font: 'bold' }, measure)
    expect(r.lines).toHaveLength(1)
    expect(r.size).toBeLessThan(30)
    expect(r.size).toBeGreaterThanOrEqual(10)
    expect(measure(r.lines[0], r.size, 'bold')).toBeLessThanOrEqual(100 + EPS)
  })

  it('truncates with an ellipsis only after the floor, and says so', () => {
    const r = fitLines('x'.repeat(200), { maxWidth: 100, preferredSize: 30, minSize: 10, maxLines: 1, font: 'bold' }, measure)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(10)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatch(/…$/)
    expect(measure(r.lines[0], r.size, 'bold')).toBeLessThanOrEqual(100 + EPS)
  })
})

describe('worst cases still fit the page', () => {
  it('the tallest stack on each format needs no more than the page offers', () => {
    // Worst case: logo, a two-line name, subline and phone all present, with a
    // dense symbol. If this holds, the code never has to go below its floor.
    for (const format of POSTER_FORMATS as ReadonlyArray<PosterFormat>) {
      const l = layoutPoster(
        input({ format, venueName: 'W'.repeat(300), qrModules: 57 }),
        measure,
      )
      expectSound(l)
      expect(l.qr.box.width).toBeGreaterThanOrEqual(posterSpec(format).qrMin - EPS)
    }
  })
})
