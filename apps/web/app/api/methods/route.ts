import { NextResponse } from "next/server";
import { loadAllPublicMethods, loadAllContributorPayloads } from "../../../lib/agent/methods-bridge";

export const runtime = "nodejs";

export async function GET() {
  const { seeded, fromRegistry, all } = loadAllPublicMethods();
  const contributors = loadAllContributorPayloads();
  return NextResponse.json({
    seededCount: seeded.length,
    registryCount: fromRegistry.length,
    methods: all,
    contributors,
  });
}
