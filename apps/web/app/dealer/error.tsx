"use client";

import { useEffect } from "react";

/**
 * Error boundary for every /dealer/* surface. Next.js automatically
 * renders this when a route segment throws during render or in a
 * client effect. Without it, the user sees a blank page.
 *
 * The boundary:
 *   - logs the digest + message to console (for debugging)
 *   - shows the user a calm "something went wrong" with the route digest
 *   - exposes a "retry" that calls reset() to re-render the segment
 *   - links back to the workbench so the user isn't trapped on the
 *     broken surface
 */

export default function DealerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[dealer:error-boundary]", error);
  }, [error]);

  return (
    <div className="dealer-errorboundary" role="alert">
      <div>
        <span className="dealer-errorboundary-kicker">Something broke on this surface</span>
        <h2>The vault is fine — this view crashed.</h2>
        <p>
          Records on disk in <code>data/dealer/records.jsonl</code> are unaffected. Try retrying the
          render, or jump back to the workbench. The error digest below is logged to the server
          console for debugging.
        </p>
        <pre>
          {error.digest ? `digest=${error.digest}\n` : ""}
          message={error.message || "(no message)"}
        </pre>
        <div className="dealer-errorboundary-actions">
          <button className="is-primary" onClick={() => reset()} type="button">
            Retry
          </button>
          <a href="/dealer/workbench">Open workbench →</a>
          <a href="/dealer/dashboard">Open vault →</a>
        </div>
      </div>
    </div>
  );
}
