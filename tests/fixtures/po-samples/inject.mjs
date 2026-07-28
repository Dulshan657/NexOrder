// Inject fabricated PO emails straight into the PO Inbox pipeline and run the
// real server-side AI analysis on them — no mailbox/OAuth required.
//
//   npm run po-inject            inject the edge-case set + run extract-po
//   npm run po-inject -- --clean remove everything the injector created
//
// What it does (default run):
//   1. recreates exactly what poll-inbox would have written — uploads
//      original.json + attachments to the `po-archive` bucket and inserts an
//      inbound_messages row (service-role, bypassing RLS like the Edge Funcs do);
//   2. seeds match data (contact_email + a trusted sender alias on a few seeded
//      HoReCas) so deterministic-match / sender-trust / spoofing cases fire;
//   3. POSTs extract-po for each message (classify → extract → resolve →
//      decide → write pending_pos), then prints an outcome table.
//
// Review the results in the app under PO Inbox → Queue.
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderPdf, renderDocx, renderImagePo, makeLogoPng, SIGNATURE_GIF_BYTES } from './render.mjs'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'
import {
  GRAND_HOTEL,
  LOTUS_GARDEN,
  SPICE_ROOM,
  HARBOUR_VIEW_IMAGE,
  ZENITH_UNKNOWN,
  GRAND_HOTEL_BOGUS,
  GRAND_HOTEL_DEMO_PDF,
  GRAND_HOTEL_DEMO_DOCX,
  CAFE_DEMO_IMAGE,
  NEWSLETTER_BODY,
} from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const ARCHIVE_BUCKET = 'po-archive'
const TEST_ACCOUNT_EMAIL = 'po-inbox-test@nexorder.local'
const TEST_PROVIDER = 'gmail'
// base64:base64 — passes the email_accounts plaintext-token CHECK (mig 00018).
const DUMMY_TOKEN = 'ZHVtbXlpdg==:ZHVtbXljaXBoZXJ0ZXh0'

// mimeType recorded in the manifest (drives isLikelySignature/attachmentKind).
const MANIFEST_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  image: 'image/png',
  'sig-png': 'image/png',
  'sig-gif': 'image/gif',
}
// contentType used for the Storage upload — the po-archive bucket's
// allowed_mime_types (mig 00019) has no image/gif, so the GIF signature is
// stored as octet-stream. It's demoted and never re-downloaded, so the stored
// content type is irrelevant; only the manifest mimeType above matters.
const UPLOAD_MIME = { ...MANIFEST_MIME, 'sig-gif': 'application/octet-stream' }

// HoReCas whose contact_email we set so deterministic match + sender-trust fire.
// (Harbour View is intentionally omitted so its image PO exercises AI name match.)
const SEED_CONTACT_EMAILS = {
  'The Grand Hotel': 'orders@grandhotelsydney.com.au',
  'Lotus Garden Restaurant': 'kitchen@lotusgarden.com.au',
  'The Spice Room': 'procurement@thespiceroom.com.au',
}
const TEST_HORECA_NAMES = [...Object.keys(SEED_CONTACT_EMAILS), 'Harbour View Café']

// ----------------------------------------------------------------------------
// The edge-case set. Each message wraps a doc spec in an email envelope; some
// carry an inline footer/signature image that must NOT hijack extraction.
// ----------------------------------------------------------------------------
const MESSAGES = [
  {
    key: 'grandhotel-autoapprove',
    fromAddress: 'orders@grandhotelsydney.com.au',
    fromName: 'Charles Lim',
    subject: 'Weekly order GH-2026-0712',
    bodyText: 'Hi team, our standard weekly order is attached. Thanks, Charles.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: GRAND_HOTEL, filename: 'grand-hotel-po.pdf' }],
    expect: 'auto_approved — trusted sender, exact SKUs',
  },
  {
    key: 'grandhotel-footer-png',
    fromAddress: 'orders@grandhotelsydney.com.au',
    fromName: 'Charles Lim',
    subject: 'Order GH-2026-0712 (with letterhead logo)',
    bodyText: 'Order attached. Sent from The Grand Hotel.',
    attachments: [
      { role: 'doc', kind: 'pdf', spec: GRAND_HOTEL, filename: 'grand-hotel-po.pdf' },
      { role: 'sig', kind: 'sig-png', filename: 'logo.png' },
    ],
    expect: 'auto_approved — PNG footer logo demoted, PDF wins',
  },
  {
    key: 'lotusgarden-multiline',
    fromAddress: 'kitchen@lotusgarden.com.au',
    fromName: 'Mei Tan',
    subject: 'PO LG-PO-558',
    bodyText: 'Kitchen order attached — please deliver via the rear lane.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: LOTUS_GARDEN, filename: 'lotus-garden-po.pdf' }],
    expect: 'needs_review — customer codes + free text, mixed fuzzy matches',
  },
  {
    key: 'spiceroom-docx',
    fromAddress: 'procurement@thespiceroom.com.au',
    fromName: 'Priya Iyer',
    subject: 'Bulk order SR-04-2026',
    bodyText: 'Please see the attached Word document for our bulk order.',
    attachments: [{ role: 'doc', kind: 'docx', spec: SPICE_ROOM, filename: 'spice-room-po.docx' }],
    expect: 'needs_review — DOCX text, description-only matching',
  },
  {
    key: 'textbody-cafe',
    fromAddress: 'kitchen@lotusgarden.com.au',
    fromName: 'Mei Tan',
    subject: 'Quick top-up order',
    bodyText: [
      'Hi, can we please get the following added to this week:',
      '',
      '- 12 x Coconut Milk 400ml (1 carton)',
      '- 6 x Oyster Sauce 210ml',
      '- 6 x Light Soy Sauce 210ml',
      '',
      'Deliver to Lotus Garden Restaurant, 12 Dixon St, Chinatown. Thanks!',
    ].join('\n'),
    attachments: [],
    expect: 'needs_review — body-text extraction, no attachment',
  },
  {
    key: 'image-po-vision',
    fromAddress: 'hello@harbourviewcafe.com.au',
    fromName: 'Tom Reeves',
    subject: 'Scanned order HV-2026-031',
    bodyText: 'Scanned our order pad — image attached. Please confirm.',
    attachments: [
      { role: 'doc', kind: 'image', spec: HARBOUR_VIEW_IMAGE, filename: 'scan-order.png' },
      { role: 'sig', kind: 'sig-gif', filename: 'signature.gif' },
    ],
    expect: 'needs_review — GPT-4o vision on the image; GIF signature demoted; AI customer match',
  },
  {
    key: 'spoofed-grandhotel',
    fromAddress: 'grandhotel.orders.team@gmail.com',
    fromName: 'Grand Hotel Orders',
    subject: 'Urgent order — Grand Hotel',
    bodyText: 'Please process the attached order for The Grand Hotel ASAP.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: GRAND_HOTEL, filename: 'grand-hotel-po.pdf' }],
    expect: 'needs_review — sender_mismatch (untrusted gmail claims to be Grand Hotel)',
  },
  {
    key: 'unknown-customer',
    fromAddress: 'buying@zenithcatering.example',
    fromName: 'Dana Whitfield',
    subject: 'Trial order ZC-9001',
    bodyText: 'New supplier trial — order attached.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: ZENITH_UNKNOWN, filename: 'zenith-po.pdf' }],
    expect: 'needs_review — customer not in catalog (unresolved)',
  },
  {
    key: 'unknown-products',
    fromAddress: 'orders@grandhotelsydney.com.au',
    fromName: 'Charles Lim',
    subject: 'Specialty order GH-2026-0799',
    bodyText: 'Please supply the attached purchase order (GH-2026-0799) for our degustation menu.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: GRAND_HOTEL_BOGUS, filename: 'grand-hotel-specialty.pdf' }],
    expect: 'needs_review — customer resolved, products not in catalog',
  },
  {
    key: 'not-a-po',
    fromAddress: 'news@foodtrends.example',
    fromName: 'Food Trends Weekly',
    subject: 'This week: 5 plating trends you need to try 🍽️',
    bodyText: [
      "Hello from Food Trends Weekly! This week we're covering the top five plating",
      'trends sweeping fine dining, a profile of a Melbourne pastry chef, and our',
      'reader photo gallery. Not a subscriber yet? Forward this to a friend!',
    ].join('\n'),
    attachments: [],
    expect: 'skipped_not_po — classifier rejects a newsletter',
  },
]

// ----------------------------------------------------------------------------
// Demo set (`--demo`) — mirrors DEMO.md. The two auto POs come from the trusted
// sender (registered as Grand Hotel's sender_email alias by seedDemoTrust); the
// review + newsletter come from a placeholder "viewer" address.
// ----------------------------------------------------------------------------
const DEMO_TRUSTED_SENDER = 'dulshan37gt@gmail.com'
const DEMO_AUTO_CUSTOMER = 'The Grand Hotel'
const DEMO_VIEWER = 'chef@viewer-demo.example'

const DEMO_MESSAGES = [
  {
    key: 'demo-grandhotel-pdf',
    fromAddress: DEMO_TRUSTED_SENDER,
    fromName: 'Charles Lim',
    subject: 'Weekly order GH-DEMO-001',
    bodyText: 'Hi team, our standard weekly order is attached. Thanks, Charles.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: GRAND_HOTEL_DEMO_PDF, filename: 'grand-hotel-po.pdf' }],
    expect: 'auto_approved — trusted sender, exact SKUs (PDF)',
  },
  {
    key: 'demo-grandhotel-docx',
    fromAddress: DEMO_TRUSTED_SENDER,
    fromName: 'Charles Lim',
    subject: 'Function centre top-up GH-DEMO-002',
    bodyText: 'Top-up order attached (Word doc). Same delivery window. Thanks.',
    attachments: [{ role: 'doc', kind: 'docx', spec: GRAND_HOTEL_DEMO_DOCX, filename: 'grand-hotel-po.docx' }],
    expect: 'auto_approved — trusted sender, exact SKUs (Word)',
  },
  {
    key: 'demo-cafe-image',
    fromAddress: DEMO_VIEWER,
    fromName: 'Mei Tan',
    subject: 'Scanned order LG-DEMO-013',
    bodyText: 'Scanned our order pad — image attached. Please confirm.',
    attachments: [{ role: 'doc', kind: 'image', spec: CAFE_DEMO_IMAGE, filename: 'scan-order.png' }],
    expect: 'needs_review — vision; one non-catalog line unresolved',
  },
  {
    key: 'demo-zenith-pdf',
    fromAddress: DEMO_VIEWER,
    fromName: 'Dana Whitfield',
    subject: 'Trial order ZC-9001',
    bodyText: 'New supplier trial — order attached.',
    attachments: [{ role: 'doc', kind: 'pdf', spec: ZENITH_UNKNOWN, filename: 'zenith-po.pdf' }],
    expect: 'needs_review — customer not in catalog',
  },
  {
    key: 'demo-not-a-po',
    fromAddress: DEMO_VIEWER,
    fromName: 'Food Trends Weekly',
    subject: 'This week: 5 plating trends you need to try 🍽️',
    bodyText: NEWSLETTER_BODY,
    attachments: [],
    expect: 'skipped_not_po — classifier rejects a newsletter',
  },
]

// ----------------------------------------------------------------------------
// File mode (`--files <dir>`) — push REAL PDF files from disk through the same
// upload → inbound_messages → extract-po pipeline (no mailbox). Used to rehearse
// the live demo against the actual customer POs and as an on-stage backup.
// The seeded heroes (Sydney Tools #3380598, Repco #S486051891) are sent from
// their seeded trusted senders so they auto-approve (run `npm run seed:tridon-demo`
// or the individual seeds first); the rest land in review.
// ----------------------------------------------------------------------------
const FILE_VIEWER_SENDER = 'viewer@po-demo.example'

// Each hero maps a filename pattern → the trusted sender its seed registered.
// Keep the sender defaults in sync with sydney-tools-seed.mjs / repco-seed.mjs.
const FILE_HEROES = [
  {
    name: 'Sydney Tools',
    pattern: /3380598|sydney/i,
    sender: (process.env.SYDNEY_TOOLS_SENDER || 'orders@sydneytools.com.au').trim().toLowerCase(),
  },
  {
    name: 'Repco',
    pattern: /s486051891|900319|repco/i,
    sender: (process.env.REPCO_SENDER || 'orders@repco.com.au').trim().toLowerCase(),
  },
  {
    // V2food demo — both Young & Jacksons POs are emailed from the same trusted
    // sender (see young-jacksons-seed.mjs). The auto PO auto-approves; the review
    // PO resolves the customer but parks on its one unmapped line.
    name: 'Young & Jacksons',
    pattern: /young|jackson|yj-2026/i,
    sender: (process.env.YJ_SENDER || 'dulshanb@nexgeninnovations.com.au').trim().toLowerCase(),
  },
]

function heroFor(filename) {
  return FILE_HEROES.find(h => h.pattern.test(filename)) ?? null
}

function fileKey(filename) {
  const slug = basename(filename)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `file-${slug || 'po'}`
}

/** Build injector messages from every PDF in a directory. */
function buildFileMessages(dir) {
  const pdfs = readdirSync(dir).filter(f => /\.pdf$/i.test(f))
  if (pdfs.length === 0) throw new Error(`no PDF files found in ${dir}`)
  return pdfs.map(filename => {
    const bytes = new Uint8Array(readFileSync(resolve(dir, filename)))
    const hero = heroFor(filename)
    return {
      key: fileKey(filename),
      fromAddress: hero ? hero.sender : FILE_VIEWER_SENDER,
      fromName: hero ? hero.name : 'PO Demo Sender',
      subject: basename(filename).replace(/\.[a-z0-9]+$/i, ''),
      bodyText: `Please process the attached purchase order (${basename(filename)}).`,
      attachments: [{ role: 'doc', kind: 'pdf', filename: basename(filename), bytes }],
      expect: hero
        ? `auto_approved — seeded ${hero.name} hero`
        : 'needs_review — extraction showcase (no matching catalog data)',
    }
  })
}

// ----------------------------------------------------------------------------
// Env + client
// ----------------------------------------------------------------------------
const { supa, env: ENV, target: TARGET } = await createDevClient()
const SUPABASE_URL = TARGET.config.supabaseUrl
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const encMsgId = key => encodeURIComponent(`inj-${key}`)
const providerMessageId = key => `inj-${key}`
const storagePrefix = (accountId, key) => `${accountId}/${encMsgId(key)}`

async function renderAttachmentBytes(att) {
  switch (att.kind) {
    case 'pdf':
      return renderPdf(att.spec)
    case 'docx':
      return renderDocx(att.spec)
    case 'image':
      return renderImagePo(att.spec)
    case 'sig-png':
      return makeLogoPng()
    case 'sig-gif':
      return SIGNATURE_GIF_BYTES
    default:
      throw new Error(`unknown attachment kind: ${att.kind}`)
  }
}

async function findTestHorecas() {
  const { data, error } = await supa.from('horecas').select('id, name').in('name', TEST_HORECA_NAMES)
  if (error) throw new Error(`horecas lookup: ${error.message}`)
  return data ?? []
}

async function getAdminProfileId() {
  const { data, error } = await supa.from('profiles').select('id').limit(1).maybeSingle()
  if (error) throw new Error(`profiles lookup: ${error.message}`)
  if (!data) throw new Error('no profiles found — seed the database first (npx tsx supabase/seed.ts)')
  return data.id
}

async function ensureTestAccount(adminId) {
  const existing = await supa
    .from('email_accounts')
    .select('id')
    .eq('provider', TEST_PROVIDER)
    .eq('email_address', TEST_ACCOUNT_EMAIL)
    .maybeSingle()
  if (existing.data) return existing.data.id

  const { data, error } = await supa
    .from('email_accounts')
    .insert({
      provider: TEST_PROVIDER,
      email_address: TEST_ACCOUNT_EMAIL,
      oauth_refresh_token_encrypted: DUMMY_TOKEN,
      status: 'paused', // poll-inbox skips paused accounts
      connected_by: adminId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`email_accounts insert: ${error.message}`)
  return data.id
}

async function seedMatchData(horecas) {
  // contact_email → deterministic customer match + sender trust.
  for (const h of horecas) {
    const email = SEED_CONTACT_EMAILS[h.name]
    if (!email) continue
    const { error } = await supa.from('horecas').update({ contact_email: email }).eq('id', h.id)
    if (error) console.warn(`  contact_email on ${h.name}: ${error.message}`)
  }
  // An explicit trusted sender_email alias for Grand Hotel (idempotent).
  const grand = horecas.find(h => h.name === 'The Grand Hotel')
  if (grand) {
    const addr = SEED_CONTACT_EMAILS['The Grand Hotel']
    const dupe = await supa
      .from('po_customer_aliases')
      .select('id')
      .eq('horeca_id', grand.id)
      .eq('source_type', 'sender_email')
      .eq('source_value', addr)
      .maybeSingle()
    if (!dupe.data) {
      const { error } = await supa.from('po_customer_aliases').insert({
        horeca_id: grand.id,
        source_type: 'sender_email',
        source_value: addr,
        confidence_at_creation: 1,
        created_by: null,
      })
      if (error) console.warn(`  sender alias for Grand Hotel: ${error.message}`)
    }
  }
}

async function removePrefix(accountId, key) {
  const prefix = storagePrefix(accountId, key)
  const { data: listing } = await supa.storage.from(ARCHIVE_BUCKET).list(prefix)
  if (listing && listing.length > 0) {
    await supa.storage.from(ARCHIVE_BUCKET).remove(listing.map(o => `${prefix}/${o.name}`))
  }
}

/** Delete inbound_messages / pending_pos / auto-created orders + storage for the account. */
async function purgeMessages(accountId) {
  const { data: inbound } = await supa
    .from('inbound_messages')
    .select('id')
    .eq('email_account_id', accountId)
  const inboundIds = (inbound ?? []).map(r => r.id)

  if (inboundIds.length > 0) {
    const { data: pendings } = await supa
      .from('pending_pos')
      .select('id, approved_order_id')
      .in('inbound_message_id', inboundIds)
    const orderIds = (pendings ?? []).map(p => p.approved_order_id).filter(Boolean)

    // Delete pending_pos FIRST: the orders→pending_pos FK is ON DELETE SET NULL,
    // so deleting an order while a still-auto_approved pending_pos references it
    // would try to null approved_order_id and trip chk_pending_pos_approved_has_order.
    await supa.from('pending_pos').delete().in('inbound_message_id', inboundIds)
    // Auto-approved rows created real orders — now safe to remove items + orders.
    if (orderIds.length > 0) {
      await supa.from('order_items').delete().in('order_id', orderIds)
      const { error } = await supa.from('orders').delete().in('id', orderIds)
      if (error) console.warn(`  orders delete: ${error.message}`)
    }
    await supa.from('inbound_messages').delete().eq('email_account_id', accountId)
  }

  // Storage (covers every known sample key from both sets, even if a row was missing).
  for (const m of [...MESSAGES, ...DEMO_MESSAGES]) await removePrefix(accountId, m.key)
}

/** Register the trusted demo sender as Grand Hotel's sender_email alias so the
 *  two auto POs resolve to + are trusted for that customer. created_by is set to
 *  a real admin so the edge-case --clean (deletes created_by IS NULL) leaves it. */
async function seedDemoTrust(adminId) {
  const grand = await supa.from('horecas').select('id').eq('name', DEMO_AUTO_CUSTOMER).maybeSingle()
  if (!grand.data) {
    console.warn(`  demo trust: HoReCa "${DEMO_AUTO_CUSTOMER}" not found`)
    return
  }
  const dupe = await supa
    .from('po_customer_aliases')
    .select('id')
    .eq('horeca_id', grand.data.id)
    .eq('source_type', 'sender_email')
    .eq('source_value', DEMO_TRUSTED_SENDER)
    .maybeSingle()
  if (dupe.data) return
  const { error } = await supa.from('po_customer_aliases').insert({
    horeca_id: grand.data.id,
    source_type: 'sender_email',
    source_value: DEMO_TRUSTED_SENDER,
    confidence_at_creation: 1,
    created_by: adminId,
  })
  if (error) console.warn(`  demo trust alias: ${error.message}`)
}

// ----------------------------------------------------------------------------
// Inject one message
// ----------------------------------------------------------------------------
async function injectMessage(accountId, msg, receivedAt) {
  const prefix = storagePrefix(accountId, msg.key)
  const manifest = []

  for (let i = 0; i < msg.attachments.length; i++) {
    const att = msg.attachments[i]
    // File mode supplies real bytes directly; the edge-case set renders synthetic specs.
    const bytes = att.bytes ?? (await renderAttachmentBytes(att))
    const storedName = `${i}-${att.filename}`
    const { error } = await supa.storage
      .from(ARCHIVE_BUCKET)
      .upload(`${prefix}/${storedName}`, bytes, { contentType: UPLOAD_MIME[att.kind], upsert: true })
    if (error) throw new Error(`upload ${storedName}: ${error.message}`)
    manifest.push({
      storedName,
      filename: att.filename,
      mimeType: MANIFEST_MIME[att.kind],
      size: bytes.length,
      inline: att.role === 'sig',
    })
  }

  const envelope = {
    id: providerMessageId(msg.key),
    threadId: `thread-${msg.key}`,
    fromAddress: msg.fromAddress,
    fromName: msg.fromName,
    subject: msg.subject,
    receivedAt,
    bodyText: msg.bodyText ?? null,
    bodyHtml: null,
    attachments: manifest,
    rawPayload: { injected: true },
  }
  const envBytes = new TextEncoder().encode(JSON.stringify(envelope))
  const up = await supa.storage
    .from(ARCHIVE_BUCKET)
    .upload(`${prefix}/original.json`, envBytes, { contentType: 'application/json', upsert: true })
  if (up.error) throw new Error(`upload original.json: ${up.error.message}`)

  const { data: row, error: insErr } = await supa
    .from('inbound_messages')
    .insert({
      email_account_id: accountId,
      provider_message_id: providerMessageId(msg.key),
      from_address: msg.fromAddress,
      subject: msg.subject,
      received_at: receivedAt,
      storage_path_prefix: `${ARCHIVE_BUCKET}/${prefix}`,
      processing_status: 'queued',
    })
    .select('id')
    .single()
  if (insErr) throw new Error(`inbound_messages insert: ${insErr.message}`)
  return row.id
}

async function runExtract(inboundMessageId) {
  const resp = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/extract-po`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundMessageId }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await resp.text()
  return { ok: resp.ok, status: resp.status, body: text }
}

// extract-po dispatches approve-po fire-and-forget; in some runtimes that
// background call is dropped after the response is sent. Trigger it ourselves
// (awaited) so auto-approval is deterministic. Idempotent: approve-po's atomic
// status claim makes a duplicate call a no-op (alreadyApproved).
async function approveAuto(pendingPoId) {
  const resp = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/approve-po`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingPoId, mode: 'auto' }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await resp.text()
  try {
    const j = JSON.parse(text)
    if (j.autoApprovalDeclined) return 'declined (stock short)'
    if (j.alreadyApproved) return 'already approved'
    if (j.orderId) return `order ${j.orderId}`
    if (j.error?.message) return `approve-po failed: ${j.error.message}`
    return resp.ok ? 'approved' : `HTTP ${resp.status}`
  } catch {
    return resp.ok ? 'approved' : `HTTP ${resp.status}`
  }
}

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
async function printSummary(accountId, horecas, decisions = new Map(), messages = MESSAGES) {
  const nameById = new Map(horecas.map(h => [h.id, h.name]))
  const { data: inbound } = await supa
    .from('inbound_messages')
    .select('id, provider_message_id, processing_status, classification_reason, failure_reason')
    .eq('email_account_id', accountId)
  const byId = new Map((inbound ?? []).map(r => [r.id, r]))

  const { data: pendings } = await supa
    .from('pending_pos')
    .select('inbound_message_id, status, matched_horeca_id, matched_items, confidence_overall, confidence_fields')
    .in('inbound_message_id', [...byId.keys()].length ? [...byId.keys()] : ['none'])
  const pendingByInbound = new Map((pendings ?? []).map(p => [p.inbound_message_id, p]))

  console.log('\n=== PO Inbox injection results ===')
  for (const m of messages) {
    const inboundRow = [...byId.values()].find(r => r.provider_message_id === providerMessageId(m.key))
    if (!inboundRow) {
      console.log(`\n• ${m.key}\n    (no inbound row — injection may have failed)`)
      continue
    }
    const p = pendingByInbound.get(inboundRow.id)
    const lines = Array.isArray(p?.matched_items) ? p.matched_items : []
    const resolved = lines.filter(l => l.product_id !== null).length
    const senderMismatch = !!p?.confidence_fields?.sender_mismatch
    const status = p ? p.status : inboundRow.processing_status
    const horeca = p?.matched_horeca_id ? nameById.get(p.matched_horeca_id) ?? `#${p.matched_horeca_id}` : '—'

    console.log(`\n• ${m.key}`)
    console.log(`    expected : ${m.expect}`)
    console.log(`    decision : ${decisions.get(m.key) ?? '—'} (extract-po outcome)`)
    let actual = `status=${status}`
    if (p) {
      actual += ` · customer=${horeca} · lines ${resolved}/${lines.length} resolved · conf=${p.confidence_overall}`
      if (senderMismatch) actual += ' · ⚠ sender_mismatch'
    } else if (inboundRow.classification_reason) {
      actual += ` · reason="${inboundRow.classification_reason}"`
    }
    if (inboundRow.failure_reason) actual += ` · FAILED: ${inboundRow.failure_reason}`
    console.log(`    actual   : ${actual}`)
  }
  console.log('\nOpen the app → PO Inbox → Queue to review (and the detail modal for the footer-image samples).')
}

// ----------------------------------------------------------------------------
// Clean
// ----------------------------------------------------------------------------
async function clean() {
  const horecas = await findTestHorecas()
  const account = await supa
    .from('email_accounts')
    .select('id')
    .eq('provider', TEST_PROVIDER)
    .eq('email_address', TEST_ACCOUNT_EMAIL)
    .maybeSingle()

  if (account.data) {
    const accountId = account.data.id
    await purgeMessages(accountId)
    const { error } = await supa.from('email_accounts').delete().eq('id', accountId)
    if (error) console.warn(`  email_accounts delete: ${error.message}`)
  }

  // Remove AI-auto-created aliases (created_by IS NULL) + seeded sender alias for test HoReCas.
  const horecaIds = horecas.map(h => h.id)
  if (horecaIds.length > 0) {
    await supa.from('po_product_aliases').delete().is('created_by', null).in('horeca_id', horecaIds)
    await supa.from('po_customer_aliases').delete().is('created_by', null).in('horeca_id', horecaIds)
    // Reset seeded contact_email back to NULL.
    for (const h of horecas) {
      if (SEED_CONTACT_EMAILS[h.name]) {
        await supa.from('horecas').update({ contact_email: null }).eq('id', h.id)
      }
    }
  }
  console.log('Cleaned: test mailbox, injected messages, auto-created orders/aliases, and seeded contact_email reset.')
}

// ----------------------------------------------------------------------------
// File mode runner — inject real PDFs from a directory
// ----------------------------------------------------------------------------
async function runFiles(dir, isClean) {
  const messages = buildFileMessages(dir)
  const adminId = await getAdminProfileId()
  const accountId = await ensureTestAccount(adminId)

  // purgeMessages clears all DB rows for the test account; also drop file-key
  // storage prefixes (purgeMessages only knows the synthetic sample keys).
  console.log('Cleaning any prior injection…')
  await purgeMessages(accountId)
  for (const m of messages) await removePrefix(accountId, m.key)

  if (isClean) {
    console.log(`Cleaned: injected file POs + storage for ${messages.length} file(s).`)
    return
  }

  const allHorecas = (await supa.from('horecas').select('id, name')).data ?? []

  const decisions = new Map()
  const baseTime = Date.now()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const receivedAt = new Date(baseTime - i * 5 * 60_000).toISOString()
    process.stdout.write(`Injecting ${msg.key} … `)
    try {
      const inboundId = await injectMessage(accountId, msg, receivedAt)
      const res = await runExtract(inboundId)
      let out = {}
      try {
        out = JSON.parse(res.body)
      } catch {
        /* non-JSON body */
      }
      const kind = out.kind ?? null
      let label = res.ok ? kind ?? 'ok' : `HTTP ${res.status}`
      if (res.ok && kind === 'auto_approved' && out.pendingPoId) {
        const ap = await approveAuto(out.pendingPoId)
        label = `auto_approved → ${ap}`
      }
      decisions.set(msg.key, label)
      console.log(res.ok ? `decision=${label}` : `extract-po HTTP ${res.status}: ${res.body.slice(0, 200)}`)
    } catch (err) {
      decisions.set(msg.key, 'ERROR')
      console.log(`ERROR: ${err.message}`)
    }
  }

  await new Promise(r => setTimeout(r, 8000))
  await printSummary(accountId, allHorecas, decisions, messages)
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const isClean = process.argv.includes('--clean')
  const isDemo = process.argv.includes('--demo')
  const filesFlagIdx = process.argv.indexOf('--files')
  const isFiles = filesFlagIdx !== -1
  const filesDir = isFiles ? process.argv[filesFlagIdx + 1] : null

  if (isFiles) {
    if (!filesDir) {
      console.error('Usage: npm run po-inject -- --files "<dir of PO PDFs>" [--clean]')
      process.exit(1)
    }
    await runFiles(resolve(filesDir), isClean)
    return
  }

  const messages = isDemo ? DEMO_MESSAGES : MESSAGES

  if (isClean) {
    if (isDemo) {
      // Light cleanup: remove injected demo rows + the test mailbox, but KEEP the
      // demo trust alias (created_by != null) so the live demo stays configured.
      const account = await supa
        .from('email_accounts')
        .select('id')
        .eq('provider', TEST_PROVIDER)
        .eq('email_address', TEST_ACCOUNT_EMAIL)
        .maybeSingle()
      if (account.data) {
        await purgeMessages(account.data.id)
        await supa.from('email_accounts').delete().eq('id', account.data.id)
      }
      console.log('Cleaned: injected demo messages + test mailbox (demo trust alias kept).')
    } else {
      await clean()
    }
    return
  }

  const horecas = await findTestHorecas()
  if (horecas.length === 0) {
    console.error('No seeded HoReCas found (expected The Grand Hotel, Lotus Garden, etc.). Seed the DB first.')
    process.exit(1)
  }
  const adminId = await getAdminProfileId()
  const accountId = await ensureTestAccount(adminId)

  console.log('Cleaning any prior injection…')
  await purgeMessages(accountId)

  if (isDemo) {
    console.log('Seeding demo trust (Grand Hotel sender alias for the trusted sender)…')
    await seedDemoTrust(adminId)
  } else {
    console.log('Seeding match data (contact_email + trusted sender alias)…')
    await seedMatchData(horecas)
  }

  const decisions = new Map()
  const baseTime = Date.now()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const receivedAt = new Date(baseTime - i * 5 * 60_000).toISOString()
    process.stdout.write(`Injecting ${msg.key} … `)
    try {
      const inboundId = await injectMessage(accountId, msg, receivedAt)
      const res = await runExtract(inboundId)
      let out = {}
      try {
        out = JSON.parse(res.body)
      } catch {
        /* non-JSON body */
      }
      const kind = out.kind ?? null
      let label = res.ok ? kind ?? 'ok' : `HTTP ${res.status}`
      // Trigger the intended auto-approval ourselves (awaited + idempotent).
      if (res.ok && kind === 'auto_approved' && out.pendingPoId) {
        const ap = await approveAuto(out.pendingPoId)
        label = `auto_approved → ${ap}`
      }
      decisions.set(msg.key, label)
      console.log(res.ok ? `decision=${label}` : `extract-po HTTP ${res.status}: ${res.body.slice(0, 200)}`)
    } catch (err) {
      decisions.set(msg.key, `ERROR`)
      console.log(`ERROR: ${err.message}`)
    }
  }

  // extract-po fires approve-po fire-and-forget for auto-approvals; give it a
  // moment to flip status → auto_approved + create the order before we read.
  await new Promise(r => setTimeout(r, 8000))
  await printSummary(accountId, horecas, decisions, messages)
}

main().catch(err => {
  console.error('Injector failed:', err)
  process.exit(1)
})
