# Accessibility statement

NexGen Innovations wants Nex Order to be usable by everyone who has to work in
it, including people using a screen reader, a keyboard alone, or a screen
magnifier, and including the warehouse operator holding a scanner in one gloved
hand.

**Last reviewed: 28 August 2026.**

## Conformance status

Nex Order is **partially conformant** with the Web Content Accessibility
Guidelines (WCAG) 2.2 at Level AA. "Partially conformant" means most of the
product meets the standard, and the parts that do not are listed below.

We have chosen to state this precisely rather than claim full conformance,
because the exceptions are real, measured, and known to us.

## What is enforced automatically

Accessibility is checked on every change, not audited occasionally:

- **Static analysis** on every pull request. Interactive elements must have an
  accessible name; click handlers must be reachable by keyboard; ARIA must be
  valid. Existing findings are frozen at a fixed count that can only shrink — a
  new one fails the build, including a second one added to a file that already
  has some.
- **Automated testing with axe** at two levels: against rendered components,
  which covers names, roles, labelling, heading order and landmarks; and against
  the running application in a real browser, which additionally covers colour
  contrast.
- **A colour-contrast survey** of the signed-in warehouse screens, run
  deliberately rather than on a schedule, because those screens can only be
  measured with a real login.

## Known exceptions

### Brand colour contrast

Our brand blue measures **3.70:1** against white, and **3.30:1** where it is used
on its own pale tint. WCAG 2.2 AA asks for 4.5:1 for normal-size text and 3:1 for
large text and non-text elements.

This colour is kept deliberately. It is a considered brand decision rather than
an oversight, and it is disclosed here rather than hidden.

Where it would have been worst, we changed it anyway:

- Small text set in the brand colour has been moved to a darker shade that
  measures 4.93:1.
- The keyboard focus indicator, which was the single most important thing on the
  list, was a 40%-opacity version of the brand colour measuring **1.62:1**. It is
  now the darker shade at 4.93:1. A focus ring is what a keyboard user navigates
  by, and it is not covered by this exception.

### Status badge colours

The severity badges — critical, warning, information — use white text on
saturated red, amber and blue. Measured, these are **2.13:1 to 3.7:1** and do not
meet AA. This affects all three badges, not one of them; it is a decision about
the whole status palette and is on our list to resolve rather than quietly
restyle. The badges never carry information that is not also in their text.

## Known limitations

- **Some form controls are not yet programmatically labelled.** The shared form
  components are fixed, and the remaining raw controls are counted and frozen, so
  the number can only go down. Until it reaches zero, a screen-reader user will
  meet fields on some administrative screens that announce less than they should.
- **Sortable table headers are not yet keyboard-operable** on some list views,
  and do not announce their sort direction.
- **There is no skip link yet**, so a keyboard user must pass the navigation to
  reach the main content on each screen.

These are being worked through in order. This statement is updated when they
change, not when we intend to change them.

## What already works

- All dialogs trap focus, restore it on close, and can be dismissed with Escape;
  each is announced with its title and its description.
- Notifications are announced by a live region that exists before the message
  arrives.
- Reduced-motion preferences are respected across the application.
- Touch targets on handheld surfaces meet the 44-pixel minimum.
- The application is usable at 360 pixels wide, which is the real width of the
  warehouse scanner it is used on.

## Telling us about a problem

If something in Nex Order is not usable for you, we want to know, and a specific
report is worth more than a general one — the screen, what you were trying to do,
and what happened.

Contact: info@nexgeninnovations.com.au

We aim to respond within five working days.

## How this was assessed

Self-assessment, using automated testing (axe-core against the running
application), static analysis, and manual keyboard and reduced-motion checks. No
external audit has been carried out. Contrast figures are measured from the
values the browser actually renders, not calculated from a colour table.
