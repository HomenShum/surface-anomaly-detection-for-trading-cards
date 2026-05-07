import { ScannerClient } from "../../../components/ScannerClient";

export default function NewCardPage() {
  return (
    <main className="container page-stack">
      <div className="page-kicker">Add card</div>
      <h1 className="page-title">Guided scan</h1>
      <ScannerClient />
    </main>
  );
}
