// How a count can come back in Nex's transcript: as digits ("22") or as words
// ("twenty-two", "twenty two"). Pure, so __tests__/voiceE2eHarness.test.ts can
// pin it without a browser. Covers 0 to 99, which is every count the voice spec
// asks about on the demo; a larger number is matched as digits only.

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** A whole-word pattern for `n` however Nex might say it; never matches another number. */
export function spokenForms(n: number): RegExp {
  const forms = [String(n)]
  if (n < 20) forms.push(WORDS[n])
  else if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]
    const unit = n % 10
    // "twenty" alone must not match the start of "twenty-one".
    forms.push(unit === 0 ? `${tens}(?![- ](one|two|three|four|five|six|seven|eight|nine)\\b)` : `${tens}[- ]${WORDS[unit]}`)
  }
  return new RegExp(`\\b(${forms.join('|')})\\b`, 'i')
}
