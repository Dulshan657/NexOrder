import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { Modal } from '../components/ui';

// In-app PDF viewer. We preview signed documents inside the app (an <iframe>
// over the fetched Blob) instead of window.open — because the signed URL is
// produced ASYNCHRONOUSLY, any window.open after the await is outside the click
// gesture and gets popup-blocked (silently). Fetching the Blob works post-await
// (the bucket is CORS-open), and a same-origin blob: URL renders the PDF inline
// with zero popup dependency.

interface DocumentViewerContextValue {
  /** Fetch + preview a document. `resolver` returns the (short-lived) signed URL. */
  previewDocument: (resolver: () => Promise<string>, title: string, filename?: string) => void;
}

const DocumentViewerContext = createContext<DocumentViewerContextValue | null>(null);

type State =
  | { status: 'closed' }
  | { status: 'loading'; title: string; filename: string }
  | { status: 'ready'; title: string; filename: string; objectUrl: string }
  | { status: 'error'; title: string; filename: string; message: string };

export function DocumentViewerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: 'closed' });
  // Track the live object URL so we can revoke it on close / replace.
  const objectUrlRef = useRef<string | null>(null);
  // Guards against a slow fetch resolving after the user opened another doc.
  const requestSeq = useRef(0);

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    requestSeq.current += 1; // invalidate any in-flight fetch
    revoke();
    setState({ status: 'closed' });
  }, [revoke]);

  const previewDocument = useCallback(
    (resolver: () => Promise<string>, title: string, filename = 'document.pdf') => {
      const seq = ++requestSeq.current;
      revoke();
      setState({ status: 'loading', title, filename });
      (async () => {
        try {
          const url = await resolver();
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Couldn't load document (${res.status})`);
          const blob = await res.blob();
          if (seq !== requestSeq.current) return; // superseded / closed
          const objectUrl = URL.createObjectURL(blob);
          objectUrlRef.current = objectUrl;
          setState({ status: 'ready', title, filename, objectUrl });
        } catch (err) {
          if (seq !== requestSeq.current) return;
          setState({ status: 'error', title, filename, message: err instanceof Error ? err.message : 'Failed to load document' });
        }
      })();
    },
    [revoke],
  );

  // Revoke on unmount. Escape is handled by <Modal>, which — unlike the window
  // listener this replaced — only closes the topmost overlay, so previewing a
  // document from inside another dialog no longer closes both.
  useEffect(() => () => revoke(), [revoke]);

  const download = () => {
    if (state.status !== 'ready') return;
    const a = document.createElement('a');
    a.href = state.objectUrl;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <DocumentViewerContext.Provider value={{ previewDocument }}>
      {children}
      {state.status !== 'closed' && (
        // The body carries an explicit height rather than relying on `flex-1`.
        // The old panel was `h-[88vh]` — a DEFINITE height, which is what let
        // the `h-full` iframe resolve. Modal's panel is `max-h-[90vh]`, which
        // is not definite, so a percentage-height iframe inside a flex-1 body
        // would collapse to zero and the PDF would render as a blank strip.
        <Modal
          open
          onClose={close}
          size="full"
          icon={<FileText className="w-4 h-4 text-nexgen-blue" />}
          title={state.title}
          bodyClassName="shrink-0 h-[78vh] bg-stone-100 overflow-hidden"
          footer={state.status === 'ready' ? (
            <>
              <button onClick={download} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press" aria-label="Download">
                <Download className="w-3.5 h-3.5" /> Download
              </button>
              <button onClick={() => window.open(state.objectUrl, '_blank', 'noopener')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg btn-press" aria-label="Open in new tab">
                <ExternalLink className="w-3.5 h-3.5" /> New tab
              </button>
            </>
          ) : undefined}
        >
          {state.status === 'loading' && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-stone-400">
              <div className="w-8 h-8 border-2 border-stone-300 border-t-nexgen-blue rounded-full animate-spin" />
              <p className="text-sm">Loading document…</p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <p className="text-sm text-red-600">{state.message}</p>
              <p className="text-xs text-stone-400">The link may have expired — try again.</p>
            </div>
          )}
          {state.status === 'ready' && (
            <iframe title={state.title} src={state.objectUrl} className="w-full h-full border-0" />
          )}
        </Modal>
      )}
    </DocumentViewerContext.Provider>
  );
}

export function useDocumentViewer(): DocumentViewerContextValue {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) throw new Error('useDocumentViewer must be used within DocumentViewerProvider');
  return ctx;
}
