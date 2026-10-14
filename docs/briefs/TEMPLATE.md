# NX-#### — <one-line title>

<!--
Copy to docs/briefs/NX-<next 4-digit number>-<slug>.md (the /brief skill does this).
Commit it ALONE, as the first commit of the branch, on the commit named in "base",
and only after the owner has approved it. Rules: docs/claude/briefs.md.
-->

```json brief
{
  "id": "NX-0000-slug",
  "base": "<full 40-char sha of the commit the branch starts from>",
  "approved": "<date> owner",
  "acceptance": [
    { "id": "A1", "check": "<one observable behaviour, stated so a test can fail on it>" },
    { "id": "A2", "check": "Merged and deployed to dev; /version.json shows the merge sha.", "manual": "deploy:dev verification" }
  ],
  "failFirst": [
    { "file": "__tests__/<file>.test.ts", "test": "<describe> > <it>", "proves": ["A1"] }
  ],
  "allow": []
}
```

## Goal

<what changes for whom, and why now>

## Approach

<files and the shape of the change — enough that a reviewer can tell scope creep>

## Out of scope

<what this change deliberately does not do>

## FINAL

<!--
Written LAST, by the author, before asking for the gate. One row per acceptance id.
Status is `claimed` (evidence required: a test name, a command and its result, a sha)
or `not-claimed` (say why in Note). Then at least one "Not claimed" item.

| Acceptance | Status | Evidence | Note |
|---|---|---|---|
| A1 | claimed | `<describe> > <it>` fails on base, passes on tip (check:brief) | |
| A2 | claimed | /version.json = <sha>, health 200 | |

### Not claimed

- <anything a reader might assume was verified but was not>
-->
