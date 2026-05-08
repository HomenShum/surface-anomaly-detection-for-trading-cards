import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions, ownerIdFromSession } from "../auth";

/**
 * Owner identity for the dealer-OS.
 *
 * Two flavors:
 *   - **Anonymous** — vendors who haven't signed in. Identified by a
 *     long-lived `dealer_anon` httpOnly cookie. Their vault is private
 *     to that browser; if they clear cookies / switch devices they lose
 *     access. The cookie is set by `middleware.ts` on the first request
 *     that touches `/dealer/*` or `/api/dealer/*`.
 *   - **Signed-in** — vendors who completed NextAuth flow. Their owner
 *     id is derived from the session (`ownerIdFromSession`).
 *
 * The owner id is the storage namespace: every JSONL file and image
 * directory under `data/dealer/<ownerId>/` is private to that owner.
 *
 * The legacy un-namespaced files at `data/dealer/records.jsonl` (etc)
 * are treated as the **demo seed** — every new owner gets a one-time
 * clone of those files into their namespace so they have content to
 * play with on first load.
 */

export const ANON_COOKIE = "dealer_anon";
const ANON_PREFIX = "anon_";
const USER_PREFIX = "user_";

/**
 * Format an owner id from a stable string. Sanitizes to filesystem-
 * safe characters so we can use the value as a directory name.
 */
function safeNamespace(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${prefix}${safe || "default"}`;
}

/**
 * Resolve the owner id for the *current* server request.
 *
 * Priority:
 *   1. NextAuth session (signed-in user)
 *   2. `dealer_anon` cookie (anonymous browser)
 *   3. Static fallback (`anon_default`) — should be unreachable in
 *      practice because the middleware always sets the cookie before
 *      a request reaches a server component or route handler. The
 *      fallback exists so a unit test running without middleware
 *      doesn't crash.
 *
 * Server components and route handlers should call this directly. Both
 * paths use `cookies()` / `getServerSession()` which are valid in both
 * contexts.
 */
export async function currentOwnerId(): Promise<string> {
  // Signed-in session takes precedence.
  try {
    const session = await getServerSession(authOptions);
    const owner = ownerIdFromSession(session);
    if (owner) return safeNamespace(USER_PREFIX, owner);
  } catch {
    // Auth not configured / session missing — fall through to anon.
  }

  // Anonymous: read the httpOnly cookie set by middleware.
  try {
    const store = await cookies();
    const anon = store.get(ANON_COOKIE)?.value;
    if (anon) return safeNamespace(ANON_PREFIX, anon);
  } catch {
    // cookies() can throw outside a request context — treat as default.
  }

  return `${ANON_PREFIX}default`;
}

/**
 * Render-friendly label for the current identity. Anonymous owners
 * get a short id slice so the sidebar chip is readable; signed-in
 * users get their email/handle.
 */
export type OwnerIdentity = {
  ownerId: string;
  kind: "anon" | "signed-in";
  label: string;
  /** Short display id (last 6 chars) for the sidebar chip. */
  slug: string;
  email?: string;
};

export async function currentOwnerIdentity(): Promise<OwnerIdentity> {
  try {
    const session = await getServerSession(authOptions);
    const owner = ownerIdFromSession(session);
    if (owner) {
      const email = session?.user?.email ?? undefined;
      const name = session?.user?.name ?? email ?? owner;
      return {
        ownerId: safeNamespace(USER_PREFIX, owner),
        kind: "signed-in",
        label: name,
        slug: owner.slice(-6),
        email,
      };
    }
  } catch {
    // fall through
  }
  try {
    const store = await cookies();
    const anon = store.get(ANON_COOKIE)?.value;
    if (anon) {
      return {
        ownerId: safeNamespace(ANON_PREFIX, anon),
        kind: "anon",
        label: "anonymous vendor",
        slug: anon.slice(-6),
      };
    }
  } catch {
    // fall through
  }
  return {
    ownerId: `${ANON_PREFIX}default`,
    kind: "anon",
    label: "anonymous vendor",
    slug: "default",
  };
}
