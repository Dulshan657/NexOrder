import React, { useState } from 'react';
import type { HoReCa } from '../../types';
import { GripVertical, X, MapPin } from 'lucide-react';

interface DraggableStopListProps {
  hoReCaIds: number[];
  hoReCaMap: Map<number, HoReCa>;
  onReorder: (newIds: number[]) => void;
  onRemove?: (hoReCaId: number) => void;
  showRemoveButton?: boolean;
}

const DraggableStopList: React.FC<DraggableStopListProps> = ({ hoReCaIds, hoReCaMap, onReorder, onRemove, showRemoveButton = true }) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const newIds = [...hoReCaIds];
    const [moved] = newIds.splice(dragIndex, 1);
    newIds.splice(index, 0, moved);
    onReorder(newIds);
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  if (hoReCaIds.length === 0) {
    return (
      <div className="text-center py-8 text-stone-500 text-sm border border-dashed border-stone-200 rounded-xl">
        No stops added yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hoReCaIds.map((id, index) => {
        const customer = hoReCaMap.get(id);
        if (!customer) return null;
        const isDragging = dragIndex === index;

        return (
          <div
            key={id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              isDragging ? 'border-nexgen-blue bg-nexgen-blue-light' : 'border-stone-200 bg-stone-50 hover:border-stone-300'
            } cursor-grab active:cursor-grabbing`}
          >
            <GripVertical className="w-4 h-4 text-stone-500 flex-shrink-0" />
            <div className="w-7 h-7 rounded-full bg-nexgen-blue text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-800 truncate">{customer.name}</p>
              {customer.address && (
                <p className="text-xs text-stone-500 flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {customer.address}
                </p>
              )}
            </div>
            {showRemoveButton && onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                className="p-1 text-stone-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors cursor-pointer flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DraggableStopList;
