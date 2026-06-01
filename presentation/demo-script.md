# Nex Order — Live Demo Script

A storytelling walkthrough on `nexorder.vercel.app`. Four acts, ~18–24 minutes
total. One continuous narrative: a customer orders, a field rep tops it up,
the back office watches it all happen in realtime — and an emailed purchase
order turns itself into an order with no app login at all.

All seeded accounts use password **`Password123!`**.

---

## Pre-demo setup (do this 5 minutes before you start)

1. **Three Chrome windows, side-by-side**, all on `nexorder.vercel.app`:

   | Window | Login | Role | Land here | Cart |
   |---|---|---|---|---|
   | **A — Customer** | `david@seasidebistro.com` | Customer (Seaside Bistro, Silver) | Shop view | Empty |
   | **B — Field Rep** | `charlie@nexorder.com.au` | Field Sales Rep | Rep Dashboard | — |
   | **C — Admin** | `alice@nexorder.com.au` | Admin | Orders / Admin view | — |

2. Disable browser notifications (no Slack pings on stage).
3. Zoom each tab to **110–125%** so the back row can see.
4. Have a **fallback screenshot folder** open in a fourth tab in case live fails.
5. Confirm the seeded promotions are still active (Coconut Season Sale,
   Buy 2 Get 1 Red Curry, Grand Hotel VIP 10%, XO Sauce 40% clearance).
6. Pre-test the **signature canvas** on the demo machine — trackpad signing
   takes a moment to warm up.
7. **Stage the inbound PO for Act 4** (Window C, PO Inbox tab):
   - Confirm a demo mailbox is connected under **PO Inbox → Mailboxes** (Gmail
     or Outlook, via OAuth). If none is connected, connect one now — or plan to
     run Act 4 from the slide instead (see recovery notes).
   - From any account, email that mailbox a short **purchase order** (a one-line
     PDF or plain text), e.g. *"PO from The Spice Room: 6 × Coconut Milk 400ml,
     4 × Thai Red Curry Paste 195g — deliver Friday."*
   - Send it **~10 minutes before** you start so `poll-inbox` + `extract-po`
     have run and the PO is sitting in the **Needs Review** queue.
   - For a cron-proof demo, pre-stage a `pending_pos` row directly (no PO Inbox
     seed data ships today — ask the team for the snippet).

> **Stage layout tip:** Put Window A on the left, B in the middle, C on the
> right. As you talk, your gaze and the audience's gaze move left-to-right
> through the story.

---

## ACT 1 — "Maya at Seaside Bistro places her weekly order"

**~5 minutes • Window A • Customer login**

> Persona: **Maya**, owner of Seaside Bistro on the Gold Coast.
> Story beat: she used to phone this in for 12 minutes; now it takes 90 seconds.

### Scene-setter (spoken, ~20s)

> "Meet Maya. She runs Seaside Bistro on the Gold Coast — a Silver-tier
> customer of our reference distributor. Tuesday morning, she's prepping for
> service and needs to reorder. Up until last year, she'd phone this through
> on hold for twelve minutes, then double-check the invoice when it arrived
> two days later. Watch what she does now."

### On screen

1. **Open the Pantry tab.**
   > "These aren't generic recommendations. They're items *Maya* has actually
   > reordered before, ranked by how often she buys them. The top of the list
   > is what she runs out of most."

2. **Tap "Add" on Coconut Milk 400ml × 2 and Thai Red Curry Paste 195g × 3.**
   > "One tap each. If anything were out of stock, the substitute engine
   > would suggest a swap right here — same category, similar price, in stock
   > today. We don't make her go hunting."

3. **Switch to the Shop tab. Add Oyster Sauce 210ml × 1.**
   > "Notice the price — that's her **Silver-tier** price, not the list price.
   > Tier resolution happens server-side, so she can't accidentally see the
   > wrong number and we can't accidentally show her one."

4. **Open the cart.**
   > **WOW MOMENT.** "Look at the line under Thai Red Curry Paste — *Buy 2 Get
   > 1 Free*. She didn't enter a code. She didn't ask. The server saw her
   > cart, saw she was Silver-tier, saw the active promo, and applied it.
   > Three units charged as two."

5. **Click Submit Order.**
   > "Customers skip the verification step — they're authenticating with their
   > own account. Verification is for staff placing orders on someone's
   > behalf, which we'll see in a minute."

### Closing line

> "Order placed. Confirmation email already sent. Stock decremented. Audit
> event written. Total time: ninety seconds, zero phone calls. Multiply that
> by every restaurant in your book."

---

## ACT 2 — "Charlie's CBD route — a top-up at The Grand Hotel"

**~6 minutes • Window B • Field Rep login**

> Persona: **Charlie**, field sales rep covering Sydney CBD.
> Story beat: he's on a planned route; the system tells him where to go and
> lets him sell on-site with proof of acceptance.

### Scene-setter (spoken, ~20s)

> "While Maya was ordering on her phone, Charlie was already in Sydney CBD.
> He's a field rep running route ROUTE-A01 — three planned stops, starting
> with The Grand Hotel. The dispatcher set this route up last night.
> Charlie's job is to walk in, take stock, and place a top-up order on the
> spot. Here's his view."

### On screen

1. **Open Rep Dashboard → Scheduled Visits.**
   > "Today's route, in order. Arrival times, stop sequence, and any notes the
   > office attached. He doesn't have to figure out where to go."

2. **Show ROUTE-A01 — CBD Priority Visits (in progress, currently at Grand Hotel).**
   > "If a customer wanted to swap a stop or move a time, they raise a change
   > request — the office sees it instantly. Route A02 has one pending right
   > now. We'll come back to that in Act 3."

3. **Click into the Grand Hotel stop → Start Order.**
   > "The HoReCa is pre-selected from the visit. He doesn't have to search."

4. **Add XO Sauce × 4.**
   > "It's flagged 40% clearance — same promotion engine Maya hit. One pricing
   > and promo brain, every channel, no exceptions."

5. **Add Sweet Chilli Sauce × 2. Open the cart.**
   > **WOW MOMENT.** "Grand Hotel is **Gold tier** — they get the VIP 10%
   > storewide promo on top of the XO Sauce clearance. Two promotions
   > stacking, server-resolved. Charlie didn't have to do mental math.
   > A rep can't accidentally over-discount because the rep doesn't decide."

6. **Click Submit Order → Verification Modal opens with Signature mode.**
   > "Field reps need acceptance proof. Office reps capture a call reference
   > number instead. Whichever it is, it gets bonded to the order."

7. **Sign on the canvas (or trackpad). Submit.**
   > "Signature stored in object storage. The order is now legally accepted."

### Closing line

> "Two channels in, identical rules engine, two different acceptance proofs.
> Now let's switch chairs."

---

## ACT 3 — "Alice in the back office watches it all happen"

**~5 minutes • Window C • Admin login**

> Persona: **Alice**, admin / operations lead.
> Story beat: realtime visibility, role-controlled actions, full traceability.

### Scene-setter (spoken, ~15s)

> "Switch to the back office. Alice has been on this screen the whole time.
> She didn't refresh the page during Acts 1 or 2. Watch what's already
> sitting on her dashboard."

### On screen

1. **Orders list — both new orders are already there.**
   > **WOW MOMENT.** "No polling, no refresh button, no F5. The Postgres
   > realtime channel pushed those rows to her browser the instant they
   > were committed to the database. Multiply that by twenty staff and you
   > have an ops floor that actually knows what's happening."

2. **Open Maya's order. Review the applied promotion. Click Confirm.**
   > "Status moves processing → confirmed. The customer just got an
   > automated email. The status pipeline is opinionated — confirmed →
   > packed → shipped → delivered, no skipping, no going backwards."

3. **Open Charlie's order. Click the signature thumbnail.**
   > "There's the proof of acceptance. Bonded to the order ID. If a customer
   > later disputes the order, this is what we show them."

4. **Switch to the Audit Log admin tab. Filter by today.**
   > "Every privileged write — order placement, status change, promotion
   > edit, HoReCa pricing change — recorded with actor, before/after diff,
   > and a reason for the sensitive ones. This is the compliance answer
   > that spreadsheets cannot give you."

5. **Switch to Promotions admin.**
   > "Promos are managed here, not hard-coded. Asian Sauce Starter Pack at
   > $9.50, Coconut Season Sale at 15%, Grand Hotel's VIP 10% — all live,
   > all changeable in seconds, every change logged."

6. **(Optional, if time)** Switch to **Routes admin** → show ROUTE-A02's
   pending **change request** the audience heard about in Act 2 → approve it.
   > "The loop closes. Charlie sees the approval immediately. We never
   > leave the platform."

### Closing line

> "Three roles, one continuous flow, every action accounted for. But there's a
> fourth way orders arrive that never needed an app at all — let me show you
> the inbox."

---

## ACT 4 — "A purchase order arrives by email — and lands itself"

**~4 minutes • Window C • Admin login • PO Inbox tab**

> Persona: still **Alice**, admin / operations lead.
> Story beat: the customer who will never learn an app just emailed a PO. The
> AI read it; Alice approves it in one click and it becomes a real order.

### Scene-setter (spoken, ~20s)

> "Not every customer wants an app — plenty just email a purchase order, often
> a PDF. The Spice Room is one of them. While we were talking, their order
> landed in Alice's inbox. Nobody keyed it in. Watch what happened to it."

### On screen

1. **Open the PO Inbox tab → Needs Review queue.**
   > "Every emailed PO the AI extracted, triaged for her. The coloured ring is
   > the AI's confidence; the riskiest ones sort to the top. There's the Spice
   > Room PO that just arrived."

2. **Point at the Auto-approved count in the stats ribbon.**
   > "The clean, high-confidence, in-stock ones already auto-approved into
   > orders with zero clicks — Alice never saw them. She only works the
   > exceptions. This is a short queue, not her whole inbox."

3. **Open the Spice Room PO → detail modal.**
   > "Sender matched to The Spice Room from an alias the system *learned* on a
   > past approval. Each line matched to a product — '6 × Coconut Milk', '4 ×
   > Thai Red Curry Paste'. Any flag she needs — sender mismatch, short stock,
   > an unmatched line — is called out right here. She never approves blind."

4. **(If a flag is present)** Resolve it — pick the customer/product, or read
   the short-stock warning.
   > "A short-stock line *warns* but doesn't block — the customer already placed
   > the order, so we fulfil via backorder. An unmatched line she maps once, and
   > the system remembers that mapping forever."

5. **Click "Approve & create order".**
   > **WOW MOMENT.** "One click. That email is now a real order — `ORD-IN-…` —
   > in the exact orders list we were just looking at."

6. **Switch back to the Orders list (still Window C).**
   > "There it is, top of the list, pushed in by realtime. Same status pipeline,
   > same fulfilment, same audit as Maya's and Charlie's orders. The email
   > channel finally lives in one place with all the others."

7. **(Optional, if time)** Switch to the **Audit Log** → filter today.
   > "And the approval is logged — actor, the source PO, the order it created.
   > Email-in is now as accountable as every other channel."

### Closing line

> "Three intake channels on screen, plus an inbox that turns emails into orders
> on its own. One pipeline, every channel, every action accounted for. That's
> Nex Order. Let's go back to the deck for next steps."

---

## Recovery notes (have these ready)

| Failure | What to do | What to say |
|---|---|---|
| **Realtime doesn't fire in Act 3** | Hit refresh on Window C. | "This would normally appear instantly — on this conference Wi-Fi the realtime channel hiccuped. The data is there." |
| **A login is logged out** (sessionStorage) | Re-login (5 seconds). Have credentials on a sticky note. | "Quick re-auth — sessions are sessionStorage by design, not localStorage, for security." |
| **A promo doesn't apply visually** | Open Promotions admin to confirm it's active, then re-add the item. | "Let me confirm this promo is live on the back end — yep, active. Adding it again." |
| **Signature canvas misbehaves** | Switch verification to "Manager Override". | "Verification method is per-role. Manager override is itself audit-logged, so we're never bypassing accountability." |
| **App is slow / loading spinner** | Open a fallback screenshot of the screen you wanted. | "Screenshots from a recent run, while the live app catches up." |
| **Whole site down** | Switch to a Loom of a recorded run. | "I'll walk you through a recording — the live app is having a moment. We'll resume after the demo." |
| **PO extraction hasn't fired in Act 4** | Refresh the PO Inbox queue; if still empty, open a pre-staged PO or just point at the Auto-approved count. | "Extraction runs on a polling cron — on conference Wi-Fi it can lag a minute. Here's one that already came through." |
| **No mailbox connected for Act 4** | Skip the live click; tell Act 4 from Slide 5 instead. | "I'll show this one from the deck — it needs a mailbox I haven't wired on this demo tenant." |

---

## Q&A primer (questions you should expect)

- **"What if our customers don't want to learn an app?"**
  > Telesales is a first-class channel. Office reps can place orders for any
  > customer through the same Shop view. The customer never has to log in.
  > Many of our customers run 80% telesales today and let self-serve grow
  > organically. And for buyers who'd rather just email a PO, **PO Inbox** reads
  > the email or PDF, matches it, and turns it into an order with zero app
  > adoption — you saw it in Act 4.

- **"How do you handle our existing pricing complexity?"**
  > Tiers are configurable. Per-customer overrides exist. Promotions are
  > server-resolved with a small DSL — BOGO, bundle, percentage, fixed-price,
  > tier-restricted, time-windowed. We can model your pricing in a scoping
  > call.

- **"Can our reps go offline in dead zones?"**
  > Today the field-rep flow assumes connectivity. Offline-first is on the
  > roadmap; we'd scope it specifically for your route density.

- **"Where does our data live?"**
  > Postgres on Supabase. Row-level security locked down per role. Edge
  > Functions on Supabase. CDN on Vercel. We can deploy to your region of
  > choice.

- **"What's the audit trail actually capture?"**
  > Every privileged write — order placement, status change, pricing edit,
  > HoReCa change, promotion change. Actor ID, role, before/after JSON,
  > optional reason for sensitive fields, IP, timestamp. Admin-only read.

- **"What's the rollout look like?"**
  > Sandbox account in 24 hours. Scoping call to map your channels, tiers,
  > promos. Pilot with one branch over 2–4 weeks. Phased rollout from there.

---

## Timing cheat-sheet

| Section | Target | Hard cap |
|---|---|---|
| Slide deck (6 slides) | 9 min | 11 min |
| Act 1 — Maya | 5 min | 6 min |
| Act 2 — Charlie | 6 min | 7 min |
| Act 3 — Alice | 5 min | 6 min |
| Act 4 — Inbox PO | 4 min | 5 min |
| Q&A | 5 min | open |
| **Total** | **34 min** | **— ** |

If you're tight on time, **drop Act 3 step 6 (route change-request approval)**
first — it's the optional callback to Act 2. Next, Act 4 compresses well: keep
steps 1, 3, and 5 (queue → open the PO → approve) and drop the audit-log step.

---

## Appendix — seeded entities you'll reference

**HoReCas:** The Grand Hotel (Gold), Seaside Bistro (Silver), Lotus Garden
(Bronze), The Spice Room (Silver), Harbour View Café (Bronze).

**Active promotions:**
- Coconut Season Sale — 15% off all Coconut products (until 30 Apr 2026)
- Buy 2 Get 1 — Thai Red Curry Paste, all customers (until 31 May 2026)
- Asian Sauce Starter Pack — bundle at $9.50 (Oyster + Fish + Soy Sauce)
- XO Sauce Clearance — 40% off (ongoing)
- Grand Hotel VIP — 10% storewide for The Grand Hotel only (ongoing)
- Exclusive Laksa Deal — fixed $3.00, Gold-tier only (ongoing)

**Seeded routes:** ROUTE-A01 "CBD Priority Visits" (in progress, Charlie),
ROUTE-A02 "Inner West Restaurants" (planned, Charlie, 1 change request
pending), TMPL-001 "Weekly Sydney CBD" (template, weekly Mon).
