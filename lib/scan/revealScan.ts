// Show a scanned code the way a machine sees it, for a refusal message.
//
// NX-0044: an operator was told "Nothing in the catalogue matches 4792082500139"
// while holding a product that stores exactly 4792082500139. The code on screen
// LOOKED identical because the difference could not be seen. A refusal has to
// make that difference visible, or it reads as the app being wrong.
//
// Every character outside printable ASCII (which is all Code 128 Set B — and so
// every label we print — can carry) is rendered as ⟨U+XXXX⟩. Pure and DOM-free.

const PRINTABLE_ASCII = /^[\x20-\x7E]$/

export function revealScan(code: string): string {
  let out = ''
  for (const ch of code) {
    if (PRINTABLE_ASCII.test(ch)) {
      out += ch
    } else {
      const hex = (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
      out += `⟨U+${hex}⟩`
    }
  }
  return out
}

/** Code points, not UTF-16 units: an astral character is one character. */
export function scanLength(code: string): number {
  return [...code].length
}
