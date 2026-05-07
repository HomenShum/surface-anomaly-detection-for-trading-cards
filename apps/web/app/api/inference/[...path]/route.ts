import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ path?: string[] }>;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 2;

function upstreamBase(request: Request) {
  const configured = (
    process.env.INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    ""
  ).replace(/\/$/, "");
  if (configured) return configured;

  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://127.0.0.1:8000";

  return "";
}

function numericEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function retryAfterMs(response: Response | undefined, attempt: number) {
  const header = response?.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(15_000, Math.max(500, seconds * 1000));
  }
  return Math.min(6_000, 500 * 2 ** attempt);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proxy(request: Request, { params }: Params) {
  const base = upstreamBase(request);
  if (!base) {
    return NextResponse.json(
      {
        error: "inference_api_not_configured",
        message: "Set INFERENCE_API_URL to the public HTTPS FastAPI inference service.",
      },
      { status: 503 },
    );
  }

  const { path = [] } = await params;
  const upstream = `${base}/${path.map(encodeURIComponent).join("/")}`;
  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
  const timeoutMs = numericEnv("INFERENCE_API_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const retries = numericEnv("INFERENCE_API_RETRIES", DEFAULT_RETRIES);
  const contentType = request.headers.get("Content-Type") ?? "application/json";
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? request.headers.get("X-Scan-Session-Id");
  const headers: Record<string, string> = {
    Accept: request.headers.get("Accept") ?? "application/json",
    "Content-Type": contentType,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        upstream,
        {
          method,
          headers,
          body,
          cache: "no-store",
        },
        timeoutMs,
      );
      lastResponse = response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        const responseContentType = response.headers.get("Content-Type") ?? "application/json";
        const responseBody = await response.text();
        return new NextResponse(responseBody, {
          status: response.status,
          headers: {
            "Content-Type": responseContentType,
            "X-Inference-Upstream": base,
            "X-Inference-Attempts": String(attempt + 1),
          },
        });
      }
      await sleep(retryAfterMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(retryAfterMs(undefined, attempt));
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.name === "AbortError"
        ? `Inference upstream timed out after ${timeoutMs}ms.`
        : lastError.message
      : lastResponse
        ? `Inference upstream returned HTTP ${lastResponse.status}.`
        : "Inference upstream is unavailable.";
  return NextResponse.json(
    {
      error: "inference_upstream_unavailable",
      status: "degraded",
      message,
      upstream: base,
      attempts: retries + 1,
      retry_after_ms: retryAfterMs(lastResponse, retries),
    },
    {
      status: 503,
      headers: {
        "X-Inference-Upstream": base,
        "X-Inference-Attempts": String(retries + 1),
      },
    },
  );
}

export async function GET(request: Request, params: Params) {
  return proxy(request, params);
}

export async function POST(request: Request, params: Params) {
  return proxy(request, params);
}
