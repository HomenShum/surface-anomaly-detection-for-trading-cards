import type { ReactNode } from "react";
import { DealerAgentDock } from "./DealerAgentDock";
import { DealerClaimAnonBanner } from "./DealerClaimAnonBanner";
import { DealerCommandPalette } from "./DealerCommandPalette";
import { DealerCostBasisDrawer } from "./DealerCostBasisDrawer";
import { DealerSideNav } from "./DealerSideNav";

type Props = {
  children: ReactNode;
  active?: "workbench" | "drop" | "vault" | "listings" | "submissions" | "alerts" | "examples" | "benchmarks" | "settings";
  expert?: boolean;
};

/**
 * Shared shell for every /dealer/* surface. Replaces per-page topbars
 * with a sticky Vercel-style left rail + a Codex-style floating agent
 * dock pinned bottom-right.
 */
export function DealerShell({ children, active, expert = false }: Props) {
  return (
    <main className="dealer-shell-v2">
      <DealerSideNav active={active} expert={expert} />
      <div className="dealer-shell-main">
        <div className="dealer-shell-canvas">
          <DealerClaimAnonBanner />
          {children}
        </div>
      </div>
      <DealerAgentDock />
      <DealerCommandPalette />
      <DealerCostBasisDrawer />
    </main>
  );
}
