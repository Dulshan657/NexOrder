# PO Sample Corpus

Real-world Purchase Order samples used by the Stream I integration suite
and for manual smoke testing of the extract-po Edge Function.

The MVP_PLAN.md target is:

- ≥5 real PDFs (anonymized customer POs)
- ≥3 Word docs
- ≥3 plain text body samples
- ≥2 scanned images (photographed POs)
- ≥1 non-PO email (to test the classifier)

This directory contains the text-body samples (committable as-is) and
a placeholder README for the formats that must be supplied by an
operator before integration tests run.

## Directory layout

```
po-samples/
├── README.md                       ← this file
├── text/                           ← plain-text email-body POs
│   ├── 01-acme-foods-tomato-sauce.txt
│   ├── 02-big-grocer-multi-line.txt
│   ├── 03-small-cafe-handwritten-feel.txt
│   └── 04-not-a-po-newsletter.txt
├── pdf/                            ← (operator must add)
├── docx/                           ← (operator must add)
└── image/                          ← (operator must add)
```

## How to add real-world samples

1. **Anonymize first**. Replace customer names, addresses, phone
   numbers, and order numbers with synthetic equivalents. Keep the
   *structure* of the PO — fonts, layout, fields — because that is what
   the extractor actually relies on. Use `Acme Foods`, `Big Grocer`,
   `Small Cafe`, or any of the seed names in `supabase/seed.ts`.
2. **One PO per file**. Multi-page PDFs are fine.
3. **Filename**: `{NN}-{shortname}.{ext}` where NN is a 2-digit index.
   Examples: `01-acme-foods.pdf`, `02-big-grocer-handwritten.jpg`.
4. **Commit them** if your repository policy allows anonymized customer
   data. If not, put them in `~/.nexorder-po-fixtures/` and point the
   Stream I integration tests at that path via the
   `PO_FIXTURE_DIR` environment variable.

## How the fixtures are used

The Stream I integration suite (when wired — see
`tests/integration/po-pipeline.test.ts`) iterates this directory:

```
foreach file in po-samples/**/*:
   POST to local extract-po with that file as the only attachment
   assert pending_pos row is inserted
   assert status='auto_approved' or 'needs_review' as expected
   assert extracted_po.po_number, customer_name_raw, etc. are populated
```

The `04-not-a-po-newsletter.txt` fixture must classify as
`skipped_not_po` — it's the negative-test sentinel.

## What good coverage looks like

When you've got ≥10 fixtures covering this grid, extraction is
production-ready:

|              | clean print | scanned/photo | handwritten |
|--------------|-------------|---------------|-------------|
| 1 line       |  ≥1         |  ≥1           |  ≥1         |
| 5–10 lines   |  ≥2         |  ≥1           |             |
| 20+ lines    |  ≥1         |               |             |
| edge case (foreign currency, multi-page, faxed) | ≥1 | | |

The classifier corpus (non-POs) should also include:
- a marketing newsletter (`04-not-a-po-newsletter.txt` — done)
- an order confirmation reply ("thanks for the PO, processing now")
- an internal email with a PO number in the subject but no body
- a signed contract with line items (commercial agreement, NOT a PO)

Each negative sample reduces false positives once the system is live.
