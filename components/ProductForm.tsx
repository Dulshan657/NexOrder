// FIX: Implement the ProductForm component.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { Product, Supplier } from '../types';
import { CATEGORIES } from '../constants';
import { useToasts } from '../hooks/useToasts';
import { compressImage } from '../lib/imageCompression';
import { uploadToBucket, deleteFromBucketByUrl, isBucketUrl } from '../services/supabase/storageService';
import { buildProductPayload } from '../lib/productFormPayload';
import { assembleProductUoms, extraUomsFromProduct } from '../lib/productUomForm';
import { brandOptions, categoryOptions, uomCodeOptions, withCurrentValue } from '../lib/productTaxonomy';
import { Button, CreatableSelect, Modal, ScanField } from './ui';
import OptimizedImage from './OptimizedImage';
import ProductHomeBinsSection from './admin/ProductHomeBinsSection';
import ProductPalletFitSection from './admin/ProductPalletFitSection';
import { useSettings } from '../hooks/queries/useSettings';
import { palletSpecFromSettings, withPalletUom } from '../lib/palletUom';
import ProductWmsAttributesSection from './admin/ProductWmsAttributesSection';
import ProductUomsSection, { type ExtraUomDraft } from './admin/ProductUomsSection';
import ProductSuppliersSection, { type SupplierLinkDraft } from './admin/ProductSuppliersSection';
import { assembleSupplierLinks, supplierDraftsFromProduct } from '../lib/productSupplierForm';

interface ProductFormProps {
    productToEdit: Product | null;
    suppliers: Supplier[];
    /** The catalog, used to seed the unit + category dropdowns with values already in use. */
    catalog?: Product[];
    onSave: (productData: Product | Omit<Product, 'id' | 'inventory'>) => void | Promise<void>;
    onClose: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({ productToEdit, suppliers, catalog, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        sku: '',
        name: '',
        description: '',
        price: '',
        category: CATEGORIES[0],
        brand: '',
        unit: 'each',
        imageUrl: '',
        supplierId: suppliers.length > 0 ? String(suppliers[0].id) : '',
        cartonSize: '1',
        cubicMetersUnit: '',
        cubicMetersCarton: '',
        lengthCm: '',
        widthCm: '',
        heightCm: '',
        cartonLengthCm: '',
        cartonWidthCm: '',
        cartonHeightCm: '',
        sizeFactor: '1',
        barcode: '',
    });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { addToast } = useToasts();
    const [isUploading, setIsUploading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    // Additional units of measure above the base (mig 00067). Base = Unit + Price.
    const [extraUoms, setExtraUoms] = useState<ExtraUomDraft[]>([]);
    // Suppliers this product can be bought from (mig 00070). One is primary and
    // feeds formData.supplierId, which is what the server's required column takes.
    const [supplierLinks, setSupplierLinks] = useState<SupplierLinkDraft[]>(() => [{
        supplierId: suppliers.length > 0 ? String(suppliers[0].id) : '',
        supplierSku: '',
        costPrice: '',
        isPrimary: true,
    }]);

    useEffect(() => {
        if (productToEdit) {
            setFormData({
                sku: productToEdit.sku ?? '',
                name: productToEdit.name,
                description: productToEdit.description,
                price: String(productToEdit.price),
                category: productToEdit.category,
                brand: productToEdit.brand ?? '',
                unit: productToEdit.unit,
                imageUrl: productToEdit.imageUrl || '',
                supplierId: String(productToEdit.supplierId),
                cartonSize: productToEdit.cartonSize != null ? String(productToEdit.cartonSize) : '1',
                cubicMetersUnit: productToEdit.cubicMetersUnit != null ? String(productToEdit.cubicMetersUnit) : '',
                cubicMetersCarton: productToEdit.cubicMetersCarton != null ? String(productToEdit.cubicMetersCarton) : '',
                lengthCm: productToEdit.lengthCm != null ? String(productToEdit.lengthCm) : '',
                widthCm: productToEdit.widthCm != null ? String(productToEdit.widthCm) : '',
                heightCm: productToEdit.heightCm != null ? String(productToEdit.heightCm) : '',
                cartonLengthCm: productToEdit.cartonLengthCm != null ? String(productToEdit.cartonLengthCm) : '',
                cartonWidthCm: productToEdit.cartonWidthCm != null ? String(productToEdit.cartonWidthCm) : '',
                cartonHeightCm: productToEdit.cartonHeightCm != null ? String(productToEdit.cartonHeightCm) : '',
                sizeFactor: productToEdit.sizeFactor != null ? String(productToEdit.sizeFactor) : '1',
                barcode: productToEdit.barcode ?? '',
            });
            setExtraUoms(extraUomsFromProduct(productToEdit));
            setSupplierLinks(supplierDraftsFromProduct(productToEdit));
        }
    }, [productToEdit]);

    // The global pallet (mig 00125), so the fit panel can work out how many
    // cartons ride on one. Null until settings load, which the panel reports
    // as a refusal rather than computing against a pallet nobody chose.
    const { data: settings } = useSettings();
    const palletSpec = useMemo(() => palletSpecFromSettings(settings), [settings]);

    // Dropdown options: the built-in lists merged with whatever the catalog
    // already uses, plus this product's own value so editing can't re-point it.
    const unitOptions = useMemo(
        () => withCurrentValue(uomCodeOptions(catalog), formData.unit),
        [catalog, formData.unit],
    );
    const categoryChoices = useMemo(
        () => withCurrentValue(categoryOptions(catalog), formData.category),
        [catalog, formData.category],
    );
    // Brands have NO curated seed list — unlike categories, they are whatever
    // this tenant happens to sell, so the options are purely what the catalog
    // already uses plus whatever is being edited right now.
    const brandChoices = useMemo(
        () => withCurrentValue(brandOptions(catalog), formData.brand),
        [catalog, formData.brand],
    );

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
        setFormError(null);

        // Suppliers first: the primary link is what feeds the server's required
        // supplier_id column, so it has to resolve before the payload is built.
        const linkResult = assembleSupplierLinks(supplierLinks);
        if (linkResult.ok === false) {
            setFormError(linkResult.error);
            return;
        }
        const primarySupplierId = linkResult.links.find(l => l.isPrimary)!.supplierId;

        const result = buildProductPayload(
            { ...formData, supplierId: String(primarySupplierId) },
            { isEdit: !!productToEdit },
        );
        // NOTE: `result.ok === false` (not `!result.ok`) — this tsconfig doesn't set
        // strictNullChecks, under which `!result.ok` fails to narrow the discriminated
        // union's else-shaped check and TS reports `.error` as missing.
        if (result.ok === false) {
            setFormError(result.error);
            return;
        }

        // Build the full UOM list (base from Unit+Price, plus the extra packs).
        const uomResult = assembleProductUoms(formData.unit, parseFloat(formData.price), extraUoms);
        if (uomResult.ok === false) {
            setFormError(uomResult.error);
            return;
        }
        const data = { ...result.data, uoms: uomResult.uoms, suppliers: linkResult.links };

        if (productToEdit) {
            onSave({ ...productToEdit, ...data } as Product);
        } else {
            onSave(data as Omit<Product, 'id' | 'inventory'>);
        }
    };

    const inputClasses = "block w-full rounded-lg border-0 bg-stone-50 py-2.5 px-3 text-stone-900 shadow-sm ring-1 ring-inset ring-stone-200 placeholder:text-stone-400 focus:ring-2 focus:ring-inset focus:ring-emerald-600 sm:text-sm transition-all hover:ring-stone-300";

    return (
        <Modal
            open
            onClose={onClose}
            onSubmit={handleSubmit}
            // No `dirty` baseline is wired: formData is (re)populated by the effect on
            // `productToEdit`, so a mount-time snapshot would read as instantly dirty.
            // Without the guard, backdrop dismissal has to stay off or a stray click
            // outside silently throws the draft away.
            dismissOnBackdrop={false}
            title={productToEdit ? 'Edit Product' : 'Add New Product'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="secondary" onClick={requestClose}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isUploading}>
                        Save Product
                    </Button>
                </>
            )}
        >
            <div className="space-y-5">
                {formError && (
                    <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5">
                        {formError}
                    </div>
                )}
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1.5">Product Name</label>
                    <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className={inputClasses} />
                </div>
                <div>
                    <label htmlFor="sku" className="block text-sm font-medium text-stone-700 mb-1.5">SKU</label>
                    <input type="text" name="sku" id="sku" value={formData.sku} onChange={handleChange} required placeholder="e.g., AYM-COC-003 (uppercase recommended)" className={inputClasses} />
                </div>
                <div>
                    {/* Scanning here is how the system LEARNS a supplier barcode:
                        scan the carton once at the desk, and every later scan of
                        that carton anywhere in the app resolves to this product. */}
                    <ScanField
                        label="Barcode (optional)"
                        value={formData.barcode}
                        onChange={(v) => setFormData(prev => ({ ...prev, barcode: v }))}
                        placeholder="Scan the supplier's carton barcode"
                        cameraTitle="Scan the product barcode"
                        helper="The manufacturer's EAN/UPC. Leave blank if the carton has none — the printed barcode label carries the SKU instead."
                    />
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
                        <CreatableSelect
                            id="unit"
                            name="unit"
                            value={formData.unit}
                            onChange={unit => setFormData(prev => ({ ...prev, unit }))}
                            options={unitOptions}
                            required
                            emptyLabel="Select a unit…"
                            customLabel="Other unit…"
                            placeholder="e.g., drum, license"
                            className={inputClasses}
                        />
                    </div>
                </div>
                <ProductUomsSection
                    baseUnitLabel={formData.unit}
                    basePrice={formData.price}
                    baseVolume={formData.cubicMetersUnit}
                    unitOptions={unitOptions}
                    extraUoms={extraUoms}
                    onChange={setExtraUoms}
                />
                <div className="hidden">
                    {/* Legacy carton_size input — the UOM editor is now the source of truth;
                        the server recomputes carton_size from the UOM list. Kept (hidden) so
                        buildProductPayload's required-field contract is unchanged. */}
                    <input type="number" name="cartonSize" id="cartonSize" value={formData.cartonSize} onChange={handleChange} step="1" min="1" />
                </div>
                 <div>
                    <label htmlFor="category" className="block text-sm font-medium text-stone-700 mb-1.5">Category</label>
                    <CreatableSelect
                        id="category"
                        name="category"
                        value={formData.category}
                        onChange={category => setFormData(prev => ({ ...prev, category }))}
                        options={categoryChoices}
                        required
                        emptyLabel="Select a category…"
                        customLabel="New category…"
                        placeholder="Name the new category"
                        className={inputClasses}
                    />
                </div>
                <div>
                    <label htmlFor="brand" className="block text-sm font-medium text-stone-700 mb-1.5">Brand</label>
                    <CreatableSelect
                        id="brand"
                        name="brand"
                        value={formData.brand}
                        onChange={brand => setFormData(prev => ({ ...prev, brand }))}
                        options={brandChoices}
                        emptyLabel="No brand"
                        customLabel="New brand…"
                        placeholder="Name the new brand"
                        className={inputClasses}
                    />
                    <p className="mt-1 text-xs text-stone-400">
                        Optional. Slotting rules can assign a whole brand to a block of racking.
                    </p>
                </div>
                <ProductSuppliersSection
                    suppliers={suppliers}
                    links={supplierLinks}
                    onChange={setSupplierLinks}
                />
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
                    {/* Pallet quantity. Sits directly under the UNIT dimensions it may
                        fall back on, and above the racked-capacity figure, because it
                        is the same conversation: how big is this thing, really. */}
                    <ProductPalletFitSection
                        spec={palletSpec}
                        unitCm={{ lengthCm: formData.lengthCm, widthCm: formData.widthCm, heightCm: formData.heightCm }}
                        cartonCm={{ lengthCm: formData.cartonLengthCm, widthCm: formData.cartonWidthCm, heightCm: formData.cartonHeightCm }}
                        // Mapped key by key, NOT spread. The panel speaks of a box as
                        // lengthCm/widthCm/heightCm, and those are also the names of the
                        // UNIT dimensions on this form -- a bare spread would silently
                        // overwrite them with the carton's.
                        onCartonChange={(patch) => setFormData(prev => ({
                            ...prev,
                            ...(patch.lengthCm !== undefined ? { cartonLengthCm: patch.lengthCm } : {}),
                            ...(patch.widthCm !== undefined ? { cartonWidthCm: patch.widthCm } : {}),
                            ...(patch.heightCm !== undefined ? { cartonHeightCm: patch.heightCm } : {}),
                        }))}
                        extraUoms={extraUoms}
                        onApply={(unitsPerPallet) => setExtraUoms(prev => withPalletUom(prev, {
                            factorToBase: unitsPerPallet,
                            baseUnitCode: formData.unit,
                            basePrice: parseFloat(formData.price) || 0,
                        }))}
                    />

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
            </div>
        </Modal>
    );
};

export default ProductForm;
