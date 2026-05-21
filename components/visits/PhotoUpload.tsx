import React, { useRef, useState } from 'react';
import { Camera, X, Image, Loader2 } from 'lucide-react';
import { uploadToBucket, deleteFromBucketByUrl } from '../../services/supabase/storageService';
import { useToasts } from '../../hooks/useToasts';
import OptimizedImage from '../OptimizedImage';

interface PhotoUploadProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
}

const PhotoUpload: React.FC<PhotoUploadProps> = ({ photos, onPhotosChange, maxPhotos = 5 }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const { addToast } = useToasts();

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
          const url = await uploadToBucket('visit-photos', file, { prefix: 'visits' });
          workingPhotos = [...workingPhotos, url];
          onPhotosChange(workingPhotos);
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
    if (removed) deleteFromBucketByUrl('visit-photos', removed).catch(() => { /* best-effort */ });
  };

  const remainingSlots = maxPhotos - photos.length - uploadingCount;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Image className="w-4 h-4 text-stone-500" />
        <span className="text-sm font-medium text-stone-700">Photos ({photos.length + uploadingCount}/{maxPhotos})</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <div key={photo} className="relative w-20 h-20 rounded-lg overflow-hidden border border-stone-200">
            <OptimizedImage src={photo} alt={`Visit photo ${index + 1}`} className="w-full h-full" transformWidth={160} />
            <button
              onClick={() => handleRemove(index)}
              className="absolute top-0.5 right-0.5 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600"
              aria-label="Remove photo"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div key={`uploading-${i}`} className="w-20 h-20 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
          </div>
        ))}

        {remainingSlots > 0 && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-20 h-20 rounded-lg border-2 border-dashed border-stone-300 flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <Camera className="w-5 h-5 text-stone-400" />
            <span className="text-[10px] text-stone-400 mt-1">Add</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
};

export default PhotoUpload;
