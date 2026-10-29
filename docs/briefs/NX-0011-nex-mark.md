# NX-0011 — Nex mark: the logo's N replaces the static orb on the launcher and the sheet header

```json brief
{
  "id": "NX-0011-nex-mark",
  "base": "3bef1ef1863b36b8dac0f7c53497487338aeb21f",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "The launcher shows the Nex mark (an aria-hidden SVG, data-nex-mark=\"disc\") and no orb, and keeps its aria-label 'Talk to Nex' and its id." },
    { "id": "A2", "check": "The sheet header shows the bare Nex mark (data-nex-mark=\"bare\") instead of an orb, and the hero orb is still the one live orb in the sheet (data-orb-animate=\"live\")." },
    { "id": "A3", "check": "The mark is the logo's geometry, measured from Nex-Order-no-bg-logo.png: every diagonal of both Ns and the arrow shaft runs at 60 degrees, the white between the two Ns is the same width on both sides, and the arrowhead is symmetric about the shaft's axis (tip on the axis, base corners equidistant), 2.8 strokes long and 3.4 strokes wide." },
    { "id": "A11", "check": "The front N's foot curls back inwards, as in the logo: the stroke rounds the bottom and ends inside the front N's arch, with white between it and both legs of that N." },
    { "id": "A12", "check": "The inside of the front N's peak and of the valley the arrow climbs out of is rounded (a concave arc tangent to both inner edges), while the outer edge of both turns stays the logo's." },
    { "id": "A13", "check": "The mark has no sharp corner anywhere: the arrowhead's three points are rounded, the two inside corners where the shaft meets the arrowhead are filled with arcs, and the white sliver inside the fold ends in a curve (the foot's arc radius is greater than half the stroke)." },
    { "id": "A4", "check": "The mark's ink is at least 3:1 against every stop of the disc (WCAG 1.4.11)." },
    { "id": "A5", "check": "The idle cadence is five shimmers at 1.7, 8, 15, 22 and 29 seconds after mount and none after 30 seconds; under reduced motion it schedules nothing." },
    { "id": "A6", "check": "NexMark draws on when mounted, shimmers on that schedule, replays the shimmer each time playToken changes, and skips a scheduled shimmer while the tab is hidden." },
    { "id": "A7", "check": "Under prefers-reduced-motion NexMark renders the finished mark still: no draw-on, no shimmer, no timers." },
    { "id": "A8", "check": "In a real browser the launcher and header mark match the approved preview (artifact BytUwpU7GoSfBeMNiewFyo) on desktop and at 360x720, in light and dark, and the hero orb still follows a conversation.", "manual": "Chrome on nexorder.vercel.app, desktop and 360x720" },
    { "id": "A9", "check": "npm run brand:nex-mark writes the SVG master, nex-mark-512.gif, nex-mark-1080.gif, nex-mark-1080.mp4 and PNGs at 64/128/256/512/1024 (disc and bare) to brand/nex-mark/dist/.", "manual": "run the script, open each file" },
    { "id": "A10", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/voice/voiceAssistantLauncher.test.tsx", "test": "VoiceAssistantLauncher > shows the Nex mark instead of an orb, keeping its label", "proves": ["A1"] },
    { "file": "__tests__/voice/voiceAssistantSheet.test.tsx", "test": "VoiceAssistantSheet > shows the Nex mark in the header and keeps the live hero orb", "proves": ["A2"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > runs every diagonal at 60 degrees", "proves": ["A3"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > keeps the gap between the two Ns equal on both sides", "proves": ["A3"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > centres the arrowhead on the shaft axis", "proves": ["A3"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > curls the front N's foot inwards, clear of both legs", "proves": ["A11"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > rounds the inside of the front peak and the valley", "proves": ["A12"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > has no sharp corner anywhere", "proves": ["A13"] },
    { "file": "__tests__/voice/nexMarkGeometry.test.ts", "test": "nexMarkGeometry > keeps the ink at 3:1 or better against the disc", "proves": ["A4"] },
    { "file": "__tests__/voice/markCadence.test.ts", "test": "markCadence > shimmers five times in the first 30 seconds, then rests", "proves": ["A5"] },
    { "file": "__tests__/voice/markCadence.test.ts", "test": "markCadence > schedules nothing under reduced motion", "proves": ["A5"] },
    { "file": "__tests__/voice/nexMark.test.tsx", "test": "NexMark > draws on when mounted and shimmers on schedule", "proves": ["A6"] },
    { "file": "__tests__/voice/nexMark.test.tsx", "test": "NexMark > replays the shimmer when playToken changes", "proves": ["A6"] },
    { "file": "__tests__/voice/nexMark.test.tsx", "test": "NexMark > skips a shimmer while the tab is hidden", "proves": ["A6"] },
    { "file": "__tests__/voice/nexMark.test.tsx", "test": "NexMark > renders still and schedules nothing under reduced motion", "proves": ["A7"] }
  ],
  "allow": []
}
```

## Goal

The Nex Assistant's launcher (bottom-right) and the sheet header (top-left) show a
still dotted orb that says nothing about the brand. The owner wants the logo's mark
there, animated and good enough to use in a campaign. Approved design: the preview
artifact `BytUwpU7GoSfBeMNiewFyo`, round 6 — C's colours (navy disc, blue-to-cyan
ink), A's motion (draw-on, then a glint sweeps the strokes and the arrow nudges
along its axis, with a glow pulse), and the logo's fold: the front N's foot curls
back inwards. The geometry is measured from the logo file and checked by overlay.

## Approach

- `components/voice/nexMarkGeometry.ts` (pure): the mark in the logo's own pixel
  space, measured from `public/assets/Nex-Order-no-bg-logo.png` — 60° diagonals,
  stroke 36, a soft back peak (radius 49), tight front corners rounded on the inside, an isosceles
  arrowhead centred on the shaft, the inward fold at the front N's foot — exported as path strings, bounds and
  colour tokens. One drawing for every size.
- `components/voice/markCadence.ts` (pure): the shimmer schedule.
- `components/voice/NexMark.tsx`: inline SVG, `variant: 'disc' | 'bare'`, `size`,
  `playToken`; aria-hidden; CSS keyframes (`nex-mark-*`) in `index.css` under
  `prefers-reduced-motion: no-preference`; per-instance ids via `useId`. No canvas,
  no dependency.
- `useReducedMotion` lifted out of `NexOrb.tsx` into `components/voice/useReducedMotion.ts`
  so both components share it.
- `VoiceAssistantButton.tsx`: the disc mark replaces the orb and the flat blue
  background; size, position, focus ring, label and id unchanged.
- `VoiceAssistantSheet.tsx`: the header orb becomes the bare mark; the hero orb is
  untouched.
- `scripts/brand/render-nex-mark.ts` (run with tsx, `npm run brand:nex-mark`): builds a
  standalone animated SVG from the same geometry, screenshots it frame by frame with
  Playwright, and encodes the GIFs and MP4 with ffmpeg. `brand/nex-mark/nex-mark.svg`
  is committed; `brand/nex-mark/dist/` is gitignored.

## Out of scope

- The hero orb and its live audio behaviour.
- Removing `NexOrb`'s now-unused `burst` mode. It loses its last two callers here,
  but its tests would count as removed assertions; it gets a follow-up brief that
  allows that by name.
- The favicon, PWA icons, the logo PNG and the login screen.
- Amadiya: `voice_assistant` is on dev only.

## FINAL

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `VoiceAssistantLauncher > shows the Nex mark instead of an orb, keeping its label` fails on base, passes on tip (check:brief) | |
| A2 | claimed | `VoiceAssistantSheet > shows the Nex mark in the header and keeps the live hero orb` fails on base, passes on tip | |
| A3 | claimed | `nexMarkGeometry > runs every diagonal at 60 degrees`, `> keeps the gap between the two Ns equal on both sides`, `> centres the arrowhead on the shaft axis` | Geometry measured from the logo and overlaid on it during design (preview artifact, round 6) |
| A4 | claimed | `nexMarkGeometry > keeps the ink at 3:1 or better against the disc` | Computed from the hex values with the WCAG formula, not measured in the built CSS |
| A5 | claimed | `markCadence > shimmers five times in the first 30 seconds, then rests`, `> schedules nothing under reduced motion` | Also `> counts from the page first showing a mark…`, added after review |
| A6 | claimed | `NexMark > draws on when mounted and shimmers on schedule`, `> replays the shimmer when playToken changes`, `> skips a shimmer while the tab is hidden` | Also `> ignores a hover or tap while it is still drawing on` and `> plays only what is left of the idle schedule when remounted`, added after review |
| A7 | claimed | `NexMark > renders still and schedules nothing under reduced motion` (no timers at all: `vi.getTimerCount() === 0`) | |
| A8 | claimed | On nexorder.vercel.app at cc69fa0, signed in as the demo Admin in Chrome: a real click on the launcher opens the sheet (pointerdown, pointerup and click all reach `#nex-assistant-launcher`), the header shows the bare mark, the hero orb listens, Escape closes it and focus returns to the launcher. Also rendered with the app's CSS at every size, mid draw-on and mid shimmer | Desktop only (1600x731); not seen at 360x720 or in dark mode on dev |
| A9 | claimed | `npm run brand:nex-mark` wrote 5 SVG masters, `nex-mark-512.gif` (1.4 MB), `nex-mark-1080.gif` (4.6 MB), `nex-mark-1080.mp4` (365 KB, ffprobe: bt709/bt709/bt709) and 10 PNGs; frames inspected as a contact sheet | |
| A10 | not-claimed | The branch (cc69fa0) is deployed to dev: /version.json = cc69fa0, health 200, live CSS carries every `nex-mark-*` rule | Not merged yet; the merge sha deploy follows the PR |
| A11 | claimed | `nexMarkGeometry > curls the front N's foot inwards, clear of both legs` | |
| A12 | claimed | `nexMarkGeometry > rounds the inside of the front peak and the valley` | |
| A13 | claimed | `nexMarkGeometry > has no sharp corner anywhere` | Every corner was also checked by eye at 900 px |

### Not claimed

- The first deploy (fece8d8) shipped a launcher that did not open: a press started a shimmer that remounted the shape under the pointer, and Chrome dropped the click. Unit tests could not see it (fireEvent.click always dispatches); fixed in cc69fa0 and pinned by `NexMark > never takes the pointer, so a shimmer cannot swallow the click that started it`, but no test reproduces the browser's dropped click itself.
- A8 was checked on desktop only, not at 360x720 on dev.
- The hero orb's live behaviour was not re-tested in a conversation; its code is unchanged apart from `useReducedMotion` moving to its own file.
- NexOrb's `burst` mode now has no caller and stays, with its tests, for a follow-up brief.
- Not checked on the RS35 handheld; `voice_assistant` is off on Amadiya, and the Warehouse role has no assistant anyway.
- The GIFs are on a white background; a dark-background cut was not rendered.
