import Link from "next/link";

export default function SettingsPage() {
  return (
    <main className="container page-stack">
      <div className="page-kicker">Local setup</div>
      <h1 className="page-title">Settings</h1>
      <section className="grid two">
        <div className="card">
          <h2>Google OAuth</h2>
          <p className="muted">Set provider variables in `.env.local` to enable real Google sign-in.</p>
          <code>GOOGLE_CLIENT_ID</code>
          <code>GOOGLE_CLIENT_SECRET</code>
        </div>
        <div className="card">
          <h2>Inference API</h2>
          <p className="muted">The web client calls `NEXT_PUBLIC_INFERENCEAPI_URL`, `NEXT_PUBLIC_INFERENCE_API_URL`, or `NEXT_PUBLIC_API_BASE_URL`, defaulting to localhost:8000 locally and `/_/inference-api` on Vercel Services.</p>
          <Link className="button secondary" href="/scan">Test scanner</Link>
        </div>
        <div className="card">
          <h2>Convex</h2>
          <p className="muted">Set `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT`, then run `npx convex dev` or `npx convex deploy`.</p>
          <code>NEXT_PUBLIC_CONVEX_URL</code>
        </div>
        <div className="card">
          <h2>Pi agent</h2>
          <p className="muted">Set `OPENROUTER_API_KEY`, `CARD_AGENT_PROVIDER`, and `CARD_AGENT_MODEL` for pi-ai report and workspace operations. `OPENAI_API_KEY` is used only as a constrained fallback.</p>
          <code>CARD_AGENT_MODEL=google/gemma-4-26b-a4b</code>
        </div>
      </section>
    </main>
  );
}
