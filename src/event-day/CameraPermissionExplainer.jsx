// M5 R13 — Camera permission explainer (Surface 5).
//
// Renders an explicit explanation BEFORE invoking
// navigator.mediaDevices.getUserMedia({ video }). Addresses audit
// pain-point §08 #24: in M4 the AdminScan page jumped straight into a
// camera-permission prompt with no explanation, which iOS Safari
// answered with "Block" by default for unattended kiosks.
//
// Caller wires the granted stream into a ZXing reader (or whatever
// library); this component owns nothing but the permission gate.
//
// Props:
//   onPermissionGranted(stream)  — called with the MediaStream once
//                                  the user grants access
//   onPermissionDenied()         — called when the user clicks "Skip"
//                                  or the browser denies access
//   onClose?()                   — optional; closes the explainer
//                                  without triggering grant/deny logic

import { useState } from 'react';

const MEDIA_CONSTRAINTS = {
    video: {
        facingMode: { ideal: 'environment' },
    },
};

export default function CameraPermissionExplainer({ onPermissionGranted, onPermissionDenied, onClose }) {
    const [phase, setPhase] = useState('pending'); // 'pending' | 'requesting' | 'denied'
    const [errMsg, setErrMsg] = useState('');

    async function requestAccess() {
        setPhase('requesting');
        setErrMsg('');
        try {
            const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
            if (typeof onPermissionGranted === 'function') onPermissionGranted(stream);
        } catch (err) {
            setPhase('denied');
            setErrMsg(err?.message || 'Camera access denied or unavailable.');
        }
    }

    function skip() {
        if (typeof onPermissionDenied === 'function') onPermissionDenied();
    }

    return (
        <div className="aas-event-day__camera-explainer" role="dialog" aria-modal="true" aria-labelledby="aas-camera-title">
            <div className="aas-event-day__camera-card">
                <h2 id="aas-camera-title" className="aas-event-day__camera-title">
                    Camera access for QR scanning
                </h2>

                {phase !== 'denied' && (
                    <>
                        <p className="aas-event-day__camera-copy">
                            We use the rear-facing camera to scan ticket QR codes. Air Action
                            Sports never records video — frames are processed live in your
                            browser only and discarded immediately.
                        </p>
                        <ul className="aas-event-day__camera-bullets">
                            <li>Allow access once per device — your browser remembers it.</li>
                            <li>You can revoke at any time from your browser settings.</li>
                            <li>If you skip, you can still paste a QR code manually.</li>
                        </ul>
                    </>
                )}

                {phase === 'denied' && (
                    <>
                        <p className="aas-event-day__camera-copy aas-event-day__camera-copy--error">
                            We couldn&apos;t access the camera.
                            {errMsg ? ` (${errMsg})` : ''}
                        </p>
                        <p className="aas-event-day__camera-copy">
                            On iOS Safari: Settings → Safari → Camera → set this site to
                            &quot;Allow&quot;.
                        </p>
                        <p className="aas-event-day__camera-copy">
                            On Android Chrome: tap the lock icon in the address bar →
                            Permissions → Camera → Allow.
                        </p>
                    </>
                )}

                <div className="aas-event-day__camera-actions">
                    <button
                        type="button"
                        onClick={skip}
                        className="aas-event-day__action-btn"
                    >
                        Paste code manually
                    </button>
                    {phase === 'denied' ? (
                        <button
                            type="button"
                            onClick={requestAccess}
                            className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                        >
                            Try again
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={requestAccess}
                            disabled={phase === 'requesting'}
                            className="aas-event-day__action-btn aas-event-day__action-btn--primary"
                        >
                            {phase === 'requesting' ? 'Requesting…' : 'Allow camera'}
                        </button>
                    )}
                </div>

                {typeof onClose === 'function' && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="aas-event-day__camera-close"
                        aria-label="Close camera permission explainer"
                    >
                        ×
                    </button>
                )}
            </div>
        </div>
    );
}
