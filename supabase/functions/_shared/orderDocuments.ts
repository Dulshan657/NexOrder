// Shared helpers for the warehouse fulfillment documents (pick slip / dispatch
// advice). Pure pdf-lib (no fonts on disk, Deno-safe) renders an A4 PDF; the
// doc is uploaded to the private `order-documents` bucket and recorded in the
// order_documents table, then a short-lived signed URL is returned.

// deno-lint-ignore-file no-explicit-any
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'https://esm.sh/pdf-lib@1.17.1'
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { EdgeFunctionError } from './errors.ts'
import { fetchLogoImage, loadCompanyIdentity, type LogoImage } from './companyIdentity.ts'

export type OrderDocKind = 'pick_slip' | 'dispatch_advice'

const BUCKET = 'order-documents'
const SIGNED_URL_TTL_SECONDS = 300

export interface DocLine {
  productName: string
  productSku: string
  ordered: number
  picked: number
  location: string
  batch: string | null
}

export interface OrderDocData {
  orderId: string
  status: string
  orderDate: string | null
  deliveryDate: string | null
  horecaName: string
  horecaAddress: string
  /** The OPERATOR of this deployment, from app_settings — not the product name.
   *  Empty when unset; see _shared/companyIdentity.ts for why there is no
   *  fallback. */
  companyName: string
  companyAddress: string
  companyContact: string
  /** null when unset, unreachable, or in a format pdf-lib cannot embed. */
  companyLogo: LogoImage | null
  lines: DocLine[]
}

// ── Data loading ──────────────────────────────────────────────────

export async function loadOrderForDoc(
  admin: SupabaseClient,
  orderId: string,
  locationId?: number | null,
): Promise<OrderDocData> {
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, status, order_date, delivery_date, horeca_id, horecas(name, address)')
    .eq('id', orderId)
    .single()
  if (orderError || !order) {
    throw new EdgeFunctionError('NOT_FOUND', `Order ${orderId} not found`)
  }
  const o = order as any

  const { data: items, error: itemsError } = await admin
    .from('order_items')
    .select('id, product_id, product_name, product_sku, quantity')
    .eq('order_id', orderId)
    .order('id')
  if (itemsError) throw new EdgeFunctionError('INTERNAL', itemsError.message)

  // Picked quantities per line (for dispatch advice + pick-progress display).
  // When locationId is given (a per-warehouse dispatch advice), restrict to that
  // site's picks so the document shows only that warehouse's shipped portion.
  let picksQuery = admin
    .from('pick_progress')
    .select('order_item_id, picked_qty, location_id, batch_id, locations(code), batches(lot_code)')
    .eq('order_id', orderId)
  if (locationId != null) picksQuery = picksQuery.eq('location_id', locationId)
  const { data: picks } = await picksQuery
  const pickByItem = new Map<number, { picked: number; location: string | null; batch: string | null }>()
  for (const p of (picks ?? []) as any[]) {
    const prev = pickByItem.get(p.order_item_id) ?? { picked: 0, location: null, batch: null }
    pickByItem.set(p.order_item_id, {
      picked: prev.picked + Number(p.picked_qty),
      location: p.locations?.code ?? prev.location,
      batch: p.batches?.lot_code ?? prev.batch,
    })
  }

  // Default warehouse code — the no-allocation last resort for the pick-from
  // suggestion (kept only for orders/lines with nothing reserved yet).
  const { data: wh } = await admin
    .from('locations')
    .select('code')
    .eq('kind', 'WAREHOUSE')
    .order('id')
    .limit(1)
    .maybeSingle()
  const defaultLoc = (wh as any)?.code ?? 'MAIN'

  // Un-picked lines source "Pick from" from the SAME allocation netting the
  // route (recommend-pick-route) and the pick-task panel (order-pick-tasks)
  // read, instead of guessing "the first warehouse" — so the pick slip names
  // the bin(s) the operator will actually be directed to. Only fetched when at
  // least one un-picked line will reach that branch below (dispatch-advice
  // calls only reach here once every line is already picked, so this stays a
  // no-op for that path).
  const willNeedAlloc = ((items ?? []) as any[]).some(
    (it) => locationId == null && !pickByItem.has(it.id),
  )
  const allocBinsByProduct = new Map<number, Array<{ code: string; qtyBase: number }>>()
  if (willNeedAlloc) {
    const { data: allocRows } = await admin.rpc('wie_order_alloc_bins', { p_order_id: orderId })
    for (const r of (allocRows ?? []) as any[]) {
      const list = allocBinsByProduct.get(r.product_id) ?? []
      list.push({ code: r.code, qtyBase: Number(r.qty_base) || 0 })
      allocBinsByProduct.set(r.product_id, list)
    }
  }

  const lines: DocLine[] = ((items ?? []) as any[])
    // For a per-warehouse dispatch advice, drop lines this site didn't pick.
    .filter((it) => locationId == null || pickByItem.has(it.id))
    .flatMap((it): DocLine[] => {
      const pk = pickByItem.get(it.id)
      if (pk) {
        return [{
          productName: it.product_name,
          productSku: it.product_sku,
          ordered: Number(it.quantity),
          picked: pk.picked,
          location: pk.location ?? defaultLoc,
          batch: pk.batch,
        }]
      }

      const bins = allocBinsByProduct.get(it.product_id) ?? []
      if (bins.length === 0) {
        return [{
          productName: it.product_name,
          productSku: it.product_sku,
          ordered: Number(it.quantity),
          picked: 0,
          location: defaultLoc,
          batch: null,
        }]
      }

      // One row per allocated bin — SKU/name/ordered-qty on the first row only
      // (buildOrderDocPdf loops data.lines and prints every row, so a second
      // "ordered" value here would double the pick-slip's unit total).
      return bins.map((bin, i) => ({
        productName: i === 0 ? it.product_name : '',
        productSku: i === 0 ? it.product_sku : '',
        ordered: i === 0 ? Number(it.quantity) : 0,
        picked: 0,
        location: `${bin.code} (${bin.qtyBase})`,
        batch: null,
      }))
    })

  // The operator's own identity, not the product's. Loaded last so a settings
  // read can never cost us the order lookup that actually matters.
  const company = await loadCompanyIdentity(admin)

  return {
    orderId: o.id,
    status: o.status,
    orderDate: o.order_date ?? null,
    deliveryDate: o.delivery_date ?? null,
    horecaName: o.horecas?.name ?? '—',
    horecaAddress: o.horecas?.address ?? '',
    companyName: company.name,
    companyAddress: company.address,
    // Phone and email share a line — a pick slip has one header, and two
    // half-empty rows read worse than one that adapts to what is filled in.
    companyContact: [company.phone, company.email].filter(Boolean).join('  ·  '),
    companyLogo: await fetchLogoImage(company.logoUrl),
    lines,
  }
}

// ── PDF rendering ─────────────────────────────────────────────────

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.12, 0.1, 0.09)       // stone-900-ish
const MUTED = rgb(0.45, 0.43, 0.4)
// The operator's logo is fitted INSIDE this box, aspect preserved, so a tall
// portrait mark and a wide horizontal one both stay inside the header band.
const LOGO_MAX_W = 96
const LOGO_MAX_H = 34

export async function buildOrderDocPdf(kind: OrderDocKind, data: OrderDocData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  let page = pdf.addPage(A4)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = page.getSize()
  let y = height - MARGIN

  const title = kind === 'pick_slip' ? 'PICK SLIP' : 'DISPATCH ADVICE'

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(s ?? '', { x, y: yy, size, font: f, color })

  // Header. The company block is the operator's, from app_settings, and every
  // part of it is optional — a site that has not filled in Settings → General
  // gets a thinner header rather than a wrong one, and the layout closes up
  // instead of leaving a gap where a name should be.
  let blockX = MARGIN
  let logoBottom = y
  if (data.companyLogo) {
    try {
      const img =
        data.companyLogo.format === 'png'
          ? await pdf.embedPng(data.companyLogo.bytes)
          : await pdf.embedJpg(data.companyLogo.bytes)
      const scaled = img.scaleToFit(LOGO_MAX_W, LOGO_MAX_H)
      // Hang the logo from the same top edge as the company name — `y` is a
      // text BASELINE, and 11pt Helvetica caps rise about 8pt above it.
      logoBottom = y + 8 - scaled.height
      page.drawImage(img, { x: MARGIN, y: logoBottom, width: scaled.width, height: scaled.height })
      blockX = MARGIN + scaled.width + 12
    } catch (e) {
      // Sniffed as PNG/JPEG but pdf-lib still refused it — a truncated upload,
      // or an interlaced PNG. One bad picture must not cost the warehouse its
      // pick slip, so fall through to the text-only header.
      console.error('[orderDocuments] logo embed failed:', e instanceof Error ? e.message : e)
    }
  }

  text(data.companyName, blockX, y, 11, bold)
  text(title, width - MARGIN - bold.widthOfTextAtSize(title, 18), y - 2, 18, bold)
  y -= 13
  for (const line of [data.companyAddress, data.companyContact]) {
    if (!line) continue
    text(truncate(line, 72), blockX, y, 8, font, MUTED)
    y -= 11
  }
  // A tall logo beside a one-line company block would otherwise have the rule
  // drawn straight through it.
  y = Math.min(y, logoBottom - 6)
  y -= 5
  text(`Order ${data.orderId}`, MARGIN, y, 10, font, MUTED)
  y -= 24
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 1, color: rgb(0.86, 0.84, 0.82) })
  y -= 22

  // Meta block
  text('Customer', MARGIN, y, 8, bold, MUTED)
  text('Order date', width / 2, y, 8, bold, MUTED)
  y -= 13
  text(data.horecaName, MARGIN, y, 11, bold)
  text(fmtDate(data.orderDate), width / 2, y, 11, font)
  y -= 13
  text(truncate(data.horecaAddress, 60), MARGIN, y, 9, font, MUTED)
  text(`Delivery: ${fmtDate(data.deliveryDate)}`, width / 2, y, 9, font, MUTED)
  y -= 26

  // Table header
  const cols = kind === 'pick_slip'
    ? [{ label: 'SKU', x: MARGIN }, { label: 'Product', x: MARGIN + 90 }, { label: 'Pick from', x: 360 }, { label: 'Qty', x: width - MARGIN - 30 }]
    : [{ label: 'SKU', x: MARGIN }, { label: 'Product', x: MARGIN + 90 }, { label: 'Ordered', x: 380 }, { label: 'Shipped', x: width - MARGIN - 44 }]
  for (const c of cols) text(c.label, c.x, y, 8, bold, MUTED)
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.5, color: rgb(0.86, 0.84, 0.82) })
  y -= 16

  for (const line of data.lines) {
    if (y < MARGIN + 60) {
      page = pdf.addPage(A4)
      y = height - MARGIN
    }
    text(line.productSku, MARGIN, y, 9, font)
    text(truncate(line.productName, 34), MARGIN + 90, y, 9, font)
    if (kind === 'pick_slip') {
      const from = line.batch ? `${line.location} · ${line.batch}` : line.location
      text(truncate(from, 22), 360, y, 9, font, MUTED)
      text(String(line.ordered), width - MARGIN - 30, y, 10, bold)
    } else {
      text(String(line.ordered), 380, y, 9, font, MUTED)
      text(String(line.picked), width - MARGIN - 44, y, 10, bold)
    }
    y -= 18
  }

  // Footer
  y = Math.max(y - 20, MARGIN + 40)
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.5, color: rgb(0.86, 0.84, 0.82) })
  y -= 16
  const totalUnits = data.lines.reduce((s, l) => s + (kind === 'pick_slip' ? l.ordered : l.picked), 0)
  text(`${data.lines.length} line(s) · ${totalUnits} unit(s)`, MARGIN, y, 9, font, MUTED)
  if (kind === 'pick_slip') {
    text('Picker signature: ____________________', width - MARGIN - 220, y, 9, font, MUTED)
  }

  return await pdf.save()
}

// ── Upload + record ───────────────────────────────────────────────

export async function uploadAndRecordDoc(
  admin: SupabaseClient,
  orderId: string,
  kind: OrderDocKind,
  bytes: Uint8Array,
  actorId: string,
  stampMs: number,
  locationId?: number | null,
): Promise<{ storagePath: string; signedUrl: string | null }> {
  const slug = kind === 'pick_slip' ? 'pick-slip' : 'dispatch-advice'
  const locSuffix = locationId != null ? `-w${locationId}` : ''
  const storagePath = `${orderId}/${slug}${locSuffix}-${stampMs}.pdf`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })
  if (uploadError) throw new EdgeFunctionError('INTERNAL', `upload failed: ${uploadError.message}`)

  const { error: insertError } = await admin.from('order_documents').insert({
    order_id: orderId,
    doc_type: kind,
    storage_path: storagePath,
    generated_by: actorId,
    location_id: locationId ?? null,
  })
  if (insertError) throw new EdgeFunctionError('INTERNAL', `record failed: ${insertError.message}`)

  const { data: signed } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

  return { storagePath, signedUrl: signed?.signedUrl ?? null }
}

// ── small format helpers ──────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = iso.slice(0, 10)
  return d || '—'
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
