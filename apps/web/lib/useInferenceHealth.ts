"use client";

import { useEffect, useRef, useState } from "react";
import { inferenceApiBaseUrl } from "./inference-api";

export type InferenceHealthState = "checking" | "live" | "degraded" | "offline";

export type InferenceHealth = {
  state: InferenceHealthState;
  modelVersion?: string;
  mock?: boolean;
  endpoint: string;
  lastCheckedAt?: string;
  message?: string;
};

const POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 4_000;

export function useInferenceHealth(): InferenceHealth {
  const [health, setHealth] = useState<InferenceHealth>(() => ({
    state: "checking",
    endpoint: typeof window === "undefined" ? "" : inferenceApiBaseUrl(),
  }));
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const endpoint = inferenceApiBaseUrl();

    async function check() {
      const url = `${endpoint}/models/current`;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        window.clearTimeout(timer);
        if (cancelledRef.current) return;
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.message) message = String(body.message);
            if (body?.error) message = `${body.error}: ${message}`;
          } catch {
            // ignore
          }
          setHealth({
            state: "offline",
            endpoint,
            message,
            lastCheckedAt: new Date().toISOString(),
          });
          return;
        }
        const body = await res.json();
        const modelVersion = String(body?.model_version ?? body?.ding_detector ?? body?.model ?? "unknown");
        const mock = Boolean(body?.mock);
        setHealth({
          state: mock ? "degraded" : "live",
          modelVersion,
          mock,
          endpoint,
          lastCheckedAt: new Date().toISOString(),
          message: mock ? "Mock fallback active - no real model loaded." : undefined,
        });
      } catch (error) {
        window.clearTimeout(timer);
        if (cancelledRef.current) return;
        const reason = error instanceof Error ? error.message : "unknown error";
        setHealth({
          state: "offline",
          endpoint,
          message: reason === "The user aborted a request." || reason.includes("abort")
            ? "Inference service did not respond within 4s."
            : `Inference service unreachable: ${reason}`,
          lastCheckedAt: new Date().toISOString(),
        });
      }
    }

    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, []);

  return health;
}
