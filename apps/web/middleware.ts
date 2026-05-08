import { NextResponse, type NextRequest } from "next/server";

const ANON_COOKIE = "dealer_anon";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Edge middleware for the dealer-OS multi-tenant surface.
 *
 * Ensures every request that touches `/dealer/*` or `/api/dealer/*`
 * carries a stable `dealer_anon` cookie. Signed-in users get their
 * owner id from NextAuth instead, but we still set the anon cookie
 * so anonymous fall-through (when sessions expire) keeps working.
 *
 * The cookie is set on BOTH the request (so the same request's server
 * components can read it via `cookies()`) and the response (so the
 * browser persists it for next time).
 *
 * Implementation notes:
 *   - `crypto.randomUUID()` is available in the Edge runtime.
 *   - The cookie is `httpOnly` so client JS can't read or rewrite it,
 *     `sameSite=lax` so it survives normal navigation, and `secure`
 *     in production so it's only sent over HTTPS.
 *   - Path is `/` so the cookie is shared across all dealer surfaces.
 */

function generateAnonId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for runtimes without WebCrypto (shouldn't hit on Edge).
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(ANON_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{6,}$/.test(existing)) {
    return NextResponse.next();
  }

  // Mint a new anon id and propagate it on both the request (so this
  // request's handlers see it immediately) and the response (so the
  // browser sends it next time).
  const id = generateAnonId();
  request.cookies.set(ANON_COOKIE, id);
  const response = NextResponse.next({ request });
  response.cookies.set(ANON_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ["/dealer/:path*", "/api/dealer/:path*"],
};
