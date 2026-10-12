// Encode a string as a QR module matrix.
//
// A thin wrapper so the third-party encoder is imported in exactly one place and
// the rest of the poster code deals in a plain `boolean[][]` ("is this module
// dark"). `qrcode-generator` is pinned: the matrix it returns for a given input
// is what a phone will be asked to read off a wall for years, so an upgrade
// should be a decision, not an accident of a floating tag.
//
// ERROR CORRECTION Q (25%) rather than the default M (15%). A poster hangs by a
// kitchen pass: it gets splashed, scuffed and half-covered by a corner of tape,
// and the cost of the extra redundancy is a slightly denser symbol -- a handful
// of modules on a 120 mm code. Version is left to the encoder (type number 0 =
// smallest that holds the data).

import qrcode from 'https://esm.sh/qrcode-generator@1.4.4'

export type QrMatrix = ReadonlyArray<ReadonlyArray<boolean>>

/** The longest string this encodes. Far above any URL we issue; stops a runaway input. */
export const MAX_QR_INPUT_CHARS = 400

export function encodeQr(text: string): QrMatrix {
  if (!text || text.length > MAX_QR_INPUT_CHARS) {
    throw new Error(`QR input must be 1-${MAX_QR_INPUT_CHARS} characters`)
  }
  const qr = qrcode(0, 'Q')
  qr.addData(text)
  qr.make()

  const size = qr.getModuleCount()
  const rows: boolean[][] = []
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = []
    for (let c = 0; c < size; c += 1) row.push(qr.isDark(r, c))
    rows.push(row)
  }
  return rows
}
