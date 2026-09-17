"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live barcode scanning from the rear camera.
 *
 * Two paths, because no single one covers both phones in a household: Chrome on
 * Android has a native BarcodeDetector that is fast and free, while Safari on
 * iOS has nothing, so we fall back to ZXing decoding frames in JavaScript.
 * Manual entry is always offered — barcodes on curved or shiny packaging can
 * defeat both.
 *
 * Note that getUserMedia only works in a secure context: HTTPS, or localhost.
 * Over plain HTTP on a LAN address the camera will refuse to start, and the
 * component says so rather than spinning forever.
 */

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

function nativeDetector(): BarcodeDetectorConstructor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void;
  onCancel: () => void;
}

export function BarcodeScanner({ onDetected, onCancel }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [starting, setStarting] = useState(true);

  // Fire once — a barcode sitting in frame decodes on every animation frame.
  const finish = useCallback(
    (code: string) => {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      onDetected(code);
    },
    [onDetected],
  );

  useEffect(() => {
    let raf = 0;
    let zxingControls: { stop: () => void } | null = null;

    // Re-arm on every mount. React runs effects mount-cleanup-mount in
    // development, and a flag only ever set by the cleanup stays latched —
    // the camera would open on the second pass and immediately shut itself off.
    stoppedRef.current = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "This browser won't open the camera here. On a phone the app must be served over HTTPS — type the barcode digits instead.",
        );
        setStarting(false);
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (caught) {
        const name = caught instanceof DOMException ? caught.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was declined. Allow it in your browser settings, or type the digits below."
            : "Could not start the camera. Type the barcode digits instead.",
        );
        setStarting(false);
        return;
      }

      if (stoppedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStarting(false);

      const Detector = nativeDetector();
      if (Detector) {
        const detector = new Detector({ formats: FORMATS });
        const tick = async () => {
          if (stoppedRef.current || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found[0]?.rawValue?.replace(/\D/g, "");
            if (code && code.length >= 8) {
              finish(code);
              return;
            }
          } catch {
            // A transient decode failure is normal between frames.
          }
          raf = requestAnimationFrame(() => void tick());
        };
        void tick();
        return;
      }

      // No native detector (iOS Safari): decode in JavaScript instead.
      const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
      if (stoppedRef.current) return;
      const reader = new BrowserMultiFormatOneDReader();
      zxingControls = await reader.decodeFromVideoElement(video, (result) => {
        const code = result?.getText().replace(/\D/g, "");
        if (code && code.length >= 8) finish(code);
      });
    }

    void start();

    return () => {
      stoppedRef.current = true;
      cancelAnimationFrame(raf);
      zxingControls?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [finish]);

  return (
    <>
      <h3>Scan a barcode</h3>
      <p className="ring-sub" style={{ marginTop: 0, marginBottom: 12 }}>
        Hold the barcode flat and fill the frame. Packaged food comes straight from the
        label, so it&apos;s far more accurate than a photo estimate.
      </p>

      {error ? (
        <div className="notice error">{error}</div>
      ) : (
        <div className="scanner">
          <video ref={videoRef} playsInline muted />
          <div className="scanner-line" />
          {starting && (
            <div className="scanner-status">
              <div className="spinner" /> Starting the camera…
            </div>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="manual-barcode">Or type the digits under the barcode</label>
        <input
          id="manual-barcode"
          type="text"
          inputMode="numeric"
          placeholder="9300675024235"
          value={manual}
          onChange={(event) => setManual(event.target.value.replace(/\D/g, ""))}
        />
      </div>

      <div className="row">
        <button className="btn ghost" onClick={onCancel}>
          Back
        </button>
        <button
          className="btn primary"
          disabled={manual.length < 8}
          onClick={() => finish(manual)}
        >
          Look it up
        </button>
      </div>
    </>
  );
}
