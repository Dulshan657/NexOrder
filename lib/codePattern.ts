// Client-side entry point for operator-controlled location codes.
//
// Rendering, validation and the recode planner live in the pure shared module so the
// Edge Function and the browser run the very same code. That is load-bearing twice
// over: the marquee's preview IS the server's `dry_run`, and the pattern editor's
// live sample IS what `save_geometry` will mint. A second implementation would drift
// and the operator would find out on a printed sticker.
//
// Mirrors lib/signPaint.ts ↔ _shared/wie/signPaint.ts. Import from here in
// components; never reach into supabase/functions directly from a view.

export {
  MAX_CODE_LENGTH,
  MAX_BLOCK_LENGTH,
  PARK_PREFIX,
  HU_NAMESPACE,
  CODE_ORDERS,
  CODE_ORDER_LABELS,
  CODE_ORIGINS,
  CODE_ORIGIN_LABELS,
  DEFAULT_ORIGIN,
  BUILTIN_PATTERN,
  WIZARD_DEFAULT_PATTERN,
  sanitizeBlock,
  sanitizeBlockInput,
  blockIssue,
  templateIssue,
  usedTokens,
  styleOfTemplate,
  templateForStyle,
  formatCode,
  levelCodeFor,
  codeIssue,
  describeCodeIssue,
  orderCells,
  frameKey,
  buildSelectionFrame,
  solveBlockFraming,
  planRecode,
} from '@/supabase/functions/_shared/wie/codePattern'

export type {
  CodeOrder,
  CodeOrigin,
  CodePattern,
  CodeBindings,
  CodeIssueKind,
  NumberingStyle,
  GridIndex,
  SelectionFrame,
  RecodeCell,
  RecodeLevel,
  RecodeUnit,
  RecodeOptions,
  RecodeLevelWrite,
  RecodeWrite,
  RecodeRefusal,
  RecodeRefusalKind,
  RecodeDrift,
  RecodeProposal,
  RecodePlan,
} from '@/supabase/functions/_shared/wie/codePattern'
