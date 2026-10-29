import { describe, it, expect } from 'vitest'
import {
  VOICE_TOOL_NAMES,
  VOICE_TOOLS,
  toolsForRole,
} from '../../supabase/functions/_shared/voice/toolSchemas'
import type { VoiceToolSchema } from '../../supabase/functions/_shared/voice/toolSchemas'

const EVERY_MODULE = ['sales_orders', 'shop', 'inventory_dispatch', 'field_ops', 'voice_assistant']
// Amadiya registry entry: no field_ops, so no rep ever gets visit stats there.
const AMADIYA = ['sales_orders', 'inventory_dispatch', 'voice_assistant']
const SALES_ONLY = ['sales_orders', 'voice_assistant']

const REORDER = 'get_reorder_recommendations'
const WAREHOUSE_TOOLS = ['get_stock_status', 'get_reorder_recommendations', 'get_product_movement']

function names(tools: readonly VoiceToolSchema[]): string[] {
  return tools.map((t) => t.name)
}

function tool(name: string): VoiceToolSchema {
  const found = VOICE_TOOLS.find((t) => t.name === name)
  if (!found) throw new Error('no tool named ' + name)
  return found
}

function props(name: string): Record<string, Record<string, unknown>> {
  return (tool(name).parameters as { properties: Record<string, Record<string, unknown>> }).properties
}

describe('VOICE_TOOLS', () => {
  it('defines exactly the ten named tools, once each, in the declared order', () => {
    expect(VOICE_TOOL_NAMES).toHaveLength(10)
    expect(names(VOICE_TOOLS)).toEqual([...VOICE_TOOL_NAMES])
    expect(new Set(names(VOICE_TOOLS)).size).toBe(10)
  })

  it('gives every tool the function type and a real description', () => {
    for (const t of VOICE_TOOLS) {
      expect(t.type).toBe('function')
      expect(t.description.length).toBeGreaterThan(40)
    }
  })

  it('gives every tool a strict object schema', () => {
    for (const t of VOICE_TOOLS) {
      const p = t.parameters as Record<string, unknown>
      expect(p.type).toBe('object')
      expect(typeof p.properties).toBe('object')
      expect(Array.isArray(p.required)).toBe(true)
      expect(p.additionalProperties).toBe(false)
    }
  })

  it('only requires properties that exist', () => {
    for (const t of VOICE_TOOLS) {
      const p = t.parameters as { properties: Record<string, unknown>; required: string[] }
      for (const key of p.required) expect(Object.keys(p.properties)).toContain(key)
    }
  })

  it('requires exactly the documented arguments', () => {
    const required = (n: string) => (tool(n).parameters as { required: string[] }).required
    expect(required('get_sales_summary')).toEqual(['period'])
    expect(required('get_target_progress')).toEqual([])
    expect(required('get_follow_up_list')).toEqual([])
    expect(required('find_customer')).toEqual(['query'])
    expect(required('get_customer_insights')).toEqual(['horeca_id'])
    expect(required('get_suggested_order_for_customer')).toEqual(['horeca_id'])
    expect(required('get_stock_status')).toEqual(['filter'])
    expect(required('get_reorder_recommendations')).toEqual([])
    expect(required('get_product_movement')).toEqual(['kind'])
    expect(required('get_visit_stats')).toEqual(['period'])
  })

  it('takes no arguments for the target progress tool', () => {
    expect(props('get_target_progress')).toEqual({})
  })

  it('offers the documented sales summary periods and optional arguments', () => {
    const p = props('get_sales_summary')
    expect(p.period.enum).toEqual([
      'today',
      'this_week',
      'this_month',
      'last_month',
      'last_30_days',
      'custom',
    ])
    expect(Object.keys(p).sort()).toEqual(['compare_previous', 'from', 'horeca_id', 'period', 'to'])
    expect(p.compare_previous).toMatchObject({ type: 'boolean', default: true })
    expect(p.horeca_id.type).toBe('integer')
    expect(p.from.type).toBe('string')
    expect(p.to.type).toBe('string')
  })

  it('bounds every limit to 1-15 and the lead time to 1-60', () => {
    expect(props('get_follow_up_list').limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 15,
      default: 8,
    })
    expect(props('get_reorder_recommendations').limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 15,
      default: 10,
    })
    expect(props('get_reorder_recommendations').lead_time_days).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 60,
      default: 14,
    })
    expect(props('get_product_movement').limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 15,
      default: 10,
    })
  })

  it('offers the documented enums for stock, movement and visits', () => {
    expect(props('get_stock_status').filter.enum).toEqual(['summary', 'low', 'out'])
    expect(props('get_stock_status').category.type).toBe('string')
    expect(props('get_product_movement').kind.enum).toEqual(['top', 'slow', 'dead'])
    expect(props('get_visit_stats').period.enum).toEqual(['this_week', 'this_month', 'last_month'])
  })

  it('tells the model to resolve a customer id with find_customer first', () => {
    expect(tool('find_customer').description).toMatch(/ambiguous/)
    expect(tool('get_sales_summary').description).toMatch(/find_customer/)
  })

  it('is deeply frozen so a caller cannot rewrite the shared schemas', () => {
    expect(Object.isFrozen(VOICE_TOOLS)).toBe(true)
    for (const t of VOICE_TOOLS) {
      expect(Object.isFrozen(t)).toBe(true)
      expect(Object.isFrozen(t.parameters)).toBe(true)
      expect(Object.isFrozen((t.parameters as { properties: object }).properties)).toBe(true)
    }
  })
})

describe('toolsForRole', () => {
  it('withholds reorder recommendations from reps', () => {
    for (const role of ['Field Sales Rep', 'Office Sales Rep']) {
      expect(names(toolsForRole(role, EVERY_MODULE))).not.toContain(REORDER)
      expect(names(toolsForRole(role, AMADIYA))).not.toContain(REORDER)
    }
  })

  it('keeps reorder recommendations for admins and managers with the warehouse module', () => {
    for (const role of ['Admin', 'Manager']) {
      expect(names(toolsForRole(role, AMADIYA))).toContain(REORDER)
    }
  })

  it('drops all three warehouse tools when inventory_dispatch is off', () => {
    for (const role of ['Admin', 'Manager', 'Field Sales Rep', 'Office Sales Rep']) {
      const offered = names(toolsForRole(role, SALES_ONLY))
      for (const warehouse of WAREHOUSE_TOOLS) expect(offered).not.toContain(warehouse)
    }
  })

  it('lets a rep ask about stock and movement when inventory_dispatch is on', () => {
    const offered = names(toolsForRole('Office Sales Rep', AMADIYA))
    expect(offered).toContain('get_stock_status')
    expect(offered).toContain('get_product_movement')
  })

  it('offers visit stats only to a Field Sales Rep in a tenant with field_ops', () => {
    expect(names(toolsForRole('Field Sales Rep', EVERY_MODULE))).toContain('get_visit_stats')
    expect(names(toolsForRole('Field Sales Rep', AMADIYA))).not.toContain('get_visit_stats')
    expect(names(toolsForRole('Office Sales Rep', EVERY_MODULE))).not.toContain('get_visit_stats')
    expect(names(toolsForRole('Manager', EVERY_MODULE))).not.toContain('get_visit_stats')
    expect(names(toolsForRole('Admin', EVERY_MODULE))).not.toContain('get_visit_stats')
  })

  it('gives a Manager on the Amadiya module set no visit stats but everything else', () => {
    const offered = names(toolsForRole('Manager', AMADIYA))
    expect(offered).not.toContain('get_visit_stats')
    expect(offered).toEqual(VOICE_TOOL_NAMES.filter((n) => n !== 'get_visit_stats'))
  })

  it('gives an Amadiya rep the sales and stock tools but no reorder or visits', () => {
    expect(names(toolsForRole('Field Sales Rep', AMADIYA))).toEqual([
      'get_sales_summary',
      'get_target_progress',
      'get_follow_up_list',
      'find_customer',
      'get_customer_insights',
      'get_suggested_order_for_customer',
      'get_stock_status',
      'get_product_movement',
    ])
  })

  it('always keeps the six sales tools, whatever the modules', () => {
    expect(names(toolsForRole('Office Sales Rep', ['sales_orders']))).toEqual([
      'get_sales_summary',
      'get_target_progress',
      'get_follow_up_list',
      'find_customer',
      'get_customer_insights',
      'get_suggested_order_for_customer',
    ])
    expect(names(toolsForRole('Admin', []))).toHaveLength(6)
  })

  it('gives a Field Sales Rep with every module nine tools, in declared order', () => {
    expect(names(toolsForRole('Field Sales Rep', EVERY_MODULE))).toEqual(
      VOICE_TOOL_NAMES.filter((n) => n !== REORDER),
    )
  })

  it('offers nothing to a role outside the four sales roles', () => {
    for (const role of ['Restaurant/Hotel Customer', 'Warehouse', 'QR Staff', 'admin', '']) {
      expect(toolsForRole(role, EVERY_MODULE)).toEqual([])
    }
  })

  it('returns the shared schema objects, not copies', () => {
    const offered = toolsForRole('Admin', EVERY_MODULE)
    for (const t of offered) expect(t).toBe(tool(t.name))
  })

  it('does not change the shared list or the modules it is given', () => {
    const modules = Object.freeze([...AMADIYA])
    toolsForRole('Field Sales Rep', modules)
    expect(VOICE_TOOLS).toHaveLength(10)
    expect(modules).toEqual(AMADIYA)
  })
})
