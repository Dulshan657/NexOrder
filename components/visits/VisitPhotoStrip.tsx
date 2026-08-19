import React from 'react';
import { Image, Loader2 } from 'lucide-react';
import { useVisitPhotoUrls, photoSrcMap } from '../../hooks/queries/useVisitPhotoUrls';

interface VisitPhotoStripProps {
  visitId: string;
  /** `visits.photos` as stored — storage keys since mig 00113. */
  photos: string[];
  /** Show at most this many, with a "+N" chip for the rest. */
  max?: number;
  /** Tailwind size classes for one thumbnail. */
  thumbClassName?: string;
}

/**
 * Thumbnails for a saved visit's photographs.
 *
 * `visit-photos` is private as of mig 00113, so a stored key needs a signed URL
 * from create-visit-photo-urls, authorised against `visits` RLS — which is what
 * keeps a rep seeing only their own visits' photos.
 *
 * MOUNTED ONLY INSIDE AN EXPANDED ROW, deliberately. Both callers render photos
 * behind a disclosure, so signing happens for what someone actually opened
 * rather than for every visit on the page. That matters twice over: the server
 * writes one audit event per call, and a timeline of fifty visits would
 * otherwise mint two hundred URLs nobody looked at.
 *
 * A plain <img> rather than <OptimizedImage>: Supabase's render-transform
 * endpoint only serves PUBLIC objects, so the transform is unavailable here and
 * the proxy rewrite in lib/imageUrl.ts has no business touching a signed URL's
 * query string.
 */
const VisitPhotoStrip: React.FC<VisitPhotoStripProps> = ({
  visitId,
  photos,
  max,
  thumbClassName = 'w-12 h-12',
}) => {
  const { data, isPending, isError } = useVisitPhotoUrls([visitId], photos.length > 0);
  const srcByValue = photoSrcMap(data);

  if (photos.length === 0) return null;

  const shown = max ? photos.slice(0, max) : photos;
  const overflow = max ? photos.length - shown.length : 0;

  return (
    <div className="flex gap-2 flex-wrap pt-1">
      {shown.map((photo, i) => {
        const src = srcByValue[photo];
        return (
          <div
            key={photo || i}
            className={`${thumbClassName} rounded-lg border border-stone-200 bg-stone-50 overflow-hidden flex items-center justify-center`}
          >
            {src
              ? <img src={src} alt={`Visit photo ${i + 1}`} className="w-full h-full object-cover" />
              : isPending
                ? <Loader2 className="w-4 h-4 text-stone-300 animate-spin" />
                : <Image className={isError ? 'w-4 h-4 text-amber-400' : 'w-4 h-4 text-stone-300'} />}
          </div>
        );
      })}
      {overflow > 0 && (
        <span className={`${thumbClassName} rounded-lg bg-stone-100 flex items-center justify-center text-xs text-stone-500 font-medium`}>
          +{overflow}
        </span>
      )}
    </div>
  );
};

export default VisitPhotoStrip;
