import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the OpenAI wrapper so the AI fuzzy-match branch is deterministic and
// never touches the network. aliasResolver.ts imports `extractStructured` from
// './openai.ts'; both that specifier and the one below resolve to the same
// module id, so this mock intercepts the resolver's call.
vi.mock('../supabase/functions/_shared/poInbox/openai.ts', () => ({
  extractStructured: vi.fn(),
}))

import { extractStructured } from '../supabase/functions/_shared/poInbox/openai.ts'
import { resolveCustomer, CUSTOMER_AUTO_ALIAS_THRESHOLD } from '../supabase/functions/_shared/poInbox/aliasResolver'
import { makeFakeSupabase, noopAudit } from './support/fakeSupabase'
import type { FakeSupabaseOptions } from './support/fakeSupabase'

const aiMock = vi.mocked(extractStructured)

beforeEach(() => {
  aiMock.mockReset()
})

/** Build a resolveCustomer input over a freshly-seeded fake. */
function setup(options: FakeSupabaseOptions, overrides: Partial<Parameters<typeof resolveCustomer>[0]> = {}) {
  const handle = makeFakeSupabase(options)
  const input = {
    supa: handle.supa,
    audit: noopAudit,
    inboundMessageId: 'msg-1',
    edgeFunction: 'extract-po',
    fromAddress: null as string | null,
    customerNameRaw: null as string | null,
    ...overrides,
  }
  return { ...handle, input }
}

/** Shape the resolver reads off `extractStructured` (only `.data` is used). */
function aiPick(matchedHorecaId: number | null, confidence: number) {
  return {
    data: { matched_horeca_id: matchedHorecaId, confidence },
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costUsd: null,
    model: 'gpt-4o-mini',
  }
}

describe('CUSTOMER_AUTO_ALIAS_THRESHOLD', () => {
  it('is the 0.9 the spec calls out, inside the (0, 1] range', () => {
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBeGreaterThan(0)
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBeLessThanOrEqual(1)
    expect(CUSTOMER_AUTO_ALIAS_THRESHOLD).toBe(0.9)
  })
})

describe('resolveCustomer — deterministic alias steps', () => {
  it('matches an exact sender_email alias (confidence 1.0, no AI)', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [{ source_type: 'sender_email', source_value: 'orders@acme.com', horeca_id: 42 }] } },
      { fromAddress: 'orders@acme.com' },
    )
    const result = await resolveCustomer(input)
    expect(result).toEqual({ horecaId: 42, confidence: 1.0, matchSource: 'sender_email_alias', aliasInsertedId: null })
    expect(aiMock).not.toHaveBeenCalled()
  })

  it('falls through to a sender_domain alias when no email alias matches', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [{ source_type: 'sender_domain', source_value: 'acme.com', horeca_id: 42 }] } },
      { fromAddress: 'orders@acme.com' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBe(42)
    expect(result.matchSource).toBe('sender_domain_alias')
  })

  it('falls through to a po_text alias on the normalized customer name', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [{ source_type: 'po_text', source_value: 'acme restaurant group', horeca_id: 42 }] } },
      { customerNameRaw: 'Acme Restaurant Group' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBe(42)
    expect(result.matchSource).toBe('po_text_alias')
  })

  it('falls through to a curated horecas.contact_email match', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [], horecas: [{ id: 42, contact_email: 'orders@acme.com' }] } },
      { fromAddress: 'orders@acme.com' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBe(42)
    expect(result.matchSource).toBe('horeca_contact_email')
  })

  it('prefers an operator-curated alias over a matching contact_email', async () => {
    const { input } = setup(
      {
        tables: {
          po_customer_aliases: [{ source_type: 'sender_email', source_value: 'orders@acme.com', horeca_id: 7 }],
          horecas: [{ id: 42, contact_email: 'orders@acme.com' }],
        },
      },
      { fromAddress: 'orders@acme.com' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBe(7)
    expect(result.matchSource).toBe('sender_email_alias')
  })

  it('matches despite mixed case / whitespace on the sender address', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [{ source_type: 'sender_email', source_value: 'orders@acme.com', horeca_id: 42 }] } },
      { fromAddress: '  ORDERS@Acme.com ' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBe(42)
    expect(result.matchSource).toBe('sender_email_alias')
  })
})

describe('resolveCustomer — missing / no-match short-circuits', () => {
  it('returns missing without calling AI when there is no name and no deterministic hit', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [], horecas: [] } },
      { fromAddress: 'unknown@nowhere.com' },
    )
    const result = await resolveCustomer(input)
    expect(result).toEqual({ horecaId: null, confidence: 0, matchSource: null, aliasInsertedId: null })
    expect(aiMock).not.toHaveBeenCalled()
  })

  it('returns missing when a name is present but the horeca catalog is empty', async () => {
    const { input } = setup(
      { tables: { po_customer_aliases: [], horecas: [] } },
      { customerNameRaw: 'Unknown Co' },
    )
    const result = await resolveCustomer(input)
    expect(result.horecaId).toBeNull()
    expect(aiMock).not.toHaveBeenCalled()
  })
})

describe('resolveCustomer — AI fuzzy match', () => {
  const catalogOnly: FakeSupabaseOptions = {
    tables: { po_customer_aliases: [], horecas: [{ id: 5, name: 'Acme Pty Ltd', address: '1 Main St' }] },
  }

  it('writes a po_text alias and returns the match when AI confidence ≥ threshold', async () => {
    aiMock.mockResolvedValue(aiPick(5, 0.95))
    const { input, db } = setup(catalogOnly, { customerNameRaw: 'Acme' })
    const result = await resolveCustomer(input)

    expect(result.horecaId).toBe(5)
    expect(result.confidence).toBe(0.95)
    expect(result.matchSource).toBe('ai_fuzzy_match')
    expect(result.aliasInsertedId).toBe('po_customer_aliases-1')

    expect(aiMock).toHaveBeenCalledTimes(1)
    expect(db.inserted).toHaveLength(1)
    expect(db.inserted[0].table).toBe('po_customer_aliases')
    expect(db.inserted[0].row).toMatchObject({
      source_type: 'po_text',
      source_value: 'acme', // normalizeCompanyName('Acme')
      horeca_id: 5,
      confidence_at_creation: 0.95,
      created_by: null,
    })
  })

  it('does not write an alias when AI confidence is below threshold', async () => {
    aiMock.mockResolvedValue(aiPick(5, 0.7))
    const { input, db } = setup(catalogOnly, { customerNameRaw: 'Acme' })
    const result = await resolveCustomer(input)

    expect(result.horecaId).toBe(5)
    expect(result.confidence).toBe(0.7)
    expect(result.matchSource).toBe('ai_fuzzy_match')
    expect(result.aliasInsertedId).toBeNull()
    expect(db.inserted).toHaveLength(0)
  })

  it('returns a null match (no source) when AI finds no candidate', async () => {
    aiMock.mockResolvedValue(aiPick(null, 0))
    const { input, db } = setup(catalogOnly, { customerNameRaw: 'Totally Unknown' })
    const result = await resolveCustomer(input)

    expect(result.horecaId).toBeNull()
    expect(result.matchSource).toBeNull()
    expect(result.aliasInsertedId).toBeNull()
    expect(db.inserted).toHaveLength(0)
  })

  it('clamps a non-finite AI confidence to 0 (no alias written)', async () => {
    aiMock.mockResolvedValue(aiPick(5, Number.NaN))
    const { input, db } = setup(catalogOnly, { customerNameRaw: 'Acme' })
    const result = await resolveCustomer(input)

    expect(result.confidence).toBe(0)
    expect(result.aliasInsertedId).toBeNull()
    expect(db.inserted).toHaveLength(0)
  })

  it('still returns the match when the alias insert races (unique-constraint error)', async () => {
    aiMock.mockResolvedValue(aiPick(5, 0.95))
    const { input } = setup(
      { ...catalogOnly, insertErrors: { po_customer_aliases: 'duplicate key' } },
      { customerNameRaw: 'Acme' },
    )
    const result = await resolveCustomer(input)

    expect(result.horecaId).toBe(5)
    expect(result.confidence).toBe(0.95)
    expect(result.matchSource).toBe('ai_fuzzy_match')
    expect(result.aliasInsertedId).toBeNull()
  })
})
