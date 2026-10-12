import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// `z.discriminatedUnion('action', [...])` may hold each discriminator value ONCE.
// zod enforces that while the schema object is being BUILT, i.e. at module load,
// so a duplicate does not fail one request: it throws "Duplicate discriminator
// value" the moment the function boots, and every call to it -- every role, every
// action -- dies. `mutate-pantry-item` did exactly that (two `delete` members:
// nested and flat) and sat broken on dev, because the functions are excluded from
// `tsc`, nothing imports them, and the compiler does not know zod's runtime rule.
//
// This reads each function's source, finds every discriminatedUnion, and checks
// that the literal each member gives its discriminator key is unique. It only sees
// members written inline as `key: z.literal('x')` -- a member passed in as a
// variable is invisible to it -- but that is how every union in this repo is
// written, and the cost of a miss is a function that is down.

const FUNCTIONS = join(__dirname, '..', 'supabase', 'functions')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.ts$/.test(name)) out.push(p)
  }
  return out
}

/**
 * Blank out comments and the CONTENTS of string / template literals (keeping their
 * quotes and length), so brackets and the word "discriminatedUnion" inside them
 * cannot confuse the scan below. Literal values are recovered from the original.
 */
function maskNonCode(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') (out += ' '), i++
    } else if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) (out += src[i] === '\n' ? '\n' : ' '), i++
      out += '  '
      i += 2
    } else if (c === "'" || c === '"' || c === '`') {
      out += c
      i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') (out += ' '), i++
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

interface Union {
  file: string
  key: string
  literals: string[]
}

/** Every inline `key: z.literal('x')` that sits directly in a member of a discriminatedUnion. */
function findUnions(file: string, src: string): Union[] {
  const masked = maskNonCode(src)
  const unions: Union[] = []
  const start = /discriminatedUnion\(\s*(['"`])([^'"`]+)\1\s*,\s*\[/g
  for (let m = start.exec(src); m; m = start.exec(src)) {
    // Skip a mention inside a comment or a string: masked text has the same length,
    // so the same position must still read as code there.
    if (!masked.startsWith('discriminatedUnion', m.index)) continue
    const open = m.index + m[0].length - 1 // the '['
    let depth = 0
    let end = open
    for (let i = open; i < masked.length; i++) {
      const c = masked[i]
      if (c === '[' || c === '(' || c === '{') depth++
      else if (c === ']' || c === ')' || c === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    const key = m[2]
    const body = masked.slice(open, end + 1)
    const original = src.slice(open, end + 1)
    const literals: string[] = []
    // A discriminator sits at depth 3 inside the array: [ -> z.object( -> { key: ...
    let d = 0
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c === '[' || c === '(' || c === '{') d++
      else if (c === ']' || c === ')' || c === '}') d--
      else if (d === 3 && body.startsWith(key, i) && !/[\w$]/.test(body[i - 1] ?? '')) {
        const rest = original.slice(i)
        const lit = new RegExp(`^${key}\\s*:\\s*z\\.literal\\(\\s*(['"])([^'"]*)\\1\\s*\\)`).exec(rest)
        if (lit) literals.push(lit[2])
      }
    }
    unions.push({ file, key, literals })
  }
  return unions
}

const unions = walk(FUNCTIONS).flatMap((f) => findUnions(relative(join(__dirname, '..'), f), readFileSync(f, 'utf8')))

describe('Edge Function discriminated unions', () => {
  it('finds the unions this guard exists to check', () => {
    // If the scan matches nothing it protects nothing.
    const files = new Set(unions.map((u) => u.file.replace(/\\/g, '/')))
    expect(files.has('supabase/functions/mutate-pantry-item/index.ts')).toBe(true)
    expect(files.has('supabase/functions/qr-unlock/index.ts')).toBe(true)
    expect(unions.filter((u) => u.literals.length > 1).length).toBeGreaterThan(5)
  })

  it('no union gives two members the same discriminator value', () => {
    const duplicated = unions
      .map((u) => {
        const seen = new Set<string>()
        const dups = u.literals.filter((l) => (seen.has(l) ? true : (seen.add(l), false)))
        return { u, dups }
      })
      .filter((x) => x.dups.length > 0)
      .map((x) => `${x.u.file}: ${x.u.key} = ${[...new Set(x.dups)].join(', ')}`)
    expect(duplicated).toEqual([])
  })

  it('the scan really does catch a duplicate', () => {
    const src = `const s = z.discriminatedUnion('action', [
      z.object({ action: z.literal('upsert'), data: a }),
      z.object({ action: z.literal('delete'), data: b }),
      z.object({ action: z.literal('delete'), horeca_id: n }),
    ])`
    const [u] = findUnions('fixture.ts', src)
    expect(u.literals).toEqual(['upsert', 'delete', 'delete'])
  })

  it('ignores a discriminator-shaped key nested deeper, and text inside strings and comments', () => {
    const src = `const s = z.discriminatedUnion('action', [
      // z.object({ action: z.literal('ghost') })
      z.object({ action: z.literal('a'), nested: z.object({ action: z.literal('a') }) }),
      z.object({ action: z.literal('b'), note: z.string().default("action: z.literal('b')") }),
    ])`
    const [u] = findUnions('fixture.ts', src)
    expect(u.literals).toEqual(['a', 'b'])
  })
})
