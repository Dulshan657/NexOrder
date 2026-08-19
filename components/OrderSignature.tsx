import React, { useEffect } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { inlineSignature } from '../services/supabase/signatureService';
import { useSignatureUrl } from '../hooks/queries/useSignatureUrl';

interface OrderSignatureProps {
    orderId: string;
    /** `orders.verification.signatureDataUrl` exactly as stored. */
    stored: string;
}

/**
 * Renders one order's verification signature.
 *
 * The `signatures` bucket is private as of mig 00113, so a stored key is not
 * something an <img> can fetch: create-signature-url mints a five-minute signed
 * URL, authorising against `orders` RLS so a customer still sees the signature
 * on their own order.
 *
 * A legacy `data:` value is rendered directly and never hits the network — mig
 * 00113 deliberately left those three seeded rows alone, because a base64 image
 * has no object behind it to sign.
 *
 * Extracted from OrderDetailView rather than inlined: this is the one place in
 * the app that reads the bucket, and it now has three states where it used to
 * have one.
 */
const OrderSignature: React.FC<OrderSignatureProps> = ({ orderId, stored }) => {
    const inline = inlineSignature(stored);
    const { mutate, data: signedUrl, isPending, isError } = useSignatureUrl();

    useEffect(() => {
        if (!inline) mutate(orderId);
    }, [orderId, inline, mutate]);

    const src = inline ?? signedUrl;

    if (src) {
        return (
            <div className="bg-white border border-stone-200 rounded-lg p-2 inline-block">
                <img src={src} alt="HoReCa signature" className="h-20 object-contain" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex items-center gap-2 text-sm text-stone-500 bg-white border border-stone-200 rounded-lg px-3 py-2 h-20">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Signature could not be loaded.</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm text-stone-400 bg-white border border-stone-200 rounded-lg px-3 py-2 h-20">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{isPending ? 'Loading signature…' : 'No signature stored.'}</span>
        </div>
    );
};

export default OrderSignature;
