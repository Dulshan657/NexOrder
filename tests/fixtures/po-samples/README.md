# PO Sample Corpus

Sample purchase orders for end-to-end testing of the **PO Inbox** pipeline:

```
poll-inbox  →  extract-po  →  pending_pos  →  (admin approves)  →  orders
```

Send the samples below from your own email client to a connected mailbox and
watch the queue, mailboxes, and aliases sub-tabs at https://nexorder.vercel.app
under **PO Inbox**.

---

## Before you test — connect a mailbox

The poll-inbox edge function only fetches from mailboxes that have completed
the OAuth flow.

1. Log in as an Admin or Manager.
2. Open **PO Inbox → Mailboxes**.
3. Click **Connect Gmail** or **Connect Outlook**, complete the OAuth grant
   on the provider's screen, and return to the app. You should see the
   account row with a green "Active" dot.
4. Note the email address shown — that's where you send the samples below.

Operators can also query the connected addresses directly:

```sql
SELECT id, provider, email_address, status, last_sync_at
FROM email_accounts
WHERE status = 'active'
ORDER BY last_sync_at DESC NULLS LAST;
```

The first poll cycle runs within ~60s of connecting (pg_cron is wired up via
migration `00020_po_realtime_and_cron.sql`).

---

## Directory layout

```
po-samples/
├── README.md          ← this file
├── generate.mjs       ← regenerates the PDFs / DOCX (npm run po-fixtures)
├── text/              ← plain-text email-body POs (send as the email body)
│   ├── 01-acme-foods-tomato-sauce.txt
│   ├── 02-big-grocer-multi-line.txt
│   ├── 03-small-cafe-handwritten-feel.txt
│   └── 04-not-a-po-newsletter.txt
├── pdf/               ← attach to the email
│   ├── 05-grand-hotel-auto-approve.pdf
│   └── 06-lotus-garden-multi-line.pdf
└── docx/              ← attach to the email
    └── 07-spice-room-bulk-order.docx
```

To rebuild the PDFs and DOCX after editing `generate.mjs`:

```
npm run po-fixtures
```

---

## Sample inventory

| # | File | Customer | Format | Scenario | First-send outcome | Re-send outcome |
|---|------|----------|--------|----------|--------------------|------------------|
| 01 | `text/01-acme-foods-tomato-sauce.txt` | Acme Foods (fictional) | Email body | Single-line PO | Needs review — AI fuzzy customer match | Auto-approved once aliases learned |
| 02 | `text/02-big-grocer-multi-line.txt` | Big Grocer (fictional) | Email body | 6-line carton notation | Needs review (clear) | Auto-approved |
| 03 | `text/03-small-cafe-handwritten-feel.txt` | Sunrise Cafe (fictional) | Email body | Casual/messy | Needs review (messy) — several fields low-confidence | Improves with each approval |
| 04 | `text/04-not-a-po-newsletter.txt` | n/a | Email body | Marketing newsletter | `skipped_not_po` — never reaches Queue | Same |
| 05 | `pdf/05-grand-hotel-auto-approve.pdf` | The Grand Hotel (**seeded** #1) | PDF attachment | 4 lines with **exact AYM SKUs** | Needs review (first time only) | Auto-approved |
| 06 | `pdf/06-lotus-garden-multi-line.pdf` | Lotus Garden Restaurant (**seeded** #4) | PDF attachment | 8 lines, customer-side codes (LG-301 etc.) | Needs review (clear) | Auto-approved once codes are learned |
| 07 | `docx/07-spice-room-bulk-order.docx` | The Spice Room (**seeded** #5) | DOCX attachment | 12 lines, free-text descriptions only | Needs review (clear) — description-only matching is lower confidence | Auto-approved once descriptions are learned |

**Seeded** customers exist in `supabase/seed.ts` and `constants.ts`. The AI
fuzzy matcher should pick them up without manual alias seeding — but the
auto-approve flow needs ≥0.95 overall confidence + customer resolved + every
line resolved, which is rare on first send. Approving once writes the
alias rows; the second send then sails through.

---

## How to send each sample

### Text samples (1–4)

Paste the file contents directly as the email body. Subject is included on
the first line of each file (`Subject: …`) — use that, or invent your own.
**No attachment** for these.

```
To:      <your connected mailbox address>
Subject: <copy from the file's "Subject:" line>
Body:    <paste the file contents verbatim>
```

### PDF / DOCX samples (5–7)

Attach the file to a short email. Suggested subject + body for each:

| File | Suggested subject | Suggested body |
|------|-------------------|----------------|
| `pdf/05-grand-hotel-auto-approve.pdf` | `PO #GH-2026-0712 — The Grand Hotel` | `Please process the attached PO. Standard weekly order.` |
| `pdf/06-lotus-garden-multi-line.pdf` | `PO LG-PO-558 — Lotus Garden Restaurant` | `Hi team, attached is our weekly order. Delivery 26 May to the rear entrance please.` |
| `docx/07-spice-room-bulk-order.docx` | `PO SR-04-2026 — The Spice Room (split delivery)` | `Attached is our monthly bulk order. Note the split delivery instructions inside.` |

Send from **any** email address you control — the system identifies the PO
by reading the attachment, then writes `sender_email` / `sender_domain` /
`po_text` aliases after approval so future POs from the same address
auto-resolve.

---

## What to look for

1. **Queue** — within ~60s of sending, a new `needs_review` row appears in
   PO Inbox → Queue (sub-tab opens by default). Click the row to open the
   detail modal.
2. **Detail modal** — verify:
   - Customer was matched to the seeded HoReCa (samples 5–7) or left
     blank for fictional ones.
   - Line items have suggested product IDs (or "unresolved" for ambiguous
     descriptions).
   - The original document renders in the left pane.
   - Approve → success toast with a **"View in Order Import"** link.
3. **Order Import** — the new order appears with the **Email PO** badge
   (teal) next to the HoReCa name. The Source filter dropdown lets you
   isolate inbound-PO orders.
4. **Aliases sub-tab** — after approving, new rows appear with
   `Operator · today` provenance. Click the sender-email cell to jump back
   to the source PO in the Queue.
5. **Re-send** — repeat the same sample. Re-sent PO should auto-approve
   (status flips to `auto_approved`, no admin click needed). The Aliases
   table doesn't grow further; instead, the new alias rows are matched
   deterministically.
6. **Negative test (sample 04)** — the newsletter should **not** appear
   in any Queue tab. Confirm:

   ```sql
   SELECT processing_status, classification_reason
   FROM inbound_messages
   WHERE subject LIKE '%newsletter%' OR subject LIKE '%catalog%'
   ORDER BY received_at DESC LIMIT 5;
   ```

   `processing_status` should be `skipped_not_po`.

---

## Adding more samples

1. Edit `generate.mjs`, add a new entry to the `samples` array:
   ```js
   {
     kind: 'pdf', // or 'docx'
     filename: '08-your-sample.pdf',
     spec: { company: '...', poNumber: '...', lines: [ ... ], notes: '...' },
   }
   ```
2. Run `npm run po-fixtures` — the new file appears in the matching subdir.
3. Add a row to the **Sample inventory** table above with the expected
   outcome and the suggested email subject/body.

### Anonymization

If you start from real customer POs, replace every personally-identifying
field (customer name, address, phone, email, PO #) with synthetic
equivalents. Keep the *layout* — fonts, table structure, signature blocks —
because that's what the AI is sensitive to.

---

## Troubleshooting

| Symptom | What it means | Fix |
|---------|---------------|-----|
| Nothing appears in 90s | poll-inbox hasn't picked the message up, or the mailbox is paused / errored | Check **PO Inbox → Mailboxes** for the status dot. Banner across the top of PO Inbox also surfaces this. |
| Sample arrives but lands in `skipped_not_po` | AI thought the email wasn't a PO | Run the SQL above and inspect `classification_reason`. Common fixes: add the word "Purchase Order" to the subject, or attach a clearer document. |
| Approve fails with a stock warning | Read-time stock check below the requested qty | Edit the line, drop the qty, or pick a different SKU. (Sample 06 deliberately triggers this on line 3 — AYM-CUR-002 has zero inventory in seed.) |
| PDF won't extract | Likely a permissions issue at OpenAI or an unsupported MIME | Check Supabase function logs: `npx supabase functions logs extract-po --project-ref lsgkznyiabqitqfpveey` |
| Aliases tab still empty after approval | The approve-po call may have failed silently | Look in `audit_events` for `resource = 'order'` near the approval time, and `audit_events.reason` for failure context. |

---

## What you've tested at the end

A full pass through samples 1–7 exercises:

- ✔ Email polling (Gmail and/or Outlook)
- ✔ Document extraction (PDF, DOCX, plain text email body)
- ✔ AI customer matching (fuzzy + alias-based)
- ✔ Per-line product matching (SKU code + free-text description)
- ✔ Alias write-back on approval (`po_customer_aliases`, `po_product_aliases`)
- ✔ Auto-approval threshold (≥0.95 overall + customer + all lines)
- ✔ Audit log entries for every mutation
- ✔ Order Import surfacing (Email PO badge, Source filter, deep-link toast)
- ✔ Classifier negative path (newsletter → `skipped_not_po`)

If all 7 samples behave as described in the inventory table, the pipeline
is healthy end-to-end.
