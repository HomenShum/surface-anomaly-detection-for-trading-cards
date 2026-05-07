import { Suspense } from "react";
import { ScanFlowClient } from "../../components/ScanFlowClient";
import { ScanModeBootstrap } from "../../components/ScanModeBootstrap";

export const dynamic = "force-dynamic";

export default function ScanPage() {
  return (
    <Suspense fallback={<ScanFlowClient />}>
      <ScanModeBootstrap />
    </Suspense>
  );
}
