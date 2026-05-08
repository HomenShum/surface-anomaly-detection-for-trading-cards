"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sticky banner shown to a freshly-signed-in user when the previous
 * anonymous browsing session left a vault behind.
 *
 * Lifecycle:
 *   - Mount: GET /api/dealer/claim-anon-vault. If `claimable: true`,
 *     render the banner; otherwise stay null.
 *   - Click "claim": POST. On 200, refresh the route so the user's
 *     namespace re-renders with the merged records.
 *   - Click "discard": just dismisses the banner via localStorage so the
 *     UI doesn't re-prompt on every page nav. Anon namespace stays on
 *     disk; can be re-claimed later if the user changes their mind by
 *     visiting `/dealer/account` (todo).
 *
 * Mounted in DealerShell so it appears on every dealer route once.
 */

const DISMISS_KEY = "dealer-claim-banner-dismissed";

type ClaimableState = {
  signedIn: boolean;
  claimable: boolean;
  recordCount?: number;
  reason?: string;
};

export function DealerClaimAnonBanner() {
  const router = useRouter();
  const [state, setState] = useState<ClaimableState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    fetch("/api/dealer/claim-anon-vault")
      .then((r) => r.json())
      .then((j: ClaimableState) => {
        if (!cancelled) setState(j);
      })
      .catch(() => {
        if (!cancelled) setState({ signedIn: false, claimable: false });
      });
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  const claim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dealer/claim-anon-vault", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Successful claim — clear the banner state and refresh the route
      // so the merged records render in the user's namespace.
      setState({ signedIn: true, claimable: false, reason: "just_claimed" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "claim failed");
    } finally {
      setBusy(false);
    }
  }, [router]);

  const dismiss = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  }, []);

  if (dismissed || !state || !state.claimable) return null;

  return (
    <aside className="dealer-claim-banner" role="alert">
      <div className="dealer-claim-banner-body">
        <span className="dealer-claim-banner-kicker">Anonymous vault detected</span>
        <p>
          Your previous anonymous session left {state.recordCount} record
          {state.recordCount === 1 ? "" : "s"} on this browser. Claim it for your account so
          your edits, sales, and audit trail follow you across devices.
        </p>
      </div>
      <div className="dealer-claim-banner-actions">
        {error ? <span className="dealer-claim-banner-error">{error}</span> : null}
        <button
          className="dealer-claim-banner-dismiss"
          disabled={busy}
          onClick={dismiss}
          type="button"
        >
          not mine
        </button>
        <button
          className="dealer-claim-banner-claim"
          disabled={busy}
          onClick={() => void claim()}
          type="button"
        >
          {busy ? "claiming…" : `claim ${state.recordCount} record${state.recordCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </aside>
  );
}
