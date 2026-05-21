import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  isSupabaseStorageObjectUrl,
  buildSupabaseRenderUrl,
  getOptimizedImageUrl,
  optimizedImageSources,
} from '../lib/imageUrl';

const STORAGE_URL =
  'https://lsgkznyiabqitqfpveey.supabase.co/storage/v1/object/public/product-images/products/abc.webp';
const EXTERNAL_URL =
  'https://ayam.com/images/com_hikashop/upload/thumbnails/263x263f/9311627603729-1.png';
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

describe('optimizedImageSources', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns a single source when no transform applies', () => {
    expect(optimizedImageSources(EXTERNAL_URL, { width: 600 })).toEqual([EXTERNAL_URL]);
    expect(optimizedImageSources(STORAGE_URL, { width: 600 })).toEqual([STORAGE_URL]);
  });

  it('returns [optimized, raw] for storage URLs when enabled', () => {
    vi.stubEnv('VITE_SUPABASE_IMAGE_TRANSFORMS', 'true');
    const sources = optimizedImageSources(STORAGE_URL, { width: 600 });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain('/render/image/public/');
    expect(sources[1]).toBe(STORAGE_URL);
  });
});
