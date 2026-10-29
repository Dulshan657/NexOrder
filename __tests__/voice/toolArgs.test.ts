import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { VOICE_TOOLS, VOICE_TOOL_NAMES } from '../../supabase/functions/_shared/voice/toolSchemas'
import type { VoiceToolName } from '../../supabase/functions/_shared/voice/toolSchemas'
import { TOOL_ARG_OBJECTS, TOOL_ARG_SCHEMAS } from '../../lib/voice/toolArgs'
import { MINIMAL_ARGS } from './voiceFixtures'

type JsonProp = { type?: string; enum?: string[]; minimum?: number; maximum?: number; default?: unknown }
type JsonParams = { properties: Record<string, JsonProp>; required: string[]; additionalProperties: boolean }

const paramsOf = (name: VoiceToolName): JsonParams =>
  VOICE_TOOLS.find((t) => t.name === name)!.parameters as unknown as JsonParams

/** Peel optional / default wrappers to reach the type that decides the JSON type. */
function inner(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
    current = current._def.innerType as z.ZodTypeAny
  }
  return current
}

/** zod 4 stores the default as a value, not a thunk. */
function defaultOf(field: z.ZodTypeAny): unknown {
  return field instanceof z.ZodDefault ? field._def.defaultValue : undefined
}

const salesMinimal = MINIMAL_ARGS.get_sales_summary

describe('toolArgs agrees with toolSchemas', () => {
  it('has a schema for every tool and for nothing else', () => {
    expect(Object.keys(TOOL_ARG_OBJECTS).sort()).toEqual([...VOICE_TOOL_NAMES].sort())
    expect(Object.keys(TOOL_ARG_SCHEMAS).sort()).toEqual([...VOICE_TOOL_NAMES].sort())
  })

  for (const name of VOICE_TOOL_NAMES) {
    describe(name, () => {
      const shape = TOOL_ARG_OBJECTS[name].shape as Record<string, z.ZodTypeAny>
      const json = paramsOf(name)

      it('has exactly the same property names', () => {
        expect(Object.keys(shape).sort()).toEqual(Object.keys(json.properties).sort())
      })

      it('has exactly the same required list', () => {
        const required = Object.keys(shape).filter((key) => !shape[key].isOptional())
        expect(required.sort()).toEqual([...json.required].sort())
      })

      it('is strict, as the JSON schema says additionalProperties false', () => {
        expect(json.additionalProperties).toBe(false)
        // zod 4 records .strict() as a never catchall
        expect(TOOL_ARG_OBJECTS[name]._def.catchall).toBeInstanceOf(z.ZodNever)
      })

      it('agrees on type, enum values, bounds and defaults of each property', () => {
        for (const [key, prop] of Object.entries(json.properties)) {
          const field = inner(shape[key])
          if (prop.type === 'string' && !prop.enum) expect(field).toBeInstanceOf(z.ZodString)
          if (prop.type === 'boolean') expect(field).toBeInstanceOf(z.ZodBoolean)
          if (prop.type === 'integer') {
            expect(field).toBeInstanceOf(z.ZodNumber)
            expect((field as z.ZodNumber).isInt).toBe(true)
          }
          if (prop.enum) {
            expect(field).toBeInstanceOf(z.ZodEnum)
            expect([...(field as z.ZodEnum).options].sort()).toEqual([...prop.enum].sort())
          }
          if (prop.minimum !== undefined) expect((field as z.ZodNumber).minValue).toBe(prop.minimum)
          if (prop.maximum !== undefined) expect((field as z.ZodNumber).maxValue).toBe(prop.maximum)
          if (prop.default !== undefined) expect(defaultOf(shape[key])).toBe(prop.default)
        }
      })

      it('accepts the minimal valid call', () => {
        expect(TOOL_ARG_SCHEMAS[name].safeParse(MINIMAL_ARGS[name]).success).toBe(true)
      })

      it('rejects a property the tool does not define', () => {
        const result = TOOL_ARG_SCHEMAS[name].safeParse({ ...MINIMAL_ARGS[name], rep_id: 102 })
        expect(result.success).toBe(false)
      })
    })
  }
})

describe('argument rules', () => {
  const parse = (name: VoiceToolName, args: unknown) => TOOL_ARG_SCHEMAS[name].safeParse(args)

  describe('get_sales_summary', () => {
    it('defaults compare_previous to true', () => {
      const result = parse('get_sales_summary', salesMinimal)
      expect(result.success && (result.data as { compare_previous: boolean }).compare_previous).toBe(true)
    })

    it('accepts a custom range with both dates', () => {
      expect(parse('get_sales_summary', { period: 'custom', from: '2026-10-01', to: '2026-10-09' }).success).toBe(true)
    })

    it('needs from and to for custom', () => {
      expect(parse('get_sales_summary', { period: 'custom' }).success).toBe(false)
      expect(parse('get_sales_summary', { period: 'custom', from: '2026-10-01' }).success).toBe(false)
    })

    it('refuses from and to on any other period', () => {
      expect(parse('get_sales_summary', { period: 'this_week', from: '2026-10-01', to: '2026-10-09' }).success).toBe(false)
    })

    it('refuses a reversed, malformed or impossible date', () => {
      expect(parse('get_sales_summary', { period: 'custom', from: '2026-10-09', to: '2026-10-01' }).success).toBe(false)
      expect(parse('get_sales_summary', { period: 'custom', from: '1/10/2026', to: '9/10/2026' }).success).toBe(false)
      expect(parse('get_sales_summary', { period: 'custom', from: '2026-02-30', to: '2026-03-01' }).success).toBe(false)
    })

    it('refuses a period it does not know', () => {
      expect(parse('get_sales_summary', { period: 'next_year' }).success).toBe(false)
    })

    it('wants a whole positive number for horeca_id, not a string', () => {
      for (const bad of [0, -3, 1.5, '11', null]) {
        expect(parse('get_sales_summary', { period: 'today', horeca_id: bad }).success).toBe(false)
      }
      expect(parse('get_sales_summary', { period: 'today', horeca_id: 11 }).success).toBe(true)
    })
  })

  describe('limits', () => {
    const defaults: Array<[VoiceToolName, Record<string, unknown>, number]> = [
      ['get_follow_up_list', {}, 8],
      ['get_reorder_recommendations', {}, 10],
      ['get_product_movement', { kind: 'top' }, 10],
    ]

    it.each(defaults)('%s defaults limit to the advertised value', (name, args, expected) => {
      const result = parse(name, args)
      expect(result.success && (result.data as { limit: number }).limit).toBe(expected)
    })

    it.each(defaults)('%s accepts 1 to 15 and refuses anything else', (name, args) => {
      for (const ok of [1, 7, 15]) expect(parse(name, { ...args, limit: ok }).success).toBe(true)
      for (const bad of [0, 16, -1, 2.5, '5']) expect(parse(name, { ...args, limit: bad }).success).toBe(false)
    })
  })

  describe('get_reorder_recommendations', () => {
    it('defaults the lead time to 14 days and bounds it to 1 to 60', () => {
      const result = parse('get_reorder_recommendations', {})
      expect(result.success && (result.data as unknown as { lead_time_days: number }).lead_time_days).toBe(14)
      expect(parse('get_reorder_recommendations', { lead_time_days: 60 }).success).toBe(true)
      expect(parse('get_reorder_recommendations', { lead_time_days: 61 }).success).toBe(false)
      expect(parse('get_reorder_recommendations', { lead_time_days: 0 }).success).toBe(false)
    })
  })

  describe('find_customer', () => {
    it('trims the query and refuses a blank or overlong one', () => {
      const trimmed = parse('find_customer', { query: '  harbour cafe ' })
      expect(trimmed.success && (trimmed.data as { query: string }).query).toBe('harbour cafe')
      expect(parse('find_customer', { query: '   ' }).success).toBe(false)
      expect(parse('find_customer', { query: 'x'.repeat(101) }).success).toBe(false)
      expect(parse('find_customer', {}).success).toBe(false)
    })
  })

  describe('get_stock_status and get_product_movement', () => {
    it('refuse a filter or kind they do not offer', () => {
      expect(parse('get_stock_status', { filter: 'all' }).success).toBe(false)
      expect(parse('get_product_movement', { kind: 'fast' }).success).toBe(false)
    })

    it('take an optional category', () => {
      expect(parse('get_stock_status', { filter: 'low', category: 'Sauces' }).success).toBe(true)
    })
  })

  describe('get_visit_stats', () => {
    it('does not offer today or last_30_days', () => {
      expect(parse('get_visit_stats', { period: 'today' }).success).toBe(false)
      expect(parse('get_visit_stats', { period: 'last_month' }).success).toBe(true)
    })
  })
})
