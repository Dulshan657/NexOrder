# Runbook — turn on transactional email

`send-email` is deployed and fully wired. It is dormant for exactly one reason: `RESEND_API_KEY` is not set. Setting it is the whole switch — no code change, no redeploy.

**Time:** ~10 minutes, most of it waiting on DNS.

---

## What is already true (verified 2026-07-27)

- The function is deployed and its callers are live.
- **Auth gate is present.** `send-email` is `verify_jwt = false` (see `supabase/config.toml`), so it enforces auth in-body: `isServiceRoleCall(req.headers.get('Authorization'))` at `supabase/functions/send-email/index.ts:88`. Non-service-role callers get 401 before any DB read. Do not remove this — without it the endpoint is world-callable, and the `sent` vs `recipient_unresolved` response distinguishes real order IDs from fabricated ones.
- **Rate limit is live:** 20 requests/min/IP, applied *before* any work so an unauthenticated flood is cheap to shed (`index.ts:74-78`).
- **It fails open, always.** With no key the function returns `{ok: true, sent: false, reason: 'not_configured'}` and logs a warning. `place-order` dispatches the email fire-and-forget inside a `try` with a `.catch` (`place-order/index.ts:504-518`), so email can never roll back or block an order.

## Templates and what triggers them

| Template | Trigger | Recipient |
|---|---|---|
| `order_confirmation` | `place-order`, after the order + invoice are written | `horecas.email` for the order's HoReCa |
| `invoice_issued` | Not yet wired — see Pending Work #4 | `horecas.email` |
| `user_invitation` | Not wired; Supabase's native invite email is what fires from `invite-user` | the invited user |
| `system_alert` | `health` cron, on state transitions only | `ALERT_EMAIL` |

Only `order_confirmation` and `system_alert` fire today.

---

## Procedure

### 1. Get a key

1. Sign up / sign in at <https://resend.com>.
2. **Add and verify your sending domain** (Domains → Add Domain), following their DNS instructions. Until a domain is verified you can only send to the address that owns the Resend account.
3. Create an API key at <https://resend.com/api-keys>. **Sending access is sufficient** — do not grant full access.

### 2. Set the secrets

Required:

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxx --project-ref lsgkznyiabqitqfpveey
```

Recommended once your domain is verified — otherwise every email comes from `onboarding@resend.dev`, which Resend will only deliver to you:

```bash
npx supabase secrets set \
  EMAIL_FROM="Nex Order <orders@yourdomain.com.au>" \
  EMAIL_REPLY_TO="support@yourdomain.com.au" \
  APP_URL="https://nexorder.vercel.app" \
  --project-ref lsgkznyiabqitqfpveey
```

Optional, to also switch on health alerts:

```bash
npx supabase secrets set ALERT_EMAIL="ops@yourdomain.com.au" --project-ref lsgkznyiabqitqfpveey
```

Secrets apply to the next invocation. **No redeploy is needed.**

Confirm they landed (values are shown as digests, never plaintext):

```bash
npx supabase secrets list --project-ref lsgkznyiabqitqfpveey
```

### 3. Send a test

The honest end-to-end test is a real order, because that is the only path that fires today.

1. Pick a HoReCa whose `horecas.email` is an address **you control**, or temporarily point one at your own:
   ```bash
   node supabase/apply-sql.mjs --query "SELECT id, name, email FROM horecas WHERE email IS NOT NULL ORDER BY id LIMIT 5"
   ```
2. Place an order for that HoReCa in the app.
3. Check your inbox. Then confirm the send in Resend → **Logs**, which shows delivered / bounced / complained per message.

If you'd rather not place an order, invoke the function directly with the service-role key — this is the same call `place-order` makes:

```bash
curl -X POST "https://lsgkznyiabqitqfpveey.supabase.co/functions/v1/send-email" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template":"order_confirmation","orderId":"<a real order id>"}'
```

### 4. Read the response

| Response | Meaning |
|---|---|
| `{ok:true, sent:true, id:"…"}` | Handed to Resend. Check their Logs for delivery. |
| `{ok:true, sent:false, reason:"not_configured"}` | `RESEND_API_KEY` still unset, or the secret hasn't propagated. |
| `{ok:true, sent:false, reason:"recipient_unresolved"}` | Order/invoice not found, or the HoReCa has no `email`. Not a config problem. |
| `401 UNAUTHORIZED` | You didn't send the service-role key as the bearer token. |
| `429 TOO_MANY_REQUESTS` | 20/min/IP limit hit. |
| `500 INTERNAL` "Email provider rejected the message" | Resend refused it — almost always an unverified `EMAIL_FROM` domain. Check the function logs for the provider's own error text. |

Function logs: Supabase Dashboard → Edge Functions → `send-email` → Logs.

---

## Rollback

Unset the key. The function immediately returns to `reason: 'not_configured'` and nothing else changes:

```bash
npx supabase secrets unset RESEND_API_KEY --project-ref lsgkznyiabqitqfpveey
```

No redeploy, no migration, no code change. Order placement is unaffected in either direction.

---

## Gotchas

- **`EMAIL_FROM` must be on a domain verified in Resend.** This is the single most common failure. An unverified sender is rejected at the provider, surfacing as a 500 from `send-email` — not as a config warning.
- **The default sender is not a real fallback.** `onboarding@resend.dev` only delivers to the Resend account owner. Leaving `EMAIL_FROM` unset in production means customers get nothing, silently, with `sent: true` in the response.
- **Currency and dates are hardcoded `en-AU` / AUD** (`send-email/index.ts:368-379`), consistent with the rest of the app being English-only. See Pending Work #9 (i18n) if that changes.
- **`invoice_issued` renders but never fires** — nothing calls it yet. Wiring it to the invoice → `issued` transition is Pending Work #4.
