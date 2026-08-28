import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Image, Loader2 } from 'lucide-react';
import { uploadVisitPhoto, deleteVisitPhoto, visitPhotoMime } from '../../services/supabase/visitPhotoService';
import { useToasts } from '../../hooks/useToasts';

interface PhotoUploadProps {
  /** Storage keys in the private `visit-photos` bucket, as stored on `visits.photos`. */
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
}

/**
 * Photo capture for a visit report.
 *
 * `visit-photos` is private as of mig 00113 (security-audit STOR-1 / STOR-2), so
 * this no longer touches Storage directly: mutate-visit-photo mints a one-shot
 * signed upload URL, the bytes go straight to Storage, and what is held in
 * state is the bare KEY.
 *
 * A key is not something an <img> can fetch, but nothing here needs to sign one.
 * This component is mounted only by VisitModal, which always starts from an
 * empty array (VisitModal.tsx:30) — every photo on screen was picked in this
 * session, so the File is in hand and a local object URL is both instant and
 * exactly right. Signed URLs are for READING a saved visit back, which is
 * VisitTimeline's job, not this one.
 */
const PhotoUpload: React.FC<PhotoUploadProps> = ({ photos, onPhotosChange, maxPhotos = 5 }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  // key -> blob: URL. A ref rather than state: revoking is cleanup, and a
  // re-render must never be what decides whether a URL is still alive.
  const previewsRef = useRef<Record<string, string>>({});
  const [, forcePreviewRender] = useState(0);
  const { addToast } = useToasts();

  useEffect(() => () => {
    for (const url of Object.values(previewsRef.current) as string[]) URL.revokeObjectURL(url);
    previewsRef.current = {};
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = maxPhotos - photos.length - uploadingCount;
    const filesToProcess = Array.from(files).slice(0, Math.max(remaining, 0));

    if (fileInputRef.current) fileInputRef.current.value = '';

    setUploadingCount(c => c + filesToProcess.length);
    // Snapshot the current photos array via ref-style closure to avoid races between concurrent uploads.
    let workingPhotos = photos;
    await Promise.all(
      filesToProcess.map(async (file: File) => {
        try {
          // The bucket accepts png/jpeg/webp only (00004:9). A phone that hands
          // back HEIC would previously have failed deep inside Storage with an
          // opaque error; say so here instead.
          const mime = visitPhotoMime(file);
          if (!mime) {
            addToast(`${file.name || 'That photo'} is not a PNG, JPEG or WebP.`, 'error');
            return;
          }
          const key = await uploadVisitPhoto(file, mime);
          previewsRef.current[key] = URL.createObjectURL(file);
          workingPhotos = [...workingPhotos, key];
          onPhotosChange(workingPhotos);
          forcePreviewRender(n => n + 1);
        } catch (err) {
          addToast(err instanceof Error ? `Photo upload failed: ${err.message}` : 'Photo upload failed', 'error');
        } finally {
          setUploadingCount(c => Math.max(c - 1, 0));
        }
      }),
    );
  };

  const handleRemove = (index: number) => {
    const removed = photos[index];
    onPhotosChange(photos.filter((_, i) => i !== index));
    if (!removed) return;

    const preview = previewsRef.current[removed];
    if (preview) {
      URL.revokeObjectURL(preview);
      delete previewsRef.current[removed];
    }
    // Best-effort, as before. The server decides whether this is allowed: an
    // object no visit references is an unsaved upload, which this always is.
    deleteVisitPhoto(removed).catch(() => { /* best-effort */ });
  };

  const remainingSlots = maxPhotos - photos.length - uploadingCount;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Image className="w-4 h-4 text-stone-500" />
        <span className="text-sm font-medium text-stone-700">Photos ({photos.length + uploadingCount}/{maxPhotos})</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => {
          const preview = previewsRef.current[photo];
          return (
            <div key={photo} className="relative w-20 h-20 rounded-lg overflow-hidden border border-stone-200 bg-stone-50">
              {preview
                ? <img src={preview} alt={`Visit photo ${index + 1}`} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center"><Image className="w-5 h-5 text-stone-300" /></div>}
              <button
                onClick={() => handleRemove(index)}
                className="absolute top-0.5 right-0.5 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                aria-label="Remove photo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div key={`uploading-${i}`} className="w-20 h-20 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-stone-500 animate-spin" />
          </div>
        ))}

        {remainingSlots > 0 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 rounded-lg border-2 border-dashed border-stone-300 flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <Camera className="w-5 h-5 text-stone-500" />
            <span className="text-[10px] text-stone-500 mt-1">Add</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
};

export default PhotoUpload;
