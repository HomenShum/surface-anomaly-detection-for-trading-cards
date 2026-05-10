"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { RipCard, RipPack } from "../../lib/rips/sample-packs";
import { pickRipCard } from "../../lib/rips/sample-packs";
import styles from "./RipsExperience.module.css";

type Phase = "idle" | "ready" | "dragging" | "tearing" | "revealed";
type RipDecision = "none" | "sell" | "ship" | "vault";

const PACK_WIDTH = 360;
const PACK_HEIGHT = 520;
const DEFAULT_TEAR_START = { x: PACK_WIDTH / 2, y: 34 };
const DEFAULT_TEAR_END = { x: PACK_WIDTH / 2, y: PACK_HEIGHT - 34 };

type Point = { x: number; y: number };

type TearGeometry = {
  start: Point;
  end: Point;
  handle: Point;
  dir: Point;
  normal: Point;
  angleDeg: number;
  sideA: Point[];
  sideB: Point[];
  seamPath: string;
  meshThreads: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    opacity: number;
    width: number;
  }>;
  crinklePaths: Array<{
    d: string;
    opacity: number;
    width: number;
  }>;
  foilShards: Array<{
    points: string;
    opacity: number;
    delay: number;
    hue: number;
  }>;
  fibers: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    start: number;
    rotate: number;
    width: number;
  }>;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function seedNumber(seed: string) {
  let out = 0;
  for (let i = 0; i < seed.length; i += 1) out = (out * 31 + seed.charCodeAt(i)) >>> 0;
  return out || 1;
}

function seededWave(seed: number, i: number) {
  const raw = Math.sin((seed + i * 73.19) * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizeVector(a: Point, b: Point): Point {
  const len = distance(a, b);
  if (len < 0.001) return { x: 0, y: 1 };
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

function cross(dir: Point, point: Point, origin: Point) {
  return dir.x * (point.y - origin.y) - dir.y * (point.x - origin.x);
}

function polygonCss(points: Point[]) {
  if (points.length < 3) return "polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%)";
  return `polygon(${points.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(", ")})`;
}

function lineRectIntersections(origin: Point, dir: Point): Point[] {
  const hits: Array<Point & { t: number }> = [];
  const addHit = (t: number) => {
    const point = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, t };
    if (
      point.x >= -0.5 &&
      point.x <= PACK_WIDTH + 0.5 &&
      point.y >= -0.5 &&
      point.y <= PACK_HEIGHT + 0.5 &&
      hits.every((hit) => Math.abs(hit.x - point.x) > 0.5 || Math.abs(hit.y - point.y) > 0.5)
    ) {
      hits.push(point);
    }
  };
  if (Math.abs(dir.x) > 0.001) {
    addHit((0 - origin.x) / dir.x);
    addHit((PACK_WIDTH - origin.x) / dir.x);
  }
  if (Math.abs(dir.y) > 0.001) {
    addHit((0 - origin.y) / dir.y);
    addHit((PACK_HEIGHT - origin.y) / dir.y);
  }
  hits.sort((a, b) => a.t - b.t);
  if (hits.length >= 2) return [hits[0], hits[hits.length - 1]];
  return [
    { x: PACK_WIDTH / 2, y: 0 },
    { x: PACK_WIDTH / 2, y: PACK_HEIGHT },
  ];
}

function clipPolygon(points: Point[], origin: Point, dir: Point, keepPositive: boolean) {
  const output: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentValue = cross(dir, current, origin);
    const previousValue = cross(dir, previous, origin);
    const currentInside = keepPositive ? currentValue >= -0.01 : currentValue <= 0.01;
    const previousInside = keepPositive ? previousValue >= -0.01 : previousValue <= 0.01;
    if (currentInside !== previousInside) {
      const denom = previousValue - currentValue;
      const t = Math.abs(denom) < 0.001 ? 0 : previousValue / denom;
      output.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
      });
    }
    if (currentInside) output.push(current);
  }
  return output;
}

function makeJitteredPath(points: Point[]) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function makeTearGeometry(seedText: string, start: Point, current: Point, progress: number): TearGeometry {
  const seed = seedNumber(seedText);
  const dir = normalizeVector(start, current);
  const normal = { x: -dir.y, y: dir.x };
  const [lineStart, lineEnd] = lineRectIntersections(start, dir);
  const pathPoints = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    const wobble = (seededWave(seed, i + 5) - 0.5) * (12 + progress * 26);
    const stress = Math.sin(i * 1.7 + seed * 0.01) * (2 + progress * 8);
    return {
      x: lineStart.x + (lineEnd.x - lineStart.x) * t + normal.x * (wobble + stress),
      y: lineStart.y + (lineEnd.y - lineStart.y) * t + normal.y * (wobble + stress),
    };
  });
  const rect = [
    { x: 0, y: 0 },
    { x: PACK_WIDTH, y: 0 },
    { x: PACK_WIDTH, y: PACK_HEIGHT },
    { x: 0, y: PACK_HEIGHT },
  ];
  const maxReach = Math.max(distance(start, lineStart), distance(start, lineEnd));
  const pull = Math.min(maxReach, Math.max(distance(start, current), maxReach * progress * 0.9));
  const handle = {
    x: clamp(start.x + dir.x * pull, 0, PACK_WIDTH),
    y: clamp(start.y + dir.y * pull, 0, PACK_HEIGHT),
  };
  const fibers = Array.from({ length: 34 }, (_, i) => {
    const t = i / 33;
    const x = lineStart.x + (lineEnd.x - lineStart.x) * t;
    const y = lineStart.y + (lineEnd.y - lineStart.y) * t;
    const side = i % 2 === 0 ? -1 : 1;
    const travel = 24 + seededWave(seed, i + 71) * 92;
    return {
      x,
      y,
      dx: normal.x * travel * side + dir.x * (seededWave(seed, i + 101) - 0.5) * 28,
      dy: normal.y * travel * side + dir.y * (seededWave(seed, i + 131) - 0.5) * 28,
      start: Math.max(0.04, t - 0.18),
      rotate: (seededWave(seed, i + 161) - 0.5) * 160,
      width: 10 + seededWave(seed, i + 191) * 24 + progress * 18,
    };
  });
  const meshThreads = Array.from({ length: 118 }, (_, i) => {
    const t = i / 117;
    const base = {
      x: lineStart.x + (lineEnd.x - lineStart.x) * t,
      y: lineStart.y + (lineEnd.y - lineStart.y) * t,
    };
    const lateral = (seededWave(seed, i + 211) - 0.5) * (70 + progress * 120);
    const bias = i % 4 < 2 ? normal : dir;
    const crossBias = i % 4 < 2 ? dir : normal;
    const len = 12 + seededWave(seed, i + 241) * 54 + progress * 46;
    const center = {
      x: base.x + normal.x * lateral + dir.x * (seededWave(seed, i + 271) - 0.5) * 38,
      y: base.y + normal.y * lateral + dir.y * (seededWave(seed, i + 271) - 0.5) * 38,
    };
    const slant = {
      x: bias.x * 0.72 + crossBias.x * (i % 2 === 0 ? 0.54 : -0.54),
      y: bias.y * 0.72 + crossBias.y * (i % 2 === 0 ? 0.54 : -0.54),
    };
    return {
      x1: center.x - slant.x * len,
      y1: center.y - slant.y * len,
      x2: center.x + slant.x * len,
      y2: center.y + slant.y * len,
      opacity: 0.1 + seededWave(seed, i + 301) * 0.28 + progress * 0.32,
      width: 0.35 + seededWave(seed, i + 331) * 1.4,
    };
  });
  const crinklePaths = Array.from({ length: 28 }, (_, i) => {
    const t = i / 27;
    const base = {
      x: lineStart.x + (lineEnd.x - lineStart.x) * t,
      y: lineStart.y + (lineEnd.y - lineStart.y) * t,
    };
    const side = i % 2 === 0 ? -1 : 1;
    const reach = 38 + seededWave(seed, i + 361) * 128 + progress * 60;
    const bend = (seededWave(seed, i + 391) - 0.5) * 46;
    const p1 = {
      x: base.x + normal.x * side * reach * 0.32 + dir.x * bend * 0.2,
      y: base.y + normal.y * side * reach * 0.32 + dir.y * bend * 0.2,
    };
    const p2 = {
      x: base.x + normal.x * side * reach * 0.76 + dir.x * bend,
      y: base.y + normal.y * side * reach * 0.76 + dir.y * bend,
    };
    const p3 = {
      x: base.x + normal.x * side * reach + dir.x * bend * 1.35,
      y: base.y + normal.y * side * reach + dir.y * bend * 1.35,
    };
    return {
      d: `M ${base.x.toFixed(1)} ${base.y.toFixed(1)} C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}, ${p3.x.toFixed(1)} ${p3.y.toFixed(1)}`,
      opacity: 0.1 + seededWave(seed, i + 421) * 0.3 + progress * 0.26,
      width: 0.65 + seededWave(seed, i + 451) * 1.6,
    };
  });
  const foilShards = Array.from({ length: 54 }, (_, i) => {
    const t = i / 53;
    const base = {
      x: lineStart.x + (lineEnd.x - lineStart.x) * t,
      y: lineStart.y + (lineEnd.y - lineStart.y) * t,
    };
    const side = i % 2 === 0 ? -1 : 1;
    const offset = 7 + seededWave(seed, i + 481) * (18 + progress * 24);
    const length = 8 + seededWave(seed, i + 511) * (18 + progress * 22);
    const width = 3 + seededWave(seed, i + 541) * (8 + progress * 7);
    const center = {
      x: base.x + normal.x * side * offset + dir.x * (seededWave(seed, i + 571) - 0.5) * 20,
      y: base.y + normal.y * side * offset + dir.y * (seededWave(seed, i + 571) - 0.5) * 20,
    };
    const tip = {
      x: center.x + normal.x * side * length + dir.x * (seededWave(seed, i + 601) - 0.5) * 16,
      y: center.y + normal.y * side * length + dir.y * (seededWave(seed, i + 601) - 0.5) * 16,
    };
    const p1 = {
      x: center.x + dir.x * width,
      y: center.y + dir.y * width,
    };
    const p2 = {
      x: center.x - dir.x * width,
      y: center.y - dir.y * width,
    };
    return {
      points: `${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`,
      opacity: 0.16 + seededWave(seed, i + 631) * 0.42 + progress * 0.24,
      delay: t,
      hue: Math.round(seededWave(seed, i + 661) * 38),
    };
  });

  return {
    start,
    end: current,
    handle,
    dir,
    normal,
    angleDeg: Math.atan2(dir.y, dir.x) * (180 / Math.PI),
    sideA: clipPolygon(rect, start, dir, true),
    sideB: clipPolygon(rect, start, dir, false),
    seamPath: makeJitteredPath(pathPoints),
    meshThreads,
    crinklePaths,
    foilShards,
    fibers,
  };
}

function pointFromPointer(event: PointerEvent<HTMLDivElement>, rect: DOMRect): Point {
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1) * PACK_WIDTH,
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1) * PACK_HEIGHT,
  };
}

function rarityTone(rarity: RipCard["rarity"]) {
  if (rarity === "chase") return styles.rarityChase;
  if (rarity === "ultra") return styles.rarityUltra;
  if (rarity === "rare") return styles.rarityRare;
  return styles.rarityBase;
}

function makeEvent(label: string) {
  return `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} | ${label}`;
}

function RipCardArt({ card }: { card: RipCard }) {
  const style = { "--rip-accent": card.accent } as CSSProperties;
  return (
    <article className={`${styles.cardArt} ${styles[`foil-${card.foil}`]}`} style={style}>
      <div className={styles.cardArtTop}>
        <span>{card.setName}</span>
        <strong>{card.number}</strong>
      </div>
      <div className={styles.cardCreature} aria-hidden>
        <span />
        <i />
      </div>
      <div className={styles.cardArtText}>
        <p>{card.name}</p>
        <small>{card.gradeSignal}</small>
      </div>
    </article>
  );
}

function RipPackVisual({
  pack,
  phase,
  progress,
  result,
  tear,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  pack: RipPack;
  phase: Phase;
  progress: number;
  result: RipCard | null;
  tear: TearGeometry;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const packetStyle = { "--rip-accent": pack.accent } as CSSProperties;
  const sideAStyle: CSSProperties = {
    clipPath: polygonCss(tear.sideA),
    transform: `translate3d(${tear.normal.x * -112 * progress + tear.dir.x * 16 * progress}px, ${tear.normal.y * -112 * progress + tear.dir.y * 16 * progress}px, 0) rotate(${(-7 - tear.angleDeg * 0.018) * progress}deg)`,
    transformOrigin: `${(tear.start.x / PACK_WIDTH) * 100}% ${(tear.start.y / PACK_HEIGHT) * 100}%`,
  };
  const sideBStyle: CSSProperties = {
    clipPath: polygonCss(tear.sideB),
    transform: `translate3d(${tear.normal.x * 112 * progress + tear.dir.x * 16 * progress}px, ${tear.normal.y * 112 * progress + tear.dir.y * 16 * progress}px, 0) rotate(${(7 + tear.angleDeg * 0.018) * progress}deg)`,
    transformOrigin: `${(tear.start.x / PACK_WIDTH) * 100}% ${(tear.start.y / PACK_HEIGHT) * 100}%`,
  };
  const cardStyle: CSSProperties = {
    opacity: clamp((progress - 0.12) / 0.68),
    transform: `translate3d(0, ${(1 - progress) * 24}px, 0) scale(${0.9 + 0.1 * progress})`,
  };
  const tensionStyle = {
    opacity: clamp(progress / 0.35),
    transform: `translate(${tear.start.x}px, ${tear.start.y}px) rotate(${tear.angleDeg}deg) scaleX(${0.15 + progress * 1.2})`,
  } as CSSProperties;

  return (
    <div className={styles.visualFrame} style={packetStyle}>
      <div
        aria-label="Press anywhere on the wrapper and pull in any direction to rip the pack open"
        className={`${styles.packStage} ${phase === "revealed" ? styles.isRevealed : ""}`}
        data-testid="rip-pack-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        role="application"
        tabIndex={0}
      >
        {result ? (
          <div className={styles.hiddenCard} style={cardStyle}>
            <RipCardArt card={result} />
          </div>
        ) : (
          <div className={styles.hiddenCardPlaceholder} style={cardStyle}>
            <span>Card sealed inside</span>
          </div>
        )}

        <div className={`${styles.packHalf} ${styles.packHalfLeft}`} style={sideAStyle}>
          <PackFace pack={pack} side="left" progress={progress} />
        </div>
        <div className={`${styles.packHalf} ${styles.packHalfRight}`} style={sideBStyle}>
          <PackFace pack={pack} side="right" progress={progress} />
        </div>

        <svg className={styles.seamSvg} viewBox={`0 0 ${PACK_WIDTH} ${PACK_HEIGHT}`} aria-hidden>
          <g className={styles.crinkleGroup} opacity={clamp(progress / 0.18)}>
            {tear.foilShards.map((shard, i) => {
              const shardProgress = clamp((progress - shard.delay * 0.22) / 0.45);
              return (
                <polygon
                  className={styles.foilShard}
                  key={`foil-shard-${i}`}
                  points={shard.points}
                  style={{
                    opacity: shard.opacity * shardProgress,
                    transform: `scale(${0.72 + shardProgress * 0.28})`,
                    transformOrigin: `${tear.start.x}px ${tear.start.y}px`,
                    fill: `color-mix(in srgb, var(--rip-accent) ${44 + shard.hue}%, white)`,
                  }}
                />
              );
            })}
            {tear.crinklePaths.map((crinkle, i) => (
              <path
                className={styles.crinklePath}
                d={crinkle.d}
                key={`crinkle-${i}`}
                style={{ opacity: crinkle.opacity, strokeWidth: crinkle.width }}
              />
            ))}
            {tear.meshThreads.map((thread, i) => (
              <line
                className={styles.meshThread}
                key={`thread-${i}`}
                style={{ opacity: thread.opacity, strokeWidth: thread.width }}
                x1={thread.x1}
                x2={thread.x2}
                y1={thread.y1}
                y2={thread.y2}
              />
            ))}
          </g>
          <path
            className={styles.seamShadow}
            d={tear.seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
          <path
            className={styles.seamVoid}
            d={tear.seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
          <path
            className={styles.seamFray}
            d={tear.seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
          <path
            className={styles.seamFiber}
            d={tear.seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
        </svg>

        <span className={styles.plasticTension} aria-hidden style={tensionStyle} />

        <div
          className={styles.seamHandle}
          data-testid="rip-seam-handle"
          style={{
            left: tear.handle.x,
            top: tear.handle.y,
            transform: `translate3d(-50%, -50%, 0) rotate(${tear.angleDeg}deg)`,
          }}
        >
          <span>pull</span>
        </div>

        {tear.fibers.map((particle, i) => {
          const local = clamp((progress - particle.start) / 0.26);
          return (
            <span
              aria-hidden
              className={styles.fiberParticle}
              key={`${particle.x}-${i}`}
              style={{
                left: particle.x,
                opacity: local,
                top: particle.y,
                width: particle.width * (0.55 + local),
                transform: `translate3d(${particle.dx * local}px, ${particle.dy * local}px, 0) rotate(${particle.rotate * local}deg) scale(${0.45 + local})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PackFace({ pack, side, progress }: { pack: RipPack; side: "left" | "right"; progress: number }) {
  return (
    <div className={styles.packFace} style={{ "--rip-stress": progress } as CSSProperties}>
      <div className={styles.packChrome} />
      <div className={styles.packMesh} aria-hidden />
      <div className={styles.packSpecular} aria-hidden />
      <div className={styles.packBrand}>
        <span>{pack.series}</span>
        <strong>{side === "left" ? "RIP" : "VAULT"}</strong>
      </div>
      <div className={styles.packCreature} aria-hidden>
        <i />
      </div>
      <div className={styles.packFooter}>
        <span>{pack.title}</span>
        <small>Original web demo</small>
      </div>
    </div>
  );
}

export function RipsExperience({ packs }: { packs: RipPack[] }) {
  const [selectedPackId, setSelectedPackId] = useState(packs[0]?.id ?? "");
  const selectedPack = packs.find((pack) => pack.id === selectedPackId) ?? packs[0];
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [tear, setTear] = useState<TearGeometry>(() =>
    makeTearGeometry(packs[0]?.id ?? "default", DEFAULT_TEAR_START, DEFAULT_TEAR_END, 0),
  );
  const [result, setResult] = useState<RipCard | null>(null);
  const [decision, setDecision] = useState<RipDecision>("none");
  const [credits, setCredits] = useState(184);
  const [events, setEvents] = useState<string[]>([
    "Ready | choose a pack, open it, then save the reveal to the vault",
  ]);
  const dragRectRef = useRef<DOMRect | null>(null);
  const draggingRef = useRef(false);
  const progressRef = useRef(0);
  const tearStartRef = useRef<Point>(DEFAULT_TEAR_START);
  const tearCurrentRef = useRef<Point>(DEFAULT_TEAR_END);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const appendEvent = useCallback((label: string) => {
    setEvents((current) => [makeEvent(label), ...current].slice(0, 8));
  }, []);

  const setRipProgress = useCallback((next: number) => {
    const clamped = clamp(next);
    progressRef.current = clamped;
    setProgress(clamped);
  }, []);

  const setTearProgress = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setRipProgress(clamped);
      setTear(makeTearGeometry(selectedPack.id, tearStartRef.current, tearCurrentRef.current, clamped));
    },
    [selectedPack.id, setRipProgress],
  );

  const setTearVector = useCallback(
    (start: Point, current: Point, nextProgress: number) => {
      tearStartRef.current = start;
      tearCurrentRef.current = current;
      setTearProgress(nextProgress);
    },
    [setTearProgress],
  );

  const resetForPack = useCallback(
    (pack: RipPack) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      draggingRef.current = false;
      dragRectRef.current = null;
      tearStartRef.current = DEFAULT_TEAR_START;
      tearCurrentRef.current = DEFAULT_TEAR_END;
      setSelectedPackId(pack.id);
      setPhase("idle");
      setRipProgress(0);
      setTear(makeTearGeometry(pack.id, DEFAULT_TEAR_START, DEFAULT_TEAR_END, 0));
      setResult(null);
      setDecision("none");
      setEvents([makeEvent(`Selected ${pack.title}`), "Ready | press anywhere on the wrapper and pull any direction"]);
    },
    [setRipProgress],
  );

  const commitPack = useCallback(() => {
    if (!selectedPack) return null;
    const nonce = Date.now() + selectedPack.id.length + Math.round(credits);
    const nextCard = pickRipCard(selectedPack, nonce);
    setResult(nextCard);
    setDecision("none");
    setTearProgress(0);
    setCredits((value) => value - selectedPack.priceUsd);
    appendEvent(`Pack committed | ${selectedPack.title} | ${money(selectedPack.priceUsd)}`);
    return nextCard;
  }, [appendEvent, credits, selectedPack, setTearProgress]);

  const openPack = useCallback(() => {
    const nextCard = commitPack();
    if (!nextCard) return;
    setPhase("ready");
  }, [commitPack]);

  const completeReveal = useCallback(() => {
    setTearProgress(1);
    setPhase("revealed");
    appendEvent("Reveal complete | card added to temporary rip record");
  }, [appendEvent, setTearProgress]);

  const animateProgress = useCallback(
    (target: number, durationMs: number) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const start = performance.now();
      const initial = progressRef.current;
      setPhase(target >= 1 ? "tearing" : "ready");
      const tick = (now: number) => {
        const t = clamp((now - start) / durationMs);
        const eased = easeOutCubic(t);
        const next = initial + (target - initial) * eased;
        setTearProgress(next);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        rafRef.current = null;
        if (target >= 1) completeReveal();
        else setPhase("ready");
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [completeReveal, setTearProgress],
  );

  const autoRip = useCallback(() => {
    if (phase === "idle" || phase === "revealed") {
      const nextCard = commitPack();
      if (!nextCard) return;
    }
    appendEvent("Auto rip started | synthetic foil tear path");
    animateProgress(1, 860);
  }, [animateProgress, appendEvent, commitPack, phase]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (phase === "revealed") return;
      if (phase === "idle") {
        const nextCard = commitPack();
        if (!nextCard) return;
        appendEvent("Manual rip started | drag gesture committed pack");
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      dragRectRef.current = event.currentTarget.getBoundingClientRect();
      setPhase("dragging");
      const rect = dragRectRef.current;
      const point = pointFromPointer(event, rect);
      const fallbackCurrent = {
        x: clamp(point.x + 2, 0, PACK_WIDTH),
        y: clamp(point.y + 2, 0, PACK_HEIGHT),
      };
      setTearVector(point, fallbackCurrent, 0.02);
    },
    [appendEvent, commitPack, phase, setTearVector],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      const rect = dragRectRef.current;
      if (!rect) return;
      const current = pointFromPointer(event, rect);
      const nextProgress = clamp(distance(tearStartRef.current, current) / 170);
      setTearVector(tearStartRef.current, current, nextProgress);
    },
    [setTearVector],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      draggingRef.current = false;
      dragRectRef.current = null;
      if (progressRef.current >= 0.68) {
        appendEvent("Manual rip threshold reached");
        animateProgress(1, 420);
        return;
      }
      appendEvent("Seal snapped back | keep dragging down the seam");
      animateProgress(0, 300);
    },
    [animateProgress, appendEvent],
  );

  const completeKeyboardRip = useCallback(() => {
    if (phase === "idle" || phase === "revealed") {
      const nextCard = commitPack();
      if (!nextCard) return;
    }
    tearStartRef.current = DEFAULT_TEAR_START;
    tearCurrentRef.current = DEFAULT_TEAR_END;
    setTearProgress(0.72);
    appendEvent("Keyboard/manual rip threshold reached");
    animateProgress(1, 420);
  }, [animateProgress, appendEvent, commitPack, phase, setTearProgress]);

  const onPointerStageKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      completeKeyboardRip();
    },
    [completeKeyboardRip],
  );

  const saveDecision = useCallback(
    (next: RipDecision) => {
      setDecision(next);
      if (next === "sell" && result) setCredits((value) => value + result.estimateUsd);
      appendEvent(
        next === "sell"
          ? "Sold to vault credit | proof note saved"
          : next === "ship"
            ? "Ship request staged | physical fulfillment mock"
            : "Held in vault | reveal record saved",
      );
    },
    [appendEvent, result],
  );

  const resultTitle = result ? `${result.name} | ${result.setName} ${result.number}` : "No card revealed yet";

  return (
    <section className={styles.shell} aria-label="Rips web prototype">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Web rips lab | private vendor prototype</p>
          <h1>Rip a sealed pack on web. Reveal, decide, save proof.</h1>
          <p>
            This is the interaction layer Triumph-style rip apps need on web: physical pack opening,
            instant reveal state, account-backed inventory, fulfillment actions, and an auditable trail.
            It uses original placeholder cards and pack art. Press anywhere on the wrapper and pull
            in any direction to tear the plastic along that angle.
          </p>
          <div className={styles.heroActions}>
            <button onClick={autoRip} type="button">Open and auto rip</button>
            <Link href="/dealer">Back to card vault</Link>
            <Link href="/examples">See condition examples</Link>
          </div>
        </div>
        <aside className={styles.heroPanel} aria-label="Session state">
          <span>Vault credit</span>
          <strong>{money(credits)}</strong>
          <small>Demo balance. No real-money purchase, payout, or gambling flow is implemented here.</small>
        </aside>
      </header>

      <div className={styles.grid}>
        <aside className={styles.packRail} aria-label="Available packs">
          <div className={styles.panelHeader}>
            <p className={styles.kicker}>Packs</p>
            <h2>Choose a drop</h2>
          </div>
          <div className={styles.packList}>
            {packs.map((pack) => (
              <button
                className={`${styles.packOption} ${pack.id === selectedPack.id ? styles.isSelected : ""}`}
                key={pack.id}
                onClick={() => resetForPack(pack)}
                style={{ "--rip-accent": pack.accent } as CSSProperties}
                type="button"
              >
                <span>
                  <strong>{pack.title}</strong>
                  <small>{pack.series}</small>
                </span>
                <em>{money(pack.priceUsd)}</em>
              </button>
            ))}
          </div>
          <div className={styles.oddsBox}>
            <strong>Transparent odds</strong>
            <dl>
              {selectedPack.odds.map((odd) => (
                <div key={odd.label}>
                  <dt>{odd.label}</dt>
                  <dd>{odd.value}</dd>
                </div>
              ))}
            </dl>
            <p>Chase: {selectedPack.chase}. Odds are static demo copy, not a live prize engine.</p>
          </div>
        </aside>

        <div className={styles.workSurface}>
          <div className={styles.workHeader}>
            <div>
              <p className={styles.kicker}>Active rip</p>
              <h2>{selectedPack.title}</h2>
            </div>
            <div className={styles.phasePill}>{phase === "idle" ? "sealed" : phase}</div>
          </div>

          <div>
            <RipPackVisual
              pack={selectedPack}
              phase={phase}
              progress={progress}
              result={result}
              tear={tear}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={onPointerStageKeyDown}
            />
          </div>

          <div className={styles.controlRow}>
            <button onClick={phase === "idle" || phase === "revealed" ? openPack : autoRip} type="button">
              {phase === "idle" ? "Open pack" : phase === "revealed" ? "Open another pack" : "Auto rip"}
            </button>
            <button onClick={() => resetForPack(selectedPack)} type="button">Reset seal</button>
          </div>
        </div>

        <aside className={styles.resultPanel} aria-label="Reveal result">
          <div className={styles.panelHeader}>
            <p className={styles.kicker}>Reveal</p>
            <h2>{resultTitle}</h2>
          </div>

          {result ? (
            <div className={styles.resultStack}>
              <span className={`${styles.rarity} ${rarityTone(result.rarity)}`}>{result.rarity}</span>
              <div className={styles.resultCardMini}>
                <RipCardArt card={result} />
              </div>
              <dl className={styles.resultStats}>
                <div>
                  <dt>Estimated value</dt>
                  <dd>{money(result.estimateUsd)}</dd>
                </div>
                <div>
                  <dt>Condition signal</dt>
                  <dd>{result.gradeSignal}</dd>
                </div>
                <div>
                  <dt>Proof state</dt>
                  <dd>{phase === "revealed" ? "ready to save" : "sealed"}</dd>
                </div>
              </dl>
              <div className={styles.decisionButtons}>
                <button disabled={phase !== "revealed" || decision !== "none"} onClick={() => saveDecision("sell")} type="button">
                  Sell for vault credit
                </button>
                <button disabled={phase !== "revealed" || decision !== "none"} onClick={() => saveDecision("ship")} type="button">
                  Ship physical card
                </button>
                <button disabled={phase !== "revealed" || decision !== "none"} onClick={() => saveDecision("vault")} type="button">
                  Hold in vault
                </button>
              </div>
              {decision !== "none" ? (
                <p className={styles.decisionNote}>Decision saved: {decision.replace("_", " ")}.</p>
              ) : null}
            </div>
          ) : (
            <p className={styles.emptyResult}>
              The reveal panel stays quiet until the seal opens. After reveal it becomes the durable
              account record: value, rarity, fulfillment state, and proof log.
            </p>
          )}
        </aside>
      </div>

      <section className={styles.proofStrip} aria-label="Rip proof trail">
        <div>
          <p className={styles.kicker}>Proof trail</p>
          <h2>Every visible animation maps to a product event.</h2>
          <p>
            In a production build, this same event stream connects to payment authorization,
            randomization audit, card assignment, fulfillment, and vault storage. For this repo,
            it is a safe interaction prototype with original assets.
          </p>
        </div>
        <ol className={styles.eventLog}>
          {events.map((event) => (
            <li key={event}>{event}</li>
          ))}
        </ol>
      </section>
    </section>
  );
}
