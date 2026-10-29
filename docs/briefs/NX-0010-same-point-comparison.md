# NX-0010 — Compare with the same point last period; Nex names no rules

```json brief
{
  "id": "NX-0010-same-point-comparison",
  "base": "b35adadb0f82c15aa94796ae43714b2df336e46a",
  "approved": "2026-10-29 owner",
  "acceptance": [
    { "id": "A1", "check": "Today runs from Sydney midnight to now and is compared with yesterday from midnight to the same clock time." },
    { "id": "A2", "check": "This week runs from Monday 00:00 (Sydney) to now and is compared with last week from Monday 00:00 to the same weekday and clock time." },
    { "id": "A3", "check": "This month runs from the 1st to now and is compared with last month from the 1st to the same day of the month and clock time; when last month is shorter (31 Oct against September) the comparison ends at the end of last month." },
    { "id": "A4", "check": "Last month, the last 30 days and a custom range keep comparing whole days with the same number of whole days just before.", "manual": "the existing last_month / last_30_days / custom cases in __tests__/voice/period.test.ts stay green with their assertions untouched" },
    { "id": "A5", "check": "The Admin Dashboard's arrows and Nex's 'compared with the previous period' use the same windows: on one data set, Nex's previous order count equals the dashboard's previous Orders count for Today, This Week and This Month." },
    { "id": "A6", "check": "Nex's instructions never ask it to name a rule: it states the period and whose orders in plain words, and is told not to call its basis a rule." },
    { "id": "A7", "check": "On dev, the voice run (tests/voice-e2e, once NX-0009 is merged) hears no 'rule' in either answer.", "manual": "npx playwright test --project=voice against nexorder.vercel.app; transcript checked by eye" },
    { "id": "A8", "check": "Merged and deployed to dev; /version.json shows the merge sha; voice-session redeployed to dev.", "manual": "deploy:dev and fn:deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares today so far with yesterday up to the same time", "proves": ["A1"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares this week so far with last week up to the same weekday and time", "proves": ["A2"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > compares this month so far with last month up to the same day and time", "proves": ["A3"] },
    { "file": "__tests__/dashboardPeriod.test.ts", "test": "dashboardRange > ends the comparison at the end of a shorter previous month", "proves": ["A3"] },
    { "file": "__tests__/numbersParity.test.ts", "test": "order numbers parity > Nex and the dashboard arrows compare with the same previous window", "proves": ["A5"] },
    { "file": "__tests__/voice/instructions.test.ts", "test": "buildInstructions > never asks Nex to name a rule", "proves": ["A6"] }
  ],
  "allow": []
}
```

## Goal

Owner's call (2026-10-29), after NX-0008 made the dashboard compare as Nex
did: whole days to whole days, so "today so far" was set against all of
yesterday and the arrows leaned negative every morning. The owner chose
**the same point last period**: today until 2 pm against yesterday until 2 pm;
1 to 29 October against 1 to 29 September. Nex changes with the dashboard so
the two keep agreeing. (Correction to how the choice was put to the owner: Nex
did NOT already compare this way; it compared whole days too. Both move.)

Second, Nex said things like "using the 'shipped means processed' rule". Its
instructions literally told it to state "the period, whose orders, and the
rule". That line goes, and it is told never to call its basis a rule.

## Approach

- `lib/period.ts` `resolvePeriod`: for `today`, `this_week` and `this_month`,
  `to` becomes `now`, and `previous` becomes the same span one day, week or
  calendar month earlier, ending at the same clock time (clamped to the end of
  a shorter previous month). `last_month`, `last_30_days` and `custom` keep
  whole days. `dashboardRange` keeps delegating, so the dashboard and Nex
  cannot drift apart.
- `__tests__/voice/period.test.ts`: its assertions for those three periods
  change to the new rule, as this brief states.
- `supabase/functions/_shared/voice/instructions.ts`: HOW_TO_SPEAK drops "and
  the rule"; ORDER WORDS keeps "never quote these rules" and adds "never call
  your basis a rule".
- Labels ("this month (1 Oct to 29 Oct 2026)") are unchanged.

## Out of scope

- Any other dashboard's comparison (SalesDashboard, RepDashboardV2).
- The voice e2e spec itself (NX-0009); A7 only reads its transcript.
- Amadiya.

## FINAL
