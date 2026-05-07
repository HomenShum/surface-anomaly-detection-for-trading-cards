import React from "react";
import { AbsoluteFill, Composition, interpolate, Sequence, useCurrentFrame } from "remotion";

const metrics = {
  model: "ding-detector-v0",
  base: "YOLOv8n fine-tune",
  run: "yolo-20260506T124111Z",
  labels: "7 DING labels",
  dataset: "3,349 Roboflow images",
  map50: "0.464 mAP50",
  recall: "0.449 recall",
};

function SceneCard({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  const frame = useCurrentFrame();
  const y = interpolate(frame % 90, [0, 20], [18, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(frame % 90, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ opacity, transform: `translateY(${y}px)`, display: "grid", gap: 18 }}>
      <div style={{ color: "#2563eb", fontSize: 22, fontWeight: 900, textTransform: "uppercase" }}>{kicker}</div>
      <div style={{ color: "#101418", fontSize: 72, fontWeight: 900, lineHeight: 0.95, maxWidth: 960 }}>{title}</div>
      <div style={{ color: "#4b5563", fontSize: 32, lineHeight: 1.35, maxWidth: 1040 }}>{body}</div>
    </div>
  );
}

function Showcase() {
  return (
    <AbsoluteFill style={{ background: "#f6f7f8", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ padding: 72, display: "grid", gap: 36 }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#4b5563", fontSize: 20, fontWeight: 800 }}>
          <span>Card Condition Vault</span>
          <span>Real-model agent workspace</span>
        </div>
        <Sequence from={0} durationInFrames={120}>
          <SceneCard
            kicker="What done looks like"
            title="Upload in chat. Analyze with our checkpoint. Save evidence."
            body="The workspace now supports agent-sidebar upload, real-model inference, normalized report data, DING overlay, evidence hashes, and Convex persistence."
          />
        </Sequence>
        <Sequence from={120} durationInFrames={120}>
          <SceneCard
            kicker="Verified model proof"
            title={`${metrics.model} - ${metrics.base}`}
            body={`${metrics.dataset}; ${metrics.labels}; run ${metrics.run}; ${metrics.map50}; ${metrics.recall}. This is alpha DING detection, not grading.`}
          />
        </Sequence>
        <Sequence from={240} durationInFrames={120}>
          <SceneCard
            kicker="Showcase packet"
            title="Easier-to-read submission docs plus Remotion render"
            body="The repo emits a QA dogfood packet, storyboard JSON, and launch demo video. The public demo is live through Vercel with tunnel-backed inference for controlled alpha."
          />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
}

export function RemotionRoot() {
  return (
    <Composition
      id="CardConditionVault"
      component={Showcase}
      durationInFrames={360}
      fps={30}
      width={1280}
      height={720}
    />
  );
}
