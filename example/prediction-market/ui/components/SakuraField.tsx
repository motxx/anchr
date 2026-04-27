import React, { useMemo } from "react";

interface Petal {
  /** Horizontal start (vw). */
  x: number;
  /** Petal width/height in px. */
  size: number;
  /** Hue around sakura pink. */
  hue: number;
  opacity: number;
  /** Fall duration in seconds. */
  duration: number;
  /** Negative animation-delay so each petal starts mid-fall on mount. */
  delay: number;
  /** Horizontal sway amplitude in px (drift left/right while falling). */
  sway: number;
  /** Total rotation across one fall in degrees. */
  spin: number;
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

function buildField(seed: number, count: number): Petal[] {
  const r = rng(seed);
  const petals: Petal[] = [];
  for (let i = 0; i < count; i++) {
    const duration = 11 + r() * 14;       // 11–25s — slow, lazy fall
    petals.push({
      x: r() * 100,
      size: 22 + r() * 26,                // 22–48px (bigger, easier to see)
      hue: 345 + r() * 18,                // 345–363 (sakura pink)
      opacity: 0.55 + r() * 0.40,         // 55–95%
      duration,
      delay: r() * duration,              // staggered so the field is full at t=0
      sway: 40 + r() * 110,               // 40–150px lateral drift
      spin: (r() < 0.5 ? -1 : 1) * (240 + r() * 540), // ±240–780° per fall
    });
  }
  return petals;
}

interface SakuraFieldProps {
  /** Number of petals (default 70). */
  count?: number;
  /** Deterministic seed (default fixed). */
  seed?: number;
}

/**
 * Falling sakura — a fixed full-viewport layer of petals that descend from
 * above the screen, drift sideways with the wind, and rotate as they fall.
 * Pure CSS animation: each petal has its own duration / delay / sway / spin
 * baked in via custom properties, all driven by one shared keyframe so the
 * compositor handles the work.
 *
 * Sits at z-index -10 behind everything (content gets `relative z-10`).
 * Honors `prefers-reduced-motion` by holding petals in place.
 */
export function SakuraField({ count = 70, seed = 0xCAFE_F10 }: SakuraFieldProps) {
  const petals = useMemo(() => buildField(seed, count), [seed, count]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {petals.map((p, i) => (
        <span
          key={i}
          className="sakura-petal absolute block"
          style={{
            left: `${p.x}vw`,
            width: p.size,
            height: p.size,
            color: `hsl(${p.hue.toFixed(0)} 95% 80%)`,
            opacity: p.opacity,
            animationDuration: `${p.duration.toFixed(2)}s`,
            animationDelay: `-${p.delay.toFixed(2)}s`,
            ["--sway" as string]: `${p.sway.toFixed(0)}px`,
            ["--spin" as string]: `${p.spin.toFixed(0)}deg`,
            filter: "drop-shadow(0 1px 2px rgba(255, 110, 140, 0.18))",
          }}
        >
          <svg
            viewBox="0 0 32 32"
            width="100%"
            height="100%"
            className="block"
          >
            {/* Sakura petal — rounded teardrop filling the viewBox, with a
             * subtle V-notch at the tip. Inner darker outline gives volume. */}
            <path
              d="
                M16 1.5
                C 23 2 29 8 28 16
                C 27.4 22 22.5 28 16 30
                C 9.5 28 4.6 22 4 16
                C 3 8 9 2 16 1.5 Z
                M13.4 27.4 L 16 30 L 18.6 27.4 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
            {/* Inner highlight — slightly lighter, gives a sense of volume. */}
            <path
              d="M16 5 C 20 5.5 24 9 23 14 C 22 17 19 19 16 19 C 13 19 10 17 9 14 C 8 9 12 5.5 16 5 Z"
              fill="rgba(255, 255, 255, 0.32)"
            />
          </svg>
        </span>
      ))}
    </div>
  );
}
