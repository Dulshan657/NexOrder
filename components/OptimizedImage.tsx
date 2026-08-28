import React, { useState } from 'react';
import { optimizedImageSources } from '@/lib/imageUrl';

interface OptimizedImageProps {
  /** Raw image URL — a Storage public URL, external CDN URL, or `data:` URL. */
  src?: string | null;
  alt: string;
  /** Classes for the wrapper box: sizing, rounding, aspect ratio, border. */
  className?: string;
  /** Classes for the inner `<img>`. Defaults to `object-cover`. */
  imgClassName?: string;
  /**
   * Target render width in px for the transform CDN. Pass roughly 2× the CSS
   * display width so the result stays crisp on retina screens.
   */
  transformWidth: number;
  transformHeight?: number;
  transformQuality?: number;
  /** Opt out of native lazy-loading for above-the-fold images. */
  eager?: boolean;
  /** Shown when there is no `src` or every candidate source fails to load. */
  fallback?: React.ReactNode;
  /** Intrinsic dimensions to reserve layout space (optional; the CSS box also works). */
  width?: number;
  height?: number;
}

function PlaceholderIcon() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-stone-100 text-stone-600">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-1/3 max-h-10 w-1/3 max-w-10 opacity-60"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    </span>
  );
}

/**
 * Lazy, transform-aware image with a shimmer placeholder and a graceful
 * fallback chain. On load error it retries the next candidate source
 * (optimized transform URL → raw object URL) before showing a placeholder, so
 * it stays correct whether or not the Supabase plan supports image transforms.
 */
const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  className,
  imgClassName,
  transformWidth,
  transformHeight,
  transformQuality,
  eager = false,
  fallback,
  width,
  height,
}) => {
  const sources = src
    ? optimizedImageSources(src, {
        width: transformWidth,
        height: transformHeight,
        quality: transformQuality,
      })
    : [];

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trackedSrc, setTrackedSrc] = useState(src);

  // Reset synchronously when the source changes — the same component instance
  // is reused across items in a list, so stale load/error state must not leak
  // onto the next image (avoids a flash of the previous picture or fallback).
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setIndex(0);
    setLoaded(false);
    setFailed(false);
  }

  const wrapperClass = `relative overflow-hidden inline-block ${className ?? ''}`;

  if (sources.length === 0 || failed) {
    return <span className={wrapperClass}>{fallback ?? <PlaceholderIcon />}</span>;
  }

  const currentSrc = sources[index] ?? sources[0];

  const handleError = () => {
    if (index + 1 < sources.length) {
      setLoaded(false);
      setIndex(index + 1);
    } else {
      setFailed(true);
    }
  };

  return (
    <span className={wrapperClass}>
      {!loaded && <span aria-hidden className="img-skeleton absolute inset-0" />}
      <img
        key={currentSrc}
        src={currentSrc}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={handleError}
        className={`absolute inset-0 block h-full w-full transition-opacity duration-500 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${imgClassName ?? 'object-cover'}`}
      />
    </span>
  );
};

export default OptimizedImage;
