import type { Metadata } from "next";
import { DealerShell } from "../../components/DealerShell";
import { RipsExperience } from "../../components/rips/RipsExperience";
import { sampleRipPacks } from "../../lib/rips/sample-packs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Web Rips Lab | Card Condition Vault",
  description: "Interactive web pack-ripping prototype with vault-backed reveal state.",
};

export default function RipsPage() {
  return (
    <DealerShell active="drop">
      <RipsExperience packs={sampleRipPacks} />
    </DealerShell>
  );
}
