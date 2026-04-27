import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Sakura (桜) petal — five-petal symmetric blossom. Used as a decorative
 * accent in the header and near the wordmark. Inherits color from
 * `currentColor`, so callers control the tint via Tailwind text utilities.
 */
export function SakuraIcon({ className, size = 16 }: IconProps) {
  // Five petals arranged at 0°, 72°, 144°, 216°, 288°.
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(16 16)">
        {petals.map((deg) => (
          <path
            key={deg}
            d="M0 -11 C 4.5 -11 5.8 -6 4.4 -2 C 3.6 0 2 1 0 1 C -2 1 -3.6 0 -4.4 -2 C -5.8 -6 -4.5 -11 0 -11 Z"
            transform={`rotate(${deg})`}
            opacity={0.92}
          />
        ))}
        <circle r={1.6} fill="rgba(255, 220, 90, 0.85)" />
      </g>
    </svg>
  );
}

/**
 * Four-pointed sparkle (✨) — used to garnish "live" indicators and CTAs.
 */
export function SparkleIcon({ className, size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2 L13.6 9.4 L21 11 L13.6 12.6 L12 20 L10.4 12.6 L3 11 L10.4 9.4 Z" />
    </svg>
  );
}

/**
 * Stylized torii (鳥居). Same shape as the v1 logo, kept here as a shared
 * primitive so the brand mark stays consistent across surfaces.
 */
export function ToriiIcon({ className, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 5 L22 5" />
      <path d="M5 9 L19 9" />
      <path d="M6 5 L6 21" />
      <path d="M18 5 L18 21" />
    </svg>
  );
}
