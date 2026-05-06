import React, { useEffect, useState } from "react";

interface Petal {
  x: number;        // start position vw
  size: number;     // px
  hue: number;
  lightness: number;
  alpha: number;
  duration: number; // s
  delay: number;    // s — within the burst window
  sway: number;     // px
  spin: number;     // deg
  shape: 0 | 1 | 2;
  mirror: boolean;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBurst(seed: number, count: number): Petal[] {
  const r = rng(seed);
  const petals: Petal[] = [];
  for (let i = 0; i < count; i++) {
    const duration = 5 + r() * 4;     // 5–9s — quick burst, not ambient
    petals.push({
      x: r() * 100,
      size: 22 + r() * 24,
      hue: 348 + r() * 12,
      lightness: 76 + r() * 8,
      alpha: 0.55 + r() * 0.35,        // brighter than ambient — celebratory
      duration,
      delay: r() * 1.2,                // staggered over the first 1.2s
      sway: 28 + r() * 56,
      spin: (r() < 0.5 ? -1 : 1) * (60 + r() * 220),
      shape: Math.floor(r() * 3) as 0 | 1 | 2,
      mirror: r() < 0.5,
    });
  }
  return petals;
}

const PETAL_SHAPES: Array<{ body: string; specular: string }> = [
  {
    body:
      "M32 4 C 46 6 54 18 52 32 C 50 46 42 56 32 60 " +
      "C 22 56 14 46 12 32 C 10 18 18 6 32 4 Z " +
      "M27 55 L 32 60 L 37 55 Z",
    specular:
      "M28 12 C 34 12 40 16 40 24 C 40 30 36 36 30 36 " +
      "C 25 36 22 30 22 24 C 22 16 24 12 28 12 Z",
  },
  {
    body:
      "M32 5 C 41 6 47 16 46 28 C 45 42 41 54 32 60 " +
      "C 23 54 19 42 18 28 C 17 16 23 6 32 5 Z " +
      "M28 55 L 32 60 L 36 55 Z",
    specular:
      "M28 14 C 33 14 38 18 38 26 C 38 34 35 42 30 42 " +
      "C 26 42 23 34 23 26 C 23 18 25 14 28 14 Z",
  },
  {
    body:
      "M28 5 C 42 6 52 18 50 32 C 48 46 38 58 26 60 " +
      "C 17 54 12 42 14 28 C 16 14 22 6 28 5 Z " +
      "M22 55 L 26 60 L 31 56 Z",
    specular:
      "M26 14 C 36 16 42 22 40 30 C 38 38 32 44 26 44 " +
      "C 21 42 19 34 21 26 C 22 18 24 14 26 14 Z",
  },
];

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(0)} ${s}% ${l.toFixed(0)}% / ${a})`;
}

interface SakuraBurstProps {
  /** Increment to fire a new burst. */
  trigger: number;
  /** Petal count per burst (default 36). */
  count?: number;
}

/**
 * Trigger-fired sakura burst — replaces the always-on background field.
 * The brand only "speaks" when something meaningful happens: the user
 * places a bet, or a market resolves. Each `trigger` increment spawns a
 * fresh batch of petals that fall once and clean themselves up.
 *
 * The petals fall when an outcome is decided. Otherwise the chrome is silent.
 */
export function SakuraBurst({ trigger, count = 36 }: SakuraBurstProps) {
  // Each fire gets a unique key so React unmounts the previous batch.
  const [activeBurst, setActiveBurst] = useState<{ id: number; petals: Petal[] } | null>(null);

  useEffect(() => {
    if (trigger <= 0) return;
    const seed = (trigger * 0x9E3779B9) >>> 0;
    const petals = buildBurst(seed, count);
    setActiveBurst({ id: trigger, petals });
    // After the longest petal finishes (max ~10s including delay), unmount.
    const timeout = setTimeout(() => setActiveBurst(null), 11_000);
    return () => clearTimeout(timeout);
  }, [trigger, count]);

  if (!activeBurst) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
    >
      {activeBurst.petals.map((p, i) => {
        const shape = PETAL_SHAPES[p.shape];
        const baseColor = hsl(p.hue, 88, p.lightness);
        const lightColor = hsl(p.hue, 95, Math.min(96, p.lightness + 10));
        const darkColor = hsl(p.hue, 70, Math.max(54, p.lightness - 18));
        const fillId = `sakura-fill-${activeBurst.id}-${i}`;
        const specId = `sakura-spec-${activeBurst.id}-${i}`;

        return (
          <span
            key={`${activeBurst.id}-${i}`}
            className="sakura-burst-petal absolute block"
            style={{
              left: `${p.x}vw`,
              width: p.size,
              height: p.size,
              opacity: p.alpha,
              animationDuration: `${p.duration.toFixed(2)}s`,
              animationDelay: `${p.delay.toFixed(2)}s`,
              ["--sway" as string]: `${p.sway.toFixed(0)}px`,
              ["--spin" as string]: `${p.spin.toFixed(0)}deg`,
              filter: "drop-shadow(0 2px 3px rgba(220, 90, 130, 0.18))",
            }}
          >
            <svg
              viewBox="0 0 64 64"
              width="100%"
              height="100%"
              className="block"
              style={p.mirror ? { transform: "scaleX(-1)" } : undefined}
            >
              <defs>
                <radialGradient id={fillId} cx="38%" cy="34%" r="70%">
                  <stop offset="0%" stopColor={lightColor} />
                  <stop offset="55%" stopColor={baseColor} />
                  <stop offset="100%" stopColor={darkColor} />
                </radialGradient>
                <radialGradient id={specId} cx="42%" cy="30%" r="40%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.78)" />
                  <stop offset="60%" stopColor="rgba(255,255,255,0.20)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
              </defs>
              <path d={shape.body} fill={`url(#${fillId})`} fillRule="evenodd" />
              <path d={shape.specular} fill={`url(#${specId})`} />
              <path
                d={shape.body}
                fill="none"
                stroke={hsl(p.hue, 60, Math.max(48, p.lightness - 22), 0.28)}
                strokeWidth={0.6}
                fillRule="evenodd"
              />
            </svg>
          </span>
        );
      })}
    </div>
  );
}
