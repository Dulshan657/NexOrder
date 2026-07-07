// Warehouse Intelligence Engine — rule evaluation.
//
// Interprets the structured-JSON rules stored in wie_rules against a
// (sku, bin) context. Hard rules (require/forbid) veto a candidate; soft rules
// (boost/penalty) adjust its score. The Phase-1 seed templates and the Phase-3
// visual builder both emit this exact shape, so the interpreter is stable across
// phases even though the authoring UI grows.

import type {
  CandidateBin,
  RuleCondition,
  RuleDefinition,
  RuleOp,
  RuleTarget,
  RuleTrigger,
  SkuProfile,
} from './types.ts'

export interface RuleContext {
  sku: SkuProfile
  bin: CandidateBin
}

/** Resolve `subject.attr` to a comparable value from the context. Unknown
 *  attributes resolve to null (so `exists` is false and comparisons fail safe). */
function resolveAttr(subject: RuleCondition['subject'], attr: string, ctx: RuleContext): unknown {
  if (subject === 'product') {
    switch (attr) {
      case 'category': return ctx.sku.category
      case 'hazardClass': return ctx.sku.hazardClass
      case 'tempMin': return ctx.sku.tempMin
      case 'tempMax': return ctx.sku.tempMax
      case 'handlingType': return ctx.sku.handlingType
      case 'stackable': return ctx.sku.stackable
      case 'sizeFactor': return ctx.sku.sizeFactor
      default: return null
    }
  }
  // 'bin' and 'zone' both read off the candidate bin (a bin carries its zone info).
  switch (attr) {
    case 'zoneTag': return ctx.bin.zoneTag
    case 'zoneType': return ctx.bin.zoneType
    case 'zonePriorityWeight': return ctx.bin.zonePriorityWeight
    case 'capacitySlots': return ctx.bin.capacitySlots
    case 'usedSlots': return ctx.bin.usedSlots
    case 'hasSameProduct': return ctx.bin.hasSameProduct
    default: return null
  }
}

function compare(op: RuleOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case 'exists': return left !== null && left !== undefined
    case 'eq': return left === right
    case 'neq': return left !== right
    case 'in': return Array.isArray(right) && right.includes(left as never)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const l = Number(left)
      const r = Number(right)
      if (Number.isNaN(l) || Number.isNaN(r)) return false
      if (op === 'gt') return l > r
      if (op === 'gte') return l >= r
      if (op === 'lt') return l < r
      return l <= r
    }
    default: return false
  }
}

/** Do a rule's conditions hold under its logic ('and' = all, 'or' = any)? An
 *  empty condition set matches (an unconditional rule). */
export function conditionsMatch(
  conditions: RuleCondition[],
  ctx: RuleContext,
  logic: 'and' | 'or' = 'and',
): boolean {
  if (conditions.length === 0) return true
  const test = (c: RuleCondition) => compare(c.op, resolveAttr(c.subject, c.attr, ctx), c.value)
  return logic === 'or' ? conditions.some(test) : conditions.every(test)
}

/** Does the candidate bin satisfy a hard rule's target predicate? */
function targetSatisfied(target: RuleTarget, ctx: RuleContext): boolean {
  const value = resolveAttr(target.scope === 'zone' ? 'zone' : 'bin', target.attr, ctx)
  return compare(target.op, value, target.value)
}

export interface RuleEvaluation {
  /** The highest-priority hard rule this bin violates, or null if it passes. */
  hardViolation: { rule: RuleDefinition; reason: string } | null
  /** Score adjustments from matching soft rules. */
  softTriggers: RuleTrigger[]
}

/**
 * Evaluate every active rule against one candidate bin. A hard rule whose
 * conditions match imposes its target: `require` fails if the target is not
 * satisfied, `forbid` fails if it is. Among violations the highest priority wins
 * (ties broken by lower id) so the rejection reason is deterministic.
 */
export function evaluateRules(rules: RuleDefinition[], ctx: RuleContext): RuleEvaluation {
  let hardViolation: RuleEvaluation['hardViolation'] = null
  const softTriggers: RuleTrigger[] = []

  for (const rule of rules) {
    if (!conditionsMatch(rule.conditions, ctx, rule.conditionLogic ?? 'and')) continue

    if (rule.enforcement === 'hard') {
      const target = rule.action.target
      if (!target) continue
      const satisfied = targetSatisfied(target, ctx)
      const violated = rule.action.effect === 'require' ? !satisfied : satisfied
      if (violated) {
        const better = hardViolation === null || rule.priority > hardViolation.rule.priority
        if (better) {
          const verb = rule.action.effect === 'require' ? 'requires' : 'forbids'
          hardViolation = {
            rule,
            reason: `${rule.name}: ${verb} ${target.scope}.${target.attr} ${target.op} ${JSON.stringify(target.value)}`,
          }
        }
      }
    } else {
      const delta = rule.action.delta ?? 0
      if (delta !== 0) {
        softTriggers.push({
          ruleId: rule.id,
          name: rule.name,
          effect: rule.action.effect === 'penalty' ? 'penalty' : 'boost',
          delta: rule.action.effect === 'penalty' ? -Math.abs(delta) : Math.abs(delta),
        })
      }
    }
  }

  return { hardViolation, softTriggers }
}
