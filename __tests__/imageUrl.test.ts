import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  isSupabaseStorageObjectUrl,
  buildSupabaseRenderUrl,
  getOptimizedImageUrl,
  optimizedImageSources,
  publicImageUrl,
} from '../lib/imageUrl';

const STORAGE_URL =
  'https://lsgkznyiabqitqfpveey.supabase.co/storage/v1/object/public/product-images/products/abc.webp';
const EXTERNAL_URL =
  'https://cdn.example.com/images/thumbnails/263x263f/9311627603729-1.png';
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('isSupabaseStorageObjectUrl', () => {
  it('detects Supabase public object URLs', () => {
    expect(isSupabaseStorageObjectUrl(STORAGE_URL)).toBe(true);
  });

  it('rejects external CDN and data URLs', () => {
    expect(isSupabaseStorageObjectUrl(EXTERNAL_URL)).toBe(false);
    expect(isSupabaseStorageObjectUrl(DATA_URL)).toBe(false);
  });
});

describe('buildSupabaseRenderUrl', () => {
  it('rewrites the object path to render/image with width + quality', () => {
    const out = buildSupabaseRenderUrl(STORAGE_URL, { width: 600 });
    expect(out).toContain('/storage/v1/render/image/public/product-images/products/abc.webp');
    expect(out).not.toContain('/object/public/');
    expect(out).toContain('width=600');
    expect(out).toContain('quality=75');
  });

  it('adds height + resize only when a height is given', () => {
    expect(buildSupabaseRenderUrl(STORAGE_URL, { width: 100 })).not.toContain('resize=');
    const out = buildSupabaseRenderUrl(STORAGE_URL, { width: 100, height: 100, resize: 'contain' });
    expect(out).toContain('height=100');
    expect(out).toContain('resize=contain');
  });

  it('rounds fractional widths', () => {
    expect(buildSupabaseRenderUrl(STORAGE_URL, { width: 199.6 })).toContain('width=200');
  });

  it('passes non-storage URLs through unchanged', () => {
    expect(buildSupabaseRenderUrl(EXTERNAL_URL, { width: 600 })).toBe(EXTERNAL_URL);
    expect(buildSupabaseRenderUrl(DATA_URL, { width: 600 })).toBe(DATA_URL);
  });
});

describe('getOptimizedImageUrl (flag-gated)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('passes storage URLs through when transforms are disabled (default)', () => {
    expect(getOptimizedImageUrl(STORAGE_URL, { width: 600 })).toBe(STORAGE_URL);
  });

  it('transforms storage URLs when the flag is on', () => {
    vi.stubEnv('VITE_SUPABASE_IMAGE_TRANSFORMS', 'true');
    const out = getOptimizedImageUrl(STORAGE_URL, { width: 600 });
    expect(out).toContain('/render/image/public/');
    expect(out).toContain('width=600');
  });

  it('still passes external URLs through even when the flag is on', () => {
    vi.stubEnv('VITE_SUPABASE_IMAGE_TRANSFORMS', 'true');
    expect(getOptimizedImageUrl(EXTERNAL_URL, { width: 600 })).toBe(EXTERNAL_URL);
  });
});

describe('publicImageUrl', () => {
  it('strips the Supabase origin, leaving a same-origin path', () => {
    expect(publicImageUrl(STORAGE_URL)).toBe(
      '/storage/v1/object/public/product-images/products/abc.webp',
    );
  });

  it('works on the transform endpoint too, so one rewrite serves both', () => {
    const render = buildSupabaseRenderUrl(STORAGE_URL, { width: 600 });
    expect(publicImageUrl(render)).toBe(
      '/storage/v1/render/image/public/product-images/products/abc.webp?width=600&quality=75',
    );
  });

  it('leaves external CDN, data and already-relative URLs alone', () => {
    expect(publicImageUrl(EXTERNAL_URL)).toBe(EXTERNAL_URL);
    expect(publicImageUrl(DATA_URL)).toBe(DATA_URL);
    expect(publicImageUrl('/storage/v1/object/public/x.webp')).toBe(
      '/storage/v1/object/public/x.webp',
    );
  });

  it('does not match "/storage/" appearing later in the path', () => {
    const decoy = 'https://cdn.example.com/assets/storage/v1/object/public/x.webp';
    expect(publicImageUrl(decoy)).toBe(decoy);
  });
});

describe('optimizedImageSources', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('leaves a non-Supabase URL as a single source', () => {
    expect(optimizedImageSources(EXTERNAL_URL, { width: 600 })).toEqual([EXTERNAL_URL]);
  });

  // The direct Supabase URL is deliberately kept as a fallback candidate:
  // <OptimizedImage> retries the next source on error, so a missing /storage
  // rewrite costs one failed request instead of breaking every image.
  it('proxies a storage URL first and keeps the direct URL as fallback', () => {
    const sources = optimizedImageSources(STORAGE_URL, { width: 600 });
    expect(sources).toEqual([
      '/storage/v1/object/public/product-images/products/abc.webp',
      STORAGE_URL,
    ]);
  });

  it('returns [proxied-transform, transform, raw] when transforms are enabled', () => {
    vi.stubEnv('VITE_SUPABASE_IMAGE_TRANSFORMS', 'true');
    const sources = optimizedImageSources(STORAGE_URL, { width: 600 });
    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatch(/^\/storage\/v1\/render\/image\/public\//);
    expect(sources[1]).toContain('/render/image/public/');
    expect(sources[1]).toContain('https://');
    expect(sources[2]).toBe(STORAGE_URL);
  });

  it('never repeats a candidate', () => {
    const sources = optimizedImageSources(EXTERNAL_URL, { width: 600 });
    expect(new Set(sources).size).toBe(sources.length);
  });
});
