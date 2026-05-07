export function inferenceApiBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_INFERENCEAPI_URL ??
    process.env.NEXT_PUBLIC_INFERENCE_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL;

  if (configured) return configured.replace(/\/$/, "");

  // In the browser, always route through the same-origin /api/inference
  // proxy. This eliminates CORS as a coupling surface — the proxy runs
  // server-side in Next.js's Node runtime and forwards to whatever
  // INFERENCE_API_URL points at (defaults to http://127.0.0.1:8000 for
  // localhost). Same path for dev (port 3000), demo prod (port 3100), and
  // public deploys.
  if (typeof window !== "undefined") return "/api/inference";

  return "http://localhost:8000";
}
