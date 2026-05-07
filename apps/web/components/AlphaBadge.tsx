"use client";

import { useState } from "react";

export function AlphaBadge() {
  const [open, setOpen] = useState(false);
  return (
    <div className="alpha-badge">
      <button
        aria-expanded={open}
        className="alpha-badge-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>Alpha v0.1</span>
        <small>Not an official grade</small>
      </button>
      {open ? (
        <div className="alpha-badge-popover" role="dialog">
          <strong>Controlled Alpha v0.1</strong>
          <p>
            Card Condition Vault is in <strong>controlled alpha</strong>. Reports are AI-assisted
            condition estimates with a timestamped evidence manifest - they are <em>not</em> official
            grades or legal guarantees.
          </p>
          <ul>
            <li>Mock fallback: <code>OFF</code> by default</li>
            <li>Confidence cap: alpha-guarded</li>
            <li>Video storage: off</li>
            <li>Hashes saved on every report</li>
          </ul>
          <p className="alpha-badge-foot">
            Found a wrong detection? Use <strong>False positive</strong> on the report page so the
            correction logs into the audit trail.
          </p>
        </div>
      ) : null}
    </div>
  );
}
