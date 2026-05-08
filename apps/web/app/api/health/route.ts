import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public liveness probe for Render / uptime monitors. Returns 200 OK
 * when the process is up and able to respond. Does NOT touch any
 * per-owner storage so it stays fast and side-effect-free.
 *
 * For a deeper readiness check (storage writable, env configured),
 * use `/api/admin/heartbeat` (token-protected).
 */

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "card-condition-vault",
      ts: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
