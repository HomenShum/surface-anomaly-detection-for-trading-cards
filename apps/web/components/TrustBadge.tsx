import type { ExampleTier } from "../lib/examples/registry";

type Props = {
  tier: ExampleTier;
  size?: "sm" | "md";
  reason?: string;
};

const TIER_COPY: Record<ExampleTier, { label: string; sublabel: string }> = {
  gold: {
    label: "Gold",
    sublabel: "User-consented scan + official outcome + human DINGs",
  },
  silver_plus: {
    label: "Silver+",
    sublabel: "Certified reference with slab/label images on file + our model run",
  },
  silver: {
    label: "Silver",
    sublabel: "External certified reference or human-reviewed fixture",
  },
  bronze: {
    label: "Bronze",
    sublabel: "Open CC BY 4.0 image + human/model annotation",
  },
  demo: {
    label: "Demo",
    sublabel: "Synthetic fixture — illustrates a behaviour, not a real outcome",
  },
};

export function TrustBadge({ tier, size = "md", reason }: Props) {
  const copy = TIER_COPY[tier];
  return (
    <span className={`trust-badge trust-badge--${tier} trust-badge--${size}`} title={reason ?? copy.sublabel}>
      <strong>{copy.label}</strong>
      {size === "md" ? <em>{copy.sublabel}</em> : null}
    </span>
  );
}
