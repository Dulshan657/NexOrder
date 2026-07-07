// FIX: Implement the ProductForm component.
import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { Product, Category, Supplier } from '../types';
import { CATEGORIES } from '../constants';
import { useToasts } from '../hooks/useToasts';
import { compressImage } from '../lib/imageCompression';
import { uploadToBucket, deleteFromBucketByUrl, isBucketUrl } from '../services/supabase/storageService';
import OptimizedImage from './OptimizedImage';
import ProductHomeBinsSection from './admin/ProductHomeBinsSection';
import ProductWmsAttributesSection from './admin/ProductWmsAttributesSection';

interface ProductFormProps {
    productToEdit: Product | null;
    suppliers: Supplier[];
    onSave: (productData: Product | Omit<Product, 'id' | 'inventory'>) => void;
    onClose: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({ productToEdit, suppliers, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        price: '',
        category: CATEGORIES[0],
        unit: 'each',
        imageUrl: '',
        supplierId: suppliers.length > 0 ? String(suppliers[0].id) : '',
        cubicMetersUnit: '',
        cubicMetersCarton: '',
        lengthCm: '',
        widthCm: '',
        heightCm: '',
        sizeFactor: '1',
    });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToasts();
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        if (productToEdit) {
            setFormData({
                name: productToEdit.name,
                description: productToEdit.description,
                price: String(productToEdit.price),
                category: productToEdit.category,
                unit: productToEdit.unit,
                imageUrl: productToEdit.imageUrl || '',
                supplierId: String(productToEdit.supplierId),
                cubicMetersUnit: productToEdit.cubicMetersUnit != null ? String(productToEdit.cubicMetersUnit) : '',
                cubicMetersCarton: productToEdit.cubicMetersCarton != null ? String(productToEdit.cubicMetersCarton) : '',
                lengthCm: productToEdit.lengthCm != null ? String(productToEdit.lengthCm) : '',
                widthCm: productToEdit.widthCm != null ? String(productToEdit.widthCm) : '',
                heightCm: productToEdit.heightCm != null ? String(productToEdit.heightCm) : '',
                sizeFactor: productToEdit.sizeFactor != null ? String(productToEdit.sizeFactor) : '1',
            });
        }
    }, [productToEdit]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Compress + resize to WebP in the browser, then upload to Storage and
    // store the public URL — instead of stuffing a base64 data URL into the DB.
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            addToast('Please choose an image file.', 'error');
            return;
        }
        const previous = formData.imageUrl;
        setIsUploading(true);
        try {
            const compressed = await compressImage(file, { maxWidthOrHeight: 1024, quality: 0.8 });
            const url = await uploadToBucket('product-images', compressed, { prefix: 'products' });
            setFormData(prev => ({ ...prev, imageUrl: url }));
            // Clean up the file we just replaced (only if it lived in our bucket).
            if (isBucketUrl('product-images', previous)) {
                void deleteFromBucketByUrl('product-images', previous);
            }
        } catch {
            addToast('Image upload failed. Please try again.', 'error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveImage = () => {
        const current = formData.imageUrl;
        if (isBucketUrl('product-images', current)) {
            void deleteFromBucketByUrl('product-images', current);
        }
        setFormData(prev => ({ ...prev, imageUrl: '' }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(formData.price);
        const supplierId = parseInt(formData.supplierId, 10);

        if (!formData.name || !formData.description || isNaN(price) || price < 0 || isNaN(supplierId)) {
            alert('Please fill all fields correctly.');
            return;
        }

        const productData: Record<string, unknown> = {
            name: formData.name,
            description: formData.description,
            price,
            category: formData.category,
            unit: formData.unit,
            imageUrl: formData.imageUrl,
            supplierId,
            cubicMetersUnit: formData.cubicMetersUnit ? parseFloat(formData.cubicMetersUnit) : undefined,
            cubicMetersCarton: formData.cubicMetersCarton ? parseFloat(formData.cubicMetersCarton) : undefined,
            lengthCm: formData.lengthCm ? parseFloat(formData.lengthCm) : undefined,
            widthCm: formData.widthCm ? parseFloat(formData.widthCm) : undefined,
            heightCm: formData.heightCm ? parseFloat(formData.heightCm) : undefined,
            sizeFactor: formData.sizeFactor ? parseFloat(formData.sizeFactor) : undefined,
        };

        if (productToEdit) {
            onSave({ ...productToEdit, ...productData });
        } else {
            onSave(productData);
        }
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg max-h-full overflow-y-auto border border-stone-200">
                <form onSubmit={handleSubmit} className="space-y-5">
                    <h2 className="text-2xl font-display font-bold text-stone-900 border-b border-stone-100 pb-3">{productToEdit ? 'Edit Product' : 'Add New Product'}</h2>
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">Product Name</label>
                        <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className={inputClasses} />
                    </div>
                    <div>
                        <label htmlFor="description" className="block text-sm font-medium text-stone-700 mb-1.5">Description</label>
                        <textarea name="description" id="description" value={formData.description} onChange={handleChange} required rows={3} className={inputClasses} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <label htmlFor="price" className="block text-sm font-medium text-stone-700 mb-1.5">Price</label>
                            <input type="number" name="price" id="price" value={formData.price} onChange={handleChange} required step="0.01" min="0" className={inputClasses} />
                        </div>
                        <div>
                            <label htmlFor="unit" className="block text-sm font-medium text-stone-700 mb-1.5">Unit</label>
                            <input type="text" name="unit" id="unit" value={formData.unit} onChange={handleChange} required placeholder="e.g., each, box, license" className={inputClasses} />
                        </div>
                    </div>
                     <div>
                        <label htmlFor="category" className="block text-sm font-medium text-stone-700 mb-1.5">Category</label>
                        <select name="category" id="category" value={formData.category} onChange={handleChange} required className={inputClasses}>
                            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                    </div>
                     <div>
                        <label htmlFor="supplierId" className="block text-sm font-medium text-stone-700 mb-1.5">Supplier</label>
                        <select name="supplierId" id="supplierId" value={formData.supplierId} onChange={handleChange} required className={inputClasses}>
                            <option value="" disabled>Select a supplier</option>
                            {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                        </select>
                    </div>
                    {/* Volume / Cubic Meters */}
                    <div className="bg-stone-50 rounded-lg p-4 border border-stone-200 space-y-4">
                        <h3 className="text-sm font-semibold text-stone-700">Volume (m³)</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="cubicMetersUnit" className="block text-xs font-medium text-stone-500 mb-1">Per Unit (m³)</label>
                                <input type="number" name="cubicMetersUnit" id="cubicMetersUnit" value={formData.cubicMetersUnit} onChange={handleChange} step="0.0001" min="0" placeholder="e.g. 0.00075" className={inputClasses} />
                            </div>
                            <div>
                                <label htmlFor="cubicMetersCarton" className="block text-xs font-medium text-stone-500 mb-1">Per Carton (m³)</label>
                                <input type="number" name="cubicMetersCarton" id="cubicMetersCarton" value={formData.cubicMetersCarton} onChange={handleChange} step="0.0001" min="0" placeholder="e.g. 0.0095" className={inputClasses} />
                            </div>
                        </div>
                        <p className="text-xs text-stone-400">Or calculate from unit dimensions:</p>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label htmlFor="lengthCm" className="block text-xs font-medium text-stone-500 mb-1">Length (cm)</label>
                                <input type="number" name="lengthCm" id="lengthCm" value={formData.lengthCm} onChange={handleChange} step="0.1" min="0" placeholder="L" className={inputClasses} />
                            </div>
                            <div>
                                <label htmlFor="widthCm" className="block text-xs font-medium text-stone-500 mb-1">Width (cm)</label>
                                <input type="number" name="widthCm" id="widthCm" value={formData.widthCm} onChange={handleChange} step="0.1" min="0" placeholder="W" className={inputClasses} />
                            </div>
                            <div>
                                <label htmlFor="heightCm" className="block text-xs font-medium text-stone-500 mb-1">Height (cm)</label>
                                <input type="number" name="heightCm" id="heightCm" value={formData.heightCm} onChange={handleChange} step="0.1" min="0" placeholder="H" className={inputClasses} />
                            </div>
                        </div>
                        {formData.lengthCm && formData.widthCm && formData.heightCm && (
                            <p className="text-xs text-stone-500">
                                Calculated: {(parseFloat(formData.lengthCm) * parseFloat(formData.widthCm) * parseFloat(formData.heightCm) / 1_000_000).toFixed(6)} m³ per unit
                            </p>
                        )}
                        <div className="mt-3">
                            <label htmlFor="sizeFactor" className="block text-xs font-medium text-stone-500 mb-1">Slots per unit (racked capacity)</label>
                            <input type="number" name="sizeFactor" id="sizeFactor" value={formData.sizeFactor} onChange={handleChange} step="0.0001" min="0" placeholder="1" className={inputClasses} />
                            <p className="text-[11px] text-stone-400 mt-1">Pallet/carton slots one base unit consumes — drives bin capacity warnings in racked warehouses.</p>
                        </div>
                        {productToEdit && <ProductHomeBinsSection productId={productToEdit.id} />}
                        {productToEdit && <ProductWmsAttributesSection productId={productToEdit.id} />}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-stone-700 mb-2">Product Image</label>
                        <div className="flex items-center gap-5">
                            <div className="w-24 h-24 bg-stone-50 rounded-lg flex items-center justify-center border border-stone-200 overflow-hidden shadow-sm">
                                {isUploading ? (
                                    <Loader2 className="h-6 w-6 text-stone-400 animate-spin" />
                                ) : formData.imageUrl ? (
                                    <OptimizedImage src={formData.imageUrl} alt="Product preview" className="w-full h-full" transformWidth={192} />
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                )}
                            </div>
                            <div className="flex flex-col gap-3">
                                <input
                                    type="file"
                                    accept="image/*"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="bg-white py-2 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isUploading ? 'Uploading…' : 'Upload Image'}
                                </button>
                                {formData.imageUrl && !isUploading && (
                                    <button
                                        type="button"
                                        onClick={handleRemoveImage}
                                        className="text-sm font-medium text-red-600 hover:text-red-800 self-start transition-colors"
                                    >
                                        Remove Image
                                    </button>
                                )}
                            </div>
                        </div>
                        <label htmlFor="imageUrl" className="block text-sm font-medium text-stone-700 mt-4 mb-1.5">Or paste Image URL</label>
                        <input type="text" name="imageUrl" id="imageUrl" value={formData.imageUrl} onChange={handleChange} className={inputClasses} />
                    </div>
                    <div className="mt-8 flex justify-end space-x-3 pt-4 border-t border-stone-100">
                        <button type="button" onClick={onClose} className="bg-white py-2.5 px-4 border border-stone-300 rounded-lg shadow-sm text-sm font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={isUploading} className="inline-flex justify-center py-2.5 px-5 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-stone-900 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-900 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                            Save Product
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductForm;