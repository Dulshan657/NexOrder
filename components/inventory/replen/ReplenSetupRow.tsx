import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import {
  describeEntry,
  draftFigures,
  entryUnitLabel,
  formatEntry,
  type ProposedHomeBin,
  type ReplenConfigRow,
  type ReplenDraft,
  type ReplenRowVerdict,
  type ReplenSuggestion,
} from '../../../lib/replenPolicy';

export interface BinOption {
  id: number;
  code: string;
  name: string;
  levelRole: string | null;
  isPickZone: boolean;
}

interface ReplenSetupRowProps {
  row: ReplenConfigRow;
  draft: ReplenDraft;
  verdict: ReplenRowVerdict;
  suggestion: ReplenSuggestion | null;
  proposal: ProposedHomeBin | null;
  /** The id of the ONE `<datalist>` the grid renders for every row. */
  binListId: string;
  binCodeOf: (binId: number | null) => string;
  resolveBinCode: (code: string) => number | null;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onChange: (next: ReplenDraft) => void;
  onUseSuggestion: () => void;
}

/** One SKU's slot. Its own component because a 200-row grid re-rendering every
 *  row on every keystroke is the difference between usable and not. */
const ReplenSetupRow: React.FC<ReplenSetupRowProps> = ({
  row, draft, verdict, suggestion, proposal, binListId, binCodeOf, resolveBinCode,
  selected, onSelect, onChange, onUseSuggestion,
}) => {
  const figures = draftFigures(row, draft);
  const unit = entryUnitLabel(row.packFactor, true);
  const isProposed = draft.binId != null && draft.binId !== row.homeBinId;

  // The bin is typed or picked from a shared datalist, never from a per-row
  // <select>. A select renders one <option> per bin PER ROW: at NEXG that is 158
  // rows x ~400 locations, and the tab froze hard enough that Chrome could not
  // be scripted. One datalist for the grid renders the list once.
  const [text, setText] = React.useState(() => binCodeOf(draft.binId));
  const [editing, setEditing] = React.useState(false);
  // Follow the draft whenever something else moves it — a fill, a CSV import, a
  // reset after save — but never while the operator is mid-word.
  React.useEffect(() => {
    if (!editing) setText(binCodeOf(draft.binId));
  }, [draft.binId, editing, binCodeOf]);

  const commitText = (value: string) => {
    setText(value);
    const trimmed = value.trim();
    onChange({ ...draft, binId: trimmed === '' ? null : resolveBinCode(trimmed) });
  };

  // A suggestion is only worth offering when it would actually change something.
  const suggestionText = suggestion && suggestion.basis === 'capacity'
    ? `${formatEntry(suggestion.minQty, row)} / ${formatEntry(suggestion.maxQty, row)} ${unit}`
    : null;
  const canFill = suggestionText !== null && (draft.minText.trim() === '' || draft.maxText.trim() === '');

  return (
    <tr className={selected ? 'bg-nexgen-blue/5' : undefined}>
      <td className="px-2 py-2 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${row.sku}`}
          className="mt-1"
        />
      </td>

      <td className="px-2 py-2 align-top min-w-[200px]">
        <div className="text-sm text-stone-800 truncate">{row.name}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="font-mono text-[11px] text-stone-500">{row.sku}</span>
          {!row.stockedHere && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500"
              title="This site holds none of it and has never named a slot for it. Configuring it now is fine — it is how a site is set up before its opening count."
            >
              not here yet
            </span>
          )}
          {row.replenEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              replenishing
            </span>
          )}
        </div>
      </td>

      <td className="px-2 py-2 align-top text-right tabular-nums text-xs text-stone-500 whitespace-nowrap">
        <div title="Base units held at this site">{row.onHandHere}</div>
        <div className="text-[10px] text-stone-400" title="Units picked in 30 days, or ordered in 90 — ranking only">
          {row.demandQty > 0 ? `${row.demandQty} moved` : '—'}
        </div>
      </td>

      <td className="px-2 py-2 align-top">
        <input
          type="text"
          list={binListId}
          value={text}
          placeholder="No home bin"
          aria-label={`Home bin for ${row.sku}`}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => commitText(e.target.value)}
          className="text-sm border border-stone-200 rounded-lg px-2 py-1.5 w-full max-w-[220px] bg-white font-mono"
        />
        {text.trim() !== '' && draft.binId == null && (
          <p className="text-[10px] text-red-600 mt-0.5">no bin with that code here</p>
        )}
        {isProposed && draft.binId != null && (
          <p className="text-[10px] text-nexgen-blue mt-0.5">
            {proposal?.source === 'stock'
              ? 'proposed — the stock is already here'
              : proposal?.source === 'free'
                ? 'proposed — nearest free pick bin'
                : 'changed'}
          </p>
        )}
      </td>

      <td className="px-2 py-2 align-top">
        <input
          type="text"
          inputMode="decimal"
          value={draft.minText}
          onChange={(e) => onChange({ ...draft, minText: e.target.value })}
          aria-label={`Minimum for ${row.sku}`}
          className="w-20 text-sm border border-stone-200 rounded px-2 py-1 text-right tabular-nums"
        />
        <div className="text-[10px] text-stone-400 h-4">{describeEntry(figures.minQty, row)}</div>
      </td>

      <td className="px-2 py-2 align-top">
        <input
          type="text"
          inputMode="decimal"
          value={draft.maxText}
          onChange={(e) => onChange({ ...draft, maxText: e.target.value })}
          aria-label={`Maximum for ${row.sku}`}
          className="w-20 text-sm border border-stone-200 rounded px-2 py-1 text-right tabular-nums"
        />
        <div className="text-[10px] text-stone-400 h-4">{describeEntry(figures.maxQty, row)}</div>
      </td>

      <td className="px-2 py-2 align-top min-w-[180px]">
        {canFill && (
          <button
            type="button"
            onClick={onUseSuggestion}
            className="inline-flex items-center gap-1 text-[11px] text-nexgen-blue hover:underline btn-press"
          >
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            {suggestionText}
          </button>
        )}
        {!canFill && suggestionText && (
          <span className="text-[11px] text-stone-400">{suggestionText}</span>
        )}
        {!suggestionText && suggestion?.reason && (
          <span className="text-[11px] text-stone-400" title={suggestion.reason}>
            no capacity figure
          </span>
        )}
        {!verdict.ok && !figures.empty && (
          <p className="text-[11px] text-red-600 mt-0.5">{verdict.reason}</p>
        )}
        {verdict.ok && !figures.empty && (
          <p className="text-[11px] text-emerald-600 mt-0.5 inline-flex items-center gap-1">
            <Check className="w-3 h-3" aria-hidden="true" /> ready
          </p>
        )}
      </td>
    </tr>
  );
};

export default React.memo(ReplenSetupRow);
