import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

/**
 * Compact app mark. Two horizontal beams on two pillars.
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
