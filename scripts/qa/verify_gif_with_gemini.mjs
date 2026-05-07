#!/usr/bin/env node
/**
 * Gemini-powered GIF verifier.
 *
 * Samples N evenly-spaced frames from a GIF (via ffmpeg), sends them to
 * gemini-2.5-flash via the Gemini Developer API REST endpoint, and asks
 * for structured JSON describing what the demo shows + a pass/fail signal
 * against a stated expectation.
 *
 * Usage:
 *   node scripts/qa/verify_gif_with_gemini.mjs \
 *     --gif=public/demo/gifs/09-benchmarks-flywheel-desktop.gif \
 *     --expect="agentic flywheel dashboard with system score and per-layer cards" \
 *     [--frames=8] [--model=gemini-2.5-flash]
 *
 * Output: prints compact JSON summary to stdout. Writes the full Gemini
 *   response to public/demo/gemini-qa/<basename>.json so future runs (or a
 *   dashboard) can read it.
 *
 * Why frames instead of native video upload? We use REST to keep this
 * script dependency-free, the Gemini Files API requires an extra resumable
 * upload roundtrip, and 8 sampled frames keeps the inline payload <2MB —
 * well under the 20MB inline limit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const ENV_PATH = join(REPO, ".env.local");

function loadDotenv() {
  if (!existsSync(ENV_PATH)) return;
  const body = readFileSync(ENV_PATH, "utf-8");
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseArgs() {
  const out = { frames: 8, model: "gemini-2.5-flash" };
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (v == null) out[k] = true;
    else if (k === "frames") out[k] = Number.parseInt(v, 10) || 8;
    else out[k] = v;
  }
  return out;
}

function probeFrames(gifPath) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,r_frame_rate,duration", "-of", "json", gifPath],
    { encoding: "utf-8" }
  );
  if (probe.status !== 0) return { nbFrames: null, fps: null, duration: null };
  try {
    const j = JSON.parse(probe.stdout);
    const s = j.streams?.[0] ?? {};
    const fpsParts = (s.r_frame_rate ?? "0/1").split("/").map(Number);
    return {
      nbFrames: Number(s.nb_read_frames) || null,
      fps: fpsParts[1] ? fpsParts[0] / fpsParts[1] : null,
      duration: Number(s.duration) || null,
    };
  } catch {
    return { nbFrames: null, fps: null, duration: null };
  }
}

function sampleFrames(gifPath, count) {
  const meta = probeFrames(gifPath);
  const total = meta.nbFrames ?? 100;
  const stride = Math.max(1, Math.floor(total / count));
  const work = join(tmpdir(), `gemini-qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(work, { recursive: true });
  const selectExpr = `not(mod(n\\,${stride}))`;
  const out = join(work, "frame-%03d.jpg");
  const ff = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", gifPath, "-vf", `select=${selectExpr},scale=960:-1`, "-vsync", "vfr", "-q:v", "4", out],
    { encoding: "utf-8" }
  );
  if (ff.status !== 0) {
    throw new Error(`ffmpeg failed: ${ff.stderr || ff.stdout}`);
  }
  const list = [];
  for (let i = 1; i <= count; i++) {
    const p = join(work, `frame-${String(i).padStart(3, "0")}.jpg`);
    if (existsSync(p)) list.push(p);
  }
  return { frames: list, meta, workDir: work };
}

function inlinePart(path) {
  const buf = readFileSync(path);
  return {
    inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") },
  };
}

async function callGemini({ apiKey, model, parts, systemInstruction }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      response_mime_type: "application/json",
      temperature: 0,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 800)}`);
  }
  const j = await res.json();
  const cand = j.candidates?.[0];
  const textParts = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return { raw: textParts, usage: j.usageMetadata, finishReason: cand?.finishReason };
}

async function main() {
  loadDotenv();
  const args = parseArgs();
  const gifArg = args.gif;
  if (!gifArg) {
    console.error("Missing --gif=<path>");
    process.exit(2);
  }
  const expect = args.expect ?? "the recorded surface to render correctly with no broken UI, no error overlays, and the headline elements visible";
  const gifPath = resolve(REPO, gifArg);
  if (!existsSync(gifPath)) {
    console.error(`GIF not found: ${gifPath}`);
    process.exit(2);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY missing from environment / .env.local");
    process.exit(2);
  }

  const { frames, meta, workDir } = sampleFrames(gifPath, args.frames);
  if (frames.length === 0) {
    console.error("ffmpeg produced 0 frames");
    process.exit(2);
  }

  const systemInstruction = `You are a QA reviewer for animated UI demo recordings.
Each input is a sequence of evenly-spaced frames sampled from a GIF that captures a Playwright-driven walkthrough of a web product.
Your job: describe what the user sees across the frames, note whether the UI looks healthy, and judge whether the recording matches the stated expectation.
Be terse and concrete. Cite specific UI text you see. If something is broken (blank page, missing data, error overlay, blocked layout), call it out.`;

  const userText = `Expectation for this clip:
"""${expect}"""

Frames are in chronological order (1 = first, ${frames.length} = last). The GIF reports ${meta.nbFrames ?? "?"} total frames @ ~${meta.fps ? meta.fps.toFixed(1) : "?"}fps over ~${meta.duration ? meta.duration.toFixed(1) : "?"}s.

Return ONLY a JSON object with this shape:
{
  "scene_summary": "<2-4 sentence overview of what happens across the clip>",
  "key_observations": ["<bullet>", ...],
  "ui_text_snippets": ["<short literal UI strings you saw>", ...],
  "matches_expectation": true | false,
  "match_confidence": <0..1>,
  "issues": ["<broken / missing / suspicious thing>", ...],
  "verdict": "pass" | "warn" | "fail",
  "suggested_followups": ["<what to check or fix next>", ...]
}`;

  const parts = [{ text: userText }, ...frames.map(inlinePart)];

  let response;
  try {
    response = await callGemini({ apiKey, model: args.model, parts, systemInstruction });
  } catch (err) {
    console.error(String(err?.message ?? err));
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.raw);
  } catch {
    parsed = { _parseError: true, raw: response.raw };
  }

  const outDir = join(REPO, "public", "demo", "gemini-qa");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${basename(gifPath, extname(gifPath))}.json`);
  const record = {
    gif: gifArg,
    expect,
    model: args.model,
    framesSampled: frames.length,
    frameMeta: meta,
    capturedAt: new Date().toISOString(),
    usage: response.usage ?? null,
    finishReason: response.finishReason ?? null,
    response: parsed,
  };
  writeFileSync(outPath, JSON.stringify(record, null, 2));

  const v = parsed.verdict ?? (parsed._parseError ? "parse_error" : "?");
  console.log(JSON.stringify({
    gif: gifArg,
    verdict: v,
    matches: parsed.matches_expectation ?? null,
    confidence: parsed.match_confidence ?? null,
    issues: Array.isArray(parsed.issues) ? parsed.issues.length : 0,
    summary: parsed.scene_summary ?? null,
    ui_text: Array.isArray(parsed.ui_text_snippets) ? parsed.ui_text_snippets.slice(0, 8) : [],
    suggested_followups: parsed.suggested_followups ?? [],
    artifact: outPath,
  }, null, 2));

  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
