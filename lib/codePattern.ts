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
  BUILTIN_PATTERN,
  sanitizeBlock,
  sanitizeBlockInput,
  blockIssue,
  templateIssue,
  formatCode,
  levelCodeFor,
  codeIssue,
  describeCodeIssue,
  orderCells,
  planRecode,
} from '@/supabase/functions/_shared/wie/codePattern'

export type {
  CodeOrder,
  CodePattern,
  CodeBindings,
  CodeIssueKind,
  RecodeCell,
  RecodeLevel,
  RecodeUnit,
  RecodeOptions,
  RecodeLevelWrite,
  RecodeWrite,
  RecodeRefusal,
  RecodeRefusalKind,
  RecodePlan,
} from '@/supabase/functions/_shared/wie/codePattern'
