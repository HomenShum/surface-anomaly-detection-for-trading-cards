"use client";

import { useState } from "react";

const ASK_COPY = `Those cert photos are super useful — they let us test automatic PSA cert extraction and give us certified outcome examples across PSA 5–10.

The thing that would help the model most is what you already have but haven't sent yet:

1. Raw front + back photos taken BEFORE grading for any of these cards (the unencapsulated card, not the slab).
2. Back-side slab photos for any of the certs you already shared.
3. Permission to use a subset of these as anonymized examples in the public app (we'll mark them Silver+ until raw scans exist; you keep the right to revoke).
4. Any cards where you personally think the PSA grade was too high or too low — disagreement cases are way more valuable than agreement cases for benchmarking.

The most useful examples aren't only 10s. The 8s, 7s, 6s, and weird-disagreement cards are what tell us whether the condition system is actually pulling its weight.`;

export function FriendAskPanel() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ASK_COPY);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="friend-ask-panel">
      <header>
        <span className="page-kicker">Vendor / friend ask</span>
        <h2>Send your friend the message that turns Silver+ into Gold.</h2>
        <p className="muted">
          The label batch + slab photos already do a lot. The next jump in trust comes from raw pre-grading
          scans + disagreement cases. Copy-paste the ask below.
        </p>
      </header>
      <pre className="friend-ask-copy" aria-label="Friend ask message">
        {ASK_COPY}
      </pre>
      <div className="friend-ask-actions">
        <button className="primary-button" onClick={() => void copy()} type="button">
          {copied ? "Copied ✓" : "Copy ask"}
        </button>
        <small className="muted">
          Cards in 8/7/6 grades + cards where the grade surprised your friend → highest signal for our eval.
        </small>
      </div>
    </section>
  );
}
