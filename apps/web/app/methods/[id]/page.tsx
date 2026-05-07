import { MethodDetailClient } from "../../../components/MethodDetailClient";
import { findMethodBySlug, loadAllPublicMethods } from "../../../lib/agent/methods-bridge";

export const dynamic = "force-dynamic";

export default async function MethodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const method = findMethodBySlug(id) ?? undefined;
  const { all } = loadAllPublicMethods();
  const related = method ? all.filter((entry) => entry.id !== method.id).slice(0, 2) : [];
  return <MethodDetailClient method={method} relatedMethods={related} />;
}
