import { ScannerClient } from "../../components/ScannerClient";

export default function ScannerPage() {
  return (
    <main className="container">
      <h1 className="page-title">Scanner</h1>
      <p className="lede">
        This legacy route mirrors `/scan` for dogfood links created during early MVP work.
      </p>
      <ScannerClient />
    </main>
  );
}
