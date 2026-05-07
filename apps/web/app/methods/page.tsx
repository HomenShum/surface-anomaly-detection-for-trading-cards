import { MethodsBoardClient } from "../../components/MethodsBoardClient";
import { loadAllPublicMethods, loadAllContributorPayloads } from "../../lib/agent/methods-bridge";
import { contributors as seedContributors, type ContributorProfile } from "../../lib/community-methods";

export const dynamic = "force-dynamic";

export default async function MethodsPage({
  searchParams,
}: {
  searchParams?: Promise<{ celebrate?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const { all } = loadAllPublicMethods();
  const registryContributors = loadAllContributorPayloads().map(
    (entry): ContributorProfile => ({
      handle: entry.handle,
      name: entry.displayName,
      role: entry.badges[0] ?? "Method Author",
      badges: entry.badges,
      verifiedMethods: entry.verifiedMethods,
      benchmarkFixtures: entry.fixturesContributed,
      corrections: entry.totalSubmissions,
      impact: `${entry.verifiedMethods} verified · ${entry.totalSubmissions} submissions`,
    }),
  );
  const merged: ContributorProfile[] = [...seedContributors];
  for (const reg of registryContributors) {
    if (!merged.find((entry) => entry.handle === reg.handle)) merged.push(reg);
  }
  return <MethodsBoardClient methods={all} contributors={merged} celebrateMethodId={params.celebrate} />;
}
