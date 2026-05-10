"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { RipCard, RipPack } from "../../lib/rips/sample-packs";
import { pickRipCard } from "../../lib/rips/sample-packs";
import styles from "./RipsExperience.module.css";

type Phase = "idle" | "ready" | "dragging" | "tearing" | "revealed";
type RipDecision = "none" | "sell" | "ship" | "vault";

const PACK_WIDTH = 360;
const PACK_HEIGHT = 520;

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

function makeTearPoints(seedText: string) {
  const seed = seedNumber(seedText);
  return Array.from({ length: 19 }, (_, i) => {
    const t = i / 18;
    const wobble = (seededWave(seed, i) - 0.5) * 42;
    const micro = Math.sin(i * 1.7 + seed * 0.01) * 10;
    return {
      x: PACK_WIDTH / 2 + wobble + micro,
      y: t * PACK_HEIGHT,
    };
  });
}

function makeTearPath(points: Array<{ x: number; y: number }>) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
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
  onPointerDown,
}: {
  pack: RipPack;
  phase: Phase;
  progress: number;
  result: RipCard | null;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const tearPoints = useMemo(() => makeTearPoints(pack.id), [pack.id]);
  const revealedY = PACK_HEIGHT * progress + 16;
  const clipPoints = tearPoints.map((point) =>
    point.y <= revealedY ? point : { x: PACK_WIDTH / 2, y: point.y },
  );
  const seamPath = makeTearPath(tearPoints);
  const leftClip = `polygon(0px 0px, ${clipPoints
    .map((point) => `${point.x.toFixed(1)}px ${point.y.toFixed(1)}px`)
    .join(", ")}, 0px ${PACK_HEIGHT}px)`;
  const rightClip = `polygon(${PACK_WIDTH}px 0px, ${PACK_WIDTH}px ${PACK_HEIGHT}px, ${[...clipPoints]
    .reverse()
    .map((point) => `${point.x.toFixed(1)}px ${point.y.toFixed(1)}px`)
    .join(", ")})`;
  const packetStyle = { "--rip-accent": pack.accent } as CSSProperties;
  const leftStyle: CSSProperties = {
    clipPath: leftClip,
    transform: `translate3d(${-126 * progress}px, ${10 * progress}px, 0) rotate(${-8 * progress}deg)`,
  };
  const rightStyle: CSSProperties = {
    clipPath: rightClip,
    transform: `translate3d(${126 * progress}px, ${10 * progress}px, 0) rotate(${8 * progress}deg)`,
  };
  const cardStyle: CSSProperties = {
    opacity: clamp((progress - 0.12) / 0.68),
    transform: `translate3d(0, ${(1 - progress) * 24}px, 0) scale(${0.9 + 0.1 * progress})`,
  };
  const particles = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const t = i / 25;
        return {
          x: PACK_WIDTH / 2 + (seededWave(seedNumber(pack.id), i + 31) - 0.5) * 48,
          y: 32 + t * (PACK_HEIGHT - 64),
          dx: (i % 2 === 0 ? -1 : 1) * (28 + seededWave(seedNumber(pack.id), i + 61) * 70),
          dy: -18 + seededWave(seedNumber(pack.id), i + 91) * 76,
          start: Math.max(0.08, t - 0.12),
        };
      }),
    [pack.id],
  );

  return (
    <div className={styles.visualFrame} style={packetStyle}>
      <div
        aria-label="Drag down the center seam to rip the pack open"
        className={`${styles.packStage} ${phase === "revealed" ? styles.isRevealed : ""}`}
        onPointerDown={onPointerDown}
        role="application"
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

        <div className={`${styles.packHalf} ${styles.packHalfLeft}`} style={leftStyle}>
          <PackFace pack={pack} side="left" />
        </div>
        <div className={`${styles.packHalf} ${styles.packHalfRight}`} style={rightStyle}>
          <PackFace pack={pack} side="right" />
        </div>

        <svg className={styles.seamSvg} viewBox={`0 0 ${PACK_WIDTH} ${PACK_HEIGHT}`} aria-hidden>
          <path
            className={styles.seamShadow}
            d={seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
          <path
            className={styles.seamFiber}
            d={seamPath}
            pathLength={1}
            style={{ strokeDashoffset: 1 - progress }}
          />
        </svg>

        <div
          className={styles.seamHandle}
          style={{ transform: `translate3d(-50%, ${progress * (PACK_HEIGHT - 70)}px, 0)` }}
        >
          <span>drag</span>
        </div>

        {particles.map((particle, i) => {
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
                transform: `translate3d(${particle.dx * local}px, ${particle.dy * local}px, 0) rotate(${i * 19 * local}deg) scale(${0.5 + local})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PackFace({ pack, side }: { pack: RipPack; side: "left" | "right" }) {
  return (
    <div className={styles.packFace}>
      <div className={styles.packChrome} />
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
  const [result, setResult] = useState<RipCard | null>(null);
  const [decision, setDecision] = useState<RipDecision>("none");
  const [credits, setCredits] = useState(184);
  const [events, setEvents] = useState<string[]>([
    "Ready | choose a pack, open it, then save the reveal to the vault",
  ]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const appendEvent = useCallback((label: string) => {
    setEvents((current) => [makeEvent(label), ...current].slice(0, 8));
  }, []);

  const resetForPack = useCallback(
    (pack: RipPack) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      setSelectedPackId(pack.id);
      setPhase("idle");
      setProgress(0);
      setResult(null);
      setDecision("none");
      setEvents([makeEvent(`Selected ${pack.title}`), "Ready | drag the seam or use Auto rip"]);
    },
    [],
  );

  const openPack = useCallback(() => {
    if (!selectedPack) return;
    const nonce = Date.now() + selectedPack.id.length + Math.round(credits);
    const nextCard = pickRipCard(selectedPack, nonce);
    setResult(nextCard);
    setDecision("none");
    setPhase("ready");
    setProgress(0);
    setCredits((value) => value - selectedPack.priceUsd);
    appendEvent(`Pack committed | ${selectedPack.title} | ${money(selectedPack.priceUsd)}`);
  }, [appendEvent, credits, selectedPack]);

  const completeReveal = useCallback(() => {
    setProgress(1);
    setPhase("revealed");
    appendEvent("Reveal complete | card added to temporary rip record");
  }, [appendEvent]);

  const animateProgress = useCallback(
    (target: number, durationMs: number) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const start = performance.now();
      const initial = progress;
      setPhase(target >= 1 ? "tearing" : "ready");
      const tick = (now: number) => {
        const t = clamp((now - start) / durationMs);
        const eased = easeOutCubic(t);
        const next = initial + (target - initial) * eased;
        setProgress(next);
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
    [completeReveal, progress],
  );

  const autoRip = useCallback(() => {
    if (phase === "idle") openPack();
    appendEvent("Auto rip started | synthetic foil tear path");
    animateProgress(1, 860);
  }, [animateProgress, appendEvent, openPack, phase]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (phase === "idle" || phase === "revealed") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPhase("dragging");
      const rect = event.currentTarget.getBoundingClientRect();
      const update = (clientY: number) => {
        const next = clamp((clientY - rect.top - 24) / (rect.height - 64));
        setProgress(next);
      };
      update(event.clientY);
    },
    [phase],
  );

  const onGlobalPointerMove = useCallback(
    (event: globalThis.PointerEvent) => {
      if (phase !== "dragging") return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      setProgress(clamp((event.clientY - rect.top - 24) / (rect.height - 64)));
    },
    [phase],
  );

  const onGlobalPointerUp = useCallback(() => {
    if (phase !== "dragging") return;
    if (progress >= 0.68) {
      appendEvent("Manual rip threshold reached");
      animateProgress(1, 420);
      return;
    }
    appendEvent("Seal snapped back | keep dragging down the seam");
    animateProgress(0, 300);
  }, [animateProgress, appendEvent, phase, progress]);

  useEffect(() => {
    window.addEventListener("pointermove", onGlobalPointerMove);
    window.addEventListener("pointerup", onGlobalPointerUp);
    return () => {
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerUp);
    };
  }, [onGlobalPointerMove, onGlobalPointerUp]);

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
            It uses original placeholder cards and pack art.
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

          <div ref={stageRef}>
            <RipPackVisual
              pack={selectedPack}
              phase={phase}
              progress={progress}
              result={result}
              onPointerDown={onPointerDown}
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
