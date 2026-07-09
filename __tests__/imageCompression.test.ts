import { describe, it, expect } from 'vitest';

import { buildCompressionOptions } from '../lib/imageCompression';

describe('buildCompressionOptions', () => {
  it('defaults to WebP at quality 0.8 on the main thread (no CDN worker)', () => {
    expect(buildCompressionOptions({ maxWidthOrHeight: 1024 })).toEqual({
      maxWidthOrHeight: 1024,
      initialQuality: 0.8,
      fileType: 'image/webp',
      // Must stay false — worker mode loads the lib from a CDN, which CSP blocks
      // and which hangs the compression when the CDN stalls (see imageCompression.ts).
      useWebWorker: false,
    });
  });

  it('honors an explicit quality and file type', () => {
    const opts = buildCompressionOptions({
      maxWidthOrHeight: 256,
      quality: 0.6,
      fileType: 'image/jpeg',
    });
    expect(opts.maxWidthOrHeight).toBe(256);
    expect(opts.initialQuality).toBe(0.6);
    expect(opts.fileType).toBe('image/jpeg');
  });
});
