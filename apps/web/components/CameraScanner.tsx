"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isSecureCameraContext, scoreFrameFromVideo, type FrameQuality } from "../lib/capture/frame-quality";

type CameraState = "init" | "ready" | "denied" | "unsupported" | "insecure";
type CaptureMode = "auto" | "manual";

export type CapturedFrame = {
  dataUrl: string;
  quality: FrameQuality;
  capturedAt: string;
  width: number;
  height: number;
};

type Props = {
  onCapture: (frame: CapturedFrame) => void;
  hint?: string;
  captureMode?: CaptureMode;
  onPermissionDenied?: () => void;
};

const STABLE_PASS_FRAMES = 6; // ~ 0.4s of consecutive passing frames at 15fps before auto-capture

export function CameraScanner({ onCapture, hint, captureMode = "auto", onPermissionDenied }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stableFramesRef = useRef(0);
  const callbackHandleRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const [state, setState] = useState<CameraState>("init");
  const [quality, setQuality] = useState<FrameQuality | null>(null);
  const [autoCapturing, setAutoCapturing] = useState(captureMode === "auto");

  const stop = useCallback(() => {
    const video = videoRef.current;
    if (callbackHandleRef.current != null && video && "cancelVideoFrameCallback" in video) {
      (video as unknown as { cancelVideoFrameCallback: (h: number) => void }).cancelVideoFrameCallback(
        callbackHandleRef.current,
      );
      callbackHandleRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const captureNow = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    capturedRef.current = true;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const q = scoreFrameFromVideo(video);
    onCapture({
      dataUrl,
      quality: q,
      capturedAt: new Date().toISOString(),
      width: canvas.width,
      height: canvas.height,
    });
    stop();
  }, [onCapture, stop]);

  const start = useCallback(async () => {
    if (!isSecureCameraContext()) {
      setState("insecure");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setState("ready");

      const supportsRVFC = "requestVideoFrameCallback" in video;
      const tick = () => {
        if (capturedRef.current) return;
        try {
          const q = scoreFrameFromVideo(video);
          setQuality(q);
          if (q.pass) {
            stableFramesRef.current += 1;
          } else {
            stableFramesRef.current = 0;
          }
          if (autoCapturing && stableFramesRef.current >= STABLE_PASS_FRAMES) {
            captureNow();
            return;
          }
        } catch {
          // ignore - keep streaming
        }
        if (supportsRVFC) {
          callbackHandleRef.current = (
            video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }
          ).requestVideoFrameCallback(tick);
        } else {
          window.setTimeout(tick, 70);
        }
      };
      if (supportsRVFC) {
        callbackHandleRef.current = (
          video as unknown as { requestVideoFrameCallback: (cb: () => void) => number }
        ).requestVideoFrameCallback(tick);
      } else {
        tick();
      }
    } catch {
      setState("denied");
      onPermissionDenied?.();
    }
  }, [autoCapturing, captureNow, onPermissionDenied]);

  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera-scanner">
      <div className="camera-stage">
        <video ref={videoRef} aria-label="Live camera preview" muted playsInline />
        <div className="camera-reticle" aria-hidden="true">
          <span className="corner top-left" />
          <span className="corner top-right" />
          <span className="corner bottom-left" />
          <span className="corner bottom-right" />
        </div>
        {state === "init" ? (
          <div className="camera-overlay">Requesting camera permission...</div>
        ) : null}
        {state === "insecure" ? (
          <div className="camera-overlay error">
            Camera requires HTTPS or localhost. Use the upload fallback.
          </div>
        ) : null}
        {state === "unsupported" ? (
          <div className="camera-overlay error">
            This browser does not expose a camera. Use the upload fallback.
          </div>
        ) : null}
        {state === "denied" ? (
          <div className="camera-overlay error">
            Camera permission was denied. Use the upload fallback.
          </div>
        ) : null}
        {state === "ready" && quality ? (
          <div className="camera-coach">
            {quality.pass ? (
              <span className="coach-line good">
                Good frame - {autoCapturing ? "auto-capturing..." : "tap capture."}
              </span>
            ) : (
              <span className="coach-line warn">{quality.reasons[0] ?? "Adjust framing."}</span>
            )}
          </div>
        ) : null}
      </div>

      {state === "ready" ? (
        <div className="camera-quality-bar" aria-label="Live frame quality">
          <QualityChip label="Sharpness" value={quality?.blurScore ?? 0} good={(quality?.blurScore ?? 0) >= 38} />
          <QualityChip label="Light" value={quality?.brightness ?? 0} good={!!quality && quality.brightness >= 22 && quality.brightness <= 86} />
          <QualityChip label="Glare" value={100 - (quality?.glareRisk ?? 0)} good={(quality?.glareRisk ?? 0) <= 35} invert />
          <QualityChip label="Edges" value={quality?.edgeCoverage ?? 0} good={(quality?.edgeCoverage ?? 0) >= 28} />
          <QualityChip label="Surface" valueText={quality?.surfaceMode ?? "-"} good />
        </div>
      ) : null}

      <div className="camera-actions">
        <button
          className="button"
          disabled={state !== "ready"}
          onClick={captureNow}
          type="button"
        >
          Capture now
        </button>
        <button
          className="button secondary"
          onClick={() => setAutoCapturing((current) => !current)}
          type="button"
        >
          {autoCapturing ? "Auto-capture: ON" : "Auto-capture: OFF"}
        </button>
        {hint ? <span className="muted camera-hint">{hint}</span> : null}
      </div>
    </div>
  );
}

function QualityChip({
  label,
  value,
  valueText,
  good,
  invert,
}: {
  label: string;
  value?: number;
  valueText?: string;
  good: boolean;
  invert?: boolean;
}) {
  const display = valueText ?? `${value}`;
  return (
    <div className={`quality-chip ${good ? "good" : "warn"} ${invert ? "invert" : ""}`}>
      <span>{label}</span>
      <strong>{display}</strong>
    </div>
  );
}
