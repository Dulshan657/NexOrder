import React, { useRef, useState, useEffect, useCallback } from 'react';
import type { OrderVerification, OrderVerificationMethod } from '../types';
import { UserRole } from '../types';
import { PenLine, Phone } from 'lucide-react';
import { uploadSignature } from '../services/supabase/signatureService';
import { useToasts } from '../hooks/useToasts';
import { Button, Modal } from './ui';

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

    // Canvas setup. The backing store is sized from the rendered rect, which is still
    // animating at mount, so this also runs from the overlay's `onEntered`. Assigning
    // `width` resets the 2D context, so the scale below never compounds across calls.
    const setupCanvas = useCallback(() => {
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
    }, []);

    useEffect(() => {
        setupCanvas();
    }, [method, setupCanvas]);

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
                // Stores a bare storage KEY, not a URL. The `signatures` bucket
                // is private as of mig 00113 and the browser cannot write to it
                // at all -- upload-signature does it as service_role and hands
                // the key back. The field name is unchanged so nothing
                // downstream has to care which shape it is holding.
                const key = await uploadSignature(dataUrl);
                onConfirm({ method: 'signature', signatureDataUrl: key, timestamp: now });
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

    // A drawn signature or typed call details are captured-but-unsubmitted evidence;
    // the prefilled date/time are defaults and so are deliberately not counted.
    const isDirty = method === 'signature'
        ? hasSignature
        : callerName.trim().length > 0 || referenceNumber.trim().length > 0;

    const inputClasses = "w-full px-3 py-2.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500 focus:border-emerald-500";

    return (
        <Modal
            open
            onClose={onCancel}
            // Terminal capture step: a stray backdrop click must not throw away a signature.
            dismissOnBackdrop={false}
            dirty={isDirty}
            onEntered={setupCanvas}
            icon={method === 'signature'
                ? <PenLine className="w-4 h-4 text-nexgen-blue" />
                : <Phone className="w-4 h-4 text-nexgen-blue" />}
            title="Order Verification"
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" onClick={requestClose}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={!isValid} loading={isUploading}>
                        {isUploading ? 'Uploading signature…' : 'Confirm & Place Order'}
                    </Button>
                </>
            )}
        >
            <div className="space-y-5">
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
        </Modal>
    );
};

export default OrderVerificationModal;
