import { ExampleGalleryClient } from "../../components/ExampleGalleryClient";
import { loadAllExamples } from "../../lib/examples/gold-store";

export const dynamic = "force-dynamic";

export default function ExamplesPage() {
  const examples = loadAllExamples();
  return <ExampleGalleryClient examples={examples} />;
}
