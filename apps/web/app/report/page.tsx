import { VaultSummary } from "../../components/VaultSummary";
import { reportDisclaimer } from "../../lib/vault";

export default function ReportPage() {
  return (
    <main className="container page-stack">
      <h1 className="page-title">Report</h1>
      <p className="lede">Summarize surface health, condition flags, and review notes.</p>
      <VaultSummary mode="report" />
      <p className="disclaimer">{reportDisclaimer}</p>
    </main>
  );
}
