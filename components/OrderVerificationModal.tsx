import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { OrderVerification, OrderVerificationMethod } from '../types';
import { UserRole } from '../types';
import { PenLine, Phone, X, Loader2 } from 'lucide-react';
import { uploadToBucket, dataUrlToBlob } from '../services/supabase/storageService';
import { useToasts } from '../hooks/useToasts';

interface OrderVerificationModalProps {
    userRole: UserRole;
    onConfirm: (verification: OrderVerification) => void;
    onCancel: () => void;
}

const OrderVerificationModal: React.FC<OrderVerificationModalProps> = ({ userRole, onConfirm, onCancel }) => {
    // Determine which mode(s) to show
    const defaultMethod: OrderVerificationMethod =
        userRole === UserRole.FIELD_REP ? 'signature' :
        userRole === UserRole.OFFICE_REP ? 'call_reference' :
        'choose'; // Admin/Manager choose

    const [method, setMethod] = useState<'signature' | 'call_reference'>(
        defaultMethod === 'choose' ? 'signature' : defaultMethod as 'signature' | 'call_reference'
    );
    const showMethodPicker = defaultMethod === 'choose';

    // Signature state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);

    // Upload state
    const [isUploading, setIsUploading] = useState(false);
    const { addToast } = useToasts();

    // Call reference state
    const [callerName, setCallerName] = useState('');
    const [callDate, setCallDate] = useState(new Date().toISOString().split('T')[0]);
    const [callTime, setCallTime] = useState(new Date().toTimeString().slice(0, 5));
    const [referenceNumber, setReferenceNumber] = useState('');

    // Canvas setup
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        ctx.scale(2, 2);
        ctx.strokeStyle = '#1c1917';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, [method]);

    const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        if ('touches' in e) {
            return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        }
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }, []);

    const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        setIsDrawing(true);
    }, [getPos]);

    const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        e.preventDefault();
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        setHasSignature(true);
    }, [isDrawing, getPos]);

    const stopDraw = useCallback(() => {
        setIsDrawing(false);
    }, []);

    const clearSignature = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasSignature(false);
    };

    const handleConfirm = async () => {
        const now = new Date().toISOString();

        if (method === 'signature') {
            if (!hasSignature || isUploading) return;
            const dataUrl = canvasRef.current?.toDataURL('image/png') ?? '';
            if (!dataUrl) return;
            setIsUploading(true);
            try {
                const blob = dataUrlToBlob(dataUrl);
                const url = await uploadToBucket('signatures', blob, { prefix: 'orders', contentType: 'image/png', ext: 'png' });
                onConfirm({ method: 'signature', signatureDataUrl: url, timestamp: now });
            } catch (err) {
                addToast(err instanceof Error ? `Signature upload failed: ${err.message}` : 'Signature upload failed', 'error');
            } finally {
                setIsUploading(false);
            }
        } else {
            if (!callerName.trim()) return;
            onConfirm({
                method: 'call_reference',
                callerName: callerName.trim(),
                callDate,
                callTime,
                referenceNumber: referenceNumber.trim() || undefined,
                timestamp: now,
            });
        }
    };

    const isValid = method === 'signature' ? hasSignature : callerName.trim().length > 0;

    const inputClasses = "w-full px-3 py-2.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500";

    return (
        <div className="fixed inset-0 bg-stone-900/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-stone-200">
                    <h3 className="text-lg font-display font-semibold text-stone-900">Order Verification</h3>
                    <button
                        onClick={onCancel}
                        className="text-stone-400 hover:text-stone-600 transition-colors p-1 rounded-lg cursor-pointer"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {/* Method Picker (Admin/Manager) */}
                    {showMethodPicker && (
                        <div>
                            <label className="block text-sm font-medium text-stone-700 mb-2">Verification Method</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setMethod('signature')}
                                    className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                                        method === 'signature'
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                            : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                                    }`}
                                >
                                    <PenLine className="w-4 h-4" />
                                    In-Person Signature
                                </button>
                                <button
                                    onClick={() => setMethod('call_reference')}
                                    className={`flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                                        method === 'call_reference'
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                            : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                                    }`}
                                >
                                    <Phone className="w-4 h-4" />
                                    Phone Call Reference
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Signature Pad */}
                    {method === 'signature' && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-stone-700">
                                    <PenLine className="w-4 h-4 inline mr-1.5" />
                                    HoReCa Signature
                                </label>
                                {hasSignature && (
                                    <button
                                        onClick={clearSignature}
                                        className="text-xs text-stone-500 hover:text-stone-700 transition-colors cursor-pointer"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-stone-500 mb-3">Ask the HoReCa to sign below to confirm this order.</p>
                            <div className="border-2 border-dashed border-stone-300 rounded-xl overflow-hidden bg-stone-50 relative">
                                <canvas
                                    ref={canvasRef}
                                    className="w-full cursor-crosshair touch-none"
                                    style={{ height: '200px' }}
                                    onMouseDown={startDraw}
                                    onMouseMove={draw}
                                    onMouseUp={stopDraw}
                                    onMouseLeave={stopDraw}
                                    onTouchStart={startDraw}
                                    onTouchMove={draw}
                                    onTouchEnd={stopDraw}
                                />
                                {!hasSignature && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <p className="text-stone-400 text-sm">Sign here</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Call Reference Form */}
                    {method === 'call_reference' && (
                        <div>
                            <div className="flex items-center gap-1.5 mb-3">
                                <Phone className="w-4 h-4 text-stone-600" />
                                <label className="block text-sm font-medium text-stone-700">Call Details</label>
                            </div>
                            <p className="text-xs text-stone-500 mb-4">Record the details of the phone call authorizing this order.</p>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-stone-600 mb-1">Caller Name *</label>
                                    <input
                                        type="text"
                                        value={callerName}
                                        onChange={e => setCallerName(e.target.value)}
                                        placeholder="Name of the person who called"
                                        className={inputClasses}
                                        autoFocus
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-stone-600 mb-1">Call Date</label>
                                        <input
                                            type="date"
                                            value={callDate}
                                            onChange={e => setCallDate(e.target.value)}
                                            className={inputClasses}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-stone-600 mb-1">Call Time</label>
                                        <input
                                            type="time"
                                            value={callTime}
                                            onChange={e => setCallTime(e.target.value)}
                                            className={inputClasses}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-stone-600 mb-1">Reference Number (optional)</label>
                                    <input
                                        type="text"
                                        value={referenceNumber}
                                        onChange={e => setReferenceNumber(e.target.value)}
                                        placeholder="e.g. ticket or call log ID"
                                        className={inputClasses}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-5 border-t border-stone-200">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-800 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!isValid || isUploading}
                        className="px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer disabled:bg-stone-300 disabled:text-stone-500 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isUploading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isUploading ? 'Uploading signature…' : 'Confirm & Place Order'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrderVerificationModal;
