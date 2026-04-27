import React, { useMemo } from "react";

interface Petal {
  x: number;       // 0-100 (vw)
  y: number;       // 0-100 (vh, relative to canvas)
  size: number;    // px
  rotation: number;
  hue: number;     // hsl hue (around 350 = sakura)
  opacity: number;
  drift: number;   // animation duration multiplier
  phase: number;   // animation phase offset
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
    petals.push({
      x: r() * 100,
      y: r() * 220, // span 220vh — enough for long detail pages
      size: 16 + r() * 30,
      rotation: r() * 360,
      hue: 345 + r() * 18,        // sakura pink range (345–363)
      opacity: 0.22 + r() * 0.28, // 22–50%
      drift: 12 + r() * 18,        // 12–30s sway period
      phase: r() * 30,             // negative animation-delay seed
    });
  }
  return petals;
}

interface SakuraFieldProps {
  /** Number of petals (default 36). */
  count?: number;
  /** Deterministic seed (default fixed). */
  seed?: number;
}

/**
 * A drift of sakura (桜) petals scattered behind the content. Pure SVG, no
 * canvas / no JS animation loop — each petal sways via a CSS keyframe with
 * a randomized phase. Sits at `position: fixed`, `z-index: 0`, so the
 * page content (which gets `relative z-10`) renders cleanly on top.
 */
export function SakuraField({ count = 56, seed = 0xCAFE_F10 }: SakuraFieldProps) {
  const petals = useMemo(() => buildField(seed, count), [seed, count]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"
    >
      {petals.map((p, i) => (
        <svg
          key={i}
          width={p.size}
          height={p.size}
          viewBox="0 0 32 32"
          className="absolute sakura-drift"
          style={{
            left: `${p.x}vw`,
            top: `${p.y}vh`,
            transform: `rotate(${p.rotation}deg)`,
            opacity: p.opacity,
            animationDuration: `${p.drift}s`,
            animationDelay: `-${p.phase}s`,
            color: `hsl(${p.hue.toFixed(0)} 100% 84%)`,
          }}
        >
          {/* Single sakura petal — teardrop with notched tip */}
          <path
            d="M16 3 C 22 3 25 9 23 14 C 22 17 19 18 16 18 C 13 18 10 17 9 14 C 7 9 10 3 16 3 Z M16 12 L 14.5 14 L 16 16 L 17.5 14 Z"
            fill="currentColor"
          />
        </svg>
      ))}
    </div>
  );
}
