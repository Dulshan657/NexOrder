// send-email Edge Function
//
// Single transactional-email entry point. Other Edge Functions invoke it
// fire-and-forget after a successful mutation; nothing is exposed to the
// browser yet (CORS is open but the templates only accept stable resource
// IDs, not arbitrary recipient strings).
//
// Templates (v1):
//   order_confirmation — sent after place-order creates an order
//   invoice_issued     — sent when an invoice transitions to 'issued'
//   user_invitation    — auxiliary template; Supabase's native invite email
//                        is what currently fires from invite-user
//
// Provider: Resend (https://resend.com). Self-disables when RESEND_API_KEY
// is not set so order placement is never blocked by missing email config.
//
// Environment:
//   RESEND_API_KEY  — provider API key (optional; absent => no-op)
//   EMAIL_FROM      — verified sender, e.g. "Nex Order <orders@example.com>"
//                     defaults to Resend's onboarding@resend.dev test sender
//   EMAIL_REPLY_TO  — optional reply-to address
//   APP_URL         — root for deep links (defaults to nexorder.vercel.app)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { z } from 'https://esm.sh/zod@3.23.8'
import { errorResponse } from '../_shared/errors.ts'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit, clientIp } from '../_shared/rateLimit.ts'

const DEFAULT_APP_URL = 'https://nexorder.vercel.app'
const DEFAULT_FROM = 'Nex Order <onboarding@resend.dev>'

const inputSchema = z.discriminatedUnion('template', [
  z.object({
    template: z.literal('order_confirmation'),
    orderId: z.string().min(1).max(64),
  }),
  z.object({
    template: z.literal('invoice_issued'),
    invoiceId: z.string().min(1).max(64),
  }),
  z.object({
    template: z.literal('user_invitation'),
    userId: z.string().uuid(),
  }),
])

type Input = z.infer<typeof inputSchema>

interface RenderedEmail {
  to: string
  subject: string
  html: string
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return errorResponse('INVALID_INPUT', 'Method not allowed', undefined, 405, req)
  }

  // Rate limit by IP. send-email is invoked fire-and-forget by other Edge
  // Functions (service role) and could in principle be called from the
  // browser too. 20 req/min per IP is generous for the legitimate path
  // (one order = one email) and tight enough to throttle abuse.
  const ip = clientIp(req)
  const rl = await checkRateLimit(`send-email:${ip}`, { windowMs: 60_000, max: 20 })
  if (!rl.ok) {
    return errorResponse('TOO_MANY_REQUESTS', 'Rate limit exceeded', undefined, 429, req)
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body) return errorResponse('INVALID_INPUT', 'Request body must be valid JSON', undefined, undefined, req)

    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('INVALID_INPUT', 'Invalid email payload', parsed.error.flatten(), undefined, req)
    }
    const input = parsed.data

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const rendered = await renderTemplate(admin, input)
    if (!rendered) {
      return new Response(
        JSON.stringify({ ok: true, sent: false, reason: 'recipient_unresolved' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) {
      console.warn('send-email: RESEND_API_KEY not set; skipping send', {
        template: input.template,
        to: rendered.to,
        subject: rendered.subject,
      })
      return new Response(
        JSON.stringify({ ok: true, sent: false, reason: 'not_configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const from = Deno.env.get('EMAIL_FROM') ?? DEFAULT_FROM
    const replyTo = Deno.env.get('EMAIL_REPLY_TO') ?? undefined

    const resendBody: Record<string, unknown> = {
      from,
      to: [rendered.to],
      subject: rendered.subject,
      html: rendered.html,
    }
    if (replyTo) resendBody.reply_to = replyTo

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendBody),
    })

    if (!resendResp.ok) {
      const errText = await resendResp.text().catch(() => '')
      console.error('send-email: Resend API error', { status: resendResp.status, body: errText })
      return errorResponse('INTERNAL', 'Email provider rejected the message', undefined, undefined, req)
    }

    const data = (await resendResp.json().catch(() => ({}))) as { id?: string }
    return new Response(
      JSON.stringify({ ok: true, sent: true, id: data.id ?? null }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return errorResponse('INTERNAL', e instanceof Error ? e.message : 'Unknown error', undefined, undefined, req)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────────────────────────────────────

async function renderTemplate(admin: ReturnType<typeof createClient>, input: Input): Promise<RenderedEmail | null> {
  switch (input.template) {
    case 'order_confirmation':
      return renderOrderConfirmation(admin, input.orderId)
    case 'invoice_issued':
      return renderInvoiceIssued(admin, input.invoiceId)
    case 'user_invitation':
      return renderUserInvitation(admin, input.userId)
  }
}

async function renderOrderConfirmation(admin: any, orderId: string): Promise<RenderedEmail | null> {
  const { data: order, error } = await admin
    .from('orders')
    .select('id, total, order_date, horeca_id, horecas(name, email)')
    .eq('id', orderId)
    .single()
  if (error || !order) {
    console.warn('send-email: order not found', { orderId, error: error?.message })
    return null
  }
  const horeca = order.horecas as { name: string; email: string | null } | null
  if (!horeca?.email) return null

  const appUrl = Deno.env.get('APP_URL') ?? DEFAULT_APP_URL
  const subject = `Order ${order.id} received — ${horeca.name}`
  const formattedTotal = formatCurrency(Number(order.total ?? 0))
  const orderDate = formatDate(order.order_date)

  const html = layout({
    title: 'Order received',
    intro: `Thanks ${escapeHtml(horeca.name)}, we've received your order and it's now being processed.`,
    rows: [
      ['Order ID', order.id],
      ['Placed', orderDate],
      ['Total', formattedTotal],
    ],
    cta: { label: 'View order', href: `${appUrl}/?order=${encodeURIComponent(order.id)}` },
    footer: `You'll receive another email when your invoice is issued.`,
  })

  return { to: horeca.email, subject, html }
}

async function renderInvoiceIssued(admin: any, invoiceId: string): Promise<RenderedEmail | null> {
  const { data: invoice, error } = await admin
    .from('invoices')
    .select('id, amount, due_date, order_id, horeca_id, horecas(name, email)')
    .eq('id', invoiceId)
    .single()
  if (error || !invoice) {
    console.warn('send-email: invoice not found', { invoiceId, error: error?.message })
    return null
  }
  const horeca = invoice.horecas as { name: string; email: string | null } | null
  if (!horeca?.email) return null

  const appUrl = Deno.env.get('APP_URL') ?? DEFAULT_APP_URL
  const subject = `Invoice ${invoice.id} — ${horeca.name}`
  const formattedAmount = formatCurrency(Number(invoice.amount ?? 0))
  const dueDate = formatDate(invoice.due_date)

  const html = layout({
    title: 'Invoice issued',
    intro: `${escapeHtml(horeca.name)}, your invoice for order ${escapeHtml(invoice.order_id)} is ready.`,
    rows: [
      ['Invoice ID', invoice.id],
      ['Amount', formattedAmount],
      ['Due', dueDate],
    ],
    cta: { label: 'View invoice', href: `${appUrl}/?invoice=${encodeURIComponent(invoice.id)}` },
    footer: `Please settle by the due date to keep your account in good standing.`,
  })

  return { to: horeca.email, subject, html }
}

async function renderUserInvitation(admin: any, userId: string): Promise<RenderedEmail | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) {
    console.warn('send-email: user not found', { userId, error: error?.message })
    return null
  }
  const { email, user_metadata } = data.user
  if (!email) return null

  const appUrl = Deno.env.get('APP_URL') ?? DEFAULT_APP_URL
  const name = (user_metadata?.name as string | undefined) ?? 'there'
  const role = (user_metadata?.role as string | undefined) ?? 'team member'
  const subject = `Welcome to Nex Order, ${name}`

  const html = layout({
    title: 'You\'re invited',
    intro: `Hi ${escapeHtml(name)}, an admin has provisioned a Nex Order account for you as ${escapeHtml(role)}.`,
    rows: [
      ['Email', email],
      ['Role', role],
    ],
    cta: { label: 'Sign in', href: appUrl },
    footer: `If you weren't expecting this, you can safely ignore this email.`,
  })

  return { to: email, subject, html }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML helpers
// ─────────────────────────────────────────────────────────────────────────────

interface LayoutInput {
  title: string
  intro: string
  rows: Array<[label: string, value: string]>
  cta?: { label: string; href: string }
  footer?: string
}

function layout({ title, intro, rows, cta, footer }: LayoutInput): string {
  const rowsHtml = rows
    .map(
      ([label, value]) => `
          <tr>
            <td style="padding:6px 0;color:#78716c;font-size:13px;">${escapeHtml(label)}</td>
            <td style="padding:6px 0;color:#1c1917;font-size:13px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(value)}</td>
          </tr>`,
    )
    .join('')

  const ctaHtml = cta
    ? `
        <tr><td style="padding:24px 0 0 0;">
          <a href="${cta.href}" style="display:inline-block;padding:12px 20px;background:#1c1917;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${escapeHtml(cta.label)}</a>
        </td></tr>`
    : ''

  const footerHtml = footer
    ? `<p style="margin:24px 0 0 0;color:#a8a29e;font-size:12px;">${escapeHtml(footer)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 4px 0;color:#a8a29e;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Nex Order</p>
          <h1 style="margin:0;font-size:20px;font-weight:700;color:#1c1917;letter-spacing:-0.01em;">${escapeHtml(title)}</h1>
          <p style="margin:16px 0 24px 0;color:#44403c;font-size:14px;line-height:1.55;">${escapeHtml(intro)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e5e4;border-bottom:1px solid #e7e5e4;padding:8px 0;">${rowsHtml}
          </table>
          ${ctaHtml}
          ${footerHtml}
        </td></tr>
      </table>
      <p style="margin:16px 0 0 0;color:#a8a29e;font-size:11px;">Sent by Nex Order. Reply if anything looks off.</p>
    </td></tr>
  </table>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return s
  }
}
