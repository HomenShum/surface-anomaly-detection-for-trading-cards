// Next.js by default only reads .env.local from the app directory
// (apps/web/), but our monorepo keeps shared LLM/API keys at the repo
// root in .env.local. Load that file here without copying it to disk so
// the dealer-OS agent dock + inspection routes can call OpenRouter /
// Gemini / OpenAI when the dev has root keys configured. We don't
// override values that are already set in the process env or in the
// per-app .env.local.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRootEnv = resolve(__dirname, "..", "..", ".env.local");

if (existsSync(repoRootEnv)) {
  try {
    const body = readFileSync(repoRootEnv, "utf-8");
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Don't override anything already set (per-app .env.local or shell).
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // best-effort: silently skip if parse fails
  }
}

// Production security headers. Applied to every response by Next.js.
// CSP is intentionally permissive on inline-style ('unsafe-inline')
// because the dealer-OS uses inline component styles in a few places;
// tighten by extracting those to CSS files later.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    // Render terminates TLS, so HSTS is meaningful in prod. preload omitted
    // until we're sure we won't break dev HTTP.
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // images.pokemontcg.io for hydrated Pokemon TCG art; data: for inline previews
      "img-src 'self' data: blob: https://images.pokemontcg.io",
      "font-src 'self' data:",
      // Allow LLM endpoints + our own API
      "connect-src 'self' https://generativelanguage.googleapis.com https://openrouter.ai https://api.openai.com https://api.anthropic.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@mariozechner/pi-ai"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
