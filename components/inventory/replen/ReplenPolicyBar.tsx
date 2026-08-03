import React from 'react';
import { Sparkles } from 'lucide-react';
import type { ReplenPolicy } from '../../../lib/replenPolicy';

interface ReplenPolicyBarProps {
  policy: ReplenPolicy;
  onChange: (next: ReplenPolicy) => void;
  /** How many rows "fill" would actually touch — empty ones only. */
  fillableCount: number;
  onFill: () => void;
  disabled?: boolean;
}

const NumberField: React.FC<{
  label: string;
  value: number;
  suffix: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  title?: string;
}> = ({ label, value, suffix, min = 0, max = 1000, onChange, title }) => (
  <label className="text-[11px] text-stone-500" title={title}>
    {label}
    <span className="mt-0.5 flex items-center gap-1">
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="w-16 text-sm border border-stone-200 rounded px-2 py-1 text-right tabular-nums"
      />
      <span className="text-[11px] text-stone-400">{suffix}</span>
    </span>
  </label>
);

/**
 * The policy that turns a slot's capacity into a suggested min and max.
 *
 * It is a calculator, not stored configuration: the numbers it produces are
 * saved, the percentages are not. Persisting the policy would invite the belief
 * that changing it later re-runs anything, and it does not — every figure on the
 * grid was accepted by a person.
 */
const ReplenPolicyBar: React.FC<ReplenPolicyBarProps> = ({
  policy, onChange, fillableCount, onFill, disabled,
}) => (
  <div className="glass-card rounded-xl p-3 sm:p-4 flex flex-wrap items-end gap-4">
    <div>
      <p className="text-sm font-medium text-stone-700">Suggest from slot capacity</p>
      <p className="text-[11px] text-stone-400 max-w-md">
        How much fits in the pick slot is the one thing that is true before a site has traded.
        Demand-based cover comes later, once there are real picks to read.
      </p>
    </div>

    <NumberField
      label="Fill to"
      suffix="% of capacity"
      value={policy.maxFillPercent}
      min={1}
      max={100}
      onChange={(maxFillPercent) => onChange({ ...policy, maxFillPercent })}
      title="The maximum, as a share of what physically fits."
    />
    <NumberField
      label="Top up at"
      suffix="% of max"
      value={policy.minPercentOfMax}
      min={0}
      max={99}
      onChange={(minPercentOfMax) => onChange({ ...policy, minPercentOfMax })}
      title="The minimum, as a share of the maximum. A task is raised when the slot falls to it."
    />
    <NumberField
      label="Never below"
      suffix="packs"
      value={policy.minFloorPacks}
      min={0}
      max={99}
      onChange={(minFloorPacks) => onChange({ ...policy, minFloorPacks })}
      title="A floor for the minimum, so a small slot does not end up topping up at zero."
    />

    <label className="text-[11px] text-stone-500">
      Round to
      <select
        value={policy.roundTo}
        onChange={(e) => onChange({ ...policy, roundTo: e.target.value === 'base' ? 'base' : 'pack' })}
        className="mt-0.5 block text-sm border border-stone-200 rounded px-2 py-1 bg-white"
      >
        <option value="pack">whole packs</option>
        <option value="base">base units</option>
      </select>
    </label>

    <button
      type="button"
      onClick={onFill}
      disabled={disabled || fillableCount === 0}
      className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 min-h-[40px] rounded-lg bg-nexgen-blue text-white btn-press disabled:opacity-40"
      title="Only fills rows that are still empty — nothing already typed is overwritten."
    >
      <Sparkles className="w-4 h-4" aria-hidden="true" />
      Fill {fillableCount} empty {fillableCount === 1 ? 'row' : 'rows'}
    </button>
  </div>
);

export default ReplenPolicyBar;
