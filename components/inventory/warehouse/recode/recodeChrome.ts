// Moved to ../panelChrome.ts when the slotting block builder needed the same
// vocabulary — two panels sharing one density rule is the whole point of the
// file, and a second copy would defeat it.
//
// Re-exported rather than rewritten at four call sites, the
// components/admin/settings/primitives.tsx precedent.
export * from '../panelChrome'
