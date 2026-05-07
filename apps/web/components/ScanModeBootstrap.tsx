"use client";

import { useSearchParams } from "next/navigation";
import { ScanFlowClient } from "./ScanFlowClient";

type ScanMode = "auto" | "video" | "upload" | "sample";
const validModes: ScanMode[] = ["auto", "video", "upload", "sample"];

export function ScanModeBootstrap() {
  const params = useSearchParams();
  const raw = params.get("mode");
  const initialMode = raw && (validModes as string[]).includes(raw) ? (raw as ScanMode) : undefined;
  return <ScanFlowClient initialMode={initialMode} />;
}
