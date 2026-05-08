"use client";

import { useEffect, useState } from "react";
import type { VerifiedMethod } from "../lib/community-methods";

type RewardToastProps =
  | {
      method: VerifiedMethod;
      delayMs?: number;
      variant?: "verified";
    }
  | {
      variant: "candidate";
      candidateIds: string[];
      delayMs?: number;
    };

export function RewardToast(props: RewardToastProps) {
  const delayMs = props.delayMs ?? 900;
  const [visible, setVisible] = useState(false);
  const isCandidate = props.variant === "candidate";

  useEffect(() => {
    if (window.matchMedia("(max-width: 500px)").matches) {
      setVisible(false);
      return undefined;
    }
    const showId = window.setTimeout(() => setVisible(true), delayMs);
    const hideId = window.setTimeout(() => setVisible(false), delayMs + 4200);
    return () => {
      window.clearTimeout(showId);
      window.clearTimeout(hideId);
    };
  }, [delayMs, isCandidate]);

  const title = isCandidate ? "Method candidate logged" : "Verified method accepted";
  const body = isCandidate
    ? `${props.candidateIds.length} draft method candidate(s) moved into the benchmark queue. Nothing is public or active yet.`
    : `${props.method.title} reduced false positives by ${props.method.benchmark.falsePositiveReductionPct}% on ${props.method.benchmark.fixturePack}.`;
  const detail = isCandidate
    ? props.candidateIds.join(", ")
    : `Contributor @${props.method.contributorHandle} earned ${props.method.reward}.`;

  if (!visible) return null;

  return (
    <aside
      className={`reward-toast ${isCandidate ? "reward-toast--candidate" : ""} is-visible`}
      role="status"
      aria-live="polite"
    >
      <div className="reward-toast-mark">{isCandidate ? "DC" : "VM"}</div>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        <small>{detail}</small>
      </div>
      <button aria-label="Dismiss reward toast" onClick={() => setVisible(false)} type="button">
        Close
      </button>
    </aside>
  );
}
