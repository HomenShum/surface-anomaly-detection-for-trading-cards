"use client";

import { useState } from "react";
import { useInferenceHealth, type InferenceHealthState } from "../lib/useInferenceHealth";

const labelMap: Record<InferenceHealthState, string> = {
  checking: "Checking",
  live: "Real model",
  degraded: "Mock fallback",
  offline: "Inference offline",
};

export function InferenceHealthPill() {
  const health = useInferenceHealth();
  const [open, setOpen] = useState(false);

  return (
    <div className={`health-pill health-pill--${health.state}`}>
      <button
        aria-expanded={open}
        className="health-pill-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="health-pill-dot" aria-hidden="true" />
        <span>{labelMap[health.state]}</span>
        {health.modelVersion ? <small>{health.modelVersion}</small> : null}
      </button>
      {open ? (
        <div className="health-pill-popover" role="dialog">
          <dl>
            <div>
              <dt>Endpoint</dt>
              <dd>
                <code>{health.endpoint || "(not configured)"}</code>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{labelMap[health.state]}</dd>
            </div>
            {health.modelVersion ? (
              <div>
                <dt>Model</dt>
                <dd>{health.modelVersion}</dd>
              </div>
            ) : null}
            {health.message ? (
              <div>
                <dt>Detail</dt>
                <dd>{health.message}</dd>
              </div>
            ) : null}
            {health.lastCheckedAt ? (
              <div>
                <dt>Checked</dt>
                <dd>{new Date(health.lastCheckedAt).toLocaleTimeString()}</dd>
              </div>
            ) : null}
          </dl>
          <p className="health-pill-foot">
            Polled every 30s against <code>/models/current</code>. Real model = mock fallback off.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function useInferenceGate() {
  const health = useInferenceHealth();
  return {
    health,
    canRunRealInference: health.state === "live",
    isCheckingHealth: health.state === "checking",
    isOffline: health.state === "offline",
    isDegraded: health.state === "degraded",
  };
}
